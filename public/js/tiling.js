'use strict';
// The riced layout: a tiling desktop where every open session is a window.
// Configured through desk.conf, a plain text file you edit in its own window (Alt C).

const PALETTES = {
  tokyonight: { crust: '#0f0f14', mantle: '#16161e', base: '#1a1b26', s0: '#292e42', s1: '#414868', line: '#232433', fg: '#c0caf5', fg2: '#a9b1d6', fg3: '#565f89', accent: '#7aa2f7', accent2: '#bb9af7', ok: '#9ece6a', warn: '#e0af68', hot: '#ff9e64', bad: '#f7768e', info: '#7dcfff' },
  catppuccin: { crust: '#11111b', mantle: '#181825', base: '#1e1e2e', s0: '#313244', s1: '#45475a', line: '#2a2b3c', fg: '#cdd6f4', fg2: '#a6adc8', fg3: '#7f849c', accent: '#cba6f7', accent2: '#89b4fa', ok: '#a6e3a1', warn: '#f9e2af', hot: '#fab387', bad: '#f38ba8', info: '#89dceb' },
  gruvbox: { crust: '#141617', mantle: '#1d2021', base: '#282828', s0: '#3c3836', s1: '#504945', line: '#32302f', fg: '#ebdbb2', fg2: '#d5c4a1', fg3: '#928374', accent: '#fabd2f', accent2: '#83a598', ok: '#b8bb26', warn: '#fabd2f', hot: '#fe8019', bad: '#fb4934', info: '#83a598' },
  nord: { crust: '#1f232b', mantle: '#242933', base: '#2e3440', s0: '#3b4252', s1: '#4c566a', line: '#373e4c', fg: '#eceff4', fg2: '#d8dee9', fg3: '#7b88a1', accent: '#88c0d0', accent2: '#b48ead', ok: '#a3be8c', warn: '#ebcb8b', hot: '#d08770', bad: '#bf616a', info: '#81a1c1' },
  rosepine: { crust: '#111019', mantle: '#16141f', base: '#191724', s0: '#26233a', s1: '#403d52', line: '#21202e', fg: '#e0def4', fg2: '#908caa', fg3: '#6e6a86', accent: '#c4a7e7', accent2: '#ebbcba', ok: '#9ccfd8', warn: '#f6c177', hot: '#ebbcba', bad: '#eb6f92', info: '#3e8fb0' },
  everforest: { crust: '#1e2326', mantle: '#232a2e', base: '#2d353b', s0: '#343f44', s1: '#475258', line: '#2e383c', fg: '#d3c6aa', fg2: '#9da9a0', fg3: '#7a8478', accent: '#a7c080', accent2: '#7fbbb3', ok: '#a7c080', warn: '#dbbc7f', hot: '#e69875', bad: '#e67e80', info: '#7fbbb3' },
};

const DEFAULT_RICE = `# desk.conf
# Changes apply as you type and save on their own.
# Comments start with "# " (a hash, then a space). Colours are hex,
# or a palette name: accent accent2 ok warn hot bad info fg fg2 fg3 s0 s1

theme = riced             # riced, or mocha to go back to the classic layout
colors = tokyonight       # tokyonight catppuccin gruvbox nord rosepine everforest
accent = auto             # auto, or any colour

# windows
layout = dwindle          # dwindle, master or monocle
gaps_in = 5
gaps_out = 12
border_size = 2
rounding = 6
active_border = accent accent2 45deg   # one colour, or several plus an angle
inactive_border = s0
opacity_inactive = 0.9
animations = on

# text
font = JetBrains Mono     # anything installed works, Nerd Fonts too
font_size = 13

# bar and background
bar_position = top        # top or bottom
bar_style = islands       # islands or flat
wallpaper = mesh          # mesh, dots, grid, plain, or an https:// image
`;

