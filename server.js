#!/usr/bin/env node
// desk: a local web UI for Claude Code.
// Zero dependencies. Drives the `claude` CLI over its stream-json protocol,
// stores its own state in ~/.desk (or $DESK_HOME), and only listens on 127.0.0.1.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFile } = require('child_process');
const { createTerminals } = require('./lib/terminals');
const gitInfo = require('./lib/git');
const crewLib = require('./lib/crew');

const DEMO = process.argv.includes('--demo');
const PORT = Number(process.env.PORT || argValue('--port') || 4317);
const HOST = '127.0.0.1';
const DATA = DEMO
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'desk-demo-'))
  : process.env.DESK_HOME || path.join(os.homedir(), '.desk');
// Demo mode never reads your real Claude Code history, so screenshots stay clean.
const CLAUDE_DIR = DEMO ? path.join(DATA, 'claude') : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const HOME_DIR = DEMO ? path.join(DATA, 'home') : os.homedir();
const PUBLIC = path.join(__dirname, 'public');
const TOKEN = crypto.randomBytes(24).toString('hex');
const IS_WIN = process.platform === 'win32';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

// ---------------------------------------------------------------- storage

fs.mkdirSync(path.join(DATA, 'events'), { recursive: true });

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch { return fallback; }
}
function writeJSON(file, value) {
  const p = path.join(DATA, file);
  fs.writeFileSync(p + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(p + '.tmp', p);
}

const DEFAULT_SETTINGS = {
  claudePath: 'claude',
  model: 'opus',
  effort: 'high',
  permission: 'default',
  defaultCwd: '',
  theme: 'mocha',
  notify: true,
  rice: '',
  editor: '',
  shell: '',
  font: 'JetBrains Mono',
  codeFont: 'JetBrains Mono',
  keys: { mod: 'alt', binds: {} },
  crew: crewLib.DEFAULT_CREW,
};
let settings = { ...DEFAULT_SETTINGS, ...readJSON('settings.json', {}) };
let sessions = readJSON('sessions.json', []);
let usage = readJSON('usage.json', null);

// Sessions that were mid-turn when the server stopped are not running any more.
for (const s of sessions) if (s.status === 'working' || s.status === 'needs_you') s.status = 'idle';

let saveTimer = null;
function saveSessions() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON('sessions.json', sessions), 150);
}

function eventsFile(id) { return path.join(DATA, 'events', id + '.jsonl'); }
// Every stored event gets a per-session sequence number so the page can skip ones it already has.
function storeEvent(s, ev) {
  ev.ts = ev.ts || Date.now();
  s.seq = (s.seq || 0) + 1;
  ev.seq = s.seq;
  fs.appendFileSync(eventsFile(s.id), JSON.stringify(ev) + '\n');
  saveSessions();
}
function appendEvent(s, ev) {
  storeEvent(s, ev);
  broadcast({ kind: 'event', id: s.id, event: ev });
}
function readEvents(id) {
  try {
    return fs.readFileSync(eventsFile(id), 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// Tool results can carry whole files. Keep what the UI shows, drop the rest.
function slimToolResult(r) {
  if (!r || typeof r !== 'object') return typeof r === 'string' ? r.slice(0, 20000) : r;
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'originalFile' || k === 'file') continue;
    if (typeof v === 'string') out[k] = v.length > 20000 ? v.slice(0, 20000) + '\n…' : v;
    else out[k] = v;
  }
  return out;
}
function slimMessageContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map((c) => {
    if (c.type === 'thinking') return { type: 'thinking', thinking: (c.thinking || '').slice(0, 20000) };
    if (c.type === 'tool_result') {
      let body = c.content;
      if (Array.isArray(body)) body = body.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
      if (typeof body === 'string' && body.length > 20000) body = body.slice(0, 20000) + '\n…';
      return { ...c, content: body };
    }
    return c;
  });
}

// ---------------------------------------------------------------- sse

const clients = new Set();
function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

const terminals = createTerminals({ broadcast: (m) => broadcast(m), getSettings: () => settings });

function publicSession(s) {
  const r = runners.get(s.id);
  return { ...s, pending: r ? [...r.pending.values()] : [] };
}
function touch(s, patch) {
  Object.assign(s, patch, { updatedAt: Date.now() });
  saveSessions();
  broadcast({ kind: 'session', session: publicSession(s) });
}

