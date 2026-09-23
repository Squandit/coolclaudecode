'use strict';
// Boot, the live connection to the server, and switching between layouts.

let L = null; // the active layout: Classic or Tiling

async function boot() {
  const data = await api('GET', '/state');
  st.settings = data.settings;
  st.usage = data.usage;
  st.demo = data.demo;
  st.home = data.home;
  st.system = data.system;
  for (const s of data.sessions) { st.sessions.set(s.id, s); st.prevStatus.set(s.id, s.status); }

  window.addEventListener('hashchange', () => L && L.go());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && closeModal()) { e.preventDefault(); return; }
    const act = Keys.action(e);
    if (act && act.id === 'themes') { e.preventDefault(); if (!$('.theme-modal')) openThemePicker(); return; }
    if (L && L.keys(e, act)) return;
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu, [data-menu]')) closeMenu();
    if (e.target.closest('[data-shortcuts-link]')) { e.preventDefault(); openShortcuts(); }
  });
  window.addEventListener('resize', closeMenu);
  setInterval(() => { L && L.onTick(); refreshAgos(); }, 30000);

  await Terms.init();
  applyTheme();
  connect();
  loadProjects();
  setInterval(loadProjects, 60000);
  updateTitle();
}

function setThemeVars(css) {
  let el = $('#theme-vars');
  if (!el) { el = document.createElement('style'); el.id = 'theme-vars'; document.head.appendChild(el); }
  el.textContent = css;
}

// Apply the saved theme, or preview another one without saving it.
function applyTheme(previewId) {
  const theme = byId(THEMES, previewId || st.settings.theme) || THEMES[0];
  const next = theme.layout === 'tiling' ? Tiling : Classic;
  document.body.classList.toggle('layout-tiling', next === Tiling);
  document.body.classList.toggle('layout-classic', next === Classic);
  if (next === Tiling) Tiling.applyConfig(st.settings.rice || DEFAULT_RICE);
  else {
    const ui = st.settings.font || 'JetBrains Mono', code = st.settings.codeFont || 'JetBrains Mono';
    loadFont(ui); loadFont(code);
    setThemeVars(`:root {${paletteVars(PALETTES[theme.palette] || PALETTES.catppuccin, { font: fontStack(ui), mono: fontStack(code, true) })}}`);
    document.body.classList.toggle('font-sans', !(FONTS.find((f) => f.name === ui) || { mono: true }).mono);
  }
  Terms.retheme();
  if (L === next) return;
  if (L) L.leave();
  L = next;
  L.enter();
}

async function saveSettings(patch, { apply = true } = {}) {
  try {
    st.settings = await api('PUT', '/settings', patch);
    if (apply) applyTheme();
  } catch (err) { toast(err.message); }
}

function switchTheme(id) {
  const patch = { theme: id };
  if (id === 'riced') patch.rice = setRiceKey(st.settings.rice || DEFAULT_RICE, 'theme', 'riced');
  return saveSettings(patch);
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
    for (const p of panes.values()) p.load();
    L.go();
  };
  es.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    onServer(msg);
  };
}

function onServer(msg) {
  switch (msg.kind) {
    case 'session': {
      const s = msg.session;
      const prev = st.prevStatus.get(s.id);
      st.sessions.set(s.id, s);
      st.prevStatus.set(s.id, s.status);
      if (prev !== s.status) maybeNotify(s, prev);
      panes.get(s.id)?.onSession();
      L.onSession(s);
      updateTitle();
      break;
    }
    case 'removed':
      st.sessions.delete(msg.id);
      panes.get(msg.id)?.destroy();
      L.onRemoved(msg.id);
      updateTitle();
      break;
    case 'event':
      panes.get(msg.id)?.onEvent(msg.event);
      break;
    case 'delta':
      panes.get(msg.id)?.onDelta(msg);
      break;
    case 'activity':
      panes.get(msg.id)?.onActivity(msg.text);
      refreshAgos();
      break;
    case 'term':
      Terms.onData(msg.id, msg.data, msg.end);
      break;
    case 'term-exit':
      Terms.onExit(msg.id);
      break;
    case 'terms':
      Terms.onList(msg.terms);
      break;
    case 'usage':
      st.usage = msg.usage;
      L.onUsage();
      break;
    case 'settings': {
      const themeChanged = msg.settings.theme !== st.settings.theme;
      st.settings = msg.settings;
      // While desk.conf is open, what's in the editor wins.
      if (themeChanged || !$('.cfgwin')) applyTheme();
      break;
    }
  }
}

// ---- hooks the panes and layouts call

function onPaneFocus(p) { L && L.onPaneFocus && L.onPaneFocus(p); }
function onPaneStats(p) { L && L.onPaneStats && L.onPaneStats(p); }
function putAway(id) { return L.putAway(id); }
function toggleInfo() { L.toggleInfo(); }
function renderTray() { L && L.renderTray(); }

function refreshAgos() {
  for (const el of $$('[data-ago]')) {
    const s = st.sessions.get(el.dataset.ago);
    if (s) el.textContent = sessionSub(s).text;
  }
}

async function createSession(cwd, prompt, crew) {
  const s = await api('POST', '/sessions', { cwd, prompt, crew: !!crew });
  st.sessions.set(s.id, s);
  loadProjects();
  return s;
}

async function importSession(sessionId) {
  try {
    const s = await api('POST', '/sessions', { importSessionId: sessionId });
    st.sessions.set(s.id, s);
    location.hash = '#/s/' + s.id;
    loadProjects();
  } catch (err) { toast(err.message); }
}

async function loadProjects() {
  try {
    const data = await api('GET', '/projects');
    st.projects = data.projects;
    st.history = data.history;
    L && L.onProjects();
  } catch {}
}

function updateTitle() {
  const n = [...st.sessions.values()].filter((s) => s.status === 'needs_you').length;
  document.title = (n ? `(${n}) ` : '') + 'desk';
}

function maybeNotify(s, prev) {
  let body = null;
  if (s.status === 'needs_you') body = 'Claude needs your go-ahead.';
  else if (s.status === 'done' && prev === 'working') body = s.summary || 'Finished.';
  else if (s.status === 'error') body = 'Hit an error.';
  if (!body) return;
  const watching = !document.hidden && st.focusId === s.id;
  if (watching) return;
  if (L === Tiling && !document.hidden) Tiling.note(s, body);
  if (!st.settings.notify || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(s.title, { body, icon: 'icon.svg', tag: s.id });
    n.onclick = () => { window.focus(); location.hash = '#/s/' + s.id; };
  } catch {}
}

boot().catch((err) => {
  document.body.innerHTML = `<div style="padding:40px;font:600 15px monospace;color:#f38ba8;background:#11111b;height:100vh">desk couldn't start: ${esc(err.message)}. Try reloading.</div>`;
});
