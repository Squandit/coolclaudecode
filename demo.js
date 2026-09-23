// Demo mode: a pretend `claude` process that speaks the same stream-json protocol,
// plus a few seeded sessions. Everything here is made up.

const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MODEL = 'claude-opus-5-5';
const uid = () => 'toolu_' + crypto.randomBytes(8).toString('hex');
const mid = () => 'msg_' + crypto.randomBytes(8).toString('hex');

const COMMANDS = [
  { name: 'compact', description: 'Summarise the conversation so far to free up context' },
  { name: 'clear', description: 'Start over with an empty context' },
  { name: 'review', description: 'Review the current changes' },
  { name: 'init', description: 'Write a CLAUDE.md for this project' },
  { name: 'cost', description: 'Show what this session has used' },
];

function usageBlock(ctx, out) {
  return { input_tokens: 12, cache_creation_input_tokens: 900, cache_read_input_tokens: ctx - 912, output_tokens: out };
}

// ------------------------------------------------------------------ fake process

function spawnFake(session) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 0;

  let cost = 0;
  let timers = [];
  let waiting = null;
  let turn = 0;
  let closed = false;

  const out = (o) => { if (!closed) child.stdout.write(JSON.stringify(o) + '\n'); };
  const later = (ms, fn) => { const t = setTimeout(fn, ms); timers.push(t); };
  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout);
    child.stdout.end();
    setTimeout(() => child.emit('close', 0), 10);
  };
  child.kill = close;

  readline.createInterface({ input: child.stdin }).on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'control_request' && msg.request.subtype === 'initialize') {
      out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { commands: COMMANDS } } });
    } else if (msg.type === 'control_request' && msg.request.subtype === 'interrupt') {
      timers.forEach(clearTimeout); timers = []; waiting = null;
      out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
      out({ type: 'result', subtype: 'error_during_execution', is_error: false, duration_ms: 1200, num_turns: 1, total_cost_usd: cost, usage: usageBlock(40000, 10), modelUsage: { [MODEL]: { contextWindow: 200000 } } });
    } else if (msg.type === 'control_response' && waiting) {
      const w = waiting; waiting = null;
      w(msg.response.response);
    } else if (msg.type === 'user') {
      turn++;
      play(script(session, msg.message.content, turn));
    }
  });
  child.stdin.on('end', close);

  function play(steps) {
    const started = Date.now();
    let i = 0;
    const finish = () => {
      cost += 0.061;
      out({ type: 'result', subtype: 'success', is_error: false, duration_ms: Date.now() - started, num_turns: 3, total_cost_usd: cost, usage: usageBlock(61800 + turn * 2400, 690), modelUsage: { [MODEL]: { contextWindow: 200000 } }, permission_denials: [] });
    };
    const next = () => {
      if (i >= steps.length) return later(200, finish);
      const step = steps[i++];
      if (step.ask) {
        const asks = session.permission === 'default' || (session.permission === 'acceptEdits' && step.ask.tool === 'Bash');
        if (!asks) return next();
        waiting = (answer) => {
          if (answer.behavior === 'deny') {
            i = steps.length;
            out(toolResult(step.ask.id, 'The user said no to this.', null, true));
            later(400, () => { out(assistantText("Okay, I won't run that. Tell me what you'd rather do.")); finish(); });
            return;
          }
          later(300, next);
        };
        out({ type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'can_use_tool', tool_name: step.ask.tool, input: step.ask.input, description: step.ask.description, tool_use_id: step.ask.id, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: step.ask.tool }], behavior: 'allow', destination: 'session' }] } });
        return;
      }
      later(step.wait || 400, () => {
        if (step.stream) {
          const words = step.stream.split(/(?<= )/);
          out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
          words.forEach((w, k) => later(k * 35, () => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } } })));
          later(words.length * 35 + 60, () => { out(assistantText(step.stream)); next(); });
          return;
        }
        if (step.activity !== undefined) out({ type: 'system', subtype: 'task_summary', detail: step.activity });
        if (step.ev) out(step.ev);
        next();
      });
    };
    next();
  }

  function script(s, prompt, n) {
    const cwd = s.cwd;
    const file = (f) => path.join(cwd, f);
    const edit1 = uid(), bash = uid(), todo = uid(), todo2 = uid(), read = uid();
    return [
      { wait: 150, ev: { type: 'system', subtype: 'init', session_id: s.sessionId, model: MODEL, claude_code_version: 'demo' } },
      { wait: 50, ev: { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.42 + n * 0.01, resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600 }, seven_day: { utilization: 0.88, resetsAt: Math.floor(Date.now() / 1000) + 3 * 86400 } } } } },
      { wait: 500, activity: 'Reading the project' },
      { wait: 400, ev: assistantTool(read, 'Read', { file_path: file('index.html') }) },
      { wait: 300, ev: toolResult(read, '<!doctype html>…', { type: 'text', file: { filePath: file('index.html'), numLines: 48 } }) },
      { wait: 500, ev: assistantTool(todo, 'TodoWrite', { todos: [
        { content: 'Add a --units flag', status: 'completed', activeForm: 'Adding a --units flag' },
        { content: 'Convert temperatures', status: 'in_progress', activeForm: 'Converting temperatures' },
        { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
      ] }) },
      { wait: 200, ev: toolResult(todo, 'Todos updated', { oldTodos: [], newTodos: [] }) },
      { stream: `Going with a single \`--units\` flag that takes \`metric\` or \`imperial\`, defaulting to metric.` },
      { wait: 300, activity: 'Editing forecast.js', ev: assistantTool(edit1, 'Edit', { file_path: file('forecast.js'), old_string: 'return c;', new_string: "return units === 'imperial' ? c * 9 / 5 + 32 : c;" }) },
      { ask: { id: edit1, tool: 'Edit', description: 'forecast.js', input: { file_path: file('forecast.js'), old_string: 'return c;', new_string: "return units === 'imperial' ? c * 9 / 5 + 32 : c;" } } },
      { wait: 300, ev: toolResult(edit1, 'The file has been updated.', { filePath: file('forecast.js'), structuredPatch: [{ oldStart: 14, oldLines: 3, newStart: 14, newLines: 3, lines: [' function toUnits(c, units) {', '-  return c;', "+  return units === 'imperial' ? c * 9 / 5 + 32 : c;", ' }'] }] }) },
      { wait: 300, activity: 'Running the tests', ev: assistantTool(bash, 'Bash', { command: 'npm test', description: 'Run the test suite' }) },
      { ask: { id: bash, tool: 'Bash', description: 'Run the test suite', input: { command: 'npm test', description: 'Run the test suite' } } },
      { wait: 1200, ev: toolResult(bash, '', { stdout: '> weather-cli@0.3.0 test\n> node --test\n\n✔ converts 20°C to 68°F\n✔ keeps metric by default\n✔ rejects --units=kelvin\nℹ tests 3\nℹ pass 3\nℹ fail 0', stderr: '', interrupted: false }) },
      { wait: 300, ev: assistantTool(todo2, 'TodoWrite', { todos: [
        { content: 'Add a --units flag', status: 'completed', activeForm: 'Adding a --units flag' },
        { content: 'Convert temperatures', status: 'completed', activeForm: 'Converting temperatures' },
        { content: 'Run the tests', status: 'completed', activeForm: 'Running the tests' },
      ] }) },
      { wait: 150, ev: toolResult(todo2, 'Todos updated', {}) },
      { wait: 100, activity: null },
      { stream: 'Done. `weather --units imperial` now prints Fahrenheit, metric stays the default, and all 3 tests pass.' },
    ];
  }

  return child;
}