// ---------------------------------------------------------------- claude runner

const runners = new Map(); // session id -> { child, pending, lastCost, ... }

function claudeArgs(s) {
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio',
    '--model', s.model, '--permission-mode', s.permission,
  ];
  if (s.effort) args.push('--effort', s.effort);
  if (s.crew) {
    // Crew mode: helpers as a session-only plugin, planner rules appended to the system prompt.
    const files = crewLib.writeCrewFiles(DATA, settings.crew);
    args.push('--plugin-dir', files.pluginDir, '--append-system-prompt-file', files.plannerFile);
  }
  if (s.started) args.push('--resume', s.sessionId);
  else args.push('--session-id', s.sessionId);
  return args;
}

// On Windows the CLI runs through cmd.exe, which splits unquoted arguments on spaces.
function winQuote(a) {
  return /[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a;
}

function startRunner(s) {
  const existing = runners.get(s.id);
  if (existing && !existing.dead) return existing;

  const cmd = IS_WIN && /\s/.test(settings.claudePath) ? `"${settings.claudePath}"` : settings.claudePath;
  const env = { ...process.env };
  // If desk itself was launched from inside a Claude Code session, don't let the
  // child think it is that session.
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_SESSION_ID; delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = DEMO
    ? require('./demo').spawnFake(s)
    : spawn(cmd, IS_WIN ? claudeArgs(s).map(winQuote) : claudeArgs(s), { cwd: s.cwd, env, shell: IS_WIN, windowsHide: true });

  const r = { child, pending: new Map(), lastCost: 0, lastModelCost: {}, agentCalls: new Map(), dead: false, stderr: '', idleTimer: null, turnOpen: false };
  runners.set(s.id, r);

  const send = (obj) => { if (!r.dead) child.stdin.write(JSON.stringify(obj) + '\n'); };
  r.send = send;
  send({ type: 'control_request', request_id: 'init-' + crypto.randomUUID(), request: { subtype: 'initialize' } });

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    handleClaudeEvent(s, r, ev);
  });
  child.stderr.on('data', (d) => { r.stderr = (r.stderr + d).slice(-4000); });
  child.on('error', (err) => {
    r.dead = true;
    r.turnOpen = false;
    appendEvent(s, { t: 'error', text: err.code === 'ENOENT'
      ? `Couldn't find the claude CLI ("${settings.claudePath}"). Install Claude Code or set its path in settings.`
      : String(err.message || err) });
    touch(s, { status: 'error' });
  });
  child.on('close', (code) => {
    r.dead = true;
    clearTimeout(r.idleTimer);
    runners.delete(s.id);
    if (r.turnOpen) {
      const tail = r.stderr.trim().split('\n').slice(-6).join('\n');
      appendEvent(s, { t: 'error', text: r.stopped ? 'Stopped.' : `claude exited (code ${code}).${tail ? '\n' + tail : ''}` });
      touch(s, { status: r.stopped ? 'idle' : 'error' });
    }
  });
  child.stdin.on('error', () => {});
  return r;
}

function armIdle(s, r) {
  clearTimeout(r.idleTimer);
  // Free the process after 20 idle minutes; the next message resumes the session.
  r.idleTimer = setTimeout(() => { if (!r.turnOpen) try { r.child.stdin.end(); } catch {} }, 20 * 60 * 1000);
}

