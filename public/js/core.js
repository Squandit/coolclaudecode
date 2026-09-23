'use strict';
// Shared bits: constants, helpers, markdown, icons, the API client.

// ------------------------------------------------------------------ constants

const TOKEN = document.querySelector('meta[name="desk-token"]').content;

// Colour palettes. Every theme (classic or riced) is built from one of these.
const PALETTES = {
  tokyonight: { crust: '#0f0f14', mantle: '#16161e', base: '#1a1b26', s0: '#292e42', s1: '#414868', line: '#232433', fg: '#c0caf5', fg2: '#a9b1d6', fg3: '#565f89', accent: '#7aa2f7', accent2: '#bb9af7', ok: '#9ece6a', warn: '#e0af68', hot: '#ff9e64', bad: '#f7768e', info: '#7dcfff' , blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff' },
  latte: { light: true, crust: '#dce0e8', mantle: '#e6e9ef', base: '#eff1f5', s0: '#ccd0da', s1: '#bcc0cc', line: '#d6dae3', fg: '#4c4f69', fg2: '#6c6f85', fg3: '#8c8fa1', accent: '#8839ef', accent2: '#1e66f5', ok: '#40a02b', warn: '#df8e1d', hot: '#fe640b', bad: '#d20f39', info: '#1e66f5' , blue: '#1e66f5', magenta: '#8839ef', cyan: '#179299' },
  catppuccin: { crust: '#11111b', mantle: '#181825', base: '#1e1e2e', s0: '#313244', s1: '#45475a', line: '#2a2b3c', fg: '#cdd6f4', fg2: '#a6adc8', fg3: '#7f849c', accent: '#cba6f7', accent2: '#89b4fa', ok: '#a6e3a1', warn: '#f9e2af', hot: '#fab387', bad: '#f38ba8', info: '#89dceb' , blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5' },
  gruvbox: { crust: '#141617', mantle: '#1d2021', base: '#282828', s0: '#3c3836', s1: '#504945', line: '#32302f', fg: '#ebdbb2', fg2: '#d5c4a1', fg3: '#928374', accent: '#fabd2f', accent2: '#83a598', ok: '#b8bb26', warn: '#fabd2f', hot: '#fe8019', bad: '#fb4934', info: '#83a598' , blue: '#83a598', magenta: '#d3869b', cyan: '#8ec07c' },
  nord: { crust: '#1f232b', mantle: '#242933', base: '#2e3440', s0: '#3b4252', s1: '#4c566a', line: '#373e4c', fg: '#eceff4', fg2: '#d8dee9', fg3: '#7b88a1', accent: '#88c0d0', accent2: '#b48ead', ok: '#a3be8c', warn: '#ebcb8b', hot: '#d08770', bad: '#bf616a', info: '#81a1c1' , blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0' },
  rosepine: { crust: '#111019', mantle: '#16141f', base: '#191724', s0: '#26233a', s1: '#403d52', line: '#21202e', fg: '#e0def4', fg2: '#908caa', fg3: '#6e6a86', accent: '#c4a7e7', accent2: '#ebbcba', ok: '#9ccfd8', warn: '#f6c177', hot: '#ebbcba', bad: '#eb6f92', info: '#3e8fb0' , blue: '#31748f', magenta: '#c4a7e7', cyan: '#9ccfd8' },
  everforest: { crust: '#1e2326', mantle: '#232a2e', base: '#2d353b', s0: '#343f44', s1: '#475258', line: '#2e383c', fg: '#d3c6aa', fg2: '#9da9a0', fg3: '#7a8478', accent: '#a7c080', accent2: '#7fbbb3', ok: '#a7c080', warn: '#dbbc7f', hot: '#e69875', bad: '#e67e80', info: '#7fbbb3' , blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092' },
};

// A theme is a palette plus a layout: 'classic' (sidebar, one session, side panel)
// or 'tiling' (every open session and terminal is a window). Riced takes its
// palette from desk.conf.
const THEMES = [
  { id: 'mocha', name: 'Catppuccin Mocha', layout: 'classic', palette: 'catppuccin' },
  { id: 'latte', name: 'Catppuccin Latte', layout: 'classic', palette: 'latte' },
  { id: 'tokyonight', name: 'Tokyo Night', layout: 'classic', palette: 'tokyonight' },
  { id: 'gruvbox', name: 'Gruvbox', layout: 'classic', palette: 'gruvbox' },
  { id: 'nord', name: 'Nord', layout: 'classic', palette: 'nord' },
  { id: 'rosepine', name: 'Rosé Pine', layout: 'classic', palette: 'rosepine' },
  { id: 'everforest', name: 'Everforest', layout: 'classic', palette: 'everforest' },
  { id: 'riced', name: 'Riced', layout: 'tiling', note: 'tiling desktop, set up in desk.conf' },
];
function themeSwatch(pal) { return [pal.crust, pal.base, pal.s0, pal.accent, pal.accent2, pal.ok, pal.hot]; }

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace";

// Fonts you can pick in Settings. All from Google Fonts, loaded only when used.
const FONTS = [
  { name: 'JetBrains Mono', mono: true, w: '400;500;600;700;800' },
  { name: 'Geist Mono', mono: true, w: '400;500;600;700;800' },
  { name: 'IBM Plex Mono', mono: true, w: '400;500;600;700' },
  { name: 'Fira Code', mono: true, w: '400;500;600;700' },
  { name: 'Space Mono', mono: true, w: '400;700' },
  { name: 'Inter', w: '400;500;600;700;800' },
  { name: 'Geist', w: '400;500;600;700;800' },
  { name: 'Space Grotesk', w: '400;500;600;700' },
  { name: 'Manrope', w: '400;500;600;700;800' },
  { name: 'Plus Jakarta Sans', w: '400;500;600;700;800' },
  { name: 'DM Sans', w: '400;500;600;700;800' },
  { name: 'IBM Plex Sans', w: '400;500;600;700' },
  { name: 'Outfit', w: '400;500;600;700;800' },
  { name: 'Archivo', w: '400;500;600;700;800' },
];
const loadedFonts = new Set(['JetBrains Mono']);
function loadFont(name) {
  const f = FONTS.find((x) => x.name === name);
  if (!f || loadedFonts.has(name)) return;
  loadedFonts.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${f.w}&display=swap`;
  document.head.appendChild(link);
}
function fontStack(name, mono) {
  const n = String(name || '').replace(/["'`;{}()<>\\]/g, '').trim() || 'JetBrains Mono';
  return mono || (FONTS.find((f) => f.name === n) || {}).mono
    ? `'${n}', 'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace`
    : `'${n}', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`;
}

// Turn a palette into the CSS variables everything else uses.
function paletteVars(pal, { accent, radius = [10, 7, 5, 3, 5], font, mono } = {}) {
  const a = accent || pal.accent;
  const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const [lg, md, sm, xs, pill] = radius;
  return `
    --bg: ${pal.crust}; --panel: ${pal.base}; --panel-2: ${pal.mantle};
    --raised: ${pal.s0}; --raised-2: ${pal.s1}; --line: ${pal.line}; --line-strong: ${pal.s1};
    --fg: ${pal.fg}; --fg-2: ${pal.fg2}; --fg-3: ${pal.fg3};
    --accent: ${a}; --accent-2: ${pal.accent2}; --accent-fg: ${pal.light ? pal.base : pal.crust};
    --claude: ${pal.hot}; --you: ${pal.accent2};
    --ok: ${pal.ok}; --warn: ${pal.warn}; --hot: ${pal.hot}; --bad: ${pal.bad}; --info: ${pal.info};
    --add: ${pal.ok}; --del: ${pal.bad}; --add-bg: ${mix(pal.ok, pal.light ? 14 : 10)}; --del-bg: ${mix(pal.bad, pal.light ? 12 : 10)};
    --code-bg: ${pal.mantle}; --ring: ${mix(a, 55)};
    --shadow: ${pal.light ? '0 1px 2px rgba(0,0,0,.06), 0 10px 30px -14px rgba(0,0,0,.18)' : '0 1px 0 rgba(255,255,255,.03) inset, 0 12px 32px -12px rgba(0,0,0,.6)'};
    --r-lg: ${lg}px; --r-md: ${md}px; --r-sm: ${sm}px; --r-xs: ${xs}px; --r-pill: ${pill}px;
    --ab: ${a}; --ib: ${pal.s0}; --bw: 1px;
    --ansi-blue: ${pal.blue}; --ansi-magenta: ${pal.magenta}; --ansi-cyan: ${pal.cyan};
    --font: ${font || MONO}; --font-mono: ${mono || font || MONO};
    color-scheme: ${pal.light ? 'light' : 'dark'};`;
}

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
  palette: I('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.9-.3-1 .4-2.1 1.5-2.1H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
  term: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>'),
  git: I('<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 8.2v7.6M8 6h4a4 4 0 0 1 4 4v0"/>'),
  refresh: I('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  news: I('<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5"/>'),
  check: I('<path d="m5 12 4.5 4.5L19 7"/>', 'stroke-width="3"'),
  brain: I('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>'),
};
const LOGO = `<svg class="brand-mark" viewBox="0 0 64 64"><g stroke="var(--claude)" stroke-width="7" stroke-linecap="round"><path d="M32 10v44M10 32h44M16.4 16.4l31.2 31.2M47.6 16.4 16.4 47.6"/></g><circle cx="32" cy="32" r="7" fill="var(--accent)"/></svg>`;

// ------------------------------------------------------------------ popups

// A floating window with a backdrop. Closes on Esc, the x, or a click outside.
function openModal({ title, sub = '', body = '', actions = '', cls = '', onClose } = {}) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="fwin modal ${cls}" role="dialog" aria-label="${esc(title)}">
    <div class="fwin-bar"><span class="fwin-title">${esc(title)}</span><span class="dim">${sub}</span>${actions}<button class="icon-btn" data-close title="Close (Esc)">${ICON.x}</button></div>
    <div class="modal-body">${body}</div>
  </div>`;
  back._onClose = onClose;
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
  back.querySelector('[data-close]').onclick = () => closeModal();
  document.body.appendChild(back);
  return back.querySelector('.modal');
}
function closeModal() {
  const back = $('.modal-back');
  if (!back) return false;
  back.remove();
  if (back._onClose) back._onClose();
  return true;
}

// Unified diff text (from git) into the hunks the diff view draws.
function parseUnified(text) {
  const hunks = [];
  let h = null;
  for (const line of String(text || '').replace(/\n$/, '').split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { h = { oldStart: +m[1], newStart: +m[2], lines: [] }; hunks.push(h); continue; }
    if (!h) continue;
    if (line === '') h.lines.push(' ');
    else if (/^[ +\-\\]/.test(line)) h.lines.push(line);
  }
  return hunks;
}

// ------------------------------------------------------------------ keyboard shortcuts

// Every shortcut is "mod+Key" (mod is whatever you picked in Shortcuts) or a full
// combo like "ctrl+Backquote". Keys use KeyboardEvent.code, so layouts don't matter.
const KEY_MODS = {
  alt: { label: 'Alt', ctrl: false, alt: true, shift: false },
  'ctrl+alt': { label: 'Ctrl Alt', ctrl: true, alt: true, shift: false },
  'alt+shift': { label: 'Alt Shift', ctrl: false, alt: true, shift: true },
  'ctrl+shift': { label: 'Ctrl Shift', ctrl: true, alt: false, shift: true },
};
const KEY_ACTIONS = [
  { id: 'launcher', label: 'New session (classic) · launcher (Riced)', def: 'mod+Enter' },
  { id: 'themes', label: 'Themes', def: 'mod+KeyT' },
  { id: 'terminal', label: 'Terminal', def: 'ctrl+Backquote' },
  { id: 'info', label: 'Side panel / info', def: 'mod+KeyI' },
  { id: 'close', label: 'Close window (Riced)', def: 'mod+KeyQ' },
  { id: 'fullscreen', label: 'Fullscreen window (Riced)', def: 'mod+KeyF' },
  { id: 'config', label: 'desk.conf (Riced)', def: 'mod+KeyC' },
  { id: 'left', label: 'Focus left (Riced)', def: 'mod+KeyH' },
  { id: 'down', label: 'Focus down (Riced)', def: 'mod+KeyJ' },
  { id: 'up', label: 'Focus up (Riced)', def: 'mod+KeyK' },
  { id: 'right', label: 'Focus right (Riced)', def: 'mod+KeyL' },
];

const Keys = {
  get cfg() { return (st.settings && st.settings.keys) || { mod: 'alt', binds: {} }; },
  mod() { return KEY_MODS[this.cfg.mod] || KEY_MODS.alt; },
  combo(id) { return (this.cfg.binds && this.cfg.binds[id]) || byId(KEY_ACTIONS, id).def; },

  // Expand a combo into the exact modifiers and code it needs.
  parse(combo) {
    const parts = combo.split('+');
    const code = parts.pop();
    const want = { ctrl: false, alt: false, shift: false, meta: false };
    for (const p of parts) {
      if (p === 'mod') { const m = this.mod(); want.ctrl ||= m.ctrl; want.alt ||= m.alt; want.shift ||= m.shift; }
      else want[p] = true;
    }
    return { want, code };
  },

  mods(e) { return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }; },
  same(a, b) { return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta; },

  // Which action (if any) this keydown is. Workspaces are mod + 1-9, arrows mirror hjkl.
  action(e) {
    if (e.getModifierState && e.getModifierState('AltGraph')) return null; // AltGr is for typing
    const have = this.mods(e);
    for (const a of KEY_ACTIONS) {
      const { want, code } = this.parse(this.combo(a.id));
      if (code === e.code && this.same(want, have)) return { id: a.id };
    }
    const modOnly = this.parse('mod+x').want;
    if (this.same(modOnly, have)) {
      const d = e.code.match(/^Digit([1-9])$/);
      if (d) return { id: 'workspace', n: +d[1] };
      const arrows = { ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'right' };
      if (arrows[e.code]) return { id: arrows[e.code] };
    }
    return null;
  },

  keyName(code) {
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Backquote', '`').replace('Enter', '⏎').replace(/^Arrow/, '').replace('Backslash', '\\').replace('Slash', '/').replace('Semicolon', ';').replace('Comma', ',').replace('Period', '.').replace('Minus', '-').replace('Equal', '=').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Quote', "'");
  },
  label(id) {
    const combo = typeof id === 'string' && id.includes('+') ? id : this.combo(id);
    const parts = combo.split('+');
    const code = parts.pop();
    const mods = parts.map((p) => (p === 'mod' ? this.mod().label : p[0].toUpperCase() + p.slice(1)));
    return [...mods, this.keyName(code)].join(' ');
  },

  // Turn a keydown into a combo string, preferring "mod+" when the modifiers match yours.
  fromEvent(e) {
    if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
    const have = this.mods(e);
    if (!have.ctrl && !have.alt && !have.meta) return null; // needs a real modifier
    if (this.same(this.parse('mod+x').want, have)) return 'mod+' + e.code;
    return [have.ctrl && 'ctrl', have.alt && 'alt', have.shift && 'shift', have.meta && 'meta', e.code].filter(Boolean).join('+');
  },
};

