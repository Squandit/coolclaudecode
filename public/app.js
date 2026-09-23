'use strict';

// ------------------------------------------------------------------ constants

const TOKEN = document.querySelector('meta[name="desk-token"]').content;

// Themes are just CSS files in /themes. Add one there and list it here.
const THEMES = [
  { id: 'mocha', name: 'Catppuccin Mocha', note: 'Soft pastels on dark', swatch: ['#11111b', '#1e1e2e', '#313244', '#cba6f7', '#fab387', '#a6e3a1', '#89b4fa'] },
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

// ------------------------------------------------------------------ state

const st = {
  settings: {},
  usage: null,
  demo: false,
  home: '~',
  sessions: new Map(),
  projects: [],
  history: [],
  openProjects: new Set(store.get('openProjects', [])),
  route: { name: 'home' },
  view: null,
  prevStatus: new Map(),
};

function sessionsSorted() {
  return [...st.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

// ------------------------------------------------------------------ boot

async function boot() {
  const data = await api('GET', '/state');
  st.settings = data.settings;
  st.usage = data.usage;
  st.demo = data.demo;
  st.home = data.home;
  for (const s of data.sessions) { st.sessions.set(s.id, s); st.prevStatus.set(s.id, s.status); }
  applyTheme();
  const app = $('#app');
  if (!store.get('tray', true)) app.classList.add('no-tray');
  $('#scrim').addEventListener('click', () => app.classList.remove('side-open', 'tray-open'));
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', globalKeys);
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu, [data-menu]')) closeMenu(); });
  setInterval(() => { renderUsage(); refreshAgos(); }, 30000);
  connect();
  loadProjects();
  setInterval(loadProjects, 60000);
  renderSide();
  route();
  updateTitle();
}

function connect() {
  let first = true;
  const es = new EventSource('/api/stream?token=' + TOKEN);
  es.onopen = async () => {
    if (first) { first = false; return; }
    // Reconnected: catch up on anything missed.
    const data = await api('GET', '/state').catch(() => null);
    if (!data) return;
    st.sessions = new Map(data.sessions.map((s) => [s.id, s]));
    st.usage = data.usage;
    renderSide();
    if (st.view) openSession(st.view.id, true);
  };
  es.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    onServer(msg);
  };
}

function onServer(msg) {
  const v = st.view;
  switch (msg.kind) {
    case 'session': {
      const s = msg.session;
      const prev = st.prevStatus.get(s.id);
      st.sessions.set(s.id, s);
      st.prevStatus.set(s.id, s.status);
      if (prev !== s.status) maybeNotify(s, prev);
      renderSideSoon();
      updateTitle();
      if (v && v.id === s.id) { renderHead(); renderTail(); renderComposerState(); renderTray(); }
      break;
    }
    case 'removed':
      st.sessions.delete(msg.id);
      renderSide();
      if (v && v.id === msg.id) location.hash = '#/';
      break;
    case 'event':
      if (v && v.id === msg.id) {
        if (v.loading) v.buffer.push(msg.event);
        else applyEvent(msg.event, true);
      }
      break;
    case 'delta':
      if (v && v.id === msg.id && !v.loading) onDelta(msg);
      break;
    case 'activity':
      if (v && v.id === msg.id) { v.activity = msg.text; renderActivity(); }
      break;
    case 'usage':
      st.usage = msg.usage;
      renderUsage();
      break;
    case 'settings':
      st.settings = msg.settings;
      applyTheme();
      break;
  }
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const app = $('#app');
  app.classList.remove('side-open', 'tray-open');
  closeMenu();
  if (h.startsWith('s/')) return openSession(h.slice(2));
  st.view = null;
  st.route = h === 'settings' ? { name: 'settings' } : { name: 'home' };
  if (st.route.name === 'settings') renderSettings(); else renderHome();
  renderTray();
  renderSide();
}

function globalKeys(e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'N' || e.code === 'KeyN')) {
    e.preventDefault();
    newSessionFlow();
  } else if (e.key === 'Escape') {
    closeMenu();
    $('#app').classList.remove('side-open', 'tray-open');
  }
}

function newSessionFlow(cwd) {
  if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
  else renderHome();
  requestAnimationFrame(() => {
    if (cwd) { const f = $('#start-folder'); if (f) f.value = cwd; }
    const t = $('#start-text'); if (t) t.focus();
  });
}

function applyTheme() {
  const t = byId(THEMES, st.settings.theme) || THEMES[0];
  const link = $('#theme-css');
  const href = `themes/${t.id}.css`;
  if (!link.getAttribute('href').endsWith(href)) link.setAttribute('href', href);
}

function updateTitle() {
  const n = [...st.sessions.values()].filter((s) => s.status === 'needs_you').length;
  document.title = (n ? `(${n}) ` : '') + 'desk';
}