function handleClaudeEvent(s, r, ev) {
  switch (ev.type) {
    case 'stream_event': {
      // Live text and thinking deltas. Not stored, the final message replaces them.
      const e = ev.event;
      if (ev.parent_tool_use_id) return;
      if (e.type === 'content_block_delta' && (e.delta.type === 'text_delta' || e.delta.type === 'thinking_delta')) {
        broadcast({ kind: 'delta', id: s.id, block: e.delta.type === 'text_delta' ? 'text' : 'thinking', text: e.delta.text || e.delta.thinking || '' });
      } else if (e.type === 'content_block_start' && e.content_block.type === 'text') {
        broadcast({ kind: 'delta', id: s.id, block: 'text', text: '', reset: true });
      }
      return;
    }
    case 'rate_limit_event': {
      const info = ev.rate_limit_info || {};
      const next = { ...(usage || {}), status: info.status, overage: !!info.isUsingOverage, updatedAt: Date.now() };
      if (info.unifiedWindows) Object.assign(next, info.unifiedWindows);
      else if (info.rateLimitType) next[info.rateLimitType] = { utilization: info.utilization, resetsAt: info.resetsAt };
      usage = next;
      writeJSON('usage.json', usage);
      broadcast({ kind: 'usage', usage });
      return;
    }
    case 'control_request': {
      if (ev.request && ev.request.subtype === 'can_use_tool') {
        const p = {
          requestId: ev.request_id,
          tool: ev.request.tool_name,
          input: ev.request.input,
          description: ev.request.description || '',
          suggestions: ev.request.permission_suggestions || [],
          toolUseId: ev.request.tool_use_id,
          at: Date.now(),
        };
        r.pending.set(p.requestId, p);
        touch(s, { status: 'needs_you' });
      } else {
        r.send({ type: 'control_response', response: { subtype: 'error', request_id: ev.request_id, error: 'not supported by desk' } });
      }
      return;
    }
    case 'control_response': {
      const resp = ev.response && ev.response.response;
      if (resp && Array.isArray(resp.commands)) {
        touch(s, { commands: resp.commands.map((c) => ({ name: c.name, description: (c.description || '').slice(0, 140), hint: c.argumentHint || '' })) });
      }
      return;
    }
    case 'system': {
      if (ev.subtype === 'init') {
        const patch = { started: true, modelName: ev.model, version: ev.claude_code_version };
        if (ev.session_id) patch.sessionId = ev.session_id;
        touch(s, patch);
      } else if (ev.subtype === 'task_summary' || ev.subtype === 'status') {
        broadcast({ kind: 'activity', id: s.id, text: ev.subtype === 'task_summary' ? ev.detail : null });
      } else if (ev.subtype === 'compact_boundary') {
        appendEvent(s, { t: 'compact', meta: ev.compact_metadata || null });
      } else if (ev.subtype === 'post_turn_summary' && ev.status_detail) {
        touch(s, { summary: ev.status_detail });
      }
      return;
    }
    case 'assistant':
    case 'user': {
      const out = {
        type: ev.type,
        parent: ev.parent_tool_use_id || null,
        message: { id: ev.message.id, model: ev.message.model, content: slimMessageContent(ev.message.content), usage: ev.message.usage },
      };
      if (ev.tool_use_result !== undefined) out.result = slimToolResult(ev.tool_use_result);
      // Replayed user prompts come back as plain strings; we already stored those.
      if (ev.type === 'user' && typeof ev.message.content === 'string') return;
      if (!out.parent) trackCrew(s, r, ev);
      // A helper that finished in the background can restart work after the turn ended.
      if (ev.type === 'assistant' && !out.parent && (s.status === 'done' || s.status === 'idle')) { r.turnOpen = true; touch(s, { status: 'working' }); }
      appendEvent(s, out);
      return;
    }
    case 'result': {
      const turnCost = Math.max(0, (ev.total_cost_usd || 0) - r.lastCost);
      r.lastCost = ev.total_cost_usd || 0;
      // Cost per model this turn (the CLI reports running totals for the process).
      const byModel = {};
      for (const [name, u] of Object.entries(ev.modelUsage || {})) {
        const prev = r.lastModelCost[name] || 0;
        const d = Math.max(0, (u.costUSD || 0) - prev);
        r.lastModelCost[name] = u.costUSD || 0;
        if (d > 0) byModel[shortModelName(name)] = (byModel[shortModelName(name)] || 0) + d;
      }
      const mu = ev.modelUsage ? (ev.modelUsage[s.modelName] || Object.values(ev.modelUsage).sort((a, b) => (b.contextWindow || 0) - (a.contextWindow || 0))[0]) : null;
      appendEvent(s, {
        type: 'result',
        subtype: ev.subtype,
        isError: !!ev.is_error,
        text: ev.is_error ? String(ev.result || ev.subtype || '') : undefined,
        durationMs: ev.duration_ms,
        steps: ev.num_turns,
        cost: turnCost,
        byModel,
        usage: ev.usage,
        contextWindow: mu ? mu.contextWindow : undefined,
        denials: (ev.permission_denials || []).map((d) => d.tool_name),
      });
      r.turnOpen = false;
      r.pending.clear();
      touch(s, { status: r.stopped ? 'idle' : ev.is_error ? 'error' : 'done' });
      armIdle(s, r);
      return;
    }
  }
}

