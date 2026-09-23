'use strict';
// Shared bits: constants, helpers, markdown, icons, the API client.

// ------------------------------------------------------------------ constants

const TOKEN = document.querySelector('meta[name="desk-token"]').content;

// A theme is a CSS file in /themes plus a layout: 'classic' (sidebar, one session,
// side panel) or 'tiling' (every open session is a window). Add one there and list it here.
const THEMES = [
  { id: 'mocha', name: 'Catppuccin Mocha', note: 'Soft pastels, classic layout', layout: 'classic', swatch: ['#11111b', '#1e1e2e', '#313244', '#cba6f7', '#fab387', '#a6e3a1', '#89b4fa'] },
  { id: 'riced', name: 'Riced', note: 'Tiling desktop, sessions as windows', layout: 'tiling', swatch: ['#0f0f14', '#1a1b26', '#292e42', '#7aa2f7', '#bb9af7', '#9ece6a', '#ff9e64'] },
];

const MODELS = [
  { id: 'opus', name: 'Opus' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'haiku', name: 'Haiku' },
  { id: 'fable', name: 'Fable' },
];
const EFFORTS = [
  { id: 'low', name: 'low effort' },
  { id: 'medium', name: 'medium effort' },
  { id: 'high', name: 'high effort' },
  { id: 'xhigh', name: 'extra high effort' },
  { id: 'max', name: 'max effort' },
];
const PERMS = [
  { id: 'default', name: 'ask first', sub: 'Claude asks before edits and commands' },
  { id: 'acceptEdits', name: 'edits ok', sub: 'File edits go through, commands still ask' },
  { id: 'plan', name: 'plan first', sub: 'Reads and plans, changes nothing' },
  { id: 'auto', name: 'auto', sub: 'A classifier approves the safe stuff' },
  { id: 'bypassPermissions', name: 'anything goes', sub: 'No prompts at all. Be careful.' },
];
const STATUS_TEXT = { working: 'working', needs_you: 'needs you', done: 'done', error: 'hit an error', idle: 'idle' };

// ------------------------------------------------------------------ tiny helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = (list, id) => list.find((x) => x.id === id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('desk.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('desk.' + k, JSON.stringify(v)); } catch {} },
};

async function api(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Desk-Token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function fmtTokens(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, '') + 'M';
}
function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
function fmtCost(c) { c = c || 0; return '$' + (c < 10 ? c.toFixed(3) : c.toFixed(2)); }
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}
function clock(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
}
function resetAt(sec) {
  const d = new Date(sec * 1000);
  const hours = (d - Date.now()) / 3600000;
  if (hours < 20) return 'resets ' + clock(d);
  return 'resets ' + d.toLocaleDateString([], { weekday: 'short' }).toLowerCase() + ' ' + clock(d);
}
function resetIn(sec) {
  const m = Math.max(0, Math.round((sec * 1000 - Date.now()) / 60000));
  if (m < 60) return m + ' min';
  if (m < 60 * 24) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  const d = Math.round(m / 1440);
  return d + (d === 1 ? ' day' : ' days');
}
function levelColor(pct) {
  if (pct < 60) return 'var(--ok)';
  if (pct < 85) return 'var(--warn)';
  if (pct < 95) return 'var(--hot)';
  return 'var(--bad)';
}
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function normPath(p) { return String(p || '').replace(/\\/g, '/'); }
function rel(p, cwd) {
  p = normPath(p); cwd = normPath(cwd).replace(/\/$/, '');
  return cwd && p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p;
}
function baseName(p) { return normPath(p).split('/').filter(Boolean).pop() || p; }
function shortModel(m) { return String(m || '').replace(/^claude-/, '').replace(/-\d{8}$/, ''); }
function lineCount(s) { return s ? String(s).replace(/\n$/, '').split('\n').length : 0; }

// ------------------------------------------------------------------ markdown (small, safe)

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });
  s = esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0001(\d+)\u0001/g, (_, n) => `<code>${esc(codes[n])}</code>`);
}

function md(src) {
  const blocks = [];
  src = String(src || '').replace(/```[^\n`]*\n?([\s\S]*?)(```|$)/g, (_, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\n\u0000${blocks.length - 1}\u0000\n`;
  });
  const lines = src.split('\n');
  const isBullet = (l) => /^\s*[-*+]\s+/.test(l);
  const isNum = (l) => /^\s*\d+[.)]\s+/.test(l);
  const isTableStart = (i) => /^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]);
  const isBlock = (l, i) => /^\u0000\d+\u0000$/.test(l.trim()) || /^#{1,4}\s/.test(l) || isBullet(l) || isNum(l) || /^\s*>/.test(l) || isTableStart(i) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const block = l.trim().match(/^\u0000(\d+)\u0000$/);
    if (block) { out += blocks[+block[1]]; i++; continue; }
    if (/^#{1,4}\s/.test(l)) { const n = l.match(/^#+/)[0].length; out += `<h${n}>${inline(l.replace(/^#+\s*/, ''))}</h${n}>`; i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    if (isBullet(l) || isNum(l)) {
      const ordered = isNum(l);
      const test = ordered ? isNum : isBullet;
      const items = [];
      while (i < lines.length && (test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (test(lines[i])) items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out += (ordered ? '<ol>' : '<ul>') + items.map((x) => `<li>${inline(x)}</li>`).join('') + (ordered ? '</ol>' : '</ul>');
      continue;
    }
    if (/^\s*>/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out += `<blockquote>${q.map(inline).join('<br>')}</blockquote>`;
      continue;
    }
    if (isTableStart(i)) {
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(lines[i]);
      i += 2;
      let body = '';
      while (i < lines.length && /^\s*\|/.test(lines[i])) body += '<tr>' + row(lines[i++]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
      out += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlock(lines[i], i)) para.push(lines[i++]);
    if (!para.length) { out += inline(lines[i++]); continue; }
    out += `<p>${para.map(inline).join('<br>')}</p>`;
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, n) => blocks[n]);
}

// ------------------------------------------------------------------ icons

const I = (d, extra = '') => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICON = {
  read: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  write: I('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>'),
  bash: I('<path d="m4 17 6-5-6-5M12 19h8"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  web: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  todo: I('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>'),
  agent: I('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 13h.01M15 13h.01"/>'),
  plug: I('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>'),
  ask: I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>'),
  plan: I('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  spark: I('<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>'),
  skill: I('<path d="m12 2 3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.6"'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  panel: I('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  more: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  chev: I('<path d="m9 6 6 6-6 6"/>'),
  branch: I('<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6M18 10.2c0 4-6 3-10.5 6"/>'),
  pencil: I('<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  home: I('<path d="M3 11 12 4l9 7v8a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  check: I('<path d="m5 12 4.5 4.5L19 7"/>', 'stroke-width="3"'),
  brain: I('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>'),
};
const LOGO = `<svg class="brand-mark" viewBox="0 0 64 64"><g stroke="var(--claude)" stroke-width="7" stroke-linecap="round"><path d="M32 10v44M10 32h44M16.4 16.4l31.2 31.2M47.6 16.4 16.4 47.6"/></g><circle cx="32" cy="32" r="7" fill="var(--accent)"/></svg>`;

