// Real terminals in the page. Needs @lydell/node-pty (installed by `npm install`),
// which ships prebuilt binaries for Linux, macOS and Windows. Without it desk still
// runs, the terminal just says how to turn it on.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

let pty = null;
let ptyError = null;
try { pty = require('@lydell/node-pty'); } catch (err) { ptyError = err.code === 'MODULE_NOT_FOUND' ? 'not installed' : String(err.message || err); }

const IS_WIN = process.platform === 'win32';
const KEEP = 256 * 1024; // scrollback kept on the server so a reload can redraw

function defaultShell(settings) {
  if (settings.shell) return settings.shell;
  if (IS_WIN) return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

function defaultEditor(settings) {
  return settings.editor || process.env.VISUAL || process.env.EDITOR || (IS_WIN ? 'notepad' : 'nano');
}

// Quote a path for the shell it's being typed into.
function quoteFor(shell, p) {
  const name = path.basename(shell).toLowerCase();
  if (name.startsWith('cmd')) return `"${p.replace(/"/g, '')}"`;
  if (name.startsWith('powershell') || name.startsWith('pwsh')) return `'${p.replace(/'/g, "''")}'`;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function createTerminals({ broadcast, getSettings }) {
  const terms = new Map();

  function list() {
    return [...terms.values()].map(({ id, title, cwd, createdAt, sessionId, exited }) => ({ id, title, cwd, createdAt, sessionId, exited }));
  }

  function create({ cwd, cols = 100, rows = 30, open, sessionId }) {
    if (!pty) throw new Error(`The terminal needs node-pty, which is ${ptyError}. Run "npm install" in the desk folder and restart.`);
    if (!cwd || !fs.existsSync(cwd)) throw new Error(`No folder at ${cwd}`);
    const settings = getSettings();
    const shell = defaultShell(settings);
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.CLAUDECODE; delete env.CLAUDE_CODE_SESSION_ID; delete env.CLAUDE_CODE_ENTRYPOINT;
    const args = IS_WIN || /(^|[\\/])(sh|dash)$/.test(shell) ? [] : ['-l'];
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(20, Math.min(500, cols | 0)),
      rows: Math.max(5, Math.min(200, rows | 0)),
      cwd,
      env,
      useConpty: IS_WIN ? true : undefined,
    });
    const id = crypto.randomBytes(6).toString('hex');
    const t = { id, proc, cwd, sessionId: sessionId || null, createdAt: Date.now(), buf: '', total: 0, exited: false, title: path.basename(cwd) || cwd };
    const decoder = new StringDecoder('utf8');
    proc.onData((d) => {
      const text = typeof d === 'string' ? d : decoder.write(d);
      t.buf = (t.buf + text).slice(-KEEP);
      t.total += text.length;
      // "end" lets the page line live output up with the scrollback it fetched.
      broadcast({ kind: 'term', id, data: text, end: t.total });
    });
    proc.onExit(({ exitCode }) => {
      t.exited = true;
      terms.delete(id);
      broadcast({ kind: 'term-exit', id, code: exitCode });
    });
    terms.set(id, t);

    if (open) {
      // Type the editor command into the new shell; when you quit the editor you're left at a prompt.
      const clean = String(open).replace(/[\r\n]/g, '');
      const full = path.isAbsolute(clean) ? clean : path.join(cwd, clean);
      t.title = path.basename(full);
      proc.write(`${defaultEditor(settings)} ${quoteFor(shell, full)}\r`);
    }
    broadcast({ kind: 'terms', terms: list() });
    return { id, title: t.title, cwd, sessionId: t.sessionId, createdAt: t.createdAt };
  }

  function get(id) { return terms.get(id); }
  function write(id, data) { const t = terms.get(id); if (t && typeof data === 'string') t.proc.write(data); return !!t; }
  function resize(id, cols, rows) {
    const t = terms.get(id);
    if (!t) return false;
    try { t.proc.resize(Math.max(20, Math.min(500, cols | 0)), Math.max(5, Math.min(200, rows | 0))); } catch {}
    return true;
  }
  function kill(id) {
    const t = terms.get(id);
    if (!t) return false;
    try { t.proc.kill(); } catch {}
    terms.delete(id);
    broadcast({ kind: 'term-exit', id, code: null });
    return true;
  }
  function killAll() { for (const id of [...terms.keys()]) kill(id); }

  return { available: !!pty, error: ptyError, list, create, get, write, resize, kill, killAll, defaultEditor: () => defaultEditor(getSettings()), defaultShell: () => defaultShell(getSettings()) };
}

module.exports = { createTerminals };
