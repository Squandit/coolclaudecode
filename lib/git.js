// What's changed in a session's folder, straight from git.

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

function git(cwd, args, maxBuffer = 8 * 1024 * 1024) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer, timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
    });
  });
}

function insideRepo(cwd, rel) {
  const full = path.resolve(cwd, rel);
  const root = path.resolve(cwd);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

async function changes(cwd) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { isRepo: false, files: [] };
  const [branch, status, numHead, numWork, ahead] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '-z', '--', '.']),
    git(cwd, ['diff', 'HEAD', '--numstat', '-z', '--relative', '--', '.']),
    git(cwd, ['diff', '--numstat', '-z', '--relative', '--', '.']),
    git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
  ]);

  // numstat -z: "add\tdel\tpath\0" (renames are "add\tdel\t\0old\0new\0")
  const counts = new Map();
  const parseNum = (text) => {
    const parts = text.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/);
      if (!m) continue;
      let p = m[3];
      if (!p) { p = parts[i + 2]; i += 2; }
      counts.set(p, { add: m[1] === '-' ? null : +m[1], del: m[2] === '-' ? null : +m[2] });
    }
  };
  parseNum(numHead.ok ? numHead.out : numWork.out); // no commits yet: HEAD doesn't exist

  // Paths from status are relative to the repo root; show them relative to cwd.
  const root = top.out.trim();
  const toCwd = (p) => path.relative(cwd, path.join(root, p)).split(path.sep).join('/');
  const files = [];
  const entries = status.out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    const code = e.slice(0, 2);
    const p = toCwd(e.slice(3));
    if (code[0] === 'R' || code[0] === 'C') i++; // skip the old name
    let kind = 'M';
    if (code === '??') kind = 'U';
    else if (code.includes('A')) kind = 'A';
    else if (code.includes('D')) kind = 'D';
    else if (code[0] === 'R') kind = 'R';
    const staged = code[0] !== ' ' && code[0] !== '?';
    const n = counts.get(p) || { add: null, del: null };
    if (kind === 'U' && !p.endsWith('/')) {
      const full = insideRepo(cwd, p);
      try {
        const st = full && fs.statSync(full);
        if (st && st.isFile() && st.size < 512 * 1024) n.add = fs.readFileSync(full, 'utf8').split('\n').length - 1 || 1;
      } catch {}
      n.del = 0;
    }
    files.push({ path: p, kind, staged, add: n.add, del: n.del });
    if (files.length >= 400) break;
  }
  let aheadN = 0, behindN = 0;
  if (ahead.ok) { const [b, a] = ahead.out.trim().split(/\s+/).map(Number); behindN = b || 0; aheadN = a || 0; }
  return { isRepo: true, branch: branch.ok ? branch.out.trim() : null, ahead: aheadN, behind: behindN, files };
}

async function fileDiff(cwd, rel) {
  const full = insideRepo(cwd, rel);
  if (!full) throw new Error('That file is outside the session folder');
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', rel]);
  if (!tracked.ok) {
    // Untracked: show the whole file as added.
    let text = '';
    try {
      const st = fs.statSync(full);
      if (st.size > 1024 * 1024) return { path: rel, untracked: true, binary: true, diff: '' };
      text = fs.readFileSync(full, 'utf8');
    } catch { return { path: rel, untracked: true, diff: '' }; }
    if (text.includes('\0')) return { path: rel, untracked: true, binary: true, diff: '' };
    const lines = text.replace(/\n$/, '').split('\n');
    return { path: rel, untracked: true, diff: `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') };
  }
  let d = await git(cwd, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-U3', '--', rel]);
  if (!d.ok) d = await git(cwd, ['diff', '--no-color', '--no-ext-diff', '-U3', '--', rel]);
  const binary = /^Binary files/m.test(d.out);
  return { path: rel, diff: binary ? '' : d.out, binary };
}

module.exports = { changes, fileDiff };