function maybeNotify(s, prev) {
  if (!st.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const watching = !document.hidden && st.view && st.view.id === s.id;
  if (watching) return;
  let body = null;
  if (s.status === 'needs_you') body = 'Claude needs your go-ahead.';
  else if (s.status === 'done' && prev === 'working') body = s.summary || 'Finished.';
  else if (s.status === 'error') body = 'Hit an error.';
  if (!body) return;
  try {
    const n = new Notification(s.title, { body, icon: 'icon.svg', tag: s.id });
    n.onclick = () => { window.focus(); location.hash = '#/s/' + s.id; };
  } catch {}
}

async function loadProjects() {
  try {
    const data = await api('GET', '/projects');
    st.projects = data.projects;
    st.history = data.history;
    renderSideSoon();
    if (st.route.name === 'home' && !st.view) renderHomeLists();
  } catch {}
}

// ------------------------------------------------------------------ sidebar

let sideQueued = false;
function renderSideSoon() {
  if (sideQueued) return;
  sideQueued = true;
  requestAnimationFrame(() => { sideQueued = false; renderSide(); });
}

function sessionSub(s) {
  if (s.status === 'working') return { cls: '', text: (st.view && st.view.id === s.id && st.view.activity) || 'working…' };
  if (s.status === 'needs_you') return { cls: 'needs', text: 'needs you' };
  if (s.status === 'error') return { cls: 'err', text: 'hit an error' };
  if (s.status === 'done') return { cls: '', text: 'done · ' + ago(s.updatedAt) };
  return { cls: '', text: ago(s.updatedAt) };
}

function renderSide() {
  const side = $('#side');
  const scrollTop = $('.side-scroll', side)?.scrollTop || 0;
  const open = sessionsSorted().filter((s) => s.open !== false);
  const groups = new Map();
  for (const s of open) {
    const k = baseName(s.cwd);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const currentId = st.view && st.view.id;

  let openHtml = '';
  for (const [name, list] of groups) {
    openHtml += `<div class="group-name">${ICON.folder}${esc(name)}</div>`;
    for (const s of list) {
      const sub = sessionSub(s);
      openHtml += `<div class="s-item ${s.id === currentId ? 'active' : ''}" role="button" tabindex="0" data-open="${s.id}">
        <span class="dot ${s.status}"></span>
        <span class="s-body"><span class="s-title" style="display:block">${esc(s.title)}</span><span class="s-sub ${sub.cls}" style="display:block" data-ago="${s.id}">${esc(sub.text)}</span></span>
        <button class="s-close" title="Put away (keeps history)" data-close="${s.id}">${ICON.x}</button>
      </div>`;
    }
  }
  if (!open.length) openHtml = `<div class="empty-note">Nothing open. Start one above.</div>`;

  let projHtml = '';
  for (const p of st.projects.slice(0, 14)) {
    const isOpen = st.openProjects.has(p.cwd);
    projHtml += `<button class="p-item ${isOpen ? 'open' : ''}" data-proj="${esc(p.cwd)}" title="${esc(p.where)}">
      <span class="chev">${ICON.chev}</span><span class="p-name">${esc(p.name)}</span><span class="p-meta">${p.count} · ${esc(ago(p.updatedAt).replace(' ago', ''))}</span>
    </button>`;
    if (isOpen) {
      const mine = sessionsSorted().filter((s) => s.cwd === p.cwd);
      const theirs = st.history.filter((h) => h.cwd === p.cwd);
      projHtml += `<div class="p-sessions">`;
      projHtml += `<button class="p-sess" data-newin="${esc(p.cwd)}" style="color:var(--accent);font-weight:700">+ new session here</button>`;
      for (const s of mine) projHtml += `<button class="p-sess" data-open="${s.id}">${esc(s.title)}<small>${esc(ago(s.updatedAt))}</small></button>`;
      for (const h of theirs.slice(0, 8)) projHtml += `<button class="p-sess" data-import="${h.sessionId}" title="From Claude Code">${esc(h.title)}<small>${esc(ago(h.updatedAt))}</small></button>`;
      projHtml += `</div>`;
    }
  }
  if (!st.projects.length) projHtml = `<div class="empty-note">Folders you've used Claude Code in show up here.</div>`;

  side.innerHTML = `
    <div class="brand">${LOGO}<span class="brand-name">desk</span>${st.demo ? '<span class="brand-demo">demo</span>' : ''}</div>
    <button class="new-btn" data-new>${ICON.plus}<span>New session</span><kbd>Alt N</kbd></button>
    <div class="side-scroll">
      <div class="side-label"><span>Open</span><button data-home>${ICON.home}</button></div>
      ${openHtml}
      <div class="side-label"><span>Projects</span></div>
      ${projHtml}
    </div>
    <div class="usage" id="usage"></div>`;
  $('.side-scroll', side).scrollTop = scrollTop;
  renderUsage();

  side.onclick = async (e) => {
    const t = e.target.closest('[data-open],[data-close],[data-proj],[data-new],[data-newin],[data-import],[data-home],[data-settings]');
    if (!t) return;
    if (t.dataset.close) {
      e.stopPropagation();
      await api('PATCH', '/sessions/' + t.dataset.close, { open: false });
      if (currentId === t.dataset.close) location.hash = '#/';
    } else if (t.dataset.open) location.hash = '#/s/' + t.dataset.open;
    else if (t.dataset.proj) {
      const c = t.dataset.proj;
      if (st.openProjects.has(c)) st.openProjects.delete(c); else st.openProjects.add(c);
      store.set('openProjects', [...st.openProjects]);
      renderSide();
    } else if (t.dataset.new !== undefined) newSessionFlow();
    else if (t.dataset.newin) newSessionFlow(t.dataset.newin);
    else if (t.dataset.import) importSession(t.dataset.import);
    else if (t.dataset.home !== undefined) location.hash = '#/';
    else if (t.dataset.settings !== undefined) location.hash = '#/settings';
  };
  side.onkeydown = (e) => {
    const t = e.target.closest('[data-open]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = '#/s/' + t.dataset.open; }
  };
}

function refreshAgos() {
  for (const el of $$('[data-ago]')) {
    const s = st.sessions.get(el.dataset.ago);
    if (s) el.textContent = sessionSub(s).text;
  }
}

function renderUsage() {
  const el = $('#usage');
  if (!el) return;
  const u = st.usage;
  const settingsBtn = `<button class="icon-btn ${st.route.name === 'settings' ? 'on' : ''}" title="Settings" data-settings>${ICON.gear}</button>`;
  const meter = (label, w) => {
    if (!w || w.utilization == null) return '';
    const pct = Math.round(w.utilization * 100);
    const c = levelColor(pct);
    return `<div class="meter ${pct >= 85 ? 'hot' : ''}" style="--c:${c}">
      <div class="meter-top"><span class="meter-name">${label}</span><span class="meter-pct">${pct}%</span></div>
      <div class="meter-bar"><div class="meter-fill" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="meter-reset">${w.resetsAt ? esc(resetAt(w.resetsAt)) : '&nbsp;'}</div>
    </div>`;
  };
  if (!u || (!u.five_hour && !u.seven_day)) {
    el.innerHTML = `<div class="usage-head"><strong>Plan usage</strong>${settingsBtn}</div>
      <div class="usage-empty">Your 5-hour and weekly limits show up here after your first message.</div>`;
    return;
  }
  let warn = '';
  const wk = u.seven_day, fh = u.five_hour;
  if (wk && wk.utilization >= 0.85) warn = `Weekly limit nearly used. It resets in ${resetIn(wk.resetsAt)}.`;
  else if (fh && fh.utilization >= 0.85) warn = `5-hour limit nearly used. It resets in ${resetIn(fh.resetsAt)}.`;
  if (u.overage) warn = 'Past your plan limit, using extra usage.';
  el.innerHTML = `<div class="usage-head"><strong>Plan usage</strong>${settingsBtn}</div>
    ${meter('5 hour', fh)}${meter('week', wk)}
    ${warn ? `<div class="usage-warn">${esc(warn)}</div>` : ''}
    <div class="usage-foot">updated ${esc(ago(u.updatedAt))}</div>`;
}

async function importSession(sessionId) {
  try {
    const s = await api('POST', '/sessions', { importSessionId: sessionId });
    st.sessions.set(s.id, s);
    location.hash = '#/s/' + s.id;
    loadProjects();
  } catch (err) { toast(err.message); }
}

// ------------------------------------------------------------------ home

function renderHome() {
  const main = $('#main');
  const recentFolder = sessionsSorted()[0]?.where || '';
  main.innerHTML = `
    <div class="head mobile-only" style="border:0;padding-bottom:0"><button class="icon-btn" data-side>${ICON.menu}</button></div>
    <div class="page"><div class="page-inner">
      <div class="eyebrow">${esc(greeting())}</div>
      <h1 class="hero">What are we making?</h1>
      <p class="lede">Start a session in any folder, or pick up one you left open.</p>
      <div class="starter">
        <textarea id="start-text" placeholder="Describe the thing. Or leave it blank and just open a session." rows="3"></textarea>
        <div class="starter-bar">
          <label class="folder-field" title="Folder Claude works in">${ICON.folder}<input id="start-folder" list="folders" spellcheck="false" placeholder="${esc(st.settings.defaultCwd || st.home)}" value="${esc(st.settings.defaultCwd || '')}"></label>
          <datalist id="folders"></datalist>
          <button class="btn" id="resume-last" ${sessionsSorted().length ? '' : 'disabled'}>Resume last</button>
          <button class="btn primary" id="start-go">Start <kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ⏎</kbd></button>
        </div>
      </div>
      <div class="tip"><span><kbd>Alt N</kbd> new session</span><span><kbd>/</kbd> commands</span><span><kbd>@</kbd> files</span><span>Sessions keep running when you switch away.</span></div>
      <div id="home-lists"></div>
    </div></div>`;
  const go = async () => {
    const btn = $('#start-go');
    btn.disabled = true;
    try {
      const s = await api('POST', '/sessions', { cwd: $('#start-folder').value.trim() || undefined, prompt: $('#start-text').value.trim() || undefined });
      st.sessions.set(s.id, s);
      location.hash = '#/s/' + s.id;
    } catch (err) { toast(err.message); btn.disabled = false; }
  };
  $('#start-go').onclick = go;
  $('#start-text').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } };
  $('#resume-last').onclick = () => { const s = sessionsSorted()[0]; if (s) location.hash = '#/s/' + s.id; };
  $('[data-side]', main).onclick = () => $('#app').classList.add('side-open');
  if (recentFolder && !$('#start-folder').value) $('#start-folder').placeholder = recentFolder;
  renderHomeLists();
}

function renderHomeLists() {
  const box = $('#home-lists');
  if (!box) return;
  const dl = $('#folders');
  if (dl) dl.innerHTML = st.projects.map((p) => `<option value="${esc(p.where)}">`).join('');
  const open = sessionsSorted().filter((s) => s.open !== false).slice(0, 6);
  let html = '';
  if (open.length) {
    html += `<div class="section-title"><h2>On the desk</h2><small>${open.length} open</small></div><div class="cards">`;
    for (const s of open) {
      html += `<button class="s-card" data-open="${s.id}">
        <span class="top"><span class="dot ${s.status}"></span>${esc(STATUS_TEXT[s.status] || s.status)} · ${esc(baseName(s.cwd))}</span>
        <span class="t">${esc(s.title)}</span>
        <span class="sub">${esc(s.summary || ago(s.updatedAt))}</span>
      </button>`;
    }
    html += `</div>`;
  }
  if (st.projects.length) {
    html += `<div class="section-title"><h2>Recent projects</h2><small>from desk and Claude Code</small></div><div class="table-wrap"><table class="table"><tbody>`;
    for (const p of st.projects.slice(0, 8)) {
      html += `<tr><td class="nm">${esc(p.name)}<small>${esc(p.where)}</small></td><td class="last">${esc(p.last || '')}</td><td class="ago">${esc(ago(p.updatedAt))}</td>
        <td class="acts"><button class="link-btn" data-newin="${esc(p.where)}">New session</button></td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  if (st.history.length) {
    html += `<div class="section-title"><h2>Pick up from Claude Code</h2><small>sessions you ran in the terminal</small></div><div class="table-wrap"><table class="table"><tbody>`;
    for (const h of st.history.slice(0, 8)) {
      html += `<tr><td class="nm">${esc(h.title)}<small>${esc(h.where)}${h.branch ? ' · ' + esc(h.branch) : ''}</small></td><td class="ago">${esc(ago(h.updatedAt))}</td>
        <td class="acts"><button class="link-btn" data-import="${h.sessionId}">Resume</button></td></tr>`;
    }
    html += `</tbody></table></div>`;
  }
  box.innerHTML = html;
  box.onclick = (e) => {
    const t = e.target.closest('[data-open],[data-newin],[data-import]');
    if (!t) return;
    if (t.dataset.open) location.hash = '#/s/' + t.dataset.open;
    else if (t.dataset.import) importSession(t.dataset.import);
    else if (t.dataset.newin) { $('#start-folder').value = t.dataset.newin; $('#start-text').focus(); window.scrollTo(0, 0); $('.page').scrollTop = 0; }
  };
}

// ------------------------------------------------------------------ settings

function renderSettings() {
  const s = st.settings;
  const seg = (key, list) => `<div class="seg" data-key="${key}">${list.map((x) => `<button data-val="${x.id}" class="${s[key] === x.id ? 'sel' : ''}">${esc(x.name)}</button>`).join('')}</div>`;
  const main = $('#main');
  main.innerHTML = `
    <div class="head mobile-only" style="border:0;padding-bottom:0"><button class="icon-btn" data-side>${ICON.menu}</button></div>
    <div class="page"><div class="page-inner">
      <div class="eyebrow">Settings</div>
      <h1 class="hero" style="font-size:40px">Make it yours</h1>
      <p class="lede">Saved to <span class="mono">~/.desk</span> on this machine. Nothing leaves it.</p>

      <div class="set-group"><h2>Look</h2><p>More themes are on the way. Each one is a single CSS file of tokens.</p>
        <div class="themes">
          ${THEMES.map((t) => `<button class="theme-card ${s.theme === t.id ? 'sel' : ''}" data-theme="${t.id}"><span class="sw">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span><b>${esc(t.name)}</b><small>${esc(t.note)}</small></button>`).join('')}
          <div class="theme-card soon">your next theme<br>goes here</div>
        </div>
      </div>

      <div class="set-group"><h2>New sessions start with</h2><p>You can change any of these per session from the header.</p>
        <div class="set-row"><label>Model</label>${seg('model', MODELS)}</div>
        <div class="set-row"><label>Effort<small>How hard Claude thinks</small></label>${seg('effort', EFFORTS.map((e) => ({ ...e, name: e.id })))}</div>
        <div class="set-row"><label>Permissions<small>What Claude can do without asking</small></label>${seg('permission', PERMS)}</div>
        <div class="set-row"><label>Folder<small>Where new sessions open</small></label><input class="text-in" data-text="defaultCwd" value="${esc(s.defaultCwd)}" placeholder="${esc(st.home)}" spellcheck="false"></div>
      </div>

      <div class="set-group"><h2>Claude Code</h2><p>desk drives the <span class="mono">claude</span> CLI you already have installed and logged into.</p>
        <div class="set-row"><label>CLI path<small>Leave as <span class="mono">claude</span> if it's on your PATH</small></label><div><input class="text-in" data-text="claudePath" value="${esc(s.claudePath)}" spellcheck="false"><span class="ver" id="ver">checking…</span></div></div>
      </div>

      <div class="set-group"><h2>Notifications</h2><p>A desktop ping when a session needs you or finishes while you're looking elsewhere.</p>
        <div class="set-row"><label>Notify me</label><button class="switch ${s.notify ? 'on' : ''}" id="notify" aria-pressed="${!!s.notify}"></button></div>
      </div>
    </div></div>`;

  const save = async (patch) => {
    try { st.settings = await api('PUT', '/settings', patch); applyTheme(); } catch (err) { toast(err.message); }
  };
  main.onclick = async (e) => {
    const b = e.target.closest('.seg button');
    if (b) {
      const key = b.parentElement.dataset.key;
      $$('button', b.parentElement).forEach((x) => x.classList.toggle('sel', x === b));
      save({ [key]: b.dataset.val });
      return;
    }
    const t = e.target.closest('[data-theme]');
    if (t) { $$('[data-theme]').forEach((x) => x.classList.toggle('sel', x === t)); save({ theme: t.dataset.theme }); return; }
    if (e.target.closest('#notify')) {
      const on = !st.settings.notify;
      if (on && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      $('#notify').classList.toggle('on', on);
      save({ notify: on });
      return;
    }
    if (e.target.closest('[data-side]')) $('#app').classList.add('side-open');
  };
  for (const input of $$('[data-text]', main)) {
    input.onchange = async () => { await save({ [input.dataset.text]: input.value.trim() }); if (input.dataset.text === 'claudePath') checkVersion(); };
  }
  checkVersion();
}

async function checkVersion() {
  const el = $('#ver');
  if (!el) return;
  el.textContent = 'checking…';
  const { version } = await api('GET', '/version').catch(() => ({}));
  el.textContent = version ? '✓ ' + version : "✗ can't run it";
  el.style.color = version ? 'var(--ok)' : 'var(--bad)';
}

// ------------------------------------------------------------------ session view

function freshModel() {
  return {
    todos: [], tasks: new Map(), files: new Map(), toolInputs: new Map(),
    turns: 0, timeMs: 0, tools: 0, tokIn: 0, tokOut: 0, cacheR: 0, cacheW: 0, cost: 0,
    ctx: null, window: 200000, modelName: null,
  };
}

async function openSession(id, resync) {
  const s = st.sessions.get(id);
  st.route = { name: 'session', id };
  if (!resync || !st.view || st.view.id !== id) {
    st.view = { id, loading: true, buffer: [], seq: 0, m: freshModel(), tools: new Map(), live: null, liveText: '', activity: null, files: null, askState: new Map(), pendingKey: '' };
  } else {
    Object.assign(st.view, { loading: true, buffer: [], seq: 0, m: freshModel(), tools: new Map(), live: null, liveText: '', pendingKey: '' });
  }
  const v = st.view;
  if (!s) {
    // Might be brand new and not in our map yet.
    try { const d = await api('GET', '/sessions/' + id); st.sessions.set(id, d.session); } catch { location.hash = '#/'; return; }
  }
  renderSessionShell();
  renderSide();
  let data;
  try { data = await api('GET', '/sessions/' + id); } catch (err) { toast(err.message); location.hash = '#/'; return; }
  if (st.view !== v) return;
  st.sessions.set(id, data.session);
  v.branch = data.branch;
  v.where = data.where;
  for (const ev of data.events) applyEvent(ev, false);
  v.loading = false;
  for (const ev of v.buffer) applyEvent(ev, false);
  v.buffer = [];
  renderHead();
  renderTail();
  renderTray();
  renderComposerState();
  renderEmpty();
  scrollToEnd(true);
  if (!resync) $('#composer-text')?.focus();
}

function renderSessionShell() {
  const main = $('#main');
  main.innerHTML = `
    <header class="head" id="head"></header>
    <div class="scroll" id="scroll">
      <div class="log" id="log"><div id="items"></div><div id="live"></div><div id="tail"></div></div>
    </div>
    <div class="composer">
      <div class="composer-box" id="composer-box">
        <div class="pop" id="pop" hidden></div>
        <textarea id="composer-text" rows="1" placeholder="What are we making?" spellcheck="true"></textarea>
        <div class="composer-bar">
          <div class="hints"><span><kbd>⏎</kbd>send</span><span><kbd>⇧⏎</kbd>new line</span><span><kbd>/</kbd>commands</span><span><kbd>@</kbd>files</span></div>
          <button class="btn primary" id="send-btn">Send</button>
        </div>
      </div>
    </div>`;
  main.onclick = null;
  wireComposer();
  renderHead();
}

function cur() { return st.view && st.sessions.get(st.view.id); }

function renderHead() {
  const s = cur();
  const head = $('#head');
  if (!s || !head) return;
  const v = st.view;
  const model = byId(MODELS, s.model);
  const effort = byId(EFFORTS, s.effort);
  const perm = byId(PERMS, s.permission);
  const pct = ctxPct();
  const trayShown = !$('#app').classList.contains('no-tray');
  head.innerHTML = `
    <button class="icon-btn mobile-only" data-side>${ICON.menu}</button>
    <div class="head-left">
      <div class="head-title"><span id="title-text">${esc(s.title)}</span><button class="icon-btn" id="rename" title="Rename">${ICON.pencil}</button></div>
      <div class="head-meta">
        <span class="mono" title="${esc(s.cwd)}">${esc(v.where || s.cwd)}</span>
        ${v.branch ? `<span class="branch">${ICON.branch}<span class="mono">${esc(v.branch)}</span></span>` : ''}
        <span class="status-chip ${s.status}"><span class="dot ${s.status}"></span>${esc(STATUS_TEXT[s.status] || s.status)}</span>
      </div>
    </div>
    <div class="head-right">
      <button class="pill model" data-menu="model">${esc(model ? model.name : s.model)}</button>
      <button class="pill" data-menu="effort">${esc(effort ? effort.name : s.effort)}</button>
      <button class="pill perm-${s.permission}" data-menu="perm">${esc(perm ? perm.name : s.permission)}</button>
      <button class="pill ghost" data-ctx title="Context used">${pct == null ? '' : `<span class="ctx-ring" style="--p:${pct};--c:${levelColor(pct)}"></span>`}${pct == null ? 'context' : pct + '%'}<span class="k">${pct == null ? '' : 'context'}</span></button>
      <button class="icon-btn ${trayShown ? 'on' : ''}" data-tray title="Toggle side panel">${ICON.panel}</button>
      <button class="icon-btn" data-menu="more" title="More">${ICON.more}</button>
    </div>`;
  head.onclick = (e) => {
    const t = e.target.closest('[data-menu],[data-tray],[data-ctx],[data-side],#rename');
    if (!t) return;
    if (t.id === 'rename') return startRename();
    if (t.dataset.side !== undefined) return $('#app').classList.add('side-open');
    if (t.dataset.tray !== undefined || t.dataset.ctx !== undefined) return toggleTray();
    openHeadMenu(t, t.dataset.menu);
  };
}

function toggleTray() {
  const app = $('#app');
  if (window.matchMedia('(max-width: 1180px)').matches) {
    app.classList.toggle('tray-open');
  } else {
    app.classList.toggle('no-tray');
    store.set('tray', !app.classList.contains('no-tray'));
  }
  renderHead();
}

function startRename() {
  const el = $('#title-text');
  const s = cur();
  el.contentEditable = 'true';
  el.focus();
  document.getSelection().selectAllChildren(el);
  const finish = async (save) => {
    el.contentEditable = 'false';
    el.onblur = el.onkeydown = null;
    const title = el.textContent.trim();
    if (save && title && title !== s.title) await api('PATCH', '/sessions/' + s.id, { title }).catch((err) => toast(err.message));
    else el.textContent = s.title;
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  el.onblur = () => finish(true);
}

let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

function openHeadMenu(anchor, kind) {
  if (menuEl && menuEl.dataset.kind === kind) return closeMenu();
  closeMenu();
  const s = cur();
  let items;
  if (kind === 'model') items = MODELS.map((m) => ({ id: m.id, main: m.name, sel: s.model === m.id }));
  else if (kind === 'effort') items = EFFORTS.map((m) => ({ id: m.id, main: m.name, sel: s.effort === m.id }));
  else if (kind === 'perm') items = PERMS.map((m) => ({ id: m.id, main: m.name, sub: m.sub, sel: s.permission === m.id }));
  else items = [
    { id: 'copy-resume', main: 'Copy terminal command', sub: `claude --resume ${s.sessionId.slice(0, 8)}…` },
    { id: 'copy-path', main: 'Copy folder path' },
    { id: 'close', main: 'Put away', sub: 'Hide from the sidebar, keep history' },
    { id: 'delete', main: 'Delete from desk', sub: "Claude Code's own transcript stays" },
  ];
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.dataset.kind = kind;
  menuEl.innerHTML = items.map((it) => `<button data-id="${it.id}" class="${it.sel ? 'sel' : ''}"><span class="tick">${it.sel ? '✓' : ''}</span><span><div class="m-main">${esc(it.main)}</div>${it.sub ? `<div class="m-sub">${esc(it.sub)}</div>` : ''}</span></button>`).join('');
  const main = $('#main');
  main.appendChild(menuEl);
  const a = anchor.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  menuEl.style.top = a.bottom - m.top + 6 + 'px';
  const left = Math.min(a.left - m.left, m.width - menuEl.offsetWidth - 10);
  menuEl.style.left = Math.max(10, left) + 'px';
  menuEl.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.dataset.id;
    closeMenu();
    if (kind === 'model') await patchSession({ model: id });
    else if (kind === 'effort') await patchSession({ effort: id });
    else if (kind === 'perm') await patchSession({ permission: id });
    else if (id === 'copy-resume') copy(`cd "${s.cwd}" && claude --resume ${s.sessionId}`, 'Command copied');
    else if (id === 'copy-path') copy(s.cwd, 'Path copied');
    else if (id === 'close') { await patchSession({ open: false }); location.hash = '#/'; }
    else if (id === 'delete') {
      if (!confirm(`Delete "${s.title}" from desk?`)) return;
      await api('DELETE', '/sessions/' + s.id).catch((err) => toast(err.message));
      location.hash = '#/';
    }
  };
}

async function patchSession(patch) {
  const s = cur();
  try {
    const next = await api('PATCH', '/sessions/' + s.id, patch);
    st.sessions.set(next.id, next);
    renderHead();
    renderTray();
    if (s.status === 'working' && (patch.model || patch.effort || patch.permission)) toast('Takes effect from the next message');
  } catch (err) { toast(err.message); }
}

function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg || 'Copied'), () => toast("Couldn't copy"));
}

// ------------------------------------------------------------------ events -> model + DOM

function reduce(m, ev) {
  if (ev.type === 'assistant' && !ev.parent) {
    const u = ev.message.usage;
    if (u) m.ctx = { cached: u.cache_read_input_tokens || 0, fresh: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) };
    if (ev.message.model) m.modelName = ev.message.model;
    for (const c of ev.message.content || []) {
      if (c.type !== 'tool_use') continue;
      m.tools++;
      m.toolInputs.set(c.id, { name: c.name, input: c.input || {} });
      if (c.name === 'TodoWrite' && Array.isArray(c.input?.todos)) m.todos = c.input.todos;
    }
  } else if (ev.type === 'user' && !ev.parent) {
    for (const c of ev.message.content || []) {
      if (c.type !== 'tool_result') continue;
      const tu = m.toolInputs.get(c.tool_use_id);
      if (!tu || c.is_error) continue;
      const r = ev.result || {};
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tu.name)) {
        const fp = r.filePath || tu.input.file_path || tu.input.notebook_path;
        if (!fp) continue;
        const counts = patchCounts(r.structuredPatch);
        if (!counts.add && !counts.del && tu.name === 'Write') counts.add = lineCount(tu.input.content);
        const f = m.files.get(fp) || { add: 0, del: 0 };
        f.add += counts.add; f.del += counts.del;
        m.files.set(fp, f);
      } else if (tu.name === 'TaskCreate') {
        const text = typeof c.content === 'string' ? c.content : '';
        const id = String(r.task?.id ?? (text.match(/#(\d+)/) || [])[1] ?? m.tasks.size + 1);
        m.tasks.set(id, { content: tu.input.subject || tu.input.description || 'task', activeForm: tu.input.activeForm, status: 'pending' });
      } else if (tu.name === 'TaskUpdate') {
        const t = m.tasks.get(String(tu.input.taskId));
        if (t) {
          if (tu.input.status === 'deleted') m.tasks.delete(String(tu.input.taskId));
          else { if (tu.input.status) t.status = tu.input.status; if (tu.input.subject) t.content = tu.input.subject; }
        }
      }
    }
  } else if (ev.type === 'result') {
    m.turns++;
    m.timeMs += ev.durationMs || 0;
    m.cost += ev.cost || 0;
    const u = ev.usage || {};
    m.tokIn += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    m.tokOut += u.output_tokens || 0;
    m.cacheR += u.cache_read_input_tokens || 0;
    m.cacheW += u.cache_creation_input_tokens || 0;
    if (ev.contextWindow) m.window = ev.contextWindow;
  }
}

function patchCounts(hunks) {
  let add = 0, del = 0;
  for (const h of hunks || []) for (const l of h.lines || []) { if (l[0] === '+') add++; else if (l[0] === '-') del++; }
  return { add, del };
}

function ctxPct() {
  const m = st.view && st.view.m;
  if (!m || !m.ctx) return null;
  return Math.min(100, Math.round(((m.ctx.cached + m.ctx.fresh) / m.window) * 100));
}

function applyEvent(ev, live) {
  const v = st.view;
  if (ev.seq && ev.seq <= v.seq) return;
  if (ev.seq) v.seq = ev.seq;
  const stick = live && nearBottom();
  reduce(v.m, ev);
  renderEvent(ev);
  if (live) {
    renderTray();
    renderEmpty();
    if (ev.type === 'assistant' || ev.type === 'result') renderHead();
    if (stick) scrollToEnd();
  }
}

function nearBottom() {
  const sc = $('#scroll');
  return !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
}
function scrollToEnd(force) {
  const sc = $('#scroll');
  if (!sc) return;
  if (force || nearBottom()) sc.scrollTop = sc.scrollHeight;
}

function renderEmpty() {
  const items = $('#items');
  if (!items) return;
  const existing = $('.empty-session', items);
  const hasContent = [...items.children].some((c) => !c.classList.contains('empty-session'));
  if (hasContent || (cur() && cur().status === 'working')) { existing?.remove(); return; }
  if (!existing) {
    const s = cur();
    items.insertAdjacentHTML('afterbegin', `<div class="empty-session"><div><div class="eyebrow">${esc(baseName(s.cwd))}</div><h2>What are we making?</h2><p>Claude works in <span class="mono">${esc(st.view.where || s.cwd)}</span>. Type below to start.</p></div></div>`);
  }
}

function add(html) {
  const items = $('#items');
  items.insertAdjacentHTML('beforeend', html);
  return items.lastElementChild;
}

function endLive() {
  const v = st.view;
  v.liveText = '';
  $('#live').innerHTML = '';
}

function renderEvent(ev) {
  const v = st.view;
  const s = cur();
  if (ev.t === 'prompt') {
    endLive();
    const time = ev.ts ? clock(new Date(ev.ts)) : '';
    add(`<div class="prompt"><div class="who">you<time>${esc(time)}</time></div>${esc(ev.text)}</div>`);
  } else if (ev.t === 'compact') {
    add(`<div class="divider">context compacted</div>`);
  } else if (ev.t === 'error') {
    endLive();
    add(`<div class="err-card">${esc(ev.text)}</div>`);
  } else if (ev.t === 'decision') {
    const t = v.tools.get(ev.toolUseId);
    const html = `<div class="decision ${ev.allow ? '' : 'no'}">${ev.allow ? (ev.always ? 'you allowed this for the session' : 'you allowed this') : 'you said no'}</div>`;
    if (t) t.el.insertAdjacentHTML('beforeend', html); else add(html);
  } else if (ev.type === 'assistant') {
    if (ev.parent) return;
    for (const c of ev.message.content || []) {
      if (c.type === 'text' && c.text.trim()) { endLive(); add(`<div class="say">${md(c.text)}</div>`); }
      else if (c.type === 'thinking' && c.thinking && c.thinking.trim()) add(`<details class="thinking"><summary>${ICON.brain} thought about it</summary><div>${esc(c.thinking)}</div></details>`);
      else if (c.type === 'tool_use') addTool(c, s);
    }
  } else if (ev.type === 'user') {
    if (ev.parent) return;
    for (const c of ev.message.content || []) if (c.type === 'tool_result') finishTool(c, ev.result, s);
  } else if (ev.type === 'result') {
    endLive();
    // A finished turn has no running tools. Clear any spinner that never got a result.
    for (const t of v.tools.values()) {
      const spin = t.result === undefined && $('.spin', t.el);
      if (spin) spin.parentElement.innerHTML = '<span class="tool-state" style="color:var(--fg-3)">–</span>';
    }
    if (ev.isError && ev.text) add(`<div class="err-card">${esc(ev.text)}</div>`);
    const out = ev.usage ? ev.usage.output_tokens || 0 : 0;
    const bits = [];
    if (ev.durationMs) bits.push(`<b>${fmtDur(ev.durationMs)}</b>`);
    if (ev.cost) bits.push(fmtCost(ev.cost));
    if (ev.steps) bits.push(`${ev.steps} step${ev.steps === 1 ? '' : 's'}`);
    if (out) bits.push(`${fmtTokens(out)} tokens out`);
    if (ev.subtype === 'error_during_execution') bits.push('stopped');
    if (bits.length) add(`<div class="turn-foot">${bits.join('<span>·</span>')}</div>`);
  }
}

// ---- tools

function describeTool(name, input, s, result) {
  const i = input || {};
  const file = (p) => `<span class="mono">${esc(rel(p, s.cwd))}</span>`;
  const q = (x, n = 80) => esc(String(x || '').length > n ? String(x).slice(0, n) + '…' : String(x || ''));
  switch (name) {
    case 'Read': {
      const n = result?.file?.numLines;
      return { ico: ICON.read, c: 'var(--sky, var(--info))', html: `<b>Read</b> ${file(i.file_path)}${n ? ` <span style="color:var(--fg-3)">${n} lines</span>` : ''}` };
    }
    case 'Write': return { ico: ICON.write, c: 'var(--ok)', html: `<b>${result?.type === 'update' ? 'Rewrote' : 'Wrote'}</b> ${file(i.file_path)}` };
    case 'Edit':
    case 'MultiEdit': {
      const n = patchCounts(result?.structuredPatch);
      const count = name === 'MultiEdit' ? (i.edits || []).length : 1;
      const tally = result?.structuredPatch ? ` <span style="color:var(--fg-3)">(${count} change${count === 1 ? '' : 's'}, <span class="n-add">+${n.add}</span> <span class="n-del">−${n.del}</span>)</span>` : '';
      return { ico: ICON.edit, c: 'var(--warn)', html: `<b>Edited</b> ${file(i.file_path)}${tally}` };
    }
    case 'NotebookEdit': return { ico: ICON.edit, c: 'var(--warn)', html: `<b>Edited notebook</b> ${file(i.notebook_path)}` };
    case 'Bash': return { ico: ICON.bash, c: 'var(--accent)', html: `<b>Ran</b> <span class="mono">${q(String(i.command || '').split('\n')[0], 90)}</span>` };
    case 'BashOutput': return { ico: ICON.bash, c: 'var(--accent)', html: `<b>Checked</b> a background command` };
    case 'KillShell': case 'KillBash': return { ico: ICON.bash, c: 'var(--bad)', html: `<b>Stopped</b> a background command` };
    case 'Grep': return { ico: ICON.search, c: 'var(--info)', html: `<b>Searched</b> for <span class="mono">${q(i.pattern, 60)}</span>${i.path ? ' in ' + file(i.path) : ''}` };
    case 'Glob': return { ico: ICON.search, c: 'var(--info)', html: `<b>Looked for</b> <span class="mono">${q(i.pattern, 60)}</span>` };
    case 'WebFetch': { let host = i.url; try { host = new URL(i.url).host; } catch {} return { ico: ICON.web, c: 'var(--info)', html: `<b>Fetched</b> <span class="mono">${q(host)}</span>` }; }
    case 'WebSearch': return { ico: ICON.web, c: 'var(--info)', html: `<b>Searched the web</b> for “${q(i.query, 70)}”` };
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet':
      return { ico: ICON.todo, c: 'var(--ok)', html: `<b>Updated the to-do list</b>${i.subject ? ` <span style="color:var(--fg-3)">${q(i.subject, 60)}</span>` : ''}` };
    case 'Task': case 'Agent': return { ico: ICON.agent, c: 'var(--pink, var(--accent))', html: `<b>Sent a helper</b> ${q(i.description || i.subagent_type || '', 80)}` };
    case 'AskUserQuestion': return { ico: ICON.ask, c: 'var(--hot)', html: `<b>Asked you</b> ${q(i.questions?.[0]?.question || '', 80)}` };
    case 'ExitPlanMode': return { ico: ICON.plan, c: 'var(--info)', html: `<b>Proposed a plan</b>` };
    case 'EnterPlanMode': return { ico: ICON.plan, c: 'var(--info)', html: `<b>Switched to planning</b>` };
    case 'Skill': return { ico: ICON.skill, c: 'var(--warn)', html: `<b>Used skill</b> <span class="mono">${q(i.skill || i.command || '')}</span>` };
  }
  if (name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    return { ico: ICON.plug, c: 'var(--teal, var(--info))', html: `<b>${esc(server)}</b> · ${esc(rest.join('__'))}` };
  }
  return { ico: ICON.spark, c: 'var(--fg-2)', html: `<b>${esc(name)}</b>` };
}

function addTool(c, s) {
  const d = describeTool(c.name, c.input, s);
  const el = add(`<div class="tool" data-tool="${esc(c.id)}">
    <button class="tool-row"><span class="tool-ico" style="--c:${d.c}">${d.ico}</span><span class="tool-text">${d.html}</span><span class="tool-state"><span class="spin"></span></span></button>
  </div>`);
  const entry = { el, name: c.name, input: c.input || {}, detail: null };
  st.view.tools.set(c.id, entry);
  // Show edits right away from the tool input, then swap in the real patch when it lands.
  if (c.name === 'Edit' && c.input) entry.diff = appendDiff(el, c.input.file_path, stringsToHunks(c.input.old_string, c.input.new_string), s, false);
  if (c.name === 'MultiEdit' && c.input?.edits) entry.diff = appendDiff(el, c.input.file_path, c.input.edits.flatMap((e) => stringsToHunks(e.old_string, e.new_string)), s, false);
  if (c.name === 'ExitPlanMode' && c.input?.plan) el.insertAdjacentHTML('beforeend', `<div class="tool-detail"><div class="say" style="margin:0">${md(c.input.plan)}</div></div>`);
  $('.tool-row', el).onclick = () => toggleToolDetail(entry);
}

function finishTool(c, result, s) {
  const entry = st.view.tools.get(c.tool_use_id);
  if (!entry) return;
  entry.result = result;
  entry.content = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('\n') : '';
  entry.isError = !!c.is_error;
  const d = describeTool(entry.name, entry.input, s, result);
  $('.tool-text', entry.el).innerHTML = d.html;
  $('.tool-state', entry.el).innerHTML = entry.isError ? `<span class="tool-state err">✗</span>` : `<span class="tool-state ok">✓</span>`;
  const patch = result && Array.isArray(result.structuredPatch) ? result.structuredPatch : null;
  const fp = result?.filePath || entry.input.file_path;
  if (!entry.isError && ['Edit', 'MultiEdit', 'Write'].includes(entry.name)) {
    let hunks = patch && patch.length ? patch : null;
    if (!hunks && entry.name === 'Write') hunks = stringsToHunks('', entry.input.content || '');
    if (hunks) {
      entry.diff?.remove();
      entry.diff = appendDiff(entry.el, fp, hunks, s, true);
    }
  }
  if (entry.isError) {
    entry.diff?.remove();
    openToolDetail(entry);
  }
}

function toolDetailHtml(entry) {
  const r = entry.result;
  if (entry.name === 'Bash') {
    const outText = r && (r.stdout || r.stderr) ? [r.stdout, r.stderr].filter(Boolean).join('\n') : entry.content;
    return `<pre>$ ${esc(entry.input.command)}${entry.input.description ? `\n# ${esc(entry.input.description)}` : ''}${outText ? '\n\n' + esc(outText) : ''}</pre>`;
  }
  if ((entry.name === 'Task' || entry.name === 'Agent') && entry.content) return `<div class="say" style="margin:0">${md(entry.content)}</div>`;
  if (entry.content == null) return `<pre>${esc(JSON.stringify(entry.input, null, 2))}</pre>`;
  if (entry.name === 'Read') return `<pre>${esc(entry.content.slice(0, 4000))}</pre>`;
  return `<pre class="${entry.isError ? 'err' : ''}">${esc(entry.content || '(nothing came back)')}</pre>`;
}
function openToolDetail(entry) {
  if (entry.detail) return;
  entry.detail = document.createElement('div');
  entry.detail.className = 'tool-detail';
  entry.detail.innerHTML = toolDetailHtml(entry);
  $('.tool-row', entry.el).after(entry.detail);
}
function toggleToolDetail(entry) {
  if (entry.detail) { entry.detail.remove(); entry.detail = null; } else openToolDetail(entry);
}

function stringsToHunks(oldS, newS) {
  const lines = [];
  if (oldS) for (const l of String(oldS).replace(/\n$/, '').split('\n')) lines.push('-' + l);
  if (newS) for (const l of String(newS).replace(/\n$/, '').split('\n')) lines.push('+' + l);
  return [{ oldStart: 0, newStart: 0, lines, noNumbers: true }];
}

function diffRows(hunks) {
  let rows = '';
  let adds = [];
  for (const h of hunks) {
    let o = h.oldStart, n = h.newStart;
    if (hunks.length > 1 && !h.noNumbers) rows += `<div class="dl hunk"><span class="ln"></span><span class="sg"></span><span class="tx">@@ line ${h.newStart}</span></div>`;
    for (const line of h.lines || []) {
      const sg = line[0], tx = line.slice(1);
      if (sg === '\\') continue;
      if (sg === '+') { adds.push(tx); rows += `<div class="dl add"><span class="ln">${h.noNumbers ? '' : n}</span><span class="sg">+</span><span class="tx">${esc(tx)}</span></div>`; n++; }
      else if (sg === '-') { rows += `<div class="dl del"><span class="ln">${h.noNumbers ? '' : o}</span><span class="sg">−</span><span class="tx">${esc(tx)}</span></div>`; o++; }
      else { rows += `<div class="dl"><span class="ln">${h.noNumbers ? '' : n}</span><span class="sg"></span><span class="tx">${esc(tx)}</span></div>`; o++; n++; }
    }
  }
  return { rows, adds };
}

function appendDiff(parent, filePath, hunks, s, final) {
  const { rows, adds } = diffRows(hunks);
  const n = patchCounts(hunks);
  const long = n.add + n.del > 24;
  const el = document.createElement('div');
  el.className = 'diff';
  el.innerHTML = `<div class="diff-head"><span class="mono">${esc(rel(filePath, s.cwd))}</span><span class="n-add">+${n.add}</span><span class="n-del">−${n.del}</span>${final ? '' : '<span style="color:var(--fg-3)">pending</span>'}
    ${long ? '<button data-act="grow">expand</button>' : ''}<button data-act="copy">copy</button></div>
    <div class="diff-body ${long ? 'clip' : ''}">${rows}</div>`;
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'copy') copy(adds.join('\n'), 'Copied the new lines');
    if (b.dataset.act === 'grow') { const body = $('.diff-body', el); body.classList.toggle('clip'); b.textContent = body.classList.contains('clip') ? 'expand' : 'collapse'; }
  };
  // Keep the diff right under the tool row, above any "you allowed this" note.
  const anchor = parent.querySelector('.tool-detail') || parent.querySelector('.tool-row');
  if (anchor) anchor.after(el); else parent.appendChild(el);
  return el;
}

// ---- live streaming text

let liveRaf = 0;
function onDelta(msg) {
  const v = st.view;
  if (msg.block === 'thinking') { if (!v.activity) { v.activity = 'Thinking'; renderActivity(); } return; }
  if (msg.reset) v.liveText = '';
  v.liveText += msg.text;
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0;
    const stick = nearBottom();
    const box = $('#live');
    if (!box) return;
    box.innerHTML = v.liveText ? `<div class="say live">${md(v.liveText)}</div>` : '';
    renderEmpty();
    if (stick) scrollToEnd(true);
  });
}

// ---- tail: activity + permission prompts

function renderActivity() {
  const s = cur();
  const tail = $('#tail');
  if (!s || !tail) return;
  let el = $('.activity', tail);
  if (s.status !== 'working') { el?.remove(); return; }
  if (!el) { tail.insertAdjacentHTML('afterbegin', `<div class="activity"><span class="dots"><i></i><i></i><i></i></span><span></span></div>`); el = $('.activity', tail); }
  el.lastElementChild.textContent = st.view.activity || 'Working';
  refreshAgos();
}

function renderTail() {
  const s = cur();
  const tail = $('#tail');
  if (!s || !tail) return;
  const stick = nearBottom();
  if (s.status !== 'working') st.view.activity = null;
  renderActivity();
  const pending = s.pending || [];
  const key = pending.map((p) => p.requestId).join(',');
  if (key !== st.view.pendingKey) {
    st.view.pendingKey = key;
    $$('.ask', tail).forEach((x) => x.remove());
    for (const p of pending) tail.appendChild(askCard(s, p));
    if (stick) scrollToEnd(true);
  }
}

function askCard(s, p) {
  const el = document.createElement('div');
  el.className = 'ask';
  const i = p.input || {};
  let title, sub = p.description && p.description !== i.file_path ? p.description : '', body = '';
  let allowLabel = 'Allow', denyLabel = 'No', allowAlways = p.suggestions && p.suggestions.length ? 'Allow for this session' : '';
  switch (p.tool) {
    case 'Edit': case 'MultiEdit': {
      title = `Edit ${rel(i.file_path, s.cwd)}?`;
      const hunks = p.tool === 'Edit' ? stringsToHunks(i.old_string, i.new_string) : (i.edits || []).flatMap((e) => stringsToHunks(e.old_string, e.new_string));
      body = `<div class="diff"><div class="diff-body">${diffRows(hunks).rows}</div></div>`;
      allowAlways = allowAlways && 'Allow edits for this session';
      break;
    }
    case 'Write': {
      title = `Write ${rel(i.file_path, s.cwd)}?`;
      const text = String(i.content || '');
      const lines = text.split('\n');
      body = `<div class="diff"><div class="diff-body clip">${diffRows(stringsToHunks('', lines.slice(0, 200).join('\n'))).rows}</div></div>`;
      break;
    }
    case 'Bash':
      title = 'Run this command?';
      sub = i.description || '';
      body = `<pre>$ ${esc(i.command)}</pre>`;
      break;
    case 'WebFetch': title = `Fetch ${i.url}?`; break;
    case 'ExitPlanMode':
      title = "Here's the plan";
      sub = 'Approve it and Claude starts making changes.';
      body = `<div class="say">${md(i.plan || '')}</div>`;
      allowLabel = 'Approve plan'; denyLabel = 'Keep planning'; allowAlways = '';
      break;
    case 'AskUserQuestion':
      title = 'Claude has a question';
      body = (i.questions || []).map((q, qi) => `<div class="q" data-q="${qi}"><div class="q-text">${esc(q.question)}</div><div class="q-opts">${(q.options || []).map((o, oi) => `<button class="q-opt" data-o="${oi}"><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</button>`).join('')}</div></div>`).join('');
      allowLabel = 'Send answers'; denyLabel = 'Skip'; allowAlways = '';
      break;
    default:
      title = p.tool.startsWith('mcp__') ? `Use ${p.tool.split('__').slice(1).join(' · ')}?` : `Use ${p.tool}?`;
      body = Object.keys(i).length ? `<pre>${esc(JSON.stringify(i, null, 2))}</pre>` : '';
  }
  el.innerHTML = `
    <div class="ask-head"><span class="tag">needs you</span><span>${esc(title)}</span></div>
    ${sub ? `<div class="ask-sub">${esc(sub)}</div>` : ''}
    ${body ? `<div class="ask-body">${body}</div>` : ''}
    <div class="ask-actions">
      <button class="btn go" data-a="allow">${esc(allowLabel)}</button>
      ${allowAlways ? `<button class="btn" data-a="always">${esc(allowAlways)}</button>` : ''}
      <input placeholder="or tell Claude what to do instead" data-note>
      <button class="btn danger" data-a="deny">${esc(denyLabel)}</button>
    </div>`;

  const picks = st.view.askState.get(p.requestId) || {};
  st.view.askState.set(p.requestId, picks);
  const syncPicks = () => $$('.q', el).forEach((qEl) => {
    const qi = qEl.dataset.q;
    $$('.q-opt', qEl).forEach((b) => b.classList.toggle('sel', (picks[qi] || []).includes(+b.dataset.o)));
  });
  syncPicks();

  const answer = async (body) => {
    $$('button', el).forEach((b) => { b.disabled = true; });
    try { await api('POST', `/sessions/${s.id}/permission`, { requestId: p.requestId, ...body }); }
    catch (err) { toast(err.message); $$('button', el).forEach((b) => { b.disabled = false; }); }
  };
  el.onclick = (e) => {
    const opt = e.target.closest('.q-opt');
    if (opt) {
      const qi = opt.closest('.q').dataset.q;
      const q = i.questions[qi];
      const o = +opt.dataset.o;
      const cur = picks[qi] || [];
      picks[qi] = q.multiSelect ? (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]) : [o];
      syncPicks();
      return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const note = $('[data-note]', el).value.trim();
    if (b.dataset.a === 'deny' || (note && b.dataset.a !== 'allow' && b.dataset.a !== 'always')) {
      return answer({ allow: false, message: note || undefined });
    }
    if (p.tool === 'AskUserQuestion') {
      const answers = {};
      (i.questions || []).forEach((q, qi) => {
        const chosen = (picks[qi] || []).map((o) => q.options[o].label);
        if (chosen.length) answers[q.question] = chosen.join(', ');
      });
      if (note) answers.note = note;
      return answer({ allow: true, updatedInput: { ...i, answers } });
    }
    answer({ allow: true, always: b.dataset.a === 'always' });
  };
  $('[data-note]', el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); answer({ allow: false, message: e.target.value.trim() || undefined }); } };
  return el;
}

// ------------------------------------------------------------------ composer

function wireComposer() {
  const ta = $('#composer-text');
  const pop = $('#pop');
  const btn = $('#send-btn');
  let popItems = [];
  let popSel = 0;
  let popTrigger = null;

  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + 'px'; };

  const closePop = () => { pop.hidden = true; popItems = []; popTrigger = null; };
  const showPop = () => {
    if (!popItems.length) return closePop();
    pop.hidden = false;
    pop.innerHTML = popItems.map((it, k) => `<button data-k="${k}" class="${k === popSel ? 'sel' : ''}"><span class="mono">${esc(it.label)}</span><small>${esc(it.sub || '')}</small></button>`).join('');
    pop.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (k) => {
    const it = popItems[k];
    if (!it || !popTrigger) return;
    const before = ta.value.slice(0, popTrigger.start);
    const after = ta.value.slice(ta.selectionStart);
    ta.value = before + it.insert + after;
    const pos = before.length + it.insert.length;
    ta.setSelectionRange(pos, pos);
    closePop();
    ta.focus();
    autosize();
    renderComposerState();
  };

  const updatePop = async () => {
    const upto = ta.value.slice(0, ta.selectionStart);
    const slash = upto.match(/^\/([\w:-]*)$/);
    const at = upto.match(/(^|\s)@([^\s@]*)$/);
    if (slash) {
      const s = cur();
      const cmds = (s.commands && s.commands.length ? s.commands : [{ name: 'compact', description: 'Summarise to free up context' }, { name: 'clear', description: 'Start the context over' }, { name: 'review', description: 'Review changes' }]);
      const qq = slash[1].toLowerCase();
      popItems = cmds.filter((c) => c.name.toLowerCase().includes(qq)).sort((a, b) => a.name.toLowerCase().indexOf(qq) - b.name.toLowerCase().indexOf(qq)).slice(0, 30)
        .map((c) => ({ label: '/' + c.name, sub: c.description, insert: '/' + c.name + ' ' }));
      popTrigger = { start: 0 };
      popSel = 0;
      showPop();
    } else if (at) {
      const v = st.view;
      if (!v.files) {
        v.files = [];
        try { v.files = (await api('GET', `/sessions/${v.id}/files`)).files; } catch {}
      }
      const qq = at[2].toLowerCase();
      const scored = [];
      for (const f of v.files) {
        const lf = f.toLowerCase();
        const idx = lf.indexOf(qq);
        if (idx === -1) continue;
        const base = lf.slice(lf.lastIndexOf('/') + 1);
        scored.push({ f, score: (base.startsWith(qq) ? 0 : base.includes(qq) ? 1 : 2) * 1000 + f.length });
        if (scored.length > 400) break;
      }
      scored.sort((a, b) => a.score - b.score);
      popItems = scored.slice(0, 12).map(({ f }) => ({ label: baseName(f), sub: f, insert: '@' + f + ' ' }));
      popTrigger = { start: upto.length - at[2].length - 1 };
      popSel = 0;
      showPop();
    } else closePop();
  };

  ta.addEventListener('input', () => { autosize(); updatePop(); renderComposerState(); });
  ta.addEventListener('click', updatePop);
  ta.addEventListener('blur', () => setTimeout(closePop, 150));
  ta.addEventListener('keydown', (e) => {
    if (!pop.hidden && popItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); popSel = (popSel + 1) % popItems.length; return showPop(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); popSel = (popSel - 1 + popItems.length) % popItems.length; return showPop(); }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pick(popSel); }
      if (e.key === 'Escape') { e.preventDefault(); return closePop(); }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  pop.addEventListener('mousedown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); pick(+b.dataset.k); } });
  btn.onclick = () => {
    const s = cur();
    const busy = s && (s.status === 'working' || s.status === 'needs_you');
    if (busy && !ta.value.trim()) return stop();
    send();
  };

  async function send() {
    const text = ta.value.trim();
    if (!text) return;
    const s = cur();
    ta.value = '';
    autosize();
    closePop();
    renderComposerState();
    try { await api('POST', `/sessions/${s.id}/send`, { text }); scrollToEnd(true); }
    catch (err) { toast(err.message); ta.value = text; autosize(); renderComposerState(); }
  }
  async function stop() {
    const s = cur();
    try { await api('POST', `/sessions/${s.id}/stop`); } catch (err) { toast(err.message); }
  }
  autosize();
}

function renderComposerState() {
  const s = cur();
  const btn = $('#send-btn');
  const ta = $('#composer-text');
  if (!s || !btn || !ta) return;
  const busy = s.status === 'working' || s.status === 'needs_you';
  const hasText = !!ta.value.trim();
  if (busy && !hasText) { btn.className = 'btn stop'; btn.textContent = 'Stop'; btn.disabled = false; }
  else { btn.className = 'btn primary'; btn.textContent = busy ? 'Queue' : 'Send'; btn.disabled = !hasText; }
  ta.placeholder = busy ? 'Claude is on it. Type to queue a follow-up…' : 'What are we making?';
}

// ------------------------------------------------------------------ tray

function renderTray() {
  const tray = $('#tray');
  const v = st.view;
  const s = cur();
  if (!v || !s) {
    tray.innerHTML = trayIdle();
    return;
  }
  const m = v.m;

  // to do
  const todos = m.tasks.size ? [...m.tasks.values()] : m.todos;
  const done = todos.filter((t) => t.status === 'completed').length;
  const todoHtml = todos.length
    ? `<ul class="todo">${todos.map((t) => `<li class="${t.status}"><span class="box">${t.status === 'completed' ? ICON.check.replace('width="14" height="14"', 'width="10" height="10"') : ''}</span><span>${esc(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content)}</span></li>`).join('')}</ul>`
    : `<div class="card-empty">Claude's plan shows up here when it makes one.</div>`;

  // files
  const files = [...m.files.entries()];
  let fa = 0, fd = 0;
  for (const [, f] of files) { fa += f.add; fd += f.del; }
  const filesHtml = files.length
    ? `<ul class="files">${files.map(([p, f]) => {
        const r = rel(p, s.cwd);
        const dir = r.includes('/') ? r.slice(0, r.lastIndexOf('/') + 1) : '';
        return `<li><span class="fn" title="${esc(r)}"><small>${esc(dir)}</small>${esc(baseName(r))}</span><span class="n-add">+${f.add}</span><span class="n-del">−${f.del}</span></li>`;
      }).join('')}</ul>`
    : `<div class="card-empty">No files changed yet.</div>`;

  // context
  const pct = ctxPct();
  const cached = m.ctx ? m.ctx.cached : 0, fresh = m.ctx ? m.ctx.fresh : 0;
  const used = cached + fresh;
  const free = Math.max(0, m.window - used);
  const w = (n) => (n / m.window) * 100 + '%';

  tray.innerHTML = `
    <section class="card">
      <div class="card-head"><h3>To do</h3><span class="count">${todos.length ? `${done} of ${todos.length}` : ''}</span></div>
      ${todoHtml}
    </section>
    <section class="card">
      <div class="card-head"><h3>Files touched</h3><span class="count">${files.length ? `${files.length} · <span class="n-add">+${fa}</span> <span class="n-del">−${fd}</span>` : ''}</span></div>
      ${filesHtml}
    </section>
    <section class="card">
      <div class="card-head"><h3>This session</h3><span class="count mono">No. ${String(s.number || 0).padStart(4, '0')}</span></div>
      <dl class="stats">
        <dt>Turns</dt><dd>${m.turns}</dd>
        <dt>Claude time</dt><dd>${fmtDur(m.timeMs)}</dd>
        <dt>Tool uses</dt><dd>${m.tools}</dd>
        <dt>Tokens in / out</dt><dd>${fmtTokens(m.tokIn)} / ${fmtTokens(m.tokOut)}</dd>
        <dt>Cache read / write</dt><dd>${fmtTokens(m.cacheR)} / ${fmtTokens(m.cacheW)}</dd>
        <dt>Model</dt><dd class="mono" style="font-size:12px">${esc(shortModel(m.modelName || s.modelName) || s.model)}</dd>
        <dt>Effort</dt><dd>${esc(s.effort || 'default')}</dd>
        <dt>Session</dt><dd class="mono" style="font-size:12px" title="${esc(s.sessionId)}">${esc(s.sessionId.slice(0, 8))}</dd>
      </dl>
      <div class="cost-row"><span>Cost<br>API equivalent</span><span class="cost-big">${fmtCost(m.cost)}</span></div>
    </section>
    <section class="card">
      <div class="card-head"><h3>Context</h3><span class="count">${pct == null ? '—' : `${pct}% of ${fmtTokens(m.window)}`}</span></div>
      <div class="ctx-bar"><i style="width:${w(cached)};background:var(--info)"></i><i style="width:${w(fresh)};background:var(--accent)"></i></div>
      <div class="legend">
        <i class="sw" style="background:var(--info)"></i><span>Cached</span><b>${fmtTokens(cached)}</b>
        <i class="sw" style="background:var(--accent)"></i><span>New last turn</span><b>${fmtTokens(fresh)}</b>
        <i class="sw" style="background:var(--raised-2)"></i><span>Free</span><b>${fmtTokens(free)}</b>
      </div>
      <div class="ctx-note">Claude Code compacts on its own as this fills. Type <span class="mono">/compact</span> to do it now.</div>
    </section>`;
}

function trayIdle() {
  const all = [...st.sessions.values()];
  const counts = { working: 0, needs_you: 0, done: 0 };
  for (const s of all) if (counts[s.status] != null) counts[s.status]++;
  return `
    <section class="card">
      <div class="card-head"><h3>Right now</h3></div>
      <dl class="stats">
        <dt>Working</dt><dd style="color:var(--info)">${counts.working}</dd>
        <dt>Needs you</dt><dd style="color:var(--hot)">${counts.needs_you}</dd>
        <dt>Done</dt><dd style="color:var(--ok)">${counts.done}</dd>
        <dt>All sessions</dt><dd>${all.length}</dd>
      </dl>
    </section>
    <section class="card">
      <div class="card-head"><h3>How this works</h3></div>
      <div class="card-empty" style="line-height:1.55">Each session is a real Claude Code session running on this machine, so you can pick any of them up in the terminal with <span class="mono">claude --resume</span>. Permission prompts land here as cards.</div>
    </section>`;
}

boot().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;font:600 15px system-ui;color:#f38ba8;background:#11111b;height:100vh">desk couldn't start: ${esc(err.message)}. Try reloading.</div>`;
});
