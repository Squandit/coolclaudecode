// Auto route: before a turn, a quick Haiku call reads the request and picks which
// model and effort should handle it. One print-mode call per prompt: no tools, no
// thinking, no saved session, about two seconds and a fifth of a cent.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

// Levels are kinds of job, so you can remap any of them to a different model.
const LEVELS = [
  { id: 'easy', name: 'easy', job: 'Simple, clear coding: renames, small edits, boilerplate, one-file changes, config tweaks, running a command, explaining a bit of code.' },
  { id: 'normal', name: 'normal', job: 'Ordinary feature work across a few files with a clear goal, bug fixes with a known cause, writing tests.' },
  { id: 'think', name: 'think', job: 'Asking what to do: advice, planning, design choices, reviewing an approach, comparing options. Also unfamiliar or messy code.' },
  { id: 'hard', name: 'hard', job: 'Hard or risky work: architecture, big refactors, bugs with no clear cause, concurrency, security, performance, or anything an earlier attempt already failed at.' },
];

const DEFAULT_ROUTER = {
  model: 'haiku',
  // Past this much context a switch re-reads the whole conversation uncached, so
  // the route only ever steps up from here.
  stickAt: 40000,
  levels: {
    easy: { model: 'sonnet', effort: 'medium' },
    normal: { model: 'sonnet', effort: 'high' },
    think: { model: 'opus', effort: 'medium' },
    hard: { model: 'opus', effort: 'high' },
  },
};

function cleanRouter(r) {
  const d = DEFAULT_ROUTER;
  if (!r || typeof r !== 'object') return JSON.parse(JSON.stringify(d));
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const levels = {};
  for (const l of LEVELS) {
    const x = (r.levels && r.levels[l.id]) || {};
    levels[l.id] = { model: pick(x.model, MODELS, d.levels[l.id].model), effort: pick(x.effort, EFFORTS, d.levels[l.id].effort) };
  }
  const stick = parseInt(r.stickAt, 10);
  return {
    model: pick(r.model, MODELS, 'haiku'),
    stickAt: Number.isFinite(stick) ? Math.max(0, Math.min(1000000, stick)) : d.stickAt,
    levels,
  };
}

function systemPrompt() {
  return [
    'You route requests in Claude Code (a coding agent) to the cheapest level that will still do the job well.',
    'Reply with one line of JSON and nothing else: {"level":"<id>","why":"<under 10 words>"}',
    '',
    'Levels:',
    ...LEVELS.map((l) => `- ${l.id}: ${l.job}`),
    '',
    'Rules:',
    '- Judge the work the request needs, not how it is worded. A short message can be hard.',
    '- If the request builds on the previous one, weigh what was already going on.',
    '- If the last attempt failed or the user is frustrated with the result, go up a level.',
    '- When torn between two levels, pick the cheaper one.',
  ].join('\n');
}

// Messages that just keep the current work going. No point asking Haiku about these.
const FOLLOW_UP = /^\s*(y|yes|yep|yeah|ok|okay|sure|go|go ahead|do it|continue|carry on|proceed|next|sounds good|looks good|lgtm|thanks|thank you|ty|mb continue)[\s.!]*$/i;
function isFollowUp(text) { return FOLLOW_UP.test(text); }

// Rough strength of a model and effort, to tell a step up from a step down.
function rank(model, effort) {
  const m = { haiku: 0, sonnet: 1, opus: 2, fable: 3 }[model] ?? 1;
  const e = { low: 0, medium: 1, '': 1, high: 2, xhigh: 3, max: 4 }[effort || ''] ?? 1;
  return m * 10 + e;
}

function parseReply(text) {
  const m = String(text || '').match(/\{[^{}]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const level = LEVELS.find((l) => l.id === String(j.level || '').toLowerCase());
    return level ? { level: level.id, why: String(j.why || '').slice(0, 120) } : null;
  } catch { return null; }
}

function userMessage({ text, current, lastPrompt, lastReply }) {
  const parts = [];
  if (current) parts.push(`Current level: ${current}`);
  if (lastPrompt) parts.push(`Previous request:\n${lastPrompt.slice(0, 800)}`);
  if (lastReply) parts.push(`Start of Claude's last reply:\n${lastReply.slice(0, 600)}`);
  parts.push(`New request:\n${text.slice(0, 4000)}`);
  return parts.join('\n\n');
}

// Runs the router call. Resolves { level, why, cost, ms } or { error }.
function pick({ claudePath, dataDir, router, isWin, winQuote, env, ...ctx }) {
  const file = path.join(dataDir, 'router-prompt.md');
  const prompt = systemPrompt();
  try { if (fs.readFileSync(file, 'utf8') !== prompt) throw 0; } catch { fs.writeFileSync(file, prompt); }
  const args = [
    '-p', '--model', router.model, '--system-prompt-file', file,
    '--tools', '', '--no-session-persistence', '--setting-sources', '',
    '--output-format', 'json',
  ];
  const cmd = isWin && /\s/.test(claudePath) ? `"${claudePath}"` : claudePath;
  const started = Date.now();
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve({ ...v, ms: Date.now() - started }); } };
    let child;
    try {
      child = spawn(cmd, isWin ? args.map(winQuote) : args, {
        cwd: dataDir, shell: isWin, windowsHide: true,
        env: { ...env, MAX_THINKING_TOKENS: '0' },
      });
    } catch (e) { return finish({ error: String(e.message || e) }); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ error: 'router timed out' }); }, 30000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', (e) => finish({ error: String(e.message || e) }));
    child.on('close', () => {
      let j;
      try { j = JSON.parse(out); } catch { return finish({ error: (err.trim().split('\n').pop() || 'no answer from the router') }); }
      const got = !j.is_error && parseReply(j.result);
      if (!got) return finish({ error: j.is_error ? String(j.result || 'router error') : 'router gave no level', cost: j.total_cost_usd || 0 });
      finish({ ...got, cost: j.total_cost_usd || 0 });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(userMessage(ctx));
  });
}

// Demo mode: keyword guesses and a short pause, so nothing real runs.
function fakePick({ text }) {
  const t = text.toLowerCase();
  const level = /(why|crash|race|security|architect|refactor|slow|failed again|still broken)/.test(t) ? 'hard'
    : /(should i|what do you think|plan|how would|which|idea|design)/.test(t) ? 'think'
    : /(rename|typo|comment|readme|format|bump|move)/.test(t) ? 'easy' : 'normal';
  const why = { easy: 'small, clear edit', normal: 'regular feature work', think: 'asking for advice', hard: 'unclear cause, needs digging' }[level];
  return new Promise((r) => setTimeout(() => r({ level, why, cost: 0.0021, ms: 900 }), 900));
}

module.exports = { LEVELS, DEFAULT_ROUTER, cleanRouter, pick, fakePick, isFollowUp, rank, parseReply, systemPrompt };