function shortModelName(name) {
  const m = String(name).match(/(opus|sonnet|haiku|fable|mythos)/i);
  return m ? m[1].toLowerCase() : name;
}

// Remember which task went to which crew level, and log how it went, so the ladder
// can be tuned from real data (see /api/crew/stats).
function trackCrew(s, r, ev) {
  for (const c of ev.message.content || []) {
    if (c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task') && c.input && String(c.input.subagent_type || '').startsWith(crewLib.PLUGIN + ':')) {
      r.agentCalls.set(c.id, c.input);
    }
    if (c.type === 'tool_result' && r.agentCalls.has(c.tool_use_id)) {
      const input = r.agentCalls.get(c.tool_use_id);
      r.agentCalls.delete(c.tool_use_id);
      const res = ev.tool_use_result && typeof ev.tool_use_result === 'object' ? ev.tool_use_result : {};
      if (res.status && res.status !== 'completed') continue;
      const u = res.usage || {};
      const m = String(input.description || '').match(/#(\d+)/);
      const row = {
        ts: Date.now(), session: s.id,
        level: String(input.subagent_type).split(':')[1],
        task: m ? +m[1] : null,
        model: res.resolvedModel || null,
        tokens: res.totalTokens || null,
        out: u.output_tokens || null,
        thinking: u.output_tokens_details ? u.output_tokens_details.thinking_tokens : null,
        ms: res.totalDurationMs || null,
        tools: res.totalToolUseCount || null,
        error: !!c.is_error,
      };
      try { fs.appendFileSync(path.join(DATA, 'crew-log.jsonl'), JSON.stringify(row) + '\n'); } catch {}
    }
  }
}

function crewStats() {
  let rows = [];
  try { rows = fs.readFileSync(path.join(DATA, 'crew-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  // A task that went to a later level after this attempt counts as escalated from it.
  const byTask = new Map();
  for (const r of rows) if (r.task != null) {
    const k = r.session + '#' + r.task;
    if (!byTask.has(k)) byTask.set(k, []);
    byTask.get(k).push(r);
  }
  const escalated = new Set();
  for (const list of byTask.values()) list.sort((a, b) => a.ts - b.ts).slice(0, -1).forEach((r) => escalated.add(r));
  const levels = {};
  for (const r of rows) {
    const L = (levels[r.level] = levels[r.level] || { level: r.level, runs: 0, escalated: 0, tokens: 0, ms: 0 });
    L.runs++;
    if (escalated.has(r)) L.escalated++;
    L.tokens += r.tokens || 0;
    L.ms += r.ms || 0;
  }
  return { total: rows.length, levels: Object.values(levels).map((L) => ({ ...L, avgTokens: L.runs ? Math.round(L.tokens / L.runs) : 0, avgMs: L.runs ? Math.round(L.ms / L.runs) : 0 })) };
}

function sendPrompt(s, text) {
  const r = startRunner(s);
  if (r.dead) return;
  r.turnOpen = true;
  r.stopped = false;
  clearTimeout(r.idleTimer);
  appendEvent(s, { t: 'prompt', text });
  const patch = { status: 'working' };
  if (!s.titled && (!s.title || s.title === 'new session')) patch.title = titleFrom(text);
  touch(s, patch);
  r.send({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' });
}

function titleFrom(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return (words.length > 48 ? words.slice(0, 48) + '…' : words) || 'new session';
}

function answerPermission(s, requestId, decision) {
  const r = runners.get(s.id);
  if (!r) return false;
  const p = r.pending.get(requestId);
  if (!p) return false;
  let response;
  if (decision.allow) {
    response = { behavior: 'allow', updatedInput: decision.updatedInput || p.input };
    if (decision.always && p.suggestions.length) response.updatedPermissions = p.suggestions;
  } else {
    response = { behavior: 'deny', message: decision.message || 'The user said no to this. Ask what they want instead.' };
  }
  r.send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  r.pending.delete(requestId);
  appendEvent(s, { t: 'decision', tool: p.tool, toolUseId: p.toolUseId, allow: !!decision.allow, always: !!decision.always });
  touch(s, { status: r.pending.size ? 'needs_you' : 'working' });
  return true;
}

function stopSession(s) {
  const r = runners.get(s.id);
  if (!r) return;
  r.stopped = true;
  for (const id of r.pending.keys()) answerPermission(s, id, { allow: false, message: 'Stopped by the user.' });
  r.send({ type: 'control_request', request_id: 'int-' + crypto.randomUUID(), request: { subtype: 'interrupt' } });
  // If it doesn't settle, end the process. The session resumes fine next time.
  setTimeout(() => { if (r.turnOpen && !r.dead) killTree(r.child); }, 4000);
}

// On Windows the CLI runs under cmd.exe (shell: true), so kill the whole tree.
function killTree(child) {
  if (IS_WIN && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  } else {
    try { child.kill(); } catch {}
  }
}

// Model/effort/permission are launch flags, so an idle process is restarted to pick them up.
function restartIfIdle(s) {
  const r = runners.get(s.id);
  if (r && !r.turnOpen) try { r.child.stdin.end(); } catch {}
}

// ---------------------------------------------------------------- claude code history

function projectKey(cwd) { return cwd.replace(/[^a-zA-Z0-9]/g, '-'); }

function readChunk(file, start, len) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}

function promptText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return '';
}
function isNoise(text) {
  return !text || /^\s*<(command-|local-command|system-reminder|bash-|task-notification)/.test(text) || text.startsWith('Caveat:');
}

let historyCache = { at: 0, list: [] };
function scanHistory() {
  if (Date.now() - historyCache.at < 5000) return historyCache.list;
  const root = path.join(CLAUDE_DIR, 'projects');
  const files = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch {}
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, d)); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const file = path.join(root, d, n);
      try { const st = fs.statSync(file); files.push({ file, mtime: st.mtimeMs, size: st.size }); } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const list = [];
  for (const f of files.slice(0, 120)) {
    const head = readChunk(f.file, 0, 96 * 1024);
    const tail = f.size > 96 * 1024 ? readChunk(f.file, Math.max(0, f.size - 96 * 1024), 96 * 1024) : '';
    let cwd = null, firstPrompt = null, title = null, branch = null;
    for (const line of (head + '\n' + tail).split('\n')) {
      if (!line.startsWith('{')) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      if (!cwd && d.cwd) cwd = d.cwd;
      if (!branch && d.gitBranch) branch = d.gitBranch;
      if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle;
      if (d.type === 'summary' && d.summary && !title) title = d.summary;
      if (!firstPrompt && d.type === 'user' && !d.isMeta && !d.isSidechain) {
        const t = promptText(d.message && d.message.content);
        if (!isNoise(t)) firstPrompt = t.trim().split('\n')[0].slice(0, 90);
      }
    }
    if (!cwd || (!firstPrompt && !title)) continue;
    list.push({ sessionId: path.basename(f.file, '.jsonl'), file: f.file, cwd, branch, title: title || firstPrompt, updatedAt: f.mtime });
  }
  historyCache = { at: Date.now(), list };
  return list;
}

function projectsList() {
  const map = new Map();
  const add = (cwd, at, title, fromDesk) => {
    const p = map.get(cwd) || { cwd, name: path.basename(cwd) || cwd, count: 0, updatedAt: 0, last: null };
    p.count++;
    if (at > p.updatedAt) { p.updatedAt = at; p.last = title; }
    map.set(cwd, p);
  };
  for (const h of scanHistory()) if (!sessions.some((s) => s.sessionId === h.sessionId)) add(h.cwd, h.updatedAt, h.title);
  for (const s of sessions) add(s.cwd, s.updatedAt, s.title, true);
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
}

// Turn a Claude Code transcript into desk events so an existing session can be picked up here.
function importTranscript(file) {
  const events = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain || d.isMeta) continue;
    const ts = d.timestamp ? Date.parse(d.timestamp) : undefined;
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      const hasResult = Array.isArray(c) && c.some((x) => x.type === 'tool_result');
      if (hasResult) {
        const ev = { type: 'user', parent: null, message: { content: slimMessageContent(c) }, ts };
        if (d.toolUseResult !== undefined) ev.result = slimToolResult(d.toolUseResult);
        events.push(ev);
      } else {
        const t = promptText(c);
        if (!isNoise(t)) events.push({ t: 'prompt', text: t, ts });
      }
    } else if (d.type === 'assistant' && d.message) {
      events.push({ type: 'assistant', parent: null, message: { id: d.message.id, model: d.message.model, content: slimMessageContent(d.message.content), usage: d.message.usage }, ts });
    } else if (d.type === 'system' && d.subtype === 'compact_boundary') {
      events.push({ t: 'compact', ts });
    }
  }
  return events;
}

