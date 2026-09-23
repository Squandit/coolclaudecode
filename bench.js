#!/usr/bin/env node
// Compare ways of running the same task: solo vs crew, full tools vs lean.
//
//   node bench.js "your prompt"                  (or: npm run bench -- "your prompt")
//   node bench.js --prompt-file task.txt --from ~/code/my-project
//
// Each variant runs in its own copy of the folder, with the real `claude` CLI and your
// real login, so it does use your plan. Results land in bench-results/<time>/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const crewLib = require('./lib/crew');

const IS_WIN = process.platform === 'win32';
const VARIANTS = {
  solo: { crew: false, lean: false, about: 'one session, all tools' },
  'solo-lean': { crew: false, lean: true, about: 'one session, file and shell tools only' },
  crew: { crew: true, lean: false, about: 'planner + helpers, all tools' },
  'crew-lean': { crew: true, lean: true, about: 'planner + helpers, file and shell tools only' },
};

// ------------------------------------------------------------------ options

function parseArgs(argv) {
  const o = { variants: ['solo', 'solo-lean', 'crew', 'crew-lean'], model: 'opus', effort: 'high', timeout: 30, parallel: true, claude: 'claude' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--prompt-file') o.prompt = fs.readFileSync(next(), 'utf8');
    else if (a === '--from') o.from = path.resolve(expand(next()));
    else if (a === '--variants') o.variants = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--model') o.model = next();
    else if (a === '--effort') o.effort = next();
    else if (a === '--check') o.check = next();
    else if (a === '--timeout') o.timeout = Number(next()) || 30;
    else if (a === '--one-at-a-time') o.parallel = false;
    else if (a === '--claude') o.claude = next();
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  if (!o.prompt && rest.length) o.prompt = rest.join(' ');
  return o;
}

function expand(p) {
  return p && (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) ? path.join(os.homedir(), p.slice(1)) : p;
}

const HELP = `desk bench: run one prompt several ways and compare usage, time and results.

  node bench.js "prompt"                      run the prompt in fresh empty folders
  node bench.js --prompt-file task.txt        read the prompt from a file
  --from <folder>        copy this project into each run (node_modules is skipped)
  --variants a,b         any of: ${Object.keys(VARIANTS).join(', ')} (default: all four)
  --model opus --effort high     solo model and effort (crew uses your crew settings)
  --check "<command>"    how to judge the result (default: npm test or node --test)
  --one-at-a-time        run variants one after another instead of together
  --timeout 30           minutes before a variant is stopped
  --claude <path>        the claude CLI, if it isn't on your PATH`;

// ------------------------------------------------------------------ helpers

function winQuote(a) { return /[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a; }

function deskCrewSettings() {
  const home = process.env.DESK_HOME || path.join(os.homedir(), '.desk');
  try { return JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')).crew; } catch { return null; }
}

function copyProject(from, to) {
  const skip = new Set(['node_modules', 'bench-results', '.desk']);
  fs.cpSync(from, to, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
}

function countFiles(dir) {
  let files = 0, lines = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        files++;
        try { const t = fs.readFileSync(p, 'utf8'); if (!t.includes('\0')) lines += t.split('\n').length; } catch {}
      }
    }
  };
  try { walk(dir); } catch {}
  return { files, lines };
}

// Find where the tests live (the task may have made a subfolder) and run them.
function runCheck(dir, cmd) {
  let where = dir;
  if (!cmd) {
    const pkgs = [];
    const walk = (d, depth) => {
      if (depth > 3) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (/(^package\.json$)|(\.test\.[cm]?js$)|(^test\.[cm]?js$)/.test(e.name)) pkgs.push(d);
      }
    };
    try { walk(dir, 0); } catch {}
    if (!pkgs.length) return { ran: false, text: 'no tests found' };
    where = pkgs.sort((a, b) => a.length - b.length)[0];
    let hasScript = false;
    try { hasScript = !!JSON.parse(fs.readFileSync(path.join(where, 'package.json'), 'utf8')).scripts?.test; } catch {}
    cmd = hasScript ? 'npm test' : 'node --test';
  }
  const r = spawnSync(cmd, { cwd: where, shell: true, encoding: 'utf8', timeout: 5 * 60 * 1000, env: { ...process.env, CI: '1' } });
  const out = (r.stdout || '') + (r.stderr || '');
  const num = (k) => { const m = out.match(new RegExp(`^[#ℹ\\s]*${k}\\s+(\\d+)`, 'm')); return m ? +m[1] : null; };
  const pass = num('pass'), fail = num('fail'), total = num('tests');
  return {
    ran: true, cmd, where: path.relative(dir, where) || '.', ok: r.status === 0,
    text: total != null ? `${pass}/${total} pass${fail ? `, ${fail} fail` : ''}` : r.status === 0 ? 'passed' : `failed (exit ${r.status})`,
  };
}