function assistantText(text) {
  return { type: 'assistant', message: { id: mid(), model: MODEL, content: [{ type: 'text', text }], usage: usageBlock(62000, 80) }, parent_tool_use_id: null };
}
function assistantTool(id, name, input) {
  return { type: 'assistant', message: { id: mid(), model: MODEL, content: [{ type: 'tool_use', id, name, input }], usage: usageBlock(62000, 60) }, parent_tool_use_id: null };
}
function toolResult(id, content, result, isError) {
  const ev = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!isError }] }, parent_tool_use_id: null };
  if (result) ev.tool_use_result = result;
  return ev;
}

// ------------------------------------------------------------------ seeded sessions

function stored(ev) {
  // Same shape server.js writes to disk.
  if (ev.type === 'assistant' || ev.type === 'user') {
    const out = { type: ev.type, parent: null, message: { id: ev.message.id, model: ev.message.model, content: ev.message.content, usage: ev.message.usage } };
    if (ev.tool_use_result) out.result = ev.tool_use_result;
    return out;
  }
  return ev;
}

function seed({ newSession, appendEvent, sessions, saveSessions, setUsage, DATA }) {
  const home = path.join(DATA, 'home');
  const mk = (name) => { const p = path.join(home, 'code', name); fs.mkdirSync(p, { recursive: true }); return p; };
  const now = Date.now();
  const at = (minsAgo) => now - minsAgo * 60000;

  // Oldest first so the newest ends up on top.
  const recipes = newSession({ cwd: mk('recipe-box'), title: 'import recipes from a csv' });
  Object.assign(recipes, { status: 'done', started: true, titled: true, open: false, updatedAt: at(60 * 26) });
  add(recipes, [
    { t: 'prompt', text: 'write an importer for recipes.csv', ts: at(60 * 26 + 5) },
    assistantText('Added `import.js`. It reads `recipes.csv`, skips rows without a title and writes one JSON file per recipe into `data/`.'),
    { type: 'result', subtype: 'success', durationMs: 41000, steps: 6, cost: 0.19, usage: usageBlock(30000, 1400), contextWindow: 200000 },
  ]);

  const weather = newSession({ cwd: mk('weather-cli'), title: 'weather cli units flag' });
  Object.assign(weather, { status: 'idle', started: true, titled: true, updatedAt: at(10) });

  const mapPage = newSession({ cwd: mk('lemonade-stand'), title: 'map of the stand' });
  Object.assign(mapPage, { status: 'done', started: true, titled: true, updatedAt: at(25) });
  const mp = (f) => path.join(mapPage.cwd, f);
  const mw = uid(), mg = uid();
  add(mapPage, [
    { t: 'prompt', text: 'where should the map go? keep it light, no big libraries', ts: at(30) },
    assistantTool(mg, 'Grep', { pattern: '<table', path: mp('index.html') }),
    toolResult(mg, 'index.html:8:  <table class="prices">…</table>', {}),
    assistantTool(mw, 'Write', { file_path: mp('map.html'), content: '<iframe\n  src="https://www.openstreetmap.org/export/embed.html"\n  loading="lazy"\n  title="Where the stand is"></iframe>\n' }),
    toolResult(mw, 'File created', { type: 'create', filePath: mp('map.html'), content: '…', structuredPatch: [] }),
    assistantText('A plain OpenStreetMap embed keeps it light: no script, no API key. It lives in `map.html` for now, so you can decide where it goes on the page.'),
    { type: 'result', subtype: 'success', durationMs: 21000, steps: 3, cost: 0.048, usage: usageBlock(24000, 420), contextWindow: 200000, ts: at(25) },
  ]);

  const lemon = newSession({ cwd: mk('lemonade-stand'), title: 'lemonade stand site' });
  Object.assign(lemon, { status: 'done', started: true, titled: true, pinned: true, updatedAt: at(2), model: 'opus', effort: 'high', permission: 'default' });
  const l = (f) => path.join(lemon.cwd, f);
  const w1 = uid(), w2 = uid(), t1 = uid(), t2 = uid(), e1 = uid(), e2 = uid();
  add(lemon, [
    { t: 'prompt', text: 'make a one-page site for my lemonade stand. prices, opening hours, and a little map', ts: at(40) },
    assistantTool(t1, 'TodoWrite', { todos: [
      { content: 'Price table', status: 'in_progress', activeForm: 'Writing the price table' },
      { content: 'Bigger lemons', status: 'pending', activeForm: 'Making the lemons bigger' },
      { content: 'Embed the map', status: 'pending', activeForm: 'Embedding the map' },
      { content: 'Check it on a phone', status: 'pending', activeForm: 'Checking it on a phone' },
    ] }),
    toolResult(t1, 'Todos updated', {}),
    assistantTool(w1, 'Write', { file_path: l('index.html'), content: '<!doctype html>\n<html>\n<head>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Lemonade 🍋</h1>\n  <table class="prices">…</table>\n</body>\n</html>\n' }),
    toolResult(w1, 'File created', { type: 'create', filePath: l('index.html'), content: '…', structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 10, lines: ['+<!doctype html>', '+<html>', '+<head>', '+  <link rel="stylesheet" href="style.css">', '+</head>', '+<body>', '+  <h1>Lemonade 🍋</h1>', '+  <table class="prices">…</table>', '+</body>', '+</html>'] }] }),
    assistantTool(w2, 'Write', { file_path: l('style.css'), content: 'h1 { color: #d4a300; }\n.prices td { padding: 4px 12px; }\n' }),
    toolResult(w2, 'File created', { type: 'create', filePath: l('style.css'), content: '…', structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+h1 { color: #d4a300; }', '+.prices td { padding: 4px 12px; }'] }] }),
    assistantText('The page is up: a header, a price table and your hours. Open `index.html` to have a look. Want the lemons bigger?'),
    { type: 'result', subtype: 'success', durationMs: 38000, steps: 5, cost: 0.214, usage: usageBlock(52000, 2100), contextWindow: 200000, ts: at(38) },

    { t: 'prompt', text: 'yes, and make the lemons bigger', ts: at(3) },
    { t: 'compact', ts: at(3) },
    assistantTool(t2, 'TodoWrite', { todos: [
      { content: 'Price table', status: 'completed', activeForm: 'Writing the price table' },
      { content: 'Bigger lemons', status: 'completed', activeForm: 'Making the lemons bigger' },
      { content: 'Embed the map', status: 'in_progress', activeForm: 'Embedding the map' },
      { content: 'Check it on a phone', status: 'pending', activeForm: 'Checking it on a phone' },
    ] }),
    toolResult(t2, 'Todos updated', {}),
    assistantTool(e1, 'Edit', { file_path: l('style.css'), old_string: 'h1 { color: #d4a300; }', new_string: 'h1 { color: #d4a300; font-size: 3rem; }' }),
    toolResult(e1, 'Updated', { filePath: l('style.css'), structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-h1 { color: #d4a300; }', '+h1 { color: #d4a300; font-size: 3rem; }'] }] }),
    assistantTool(e2, 'Edit', { file_path: l('style.css'), old_string: '.prices td { padding: 4px 12px; }', new_string: '.prices td { padding: 6px 16px; font-size: 1.2rem; }' }),
    toolResult(e2, 'Updated', { filePath: l('style.css'), structuredPatch: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-.prices td { padding: 4px 12px; }', '+.prices td { padding: 6px 16px; font-size: 1.2rem; }'] }] }),
    assistantText('Bigger lemons: the heading is now `3rem` and the prices are easier to read. The map is next on the todo list.'),
    { type: 'result', subtype: 'success', durationMs: 13000, steps: 3, cost: 0.061, usage: usageBlock(61800, 690), contextWindow: 200000, ts: at(2) },
  ]);

  // Give the lemonade stand real files and some uncommitted changes, so Changes has something to show.
  try {
    const { execFileSync } = require('child_process');
    const dir = lemon.cwd;
    const g = (...args) => execFileSync('git', ['-c', 'user.name=desk demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
    const write = (f, text) => fs.writeFileSync(path.join(dir, f), text);
    write('index.html', '<!doctype html>\n<html>\n<head>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Lemonade</h1>\n  <table class="prices">\n    <tr><td>Small</td><td>$1</td></tr>\n    <tr><td>Large</td><td>$2</td></tr>\n  </table>\n</body>\n</html>\n');
    write('style.css', 'h1 { color: #d4a300; }\n.prices td { padding: 4px 12px; }\n');
    g('init', '-q', '-b', 'main');
    g('add', '.');
    g('commit', '-q', '-m', 'First go at the stand');
    write('style.css', 'h1 { color: #d4a300; font-size: 3rem; }\n.prices td { padding: 6px 16px; font-size: 1.2rem; }\n');
    write('index.html', fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('<h1>Lemonade</h1>', '<h1>Lemonade 🍋</h1>\n  <p>Open Saturdays, 10 till the lemons run out.</p>'));
    write('map.html', '<iframe\n  src="https://www.openstreetmap.org/export/embed.html"\n  loading="lazy"\n  title="Where the stand is"></iframe>\n');
  } catch {}

  saveSessions();
  setUsage({
    status: 'allowed_warning',
    five_hour: { utilization: 0.42, resetsAt: Math.floor(now / 1000) + 3 * 3600 + 25 * 60 },
    seven_day: { utilization: 0.88, resetsAt: Math.floor(now / 1000) + 3 * 86400 },
    updatedAt: now,
  });

  function add(s, events) {
    let t = s.updatedAt - events.length * 20000;
    for (const ev of events) {
      const e = stored(ev);
      if (!e.ts) e.ts = (t += 20000);
      appendEvent(s, e);
    }
  }

  return { autoplay: { session: weather, prompt: 'add a --units flag so I can get fahrenheit, then run the tests' } };
}

module.exports = { spawnFake, seed };