// ---------------------------------------------------------------- helpers

function gitBranch(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 2000, windowsHide: true }, (err, out) => {
      resolve(err ? null : String(out).trim() || null);
    });
  });
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'target', '.cache', 'coverage', '.turbo', '.idea']);
function listFiles(root, limit = 4000) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1); }
      else out.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
    }
  };
  walk(root, 0);
  return out;
}

// For the neofetch splash in the riced theme. Only ever shown on your own screen.
let sysCache = null;
function systemInfo() {
  if (sysCache) return sysCache;
  let osName = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' }[process.platform] || process.platform;
  if (process.platform === 'linux') {
    try {
      const m = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (m) osName = m[1];
    } catch {}
  }
  let user = 'you', host = 'desk';
  if (!DEMO) { try { user = os.userInfo().username; } catch {} host = os.hostname().split('.')[0]; }
  sysCache = { os: osName, kernel: os.release(), user, host, node: process.version, cpus: os.cpus().length, memGb: Math.round(os.totalmem() / 1073741824) };
  return sysCache;
}

function prettyPath(p) {
  const home = HOME_DIR;
  return p && p.startsWith(home) ? '~' + p.slice(home.length).split(path.sep).join('/') : p;
}

function expandPath(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return path.join(HOME_DIR, p.slice(1));
  return path.resolve(p);
}