// ------------------------------------------------------------------ one run

function runVariant(name, opts, outDir) {
  const v = VARIANTS[name];
  const work = path.join(outDir, name);
  fs.mkdirSync(work, { recursive: true });
  if (opts.from) copyProject(opts.from, work);

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash,Read,Write,Edit,MultiEdit,Glob,Grep,Agent,Task,TodoWrite,TaskCreate,TaskUpdate,TaskList,TaskGet,BashOutput,KillShell,WebFetch,WebSearch'];
  let crew = null;
  if (v.crew) {
    crew = crewLib.cleanCrew(deskCrewSettings());
    crew.approve = false; // nobody is there to say "go"
    crew.leanHelpers = v.lean;
    const files = crewLib.writeCrewFiles(path.join(outDir, `.${name}-crew`), crew);
    args.push('--model', crew.planner.model, '--plugin-dir', files.pluginDir, '--append-system-prompt-file', files.plannerFile);
    if (crew.planner.effort) args.push('--effort', crew.planner.effort);
  } else {
    args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
  }
  if (v.lean) args.push('--tools', (v.crew ? crewLib.LEAN_PLANNER : crewLib.LEAN_SOLO).join(','));

  const env = { ...process.env };
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_SESSION_ID; delete env.CLAUDE_CODE_ENTRYPOINT;
  const log = fs.createWriteStream(path.join(outDir, `${name}.jsonl`));
  const started = Date.now();
  const st = { name, results: [], helpers: new Map(), calls: new Map(), usageBefore: null, usageAfter: null, error: null };

  return new Promise((resolve) => {
    const cmd = IS_WIN && /\s/.test(opts.claude) ? `"${opts.claude}"` : opts.claude;
    const child = spawn(cmd, IS_WIN ? args.map(winQuote) : args, { cwd: work, env, shell: IS_WIN, windowsHide: true });
    const kill = setTimeout(() => { st.error = `stopped after ${opts.timeout} min`; child.kill(); }, opts.timeout * 60 * 1000);
    child.stdin.end(opts.prompt);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-3000); });
    child.on('error', (err) => { st.error = err.code === 'ENOENT' ? `can't find "${opts.claude}"` : err.message; });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      log.write(line + '\n');
      let d; try { d = JSON.parse(line); } catch { return; }
      if (d.type === 'result') st.results.push(d);
      if (d.type === 'rate_limit_event' && d.rate_limit_info) {
        const w = d.rate_limit_info.unifiedWindows || {};
        const snap = { week: w.seven_day?.utilization, five: w.five_hour?.utilization };
        if (!st.usageBefore) st.usageBefore = snap;
        st.usageAfter = snap;
      }
      // Crew helpers: who got what, and how big each run was.
      if (d.type === 'assistant' && !d.parent_tool_use_id) {
        for (const c of d.message.content || []) {
          if (c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task') && String(c.input?.subagent_type || '').startsWith(crewLib.PLUGIN + ':')) {
            st.calls.set(c.id, { level: c.input.subagent_type.split(':')[1], desc: c.input.description || '' });
          }
        }
      }
      if (d.type === 'system' && d.subtype === 'task_progress' && st.calls.has(d.tool_use_id)) {
        st.helpers.set(d.tool_use_id, { ...st.calls.get(d.tool_use_id), tokens: d.usage?.total_tokens, ms: d.usage?.duration_ms, tools: d.usage?.tool_uses, status: 'running' });
      }
      if (d.type === 'system' && d.subtype === 'task_notification' && st.calls.has(d.tool_use_id)) {
        const h = st.helpers.get(d.tool_use_id) || { ...st.calls.get(d.tool_use_id) };
        st.helpers.set(d.tool_use_id, { ...h, status: d.status });
      }
      if (d.type === 'user' && !d.parent_tool_use_id && d.tool_use_result?.status === 'completed') {
        const c = (d.message.content || []).find((x) => x.type === 'tool_result');
        if (c && st.calls.has(c.tool_use_id)) {
          const r = d.tool_use_result;
          st.helpers.set(c.tool_use_id, { ...st.calls.get(c.tool_use_id), tokens: r.totalTokens, ms: r.totalDurationMs, tools: r.totalToolUseCount, status: 'completed', model: r.resolvedModel });
        }
      }
    });
    child.on('close', () => {
      clearTimeout(kill);
      log.end();
      st.wallMs = Date.now() - started;
      if (!st.results.length && !st.error) st.error = stderr.trim().split('\n').slice(-3).join(' ') || 'no result';
      st.check = runCheck(work, opts.check);
      st.size = countFiles(work);
      st.crew = crew;
      process.stdout.write(`  ${name} finished in ${fmtDur(st.wallMs)}${st.error ? ` (${st.error})` : ''}\n`);
      resolve(st);
    });
  });
}