const RICE_KEYS = {
  theme: { def: 'riced', oneOf: ['riced', 'mocha'] },
  colors: { def: 'tokyonight', oneOf: Object.keys(PALETTES) },
  accent: { def: 'auto', color: true, allow: ['auto'] },
  layout: { def: 'dwindle', oneOf: ['dwindle', 'master', 'monocle'] },
  gaps_in: { def: 5, int: [0, 60] },
  gaps_out: { def: 12, int: [0, 120] },
  border_size: { def: 2, int: [0, 12] },
  rounding: { def: 6, int: [0, 30] },
  active_border: { def: 'accent accent2 45deg', border: true },
  inactive_border: { def: 's0', border: true },
  opacity_inactive: { def: 0.9, float: [0.3, 1] },
  animations: { def: 'on', oneOf: ['on', 'off'] },
  font: { def: 'JetBrains Mono', font: true },
  font_size: { def: 13, int: [10, 20] },
  bar_position: { def: 'top', oneOf: ['top', 'bottom'] },
  bar_style: { def: 'islands', oneOf: ['islands', 'flat'] },
  wallpaper: { def: 'mesh', wall: true },
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function parseRice(text) {
  const cfg = {};
  for (const [k, spec] of Object.entries(RICE_KEYS)) cfg[k] = spec.def;
  const errors = [];
  String(text || '').split('\n').forEach((raw, i) => {
    const line = raw.replace(/^\s*#.*$/, '').replace(/\s+#\s.*$/, '').trim();
    if (!line) return;
    const m = line.match(/^([a-z_]+)\s*=\s*(.*)$/i);
    if (!m) return errors.push(`line ${i + 1}: expected "key = value"`);
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    const spec = RICE_KEYS[key];
    if (!spec) return errors.push(`line ${i + 1}: unknown key "${key}"`);
    const bad = (why) => errors.push(`line ${i + 1}: ${key} ${why}`);
    if (spec.oneOf) { if (!spec.oneOf.includes(val)) return bad(`should be ${spec.oneOf.join(', ')}`); cfg[key] = val; }
    else if (spec.int) { const n = Number(val); if (!Number.isInteger(n) || n < spec.int[0] || n > spec.int[1]) return bad(`should be a whole number from ${spec.int[0]} to ${spec.int[1]}`); cfg[key] = n; }
    else if (spec.float) { const n = Number(val); if (!Number.isFinite(n) || n < spec.float[0] || n > spec.float[1]) return bad(`should be between ${spec.float[0]} and ${spec.float[1]}`); cfg[key] = n; }
    else if (spec.color) { if (!(spec.allow || []).includes(val) && !isColorWord(val)) return bad('should be a colour'); cfg[key] = val; }
    else if (spec.border) { if (!parseBorder(val, PALETTES.tokyonight, '#000')) return bad('should be colours, optionally ending in an angle like 45deg'); cfg[key] = val; }
    else if (spec.font) { const f = val.replace(/["'`;{}()<>\\]/g, '').trim(); if (!f) return bad('is empty'); cfg[key] = f; }
    else if (spec.wall) {
      if (['mesh', 'dots', 'grid', 'plain'].includes(val) || /^https:\/\/[^\s"'()\\]+$/.test(val)) cfg[key] = val;
      else return bad('should be mesh, dots, grid, plain or an https:// url');
    }
  });
  return { cfg, errors };
}

function isColorWord(v) { return HEX.test(v) || v in PALETTES.tokyonight; }
function resolveColor(v, pal, accent) {
  if (HEX.test(v)) return v;
  if (v === 'accent') return accent;
  return pal[v] || null;
}
function parseBorder(val, pal, accent) {
  const parts = val.split(/\s+/).filter(Boolean);
  let angle = '45deg';
  if (parts.length && /^-?\d+deg$/.test(parts[parts.length - 1])) angle = parts.pop();
  if (!parts.length) return null;
  const colors = parts.map((p) => resolveColor(p, pal, accent));
  if (colors.some((c) => !c)) return null;
  return colors.length === 1 ? colors[0] : `linear-gradient(${angle}, ${colors.join(', ')})`;
}

function setRiceKey(text, key, value) {
  const re = new RegExp(`^(\\s*${key}\\s*=\\s*)([^#\\n]*?)(\\s+#\\s.*)?$`, 'm');
  if (re.test(text)) return text.replace(re, (_, a, _b, c) => a + value + (c || ''));
  return text.replace(/\n*$/, '\n') + `${key} = ${value}\n`;
}

function riceCss(cfg) {
  const pal = PALETTES[cfg.colors] || PALETTES.tokyonight;
  const accent = cfg.accent !== 'auto' && resolveColor(cfg.accent, pal, pal.accent) ? resolveColor(cfg.accent, pal, pal.accent) : pal.accent;
  const r = cfg.rounding;
  const font = `'${cfg.font}', 'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace`;
  const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  return `:root {
    --bg: ${pal.crust}; --panel: ${pal.base}; --panel-2: ${pal.mantle};
    --raised: ${pal.s0}; --raised-2: ${pal.s1}; --line: ${pal.line}; --line-strong: ${pal.s1};
    --fg: ${pal.fg}; --fg-2: ${pal.fg2}; --fg-3: ${pal.fg3};
    --accent: ${accent}; --accent-2: ${pal.accent2}; --accent-fg: ${pal.crust};
    --claude: ${pal.hot}; --you: ${pal.accent2};
    --ok: ${pal.ok}; --warn: ${pal.warn}; --hot: ${pal.hot}; --bad: ${pal.bad}; --info: ${pal.info};
    --add: ${pal.ok}; --del: ${pal.bad}; --add-bg: ${mix(pal.ok, 10)}; --del-bg: ${mix(pal.bad, 10)};
    --code-bg: ${pal.mantle}; --ring: ${mix(accent, 55)}; --shadow: none;
    --font: ${font}; --font-mono: ${font};
    --r-lg: ${r}px; --r-md: ${Math.max(0, r - 1)}px; --r-sm: ${Math.max(0, r - 2)}px; --r-xs: ${Math.min(r, 3)}px; --r-pill: ${r}px;
    --gi: ${cfg.gaps_in}px; --go: ${cfg.gaps_out}px; --bw: ${cfg.border_size}px;
    --ab: ${parseBorder(cfg.active_border, pal, accent) || accent};
    --ib: ${parseBorder(cfg.inactive_border, pal, accent) || pal.s0};
    --op: ${cfg.opacity_inactive}; --fs: ${cfg.font_size}px;
    color-scheme: dark;
  }
  ${cfg.wallpaper.startsWith('https://') ? `.desktop { background-image: url("${cfg.wallpaper}"); }` : ''}`;
}

// ------------------------------------------------------------------ layout maths

function tileRects(n, W, H, cfg, focusIndex) {
  const gap = cfg.gaps_in * 2;
  const full = { x: 0, y: 0, w: W, h: H };
  if (n === 0) return [];
  if (cfg.layout === 'monocle' || n === 1) return Array.from({ length: n }, () => ({ ...full }));
  if (cfg.layout === 'master') {
    const mw = Math.round((W - gap) * 0.56);
    const out = [{ x: 0, y: 0, w: mw, h: H }];
    const k = n - 1;
    const sh = (H - gap * (k - 1)) / k;
    for (let i = 0; i < k; i++) out.push({ x: mw + gap, y: i * (sh + gap), w: W - mw - gap, h: sh });
    return out;
  }
  // dwindle: each window takes half of what's left, splitting along the longer side.
  const out = [];
  let r = { ...full };
  for (let i = 0; i < n; i++) {
    if (i === n - 1) { out.push(r); break; }
    if (r.w >= r.h * 0.9) {
      const w = (r.w - gap) / 2;
      out.push({ x: r.x, y: r.y, w, h: r.h });
      r = { x: r.x + w + gap, y: r.y, w, h: r.h };
    } else {
      const h = (r.h - gap) / 2;
      out.push({ x: r.x, y: r.y, w: r.w, h });
      r = { x: r.x, y: r.y + h + gap, w: r.w, h };
    }
  }
  return out;
}

function blocks(pct, cells = 8) {
  const eighths = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const total = Math.max(0, Math.min(1, pct / 100)) * cells;
  const full = Math.floor(total);
  const part = eighths[Math.round((total - full) * 7)] || '';
  const used = '█'.repeat(full) + part;
  const rest = Math.max(0, cells - full - (part ? 1 : 0));
  return `<span class="blk-on">${used}</span><span class="blk-off">${'░'.repeat(rest)}</span>`;
}

// ------------------------------------------------------------------ controller

const Tiling = {
  cfg: parseRice(DEFAULT_RICE).cfg,
  ws: null,
  fullscreen: false,
  infoOpen: false,
  order: [],

  enter() {
    const d = $('#desktop');
    d.hidden = false;
    d.innerHTML = `<div class="bar" id="bar"></div><div class="tiles" id="tiles"></div><div class="floats" id="floats"></div><div class="notes" id="notes"></div>`;
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe($('#tiles'));
    this.clockTimer = setInterval(() => this.renderBar(), 15000);
    this.go();
  },

  leave() {
    this.ro?.disconnect();
    clearInterval(this.clockTimer);
    for (const p of [...panes.values()]) p.destroy();
    const d = $('#desktop');
    d.hidden = true;
    d.innerHTML = '';
    this.infoOpen = false;
  },

  applyConfig(text) {
    const { cfg, errors } = parseRice(text);
    this.cfg = cfg;
    let el = $('#rice-style');
    if (!el) { el = document.createElement('style'); el.id = 'rice-style'; document.head.appendChild(el); }
    el.textContent = riceCss(cfg);
    const d = $('#desktop');
    d.dataset.bar = cfg.bar_position;
    d.dataset.barStyle = cfg.bar_style;
    d.dataset.wall = cfg.wallpaper.startsWith('https://') ? 'image' : cfg.wallpaper;
    d.dataset.anim = cfg.animations;
    if (!d.hidden) { this.layout(); this.renderBar(); }
    return errors;
  },
  clearStyle() { $('#rice-style')?.remove(); },

  // ---- which windows are where

  openSessions() {
    return [...st.sessions.values()].filter((s) => s.open !== false).sort((a, b) => a.createdAt - b.createdAt);
  },
  workspaces() {
    const seen = new Map();
    for (const s of this.openSessions()) if (!seen.has(s.cwd)) seen.set(s.cwd, { cwd: s.cwd, name: baseName(s.cwd), sessions: [] });
    for (const s of this.openSessions()) seen.get(s.cwd).sessions.push(s);
    return [...seen.values()];
  },
  windows() {
    return this.openSessions().filter((s) => s.cwd === this.ws);
  },

  go() {
    const h = location.hash.replace(/^#\/?/, '');
    if (h.startsWith('s/')) {
      const id = h.slice(2);
      const s = st.sessions.get(id);
      if (s) {
        if (s.open === false) api('PATCH', '/sessions/' + id, { open: true }).catch(() => {});
        s.open = true;
        this.ws = s.cwd;
        st.focusId = id;
      }
    } else if (h === 'settings') {
      this.openConfig();
    }
    this.sync();
  },

  // Make the DOM match: one pane per window in the current workspace.
  sync() {
    const wss = this.workspaces();
    if (!wss.some((w) => w.cwd === this.ws)) this.ws = wss[0]?.cwd || null;
    const wins = this.windows();
    if (!wins.some((s) => s.id === st.focusId)) st.focusId = wins[0]?.id || null;
    const tiles = $('#tiles');
    if (!tiles) return;
    const wanted = new Set(wins.map((s) => s.id));
    for (const p of [...panes.values()]) {
      const s = st.sessions.get(p.id);
      if (!s || s.open === false) p.destroy();
      else if (!wanted.has(p.id)) p.el.remove();
    }
    $('.splash', tiles)?.remove();
    for (const s of wins) {
      let p = panes.get(s.id);
      if (!p) { p = new Pane(s.id); panes.set(s.id, p); p.load().then(() => { if (p.id === st.focusId) this.renderInfo(); this.renderBar(); }); }
      if (p.el.parentElement !== tiles) tiles.appendChild(p.el);
    }
    if (!wins.length) tiles.insertAdjacentHTML('beforeend', this.splash());
    this.layout();
    this.renderBar();
    this.renderInfo();
    if (st.focusId) history.replaceState(null, '', '#/s/' + st.focusId);
  },

  layout() {
    const tiles = $('#tiles');
    if (!tiles) return;
    const wins = this.windows();
    const small = window.innerWidth < 780;
    const cfg = { ...this.cfg, layout: small ? 'monocle' : this.cfg.layout };
    const pad = cfg.gaps_out;
    const W = tiles.clientWidth - pad * 2, H = tiles.clientHeight - pad * 2;
    const rects = tileRects(wins.length, W, H, cfg);
    const mono = cfg.layout === 'monocle' || this.fullscreen;
    this.rects = new Map();
    wins.forEach((s, i) => {
      const p = panes.get(s.id);
      if (!p) return;
      const focused = s.id === st.focusId;
      let r = rects[i];
      if (this.fullscreen && focused) r = { x: 0, y: 0, w: W, h: H };
      this.rects.set(s.id, r);
      Object.assign(p.el.style, { left: pad + r.x + 'px', top: pad + r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      p.el.classList.toggle('focused', focused);
      p.el.classList.toggle('hidden-win', mono && !focused);
    });
  },

  setFocus(id, { input = true } = {}) {
    if (!id) return;
    const s = st.sessions.get(id);
    if (s && s.cwd !== this.ws) { this.ws = s.cwd; st.focusId = id; this.sync(); }
    else { st.focusId = id; this.layout(); this.renderBar(); this.renderInfo(); history.replaceState(null, '', '#/s/' + id); }
    if (input) panes.get(id)?.focusInput();
  },

  onPaneFocus(p) { if (st.focusId !== p.id) this.setFocus(p.id, { input: false }); },
  onPaneStats(p) { if (p.id === st.focusId) this.renderBar(); },

  moveFocus(dir) {
    const cur = this.rects?.get(st.focusId);
    if (!cur) return;
    const c = { x: cur.x + cur.w / 2, y: cur.y + cur.h / 2 };
    let best = null, bestD = Infinity;
    for (const [id, r] of this.rects) {
      if (id === st.focusId) continue;
      const o = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const dx = o.x - c.x, dy = o.y - c.y;
      const ok = { left: dx < -1, right: dx > 1, up: dy < -1, down: dy > 1 }[dir];
      if (!ok) continue;
      const d = dir === 'left' || dir === 'right' ? Math.abs(dx) + Math.abs(dy) * 2 : Math.abs(dy) + Math.abs(dx) * 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best) this.setFocus(best);
  },

  // ---- events from the app

  onSession(s) {
    const onScreen = !!panes.get(s.id)?.el.isConnected;
    const shouldShow = s.open !== false && (s.cwd === this.ws || !this.ws);
    if (onScreen !== shouldShow) this.sync(); else this.renderBar();
  },
  onRemoved() { this.sync(); },
  onUsage() { this.renderBar(); },
  onProjects() { if ($('.launcher')) this.renderLauncherList(); },
  onTick() { this.renderBar(); },

  putAway: async (id) => {
    const wins = Tiling.windows();
    const idx = wins.findIndex((s) => s.id === id);
    const next = wins[idx + 1] || wins[idx - 1];
    const s = st.sessions.get(id);
    if (s) s.open = false;
    if (st.focusId === id) st.focusId = next ? next.id : null;
    Tiling.sync();
    if (st.focusId) panes.get(st.focusId)?.focusInput();
    await api('PATCH', '/sessions/' + id, { open: false }).catch((err) => toast(err.message));
  },

  keys(e) {
    if (e.key === 'Escape') {
      if ($('.launcher')) { this.closeFloat('.launcher'); return true; }
      if ($('.cfgwin')) { this.closeFloat('.cfgwin'); return true; }
      return false;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return false;
    const code = e.code;
    const run = (fn) => { e.preventDefault(); fn(); return true; };
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'KeyD' || code === 'KeyN') return run(() => this.openLauncher());
    if (code === 'KeyQ') return run(() => st.focusId && this.putAway(st.focusId));
    if (code === 'KeyF') return run(() => { this.fullscreen = !this.fullscreen; this.layout(); this.renderBar(); });
    if (code === 'KeyC') return run(() => ($('.cfgwin') ? this.closeFloat('.cfgwin') : this.openConfig()));
    if (code === 'KeyI') return run(() => this.toggleInfo());
    const dirs = { KeyH: 'left', ArrowLeft: 'left', KeyL: 'right', ArrowRight: 'right', KeyK: 'up', ArrowUp: 'up', KeyJ: 'down', ArrowDown: 'down' };
    if (dirs[code]) return run(() => this.moveFocus(dirs[code]));
    const m = code.match(/^Digit([1-9])$/);
    if (m) return run(() => this.switchWs(+m[1] - 1));
    return false;
  },

  switchWs(i) {
    const w = this.workspaces()[i];
    if (!w) return;
    this.ws = w.cwd;
    st.focusId = null;
    this.fullscreen = false;
    this.sync();
    if (st.focusId) panes.get(st.focusId)?.focusInput();
  },

  // ---- bar

  renderBar() {
    const bar = $('#bar');
    if (!bar) return;
    const wss = this.workspaces();
    const focus = st.focusId && st.sessions.get(st.focusId);
    const fp = focusedPane();
    const u = st.usage;
    const mod = (cls, inner, attrs = '') => `<span class="mod ${cls}" ${attrs}>${inner}</span>`;
    const meter = (label, w, title) => {
      if (!w || w.utilization == null) return '';
      const pct = Math.round(w.utilization * 100);
      return mod('meter-mod', `<b>${label}</b> ${blocks(pct)} <span class="pct">${pct}%</span>`, `style="--c:${levelColor(pct)}" title="${esc(title + (w.resetsAt ? ', ' + resetAt(w.resetsAt) : ''))}"`);
    };
    const wsHtml = wss.map((w, i) => {
      const urgent = w.sessions.some((s) => s.status === 'needs_you');
      const busy = w.sessions.some((s) => s.status === 'working');
      return `<button class="ws ${w.cwd === this.ws ? 'active' : ''} ${urgent ? 'urgent' : ''} ${busy ? 'busy' : ''}" data-ws="${i}" title="${esc(w.cwd)}"><b>${i + 1}</b><span>${esc(w.name)}</span>${w.sessions.length > 1 ? `<small>${w.sessions.length}</small>` : ''}</button>`;
    }).join('');
    const pct = fp ? fp.ctxPct() : null;
    const now = new Date();
    const warn = usageWarning(u);
    bar.innerHTML = `
      <div class="group left">
        <button class="mod logo" data-launch title="Open something (Alt Enter)">${LOGO}<span>desk</span>${st.demo ? '<small>demo</small>' : ''}</button>
        ${wsHtml ? `<span class="wss">${wsHtml}</span>` : ''}
      </div>
      <div class="group center">
        ${focus ? `<span class="mod title-mod"><span class="dot ${focus.status}"></span><span class="t">${esc(focus.title)}</span>${this.fullscreen ? '<small>[F]</small>' : ''}</span>` : `<span class="mod title-mod dim">no windows</span>`}
      </div>
      <div class="group right">
        ${u ? meter('5h', u.five_hour, '5-hour limit') + meter('wk', u.seven_day, 'Weekly limit') : mod('dim', 'usage after first message')}
        ${warn ? mod('warn-mod', '!', `title="${esc(warn)}"`) : ''}
        ${pct != null ? mod('ctx-mod', `<b>ctx</b> ${pct}%`, `data-info style="--c:${levelColor(pct)}" title="Context used (Alt I for details)"`) : ''}
        ${fp && fp.m.cost ? mod('cost-mod', fmtCost(fp.m.cost), 'title="This session, API equivalent"') : ''}
        <button class="mod icon-mod" data-launch title="New session (Alt Enter)">${ICON.plus}</button>
        <button class="mod icon-mod" data-config title="desk.conf (Alt C)">${ICON.gear}</button>
        ${mod('clock', `${now.toLocaleDateString([], { weekday: 'short' }).toLowerCase()} <b>${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</b>`)}
      </div>`;
    bar.onclick = (e) => {
      const t = e.target.closest('[data-ws],[data-launch],[data-config],[data-info]');
      if (!t) return;
      if (t.dataset.ws) this.switchWs(+t.dataset.ws);
      else if (t.dataset.launch !== undefined) this.openLauncher();
      else if (t.dataset.config !== undefined) ($('.cfgwin') ? this.closeFloat('.cfgwin') : this.openConfig());
      else if (t.dataset.info !== undefined) this.toggleInfo();
    };
  },

  // ---- neofetch splash for an empty desktop

  splash() {
    const sys = st.system || {};
    const all = [...st.sessions.values()];
    const working = all.filter((s) => s.status === 'working').length;
    const needs = all.filter((s) => s.status === 'needs_you').length;
    const u = st.usage;
    const pct = (w) => (w && w.utilization != null ? Math.round(w.utilization * 100) + '%' : '–');
    const art = [
      '        \\    |    /',
      '     .   \\   |   /   .',
      "       '. \\  |  / .'",
      '  ---------( * )---------',
      "       .' /  |  \\ '.",
      "     '   /   |   \\   '",
      '        /    |    \\',
    ].map((l) => esc(l).replace('( * )', '<em>( * )</em>')).join('\n');
    const row = (k, v) => `<div><i>${esc(k)}</i> ${v}</div>`;
    const swatch = ['bad', 'ok', 'warn', 'info', 'accent', 'accent-2', 'hot', 'fg'].map((c) => `<span style="background:var(--${c})"></span>`).join('');
    return `<div class="splash">
      <div class="fetch">
        <pre class="ascii">${art}</pre>
        <div class="info">
          <div class="who"><b>${esc(sys.user || 'you')}</b>@<b>${esc(sys.host || 'desk')}</b></div>
          <div class="rule">${'-'.repeat(((sys.user || 'you') + (sys.host || 'desk')).length + 1)}</div>
          ${row('OS', esc(sys.os || '?'))}
          ${row('Kernel', esc(sys.kernel || '?'))}
          ${row('WM', `desk (${esc(this.cfg.layout)})`)}
          ${row('Theme', `riced · ${esc(this.cfg.colors)}`)}
          ${row('Font', `${esc(this.cfg.font)} ${this.cfg.font_size}`)}
          ${row('Node', esc(sys.node || '?'))}
          ${row('Sessions', `${all.length}${working ? `, ${working} working` : ''}${needs ? `, <span style="color:var(--hot)">${needs} need you</span>` : ''}`)}
          ${row('Usage', `5h ${pct(u?.five_hour)} · week ${pct(u?.seven_day)}`)}
          <div class="swatches">${swatch}</div>
        </div>
      </div>
      <div class="hint"><kbd>alt</kbd> + <kbd>enter</kbd> open a session &nbsp;·&nbsp; <kbd>alt</kbd> + <kbd>c</kbd> desk.conf &nbsp;·&nbsp; <kbd>alt</kbd> + <kbd>1-9</kbd> workspaces</div>
    </div>`;
  },

  // ---- floating windows

  closeFloat(sel) {
    $(sel)?.remove();
    if (sel === '.info-win') this.infoOpen = false;
    if (!$('.launcher') && !$('.cfgwin')) focusedPane()?.focusInput();
  },

  openLauncher() {
    closeMenu();
    if ($('.launcher')) { $('.launcher input').focus(); return; }
    $('#floats').insertAdjacentHTML('beforeend', `
      <div class="launcher fwin" role="dialog" aria-label="Launcher">
        <div class="l-input"><span>❯</span><input spellcheck="false" placeholder="switch, resume, new session in… or type a folder or a prompt"></div>
        <div class="l-list"></div>
        <div class="l-foot"><span>↑↓ move</span><span>⏎ open</span><span>esc close</span></div>
      </div>`);
    const input = $('.launcher input');
    this.lSel = 0;
    input.oninput = () => { this.lSel = 0; this.renderLauncherList(); };
    input.onkeydown = (e) => {
      const n = this.lItems.length;
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); this.lSel = (this.lSel + 1) % Math.max(1, n); this.renderLauncherList(true); }
      else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); this.lSel = (this.lSel - 1 + n) % Math.max(1, n); this.renderLauncherList(true); }
      else if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); this.lItems[this.lSel]?.act(); }
    };
    $('.launcher .l-list').onmousedown = (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { e.preventDefault(); this.lItems[+b.dataset.i]?.act(); }
    };
    this.renderLauncherList();
    input.focus();
  },

  launcherItems(q) {
    const items = [];
    const done = (fn) => async () => { this.closeFloat('.launcher'); try { await fn(); } catch (err) { toast(err.message); } };
    const looksLikePath = /^(~|\/|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(q);
    if (looksLikePath) items.push({ glyph: '+', label: `new session in ${q}`, sub: 'folder', act: done(() => this.newIn(q)) });
    for (const s of this.openSessions()) items.push({ glyph: '◆', label: s.title, sub: `switch · ${baseName(s.cwd)} · ${STATUS_TEXT[s.status] || s.status}`, cls: s.status, act: done(() => this.setFocus(s.id)) });
    for (const p of st.projects) items.push({ glyph: '+', label: `new session in ${p.name}`, sub: p.where, act: done(() => this.newIn(p.where)) });
    for (const h of st.history) items.push({ glyph: '↺', label: h.title, sub: `resume · ${h.where}`, act: done(() => importSession(h.sessionId)) });
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let out = looksLikePath ? items : items.filter((it) => words.every((w) => (it.label + ' ' + it.sub).toLowerCase().includes(w)));
    if (q.trim() && !looksLikePath) {
      const ws = this.ws ? baseName(this.ws) : 'your default folder';
      out.push({ glyph: '❯', label: `new session: “${q.trim()}”`, sub: `in ${ws}`, act: done(() => this.newIn(this.ws || undefined, q.trim())) });
    }
    if (!q.trim() && !this.openSessions().length && !st.projects.length) out.push({ glyph: '+', label: 'new session in your home folder', sub: st.home, act: done(() => this.newIn(undefined)) });
    return out.slice(0, 60);
  },

  renderLauncherList(keepScroll) {
    const list = $('.launcher .l-list');
    if (!list) return;
    this.lItems = this.launcherItems($('.launcher input').value);
    if (this.lSel >= this.lItems.length) this.lSel = 0;
    list.innerHTML = this.lItems.length
      ? this.lItems.map((it, i) => `<button data-i="${i}" class="${i === this.lSel ? 'sel' : ''}"><span class="g ${it.cls || ''}">${esc(it.glyph)}</span><span class="lbl">${esc(it.label)}</span><small>${esc(it.sub)}</small></button>`).join('')
      : `<div class="l-empty">nothing matches</div>`;
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  },

  async newIn(cwd, prompt) {
    const s = await createSession(cwd, prompt);
    this.ws = s.cwd;
    st.focusId = s.id;
    this.fullscreen = false;
    this.sync();
    requestAnimationFrame(() => panes.get(s.id)?.focusInput());
  },

  openConfig() {
    if ($('.cfgwin')) { $('.cfgwin textarea').focus(); return; }
    const text = st.settings.rice || DEFAULT_RICE;
    $('#floats').insertAdjacentHTML('beforeend', `
      <div class="cfgwin fwin" role="dialog" aria-label="desk.conf">
        <div class="fwin-bar"><span class="fwin-title">desk.conf</span><span class="dim">applies as you type · Ctrl S saves now</span>
          <button class="link-btn" data-reset>defaults</button><button class="icon-btn" data-close title="Close (Esc)">${ICON.x}</button></div>
        <div class="cfg-edit"><div class="gutter"></div><textarea spellcheck="false" wrap="off"></textarea></div>
        <div class="fwin-status"></div>
      </div>`);
    const win = $('.cfgwin');
    const ta = $('textarea', win);
    const gutter = $('.gutter', win);
    const status = $('.fwin-status', win);
    ta.value = text;
    const lines = () => { gutter.textContent = ta.value.split('\n').map((_, i) => i + 1).join('\n'); gutter.scrollTop = ta.scrollTop; };
    let saveT = null;
    const save = async () => {
      clearTimeout(saveT);
      const value = ta.value;
      const { cfg } = parseRice(value);
      const patch = { rice: value };
      if (cfg.theme === 'mocha') patch.theme = 'mocha';
      await saveSettings(patch, { apply: cfg.theme === 'mocha' });
      const d = $('.cfgwin .fwin-status .dim');
      if (d) d.textContent = 'saved';
    };
    const apply = () => {
      const errors = this.applyConfig(ta.value);
      status.innerHTML = errors.length
        ? `<span class="err">✗ ${esc(errors[0])}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}</span><span class="dim"></span>`
        : `<span class="ok">✓ applied</span><span class="dim">…</span>`;
      clearTimeout(saveT);
      saveT = setTimeout(save, 700);
      lines();
    };
    ta.oninput = apply;
    ta.onscroll = () => { gutter.scrollTop = ta.scrollTop; };
    ta.onkeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    };
    win.onclick = (e) => {
      if (e.target.closest('[data-close]')) this.closeFloat('.cfgwin');
      else if (e.target.closest('[data-reset]')) { ta.value = DEFAULT_RICE; apply(); }
    };
    lines();
    status.innerHTML = `<span class="ok">✓ loaded</span><span class="dim">edit a value to see it change</span>`;
    ta.focus();
  },

  toggleInfo() {
    if (this.infoOpen) { this.closeFloat('.info-win'); return; }
    this.infoOpen = true;
    this.renderInfo();
  },
  renderInfo() {
    if (!this.infoOpen) return;
    let win = $('.info-win');
    if (!win) {
      $('#floats').insertAdjacentHTML('beforeend', `<div class="info-win fwin"><div class="fwin-bar"><span class="fwin-title">info</span><span class="dim t"></span><button class="icon-btn" data-close title="Close (Alt I)">${ICON.x}</button></div><div class="info-body"></div></div>`);
      win = $('.info-win');
      win.onclick = (e) => { if (e.target.closest('[data-close]')) this.closeFloat('.info-win'); };
    }
    const p = focusedPane();
    $('.t', win).textContent = p && p.s ? p.s.title : '';
    $('.info-body', win).innerHTML = p && p.s ? trayCards(p) : `<div class="card-empty" style="padding:12px">Focus a window to see its to-dos, files and stats.</div>`;
  },
  renderTray() { this.renderInfo(); },

  // ---- dunst-style notifications

  note(s, text) {
    const box = $('#notes');
    if (!box) return;
    const el = document.createElement('button');
    el.className = `note ${s.status}`;
    el.innerHTML = `<b>${esc(s.title)}</b><span>${esc(text)}</span>`;
    el.onclick = () => { el.remove(); this.setFocus(s.id); };
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 6000);
    setTimeout(() => el.remove(), 6400);
  },
};