function newSession({ cwd, title, sessionId, started, crew }) {
  const n = sessions.reduce((m, s) => Math.max(m, s.number || 0), 0) + 1;
  const s = {
    id: crypto.randomUUID(),
    sessionId: sessionId || crypto.randomUUID(),
    number: n,
    title: title || 'new session',
    cwd,
    model: crew ? settings.crew.planner.model : settings.model,
    effort: crew ? settings.crew.planner.effort : settings.effort,
    permission: settings.permission,
    crew: !!crew,
    status: 'idle',
    started: !!started,
    open: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.unshift(s);
  saveSessions();
  broadcast({ kind: 'session', session: publicSession(s) });
  return s;
}

// ---------------------------------------------------------------- http

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer(async (req, res) => {
  // This server can run code on your machine, so only answer pages it served itself.
  if (!ALLOWED_HOSTS.has(req.headers.host)) { res.writeHead(403); return res.end('forbidden host'); }
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

  const token = req.headers['x-desk-token'] || url.searchParams.get('token');
  if (token !== TOKEN) return json(res, 401, { error: 'bad token, reload the page' });

  try {
    await route(req, res, url);
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
});

// xterm.js comes from node_modules; only these files are served.
const VENDOR = {
  '/vendor/xterm.js': ['@xterm/xterm', 'lib/xterm.js'],
  '/vendor/xterm.css': ['@xterm/xterm', 'css/xterm.css'],
  '/vendor/addon-fit.js': ['@xterm/addon-fit', 'lib/addon-fit.js'],
};

function serveStatic(pathname, res) {
  if (pathname === '/') pathname = '/index.html';
  if (VENDOR[pathname]) {
    let file;
    try { file = path.join(path.dirname(require.resolve(VENDOR[pathname][0] + '/package.json')), VENDOR[pathname][1]); } catch { res.writeHead(404); return res.end(); }
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'max-age=86400' });
      res.end(data);
    });
  }
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    if (pathname === '/index.html') data = Buffer.from(String(data).replace('__DESK_TOKEN__', TOKEN));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY' });
    res.end(data);
  });
}