function openShortcuts() {
  const draw = () => {
    const k = Keys.cfg;
    return `<div class="keys-pane">
      <div class="keys-mod">
        <div><b>Modifier</b><small>Pick one your window manager leaves alone. GlazeWM, i3 and friends usually grab Alt, so try Ctrl Alt.</small></div>
        <div class="seg">${Object.entries(KEY_MODS).map(([id, m]) => `<button data-mod="${id}" class="${k.mod === id ? 'sel' : ''}">${m.label}</button>`).join('')}</div>
      </div>
      <table class="table keys-table"><tbody>
        ${KEY_ACTIONS.map((a) => `<tr><td>${esc(a.label)}</td><td class="acts"><button class="kbd-btn" data-bind="${a.id}"><kbd>${esc(Keys.label(a.id))}</kbd></button>${k.binds && k.binds[a.id] ? `<button class="link-btn" data-reset="${a.id}">reset</button>` : ''}</td></tr>`).join('')}
        <tr><td>Workspace 1 to 9 (Riced)</td><td class="acts"><kbd>${esc(Keys.mod().label)} 1-9</kbd></td></tr>
      </tbody></table>
      <p class="keys-note">Click a shortcut, then press the new keys. Esc cancels.</p>
    </div>`;
  };
  const win = openModal({ title: 'Keyboard shortcuts', sub: 'saved on this machine', cls: 'keys-modal', body: draw() });
  const body = $('.modal-body', win);
  const save = async (keys) => {
    await saveSettings({ keys }, { apply: false });
    body.innerHTML = draw();
    L && L.onKeysChanged && L.onKeysChanged();
  };
  body.onclick = (e) => {
    const m = e.target.closest('[data-mod]');
    if (m) return save({ ...Keys.cfg, mod: m.dataset.mod });
    const r = e.target.closest('[data-reset]');
    if (r) { const binds = { ...Keys.cfg.binds }; delete binds[r.dataset.reset]; return save({ ...Keys.cfg, binds }); }
    const b = e.target.closest('[data-bind]');
    if (!b) return;
    b.innerHTML = '<kbd class="listening">press keys…</kbd>';
    const onKey = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') { cleanup(); body.innerHTML = draw(); return; }
      const combo = Keys.fromEvent(ev);
      if (!combo) return;
      cleanup();
      save({ ...Keys.cfg, binds: { ...Keys.cfg.binds, [b.dataset.bind]: combo } });
    };
    const cleanup = () => window.removeEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);
  };
}
