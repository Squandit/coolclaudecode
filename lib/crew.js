// Crew mode: an Opus planner that hands tasks to helper agents at different levels.
// The helpers are written as a small Claude Code plugin (loaded with --plugin-dir for
// that session only) and the planner's rules go in with --append-system-prompt-file.
// Files, not JSON on the command line, so nothing gets mangled by cmd.exe on Windows.

const fs = require('fs');
const path = require('path');

const PLUGIN = 'desk';
const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

// Tool sets for lean sessions. Every tool's definition is re-sent on every step, so
// fewer tools means a much smaller prompt (measured: 19.7k -> 6.2k tokens per helper
// step). Names a Claude Code version doesn't have are ignored, so the lists can be generous.
const CODE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'BashOutput', 'KillShell', 'Grep', 'Glob'];
const TODO_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'];
const LEAN_SOLO = [...CODE_TOOLS, ...TODO_TOOLS];
const LEAN_PLANNER = [...CODE_TOOLS, ...TODO_TOOLS, 'Agent', 'Task'];

const DEFAULT_CREW = {
  planner: { model: 'opus', effort: 'medium' },
  escalate: 3,
  approve: true,
  skipSmall: true,
  leanHelpers: true,
  levels: [
    { id: 'scout', model: 'haiku', effort: '', job: 'Reads and searches the codebase, never edits. Returns a short summary with file paths.' },
    { id: 's1', model: 'sonnet', effort: 'medium', job: 'Renames, boilerplate, formatting, docs.' },
    { id: 's2', model: 'sonnet', effort: 'high', job: 'Simple tests, small self-contained changes.' },
    { id: 's3', model: 'sonnet', effort: 'xhigh', job: 'Features that follow patterns the code already has. Bugs with a clear repro.' },
    { id: 'o1', model: 'opus', effort: 'low', job: 'Changes across many files with a clear plan. Anything Sonnet got stuck on.' },
    { id: 'o2', model: 'opus', effort: 'medium', job: 'Tricky bugs, awkward integrations.' },
    { id: 'o3', model: 'opus', effort: 'high', job: 'Design decisions inside a feature, performance work.' },
    { id: 'o4', model: 'opus', effort: 'xhigh', job: 'Architecture, concurrency, security, vague bugs with no clear cause.' },
  ],
};

// Keep whatever the page sends to a known shape.
function cleanCrew(c) {
  const d = DEFAULT_CREW;
  if (!c || typeof c !== 'object') return JSON.parse(JSON.stringify(d));
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const text = (v, def) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, 300) : def);
  const levels = Array.isArray(c.levels) && c.levels.length ? c.levels : d.levels;
  return {
    planner: { model: pick(c.planner && c.planner.model, MODELS, 'opus'), effort: pick(c.planner && c.planner.effort, EFFORTS, 'medium') },
    escalate: Math.max(0, Math.min(6, parseInt(c.escalate, 10) || 0)),
    approve: c.approve !== false,
    skipSmall: c.skipSmall !== false,
    leanHelpers: c.leanHelpers !== false,
    levels: levels.slice(0, 12).map((l, i) => ({
      id: /^[a-z][a-z0-9-]{0,15}$/.test(l && l.id) ? l.id : `l${i + 1}`,
      model: pick(l && l.model, MODELS, 'sonnet'),
      effort: pick(l && l.effort, EFFORTS, ''),
      job: text(l && l.job, ''),
    })),
  };
}

function label(l) {
  const m = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' }[l.model] || l.model;
  return l.effort ? `${m}, ${l.effort} effort` : m;
}

function workerPrompt(l) {
  if (l.id === 'scout') {
    return `You are the scout on a desk crew. You read and search; you never edit files or run anything that changes them.

Look into what the planner asked. Then reply with a summary under 300 words: the relevant files with their paths and what is in them, how the pieces connect, the conventions the code follows, and anything surprising. Quote short snippets only when they matter. The planner cannot see what you read, only your summary, so make it complete enough to act on.`;
  }
  return `You are the ${l.id.toUpperCase()} helper on a desk crew (${label(l)}). The planner gives you one task.

Do that task and nothing else. Keep changes small and match the style of the code around them. Read only what you need.

When you are done, run the check the planner gave you, if any. Then reply with a short report:
- what you changed, with file paths
- the result of the check
- anything you could not do, or any doubt about the result

If the task turns out to be beyond you, say so in your report instead of guessing. The planner will send it to a stronger helper.`;
}