async function route(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const m = req.method;

  if (m === 'GET' && parts[0] === 'stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (m === 'GET' && parts[0] === 'state') {
    return json(res, 200, {
      settings, usage, demo: DEMO,
      home: prettyPath(HOME_DIR),
      platform: process.platform,
      system: systemInfo(),
      sessions: sessions.map(publicSession),
    });
  }

  if (m === 'GET' && parts[0] === 'projects') {
    const history = scanHistory().filter((h) => !sessions.some((s) => s.sessionId === h.sessionId)).slice(0, 60)
      .map(({ file, ...h }) => ({ ...h, where: prettyPath(h.cwd) }));
    return json(res, 200, { projects: projectsList().map((p) => ({ ...p, where: prettyPath(p.cwd) })), history });
  }

  if (m === 'PUT' && parts[0] === 'settings') {
    const body = await readBody(req);
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (body[k] !== undefined) settings[k] = body[k];
    if (typeof settings.rice !== 'string' || settings.rice.length > 50000) settings.rice = '';
    for (const k of ['font', 'codeFont']) if (typeof settings[k] !== 'string' || settings[k].length > 60) settings[k] = 'JetBrains Mono';
    settings.crew = crewLib.cleanCrew(settings.crew);
    if (body.crew) for (const x of sessions) if (x.crew) {
      Object.assign(x, { model: settings.crew.planner.model, effort: settings.crew.planner.effort });
      broadcast({ kind: 'session', session: publicSession(x) });
      restartIfIdle(x);
    }
    const k = settings.keys;
    if (!k || typeof k !== 'object' || !['alt', 'ctrl+alt', 'alt+shift', 'ctrl+shift'].includes(k.mod)) settings.keys = { mod: 'alt', binds: {} };
    else settings.keys = { mod: k.mod, binds: Object.fromEntries(Object.entries(k.binds || {}).filter(([a, c]) => /^\w{1,20}$/.test(a) && typeof c === 'string' && c.length < 60)) };
    writeJSON('settings.json', settings);
    broadcast({ kind: 'settings', settings });
    return json(res, 200, settings);
  }

  if (m === 'GET' && parts[0] === 'crew') return json(res, 200, { defaults: crewLib.DEFAULT_CREW, stats: crewStats() });

  if (m === 'GET' && parts[0] === 'changelog') {
    let text = '';
    try { text = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch {}
    return json(res, 200, { text, version: require('./package.json').version });
  }

  if (parts[0] === 'terms') {
    const id = parts[1];
    if (m === 'GET' && !id) return json(res, 200, { available: terminals.available, error: terminals.error, editor: terminals.defaultEditor(), shell: terminals.defaultShell(), terms: terminals.list() });
    if (m === 'POST' && !id) {
      const body = await readBody(req);
      let cwd = body.cwd ? expandPath(body.cwd) : null;
      const s = body.sessionId && sessions.find((x) => x.id === body.sessionId);
      if (s) cwd = s.cwd;
      if (!cwd) cwd = expandPath(settings.defaultCwd || HOME_DIR);
      try { return json(res, 200, terminals.create({ cwd, cols: body.cols, rows: body.rows, open: body.open, sessionId: s ? s.id : null })); }
      catch (err) { return json(res, 400, { error: err.message }); }
    }
    if (m === 'GET' && parts[2] === 'buffer') { const t = terminals.get(id); return t ? json(res, 200, { data: t.buf, end: t.total }) : json(res, 404, { error: 'gone' }); }
    if (m === 'POST' && parts[2] === 'input') { const b = await readBody(req); return json(res, 200, { ok: terminals.write(id, b.data) }); }
    if (m === 'POST' && parts[2] === 'resize') { const b = await readBody(req); return json(res, 200, { ok: terminals.resize(id, b.cols, b.rows) }); }
    if (m === 'DELETE' && id) return json(res, 200, { ok: terminals.kill(id) });
  }

  if (m === 'GET' && parts[0] === 'version') {
    if (DEMO) return json(res, 200, { version: 'demo' });
    const cmd = IS_WIN && /\s/.test(settings.claudePath) ? `"${settings.claudePath}"` : settings.claudePath;
    const child = spawn(cmd, ['--version'], { shell: IS_WIN, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => json(res, 200, { version: null }));
    child.on('close', () => { if (!res.headersSent) json(res, 200, { version: out.trim() || null }); });
    return;
  }

  if (parts[0] === 'sessions') {
    if (m === 'POST' && parts.length === 1) {
      const body = await readBody(req);
      if (body.importSessionId) {
        const h = scanHistory().find((x) => x.sessionId === body.importSessionId);
        if (!h) return json(res, 404, { error: 'session not found' });
        const existing = sessions.find((s) => s.sessionId === h.sessionId);
        if (existing) { touch(existing, { open: true }); return json(res, 200, publicSession(existing)); }
        const s = newSession({ cwd: h.cwd, title: h.title, sessionId: h.sessionId, started: true });
        s.titled = true;
        for (const ev of importTranscript(h.file)) storeEvent(s, ev);
        s.status = 'done';
        saveSessions();
        return json(res, 200, publicSession(s));
      }
      const cwd = expandPath(body.cwd || settings.defaultCwd || HOME_DIR);
      if (DEMO) fs.mkdirSync(cwd, { recursive: true });
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return json(res, 400, { error: `No folder at ${body.cwd}` });
      const s = newSession({ cwd, title: body.title, crew: !!body.crew });
      if (body.prompt) sendPrompt(s, body.prompt);
      return json(res, 200, publicSession(s));
    }

    const s = sessions.find((x) => x.id === parts[1]);
    if (!s) return json(res, 404, { error: 'no such session' });
    const action = parts[2];

    if (m === 'GET' && !action) {
      return json(res, 200, { session: publicSession(s), events: readEvents(s.id), branch: await gitBranch(s.cwd), where: prettyPath(s.cwd) });
    }
    if (m === 'GET' && action === 'files') return json(res, 200, { files: listFiles(s.cwd) });
    if (m === 'GET' && action === 'changes') return json(res, 200, await gitInfo.changes(s.cwd));
    if (m === 'GET' && action === 'diff') {
      try { return json(res, 200, await gitInfo.fileDiff(s.cwd, url.searchParams.get('path') || '')); }
      catch (err) { return json(res, 400, { error: err.message }); }
    }
    if (m === 'POST' && action === 'send') {
      const { text } = await readBody(req);
      if (!text || !text.trim()) return json(res, 400, { error: 'empty' });
      sendPrompt(s, text);
      return json(res, 200, { ok: true });
    }
    if (m === 'POST' && action === 'stop') { stopSession(s); return json(res, 200, { ok: true }); }
    if (m === 'POST' && action === 'permission') {
      const body = await readBody(req);
      return json(res, 200, { ok: answerPermission(s, body.requestId, body) });
    }
    if (m === 'PATCH' && !action) {
      const body = await readBody(req);
      const patch = {};
      if (typeof body.title === 'string' && body.title.trim()) { patch.title = body.title.trim().slice(0, 80); patch.titled = true; }
      if (typeof body.open === 'boolean') patch.open = body.open;
      if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
      let relaunch = false;
      for (const k of ['model', 'effort', 'permission']) if (body[k] && body[k] !== s[k]) { patch[k] = body[k]; relaunch = true; }
      if (typeof body.crew === 'boolean' && body.crew !== !!s.crew) {
        patch.crew = body.crew;
        relaunch = true;
        // Crew mode runs the planner's model; going back to solo keeps whatever it was.
        if (body.crew) { patch.model = settings.crew.planner.model; patch.effort = settings.crew.planner.effort; }
      }
      touch(s, patch);
      if (relaunch) restartIfIdle(s);
      return json(res, 200, publicSession(s));
    }
    if (m === 'DELETE' && !action) {
      stopSession(s);
      sessions = sessions.filter((x) => x !== s);
      saveSessions();
      try { fs.unlinkSync(eventsFile(s.id)); } catch {}
      broadcast({ kind: 'removed', id: s.id });
      return json(res, 200, { ok: true });
    }
  }

  json(res, 404, { error: 'not found' });
}

const demoSeed = DEMO && require('./demo').seed({ newSession, appendEvent: storeEvent, sessions, saveSessions, setUsage: (u) => { usage = u; }, DATA });

server.listen(PORT, HOST, () => {
  if (demoSeed && demoSeed.autoplay) demoSeed.autoplay.forEach((a, i) => setTimeout(() => sendPrompt(a.session, a.prompt), 1500 + i * 700));
  const link = `http://localhost:${PORT}`;
  console.log(`\n  desk is running at ${link}${DEMO ? '  (demo mode, nothing real runs)' : ''}\n`);
  if (process.argv.includes('--open')) {
    const opener = IS_WIN ? ['cmd', ['/c', 'start', '', link]] : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
});

function shutdown() {
  for (const r of runners.values()) killTree(r.child);
  terminals.killAll();
  if (DEMO) try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