// ------------------------------------------------------------------ report

function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
function fmtK(n) { return n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n); }
function money(n) { return n == null ? '–' : '$' + n.toFixed(3); }

function summarise(st) {
  const last = st.results[st.results.length - 1] || {};
  const mu = last.modelUsage || {};
  const tok = { read: 0, write: 0, fresh: 0, out: 0 };
  const byModel = [];
  for (const [m, u] of Object.entries(mu)) {
    tok.read += u.cacheReadInputTokens || 0; tok.write += u.cacheCreationInputTokens || 0; tok.fresh += u.inputTokens || 0; tok.out += u.outputTokens || 0;
    if ((u.costUSD || 0) >= 0.005) byModel.push(`${m.replace(/^claude-/, '').replace(/-\d{8}$/, '')} ${money(u.costUSD)}`);
  }
  const helpers = [...st.helpers.values()];
  const tasks = new Map();
  for (const h of helpers) { const n = (h.desc.match(/#(\d+)/) || [])[1]; if (n) tasks.set(n, (tasks.get(n) || 0) + 1); }
  const escalations = [...tasks.values()].reduce((a, n) => a + Math.max(0, n - 1), 0);
  const week = st.usageBefore?.week != null && st.usageAfter?.week != null ? (st.usageAfter.week - st.usageBefore.week) * 100 : null;
  return {
    name: st.name,
    wall: st.wallMs, api: st.results.reduce((a, r) => a + (r.duration_api_ms || 0), 0),
    turns: st.results.reduce((a, r) => a + (r.num_turns || 0), 0),
    cost: last.total_cost_usd ?? null,
    tokens: tok.read + tok.write + tok.fresh + tok.out, tok, byModel,
    helpers, escalations, week,
    check: st.check, size: st.size, error: st.error,
    final: String(last.result || '').slice(0, 600),
  };
}

function table(rows) {
  const cols = [
    ['', (r) => r.name],
    ['time', (r) => fmtDur(r.wall)],
    ['cost', (r) => money(r.cost)],
    ['tokens', (r) => fmtK(r.tokens)],
    ['re-read', (r) => fmtK(r.tok.read)],
    ['output', (r) => fmtK(r.tok.out)],
    ['steps', (r) => String(r.turns || '–')],
    ['helpers', (r) => (r.helpers.length ? `${r.helpers.length}${r.escalations ? ` (${r.escalations} up)` : ''}` : '–')],
    ['tests', (r) => (r.check.ran ? r.check.text : r.check.text)],
    ['files', (r) => `${r.size.files} / ${r.size.lines} lines`],
  ];
  const base = rows.find((r) => r.name === 'solo' && r.cost);
  if (base) cols.push(['vs solo', (r) => (r.cost ? `${(r.cost / base.cost).toFixed(2)}× cost, ${(r.wall / base.wall).toFixed(2)}× time` : '–')]);
  if (rows.some((r) => r.week != null)) cols.push(['week used', (r) => (r.week != null ? `+${r.week.toFixed(1)}%` : '–')]);
  const cells = [cols.map((c) => c[0]), ...rows.map((r) => cols.map((c) => c[1](r)))];
  const widths = cols.map((_, i) => Math.max(...cells.map((row) => row[i].length)));
  const line = (row) => row.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(cells[0]), widths.map((w) => '─'.repeat(w)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

function markdown(rows, opts, when) {
  let md = `# desk bench, ${when}\n\n**Prompt**\n\n> ${opts.prompt.trim().replace(/\n/g, '\n> ')}\n\n`;
  md += `Solo runs on ${opts.model}${opts.effort ? ` at ${opts.effort} effort` : ''}. Crew runs use your crew settings, with the plan approval step turned off.\n\n`;
  md += '```\n' + table(rows) + '\n```\n\n';
  for (const r of rows) {
    md += `## ${r.name}\n\n${VARIANTS[r.name].about}. `;
    md += `Cost by model: ${r.byModel.join(', ') || '–'}. Tokens: ${fmtK(r.tok.read)} re-read, ${fmtK(r.tok.write)} written to cache, ${fmtK(r.tok.fresh)} fresh input, ${fmtK(r.tok.out)} output.\n\n`;
    if (r.check.ran) md += `Tests: \`${r.check.cmd}\` in \`${r.check.where}\`: ${r.check.text}.\n\n`;
    if (r.helpers.length) md += r.helpers.map((h) => `- ${h.level.toUpperCase()} ${h.desc}: ${fmtK(h.tokens)} tokens, ${fmtDur(h.ms)}, ${h.status}`).join('\n') + '\n\n';
    if (r.error) md += `Problem: ${r.error}\n\n`;
    if (r.final) md += `Last words:\n\n> ${r.final.replace(/\n/g, '\n> ')}\n\n`;
  }
  return md;
}

// ------------------------------------------------------------------ main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.prompt) { console.log(HELP); process.exit(opts.help ? 0 : 1); }
  const unknown = opts.variants.filter((v) => !VARIANTS[v]);
  if (unknown.length) { console.error(`Unknown variant: ${unknown.join(', ')}. Pick from ${Object.keys(VARIANTS).join(', ')}.`); process.exit(1); }
  if (opts.from && !fs.existsSync(opts.from)) { console.error(`No folder at ${opts.from}`); process.exit(1); }

  const when = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const outDir = path.join(__dirname, 'bench-results', when);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'prompt.txt'), opts.prompt);
  console.log(`\nRunning ${opts.variants.join(', ')} ${opts.parallel ? 'side by side' : 'one at a time'}. This uses your plan. Results: ${path.relative(process.cwd(), outDir)}\n`);

  const states = [];
  if (opts.parallel) states.push(...(await Promise.all(opts.variants.map((v) => runVariant(v, opts, outDir)))));
  else for (const v of opts.variants) states.push(await runVariant(v, opts, outDir));

  const rows = states.map(summarise);
  console.log('\n' + table(rows) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.md'), markdown(rows, opts, when));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rows, null, 2));
  console.log(`Full report: ${path.relative(process.cwd(), path.join(outDir, 'report.md'))}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