function agentFile(l, lean) {
  const lines = [
    '---',
    `name: ${l.id}`,
    `description: ${l.id.toUpperCase()} (${label(l)}). ${l.job.replace(/:/g, ' -')}`,
    `model: ${l.model}`,
  ];
  if (l.effort) lines.push(`effort: ${l.effort}`);
  if (l.id === 'scout') lines.push('tools: Read, Grep, Glob');
  else if (lean) lines.push(`tools: ${CODE_TOOLS.join(', ')}`);
  lines.push('---', '', workerPrompt(l), '');
  return lines.join('\n');
}

function plannerPrompt(crew) {
  const ladder = crew.levels.map((l) => `- ${PLUGIN}:${l.id} (${label(l)}): ${l.job}`).join('\n');
  const workers = crew.levels.filter((l) => l.id !== 'scout').map((l) => l.id);
  return `# You are the planner of a crew

In this session you lead a crew of helper agents. You decide and check; they do the work. Write code yourself only for tiny glue between their results.

## The crew, cheapest first

${ladder}

## How to work

1. Understand the request. For any reading or searching beyond one or two files, send ${PLUGIN}:scout (several at once for separate areas) so your own context stays small.
2. Plan. Split the work into tasks that are each a meaningful chunk, such as a component, an endpoint or a test file. Not single-line edits: every helper starts from nothing and has to read what it needs. Pick the cheapest level that can do each task well.
3. Make one to-do item per task, titled with its level in brackets, like "[s2] Add the toggle component".
${crew.approve
    ? `4. Then stop and show the plan: each task with its level and a one-line reason. End your turn with exactly: Reply "go" to start, or tell me what to change. Dispatch nothing until the user replies.`
    : '4. Then start straight away.'}
5. Dispatch each task with the Agent tool, in the foreground. Start the description with the task number, like "#3 add the toggle". Give the helper everything it needs: the goal, the exact files, the conventions to follow, and a check that proves it is done (a test command or a behaviour to confirm). Run tasks in parallel only when they touch different files.
6. Check every result yourself: read the diff of the files it touched and run the check. If it failed or is wrong, send the same task, same number, to the next level up (${workers.join(' → ')}) with what went wrong. You may skip a level when the failure was about reasoning rather than care. Escalate a task at most ${crew.escalate} times; after that, do it yourself or ask the user.
7. Keep the to-do list current. If a task was escalated, change its bracket to the level that finished it. End with a short summary: what changed, which level did what, anything left over.

${crew.skipSmall
    ? 'If the whole request is small enough for one helper to do well in a single pass, skip the plan and send it straight to the right level.'
    : 'Always make a plan and split the work across levels, even for small requests.'}
If the request is a question, just answer it.
`;
}

// Write the plugin and planner files; returns the paths to hand to the CLI.
function writeCrewFiles(dir, crewIn) {
  const crew = cleanCrew(crewIn);
  const plug = path.join(dir, 'crew-plugin');
  fs.rmSync(path.join(plug, 'agents'), { recursive: true, force: true });
  fs.mkdirSync(path.join(plug, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(plug, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(plug, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: PLUGIN, version: '1.0.0', description: 'desk crew helpers' }, null, 2));
  for (const l of crew.levels) fs.writeFileSync(path.join(plug, 'agents', `${l.id}.md`), agentFile(l, crew.leanHelpers));
  const planner = path.join(dir, 'crew-planner.md');
  fs.writeFileSync(planner, plannerPrompt(crew));
  return { pluginDir: plug, plannerFile: planner, crew };
}

module.exports = { DEFAULT_CREW, cleanCrew, writeCrewFiles, PLUGIN, LEAN_SOLO, LEAN_PLANNER };
