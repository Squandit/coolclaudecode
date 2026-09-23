'use strict';
// The riced layout: a tiling desktop where every open session is a window.
// Configured through desk.conf, a plain text file you edit in its own window.


const DEFAULT_RICE = `# desk.conf
# Changes apply as you type and save on their own.
# Comments start with "# " (a hash, then a space). Colours are hex,
# or a palette name: accent accent2 ok warn hot bad info fg fg2 fg3 s0 s1

theme = riced             # riced, or a classic theme: mocha latte tokyonight gruvbox nord rosepine everforest
colors = tokyonight       # tokyonight catppuccin latte gruvbox nord rosepine everforest
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
  theme: { def: 'riced', oneOf: THEMES.map((t) => t.id) },
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
  return `:root {
    ${paletteVars(pal, { accent, radius: [r, Math.max(0, r - 1), Math.max(0, r - 2), Math.min(r, 3), r], font })}
    --shadow: none;
    --gi: ${cfg.gaps_in}px; --go: ${cfg.gaps_out}px; --bw: ${cfg.border_size}px;
    --ab: ${parseBorder(cfg.active_border, pal, accent) || accent};
    --ib: ${parseBorder(cfg.inactive_border, pal, accent) || pal.s0};
    --op: ${cfg.opacity_inactive}; --fs: ${cfg.font_size}px;
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
    this.termWins = new Map();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe($('#tiles'));
    this.clockTimer = setInterval(() => this.renderBar(), 15000);
    this.go();
  },

  leave() {
    this.ro?.disconnect();
    clearInterval(this.clockTimer);
    for (const p of [...panes.values()]) p.destroy();
    for (const v of Terms.views.values()) v.el.remove();
    const d = $('#desktop');
    d.hidden = true;
    d.innerHTML = '';
    this.infoOpen = false;
  },

  applyConfig(text) {
    const { cfg, errors } = parseRice(text);
    this.cfg = cfg;
    setThemeVars(riceCss(cfg));
    const d = $('#desktop');
    d.dataset.bar = cfg.bar_position;
    d.dataset.barStyle = cfg.bar_style;
    d.dataset.wall = cfg.wallpaper.startsWith('https://') ? 'image' : cfg.wallpaper;
    d.dataset.anim = cfg.animations;
    if (!d.hidden) { this.layout(); this.renderBar(); }
    Terms.retheme();
    return errors;
  },

  // ---- which windows are where. A window is a session or a terminal.

  openSessions() {
    return [...st.sessions.values()].filter((s) => s.open !== false).sort((a, b) => a.createdAt - b.createdAt);
  },
  items() {
    const out = this.openSessions().map((s) => ({ kind: 'session', id: s.id, cwd: s.cwd, createdAt: s.createdAt, s }));
    for (const v of Terms.list()) out.push({ kind: 'term', id: v.id, cwd: v.meta.cwd, createdAt: v.meta.createdAt, v });
    return out.sort((a, b) => a.createdAt - b.createdAt);
  },
  workspaces() {
    const seen = new Map();
    for (const it of this.items()) {
      if (!seen.has(it.cwd)) seen.set(it.cwd, { cwd: it.cwd, name: baseName(it.cwd), sessions: [], count: 0 });
      const w = seen.get(it.cwd);
      w.count++;
      if (it.kind === 'session') w.sessions.push(it.s);
    }
    return [...seen.values()];
  },
  windows() { return this.items().filter((it) => it.cwd === this.ws); },

  winEl(it) {
    if (it.kind === 'session') return panes.get(it.id)?.el;
    let el = this.termWins.get(it.id);
    if (!el) {
      el = document.createElement('section');
      el.className = 'pane term-win';
      el.innerHTML = `<div class="pane-in"><header class="head"><span class="win-dot term-dot">${ICON.term}</span><div class="head-left"><div class="head-title"><span class="title-text">${esc(it.v.title)}</span></div><div class="head-meta"><span class="mono where">${esc(it.cwd)}</span></div></div><div class="head-right"><button class="icon-btn win-close" data-killterm title="Close (${esc(Keys.label('close'))})">${ICON.x}</button></div></header><div class="term-slot"></div></div>`;
      el.addEventListener('mousedown', () => { if (st.focusId !== it.id) this.setFocus(it.id, { input: false }); });
      $('[data-killterm]', el).onclick = () => it.v.kill();
      this.termWins.set(it.id, el);
    }
    const slot = $('.term-slot', el);
    if (it.v.el.parentElement !== slot) slot.appendChild(it.v.el);
    it.v.el.hidden = false;
    return el;
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

  // Make the DOM match the windows in the current workspace.
  sync() {
    const wss = this.workspaces();
    if (!wss.some((w) => w.cwd === this.ws)) this.ws = wss[0]?.cwd || null;
    const wins = this.windows();
    if (!wins.some((w) => w.id === st.focusId)) st.focusId = wins[0]?.id || null;
    const tiles = $('#tiles');
    if (!tiles) return;
    const wanted = new Set(wins.map((w) => w.id));
    for (const p of [...panes.values()]) {
      const s = st.sessions.get(p.id);
      if (!s || s.open === false) p.destroy();
      else if (!wanted.has(p.id)) p.el.remove();
    }
    for (const [id, el] of this.termWins) {
      if (!Terms.views.has(id)) { el.remove(); this.termWins.delete(id); }
      else if (!wanted.has(id)) el.remove();
    }
    $('.splash', tiles)?.remove();
    for (const w of wins) {
      if (w.kind === 'session' && !panes.get(w.id)) {
        const p = new Pane(w.id);
        panes.set(w.id, p);
        p.load().then(() => { if (p.id === st.focusId) this.renderInfo(); this.renderBar(); });
      }
      const el = this.winEl(w);
      if (el && el.parentElement !== tiles) tiles.appendChild(el);
    }
    if (!wins.length) tiles.insertAdjacentHTML('beforeend', this.splash());
    this.layout();
    this.renderBar();
    this.renderInfo();
    if (st.focusId && st.sessions.has(st.focusId)) history.replaceState(null, '', '#/s/' + st.focusId);
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
    wins.forEach((w, i) => {
      const el = w.kind === 'session' ? panes.get(w.id)?.el : this.termWins.get(w.id);
      if (!el) return;
      const focused = w.id === st.focusId;
      let r = rects[i];
      if (this.fullscreen && focused) r = { x: 0, y: 0, w: W, h: H };
      this.rects.set(w.id, r);
      Object.assign(el.style, { left: pad + r.x + 'px', top: pad + r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      el.classList.toggle('focused', focused);
      el.classList.toggle('hidden-win', mono && !focused);
    });
    // Terminals refit once the slide animation settles.
    clearTimeout(this.refitT);
    this.refitT = setTimeout(() => { for (const w of wins) if (w.kind === 'term') w.v.refit(); }, 360);
  },

  focusWin(id) {
    const v = Terms.views.get(id);
    if (v) v.focus(); else panes.get(id)?.focusInput();
  },

  setFocus(id, { input = true } = {}) {
    if (!id) return;
    const it = this.items().find((x) => x.id === id);
    if (it && it.cwd !== this.ws) { this.ws = it.cwd; st.focusId = id; this.sync(); }
    else {
      st.focusId = id;
      this.layout(); this.renderBar(); this.renderInfo();
      if (st.sessions.has(id)) history.replaceState(null, '', '#/s/' + id);
    }
    if (input) this.focusWin(id);
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

  // ---- terminals

  async newTerm() {
    const focusTerm = st.focusId && Terms.views.get(st.focusId);
    const focus = (st.focusId && st.sessions.get(st.focusId)) || (focusTerm ? { title: focusTerm.title, status: 'term' } : null);
    const v = await Terms.create(focus ? { sessionId: focus.id } : { cwd: this.ws || undefined });
    if (v) this.showTerm(v);
  },
  showTerm(v) {
    this.ws = v.meta.cwd;
    st.focusId = v.id;
    this.fullscreen = false;
    this.sync();
    v.focus();
  },
  onTermsChanged() { this.sync(); },

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
    const idx = wins.findIndex((w) => w.id === id);
    const next = wins[idx + 1] || wins[idx - 1];
    if (Terms.views.has(id)) {
      st.focusId = next ? next.id : null;
      await Terms.views.get(id).kill();
      if (st.focusId) Tiling.focusWin(st.focusId);
      return;
    }
    const s = st.sessions.get(id);
    if (s) s.open = false;
    if (st.focusId === id) st.focusId = next ? next.id : null;
    Tiling.sync();
    if (st.focusId) Tiling.focusWin(st.focusId);
    await api('PATCH', '/sessions/' + id, { open: false }).catch((err) => toast(err.message));
  },

  keys(e, act) {
    if (e.key === 'Escape') {
      if ($('.launcher')) { this.closeFloat('.launcher'); return true; }
      if ($('.cfgwin')) { this.closeFloat('.cfgwin'); return true; }
      return false;
    }
    if (!act) return false;
    e.preventDefault();
    const dirs = ['left', 'down', 'up', 'right'];
    switch (act.id) {
      case 'launcher': this.openLauncher(); break;
      case 'terminal': this.newTerm(); break;
      case 'close': if (st.focusId) this.putAway(st.focusId); break;
      case 'fullscreen': this.fullscreen = !this.fullscreen; this.layout(); this.renderBar(); break;
      case 'config': if ($('.cfgwin')) this.closeFloat('.cfgwin'); else this.openConfig(); break;
      case 'info': this.toggleInfo(); break;
      case 'workspace': this.switchWs(act.n - 1); break;
      default: if (dirs.includes(act.id)) this.moveFocus(act.id); else return false;
    }
    return true;
  },

  onKeysChanged() { this.renderBar(); if ($('.splash')) this.sync(); },

  switchWs(i) {
    const w = this.workspaces()[i];
    if (!w) return;
    this.ws = w.cwd;
    st.focusId = null;
    this.fullscreen = false;
    this.sync();
    if (st.focusId) this.focusWin(st.focusId);
  },

  // ---- bar

  renderBar() {
    const bar = $('#bar');
    if (!bar) return;
    const wss = this.workspaces();
    const focusTerm = st.focusId && Terms.views.get(st.focusId);
    const focus = (st.focusId && st.sessions.get(st.focusId)) || (focusTerm ? { title: focusTerm.title, status: 'term' } : null);
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
      return `<button class="ws ${w.cwd === this.ws ? 'active' : ''} ${urgent ? 'urgent' : ''} ${busy ? 'busy' : ''}" data-ws="${i}" title="${esc(w.cwd)}"><b>${i + 1}</b><span>${esc(w.name)}</span>${w.count > 1 ? `<small>${w.count}</small>` : ''}</button>`;
    }).join('');
    const pct = fp ? fp.ctxPct() : null;
    const now = new Date();
    const warn = usageWarning(u);
    bar.innerHTML = `
      <div class="group left">
        <button class="mod logo" data-launch title="Open something (${esc(Keys.label('launcher'))})">${LOGO}<span>desk</span>${st.demo ? '<small>demo</small>' : ''}</button>
        ${wsHtml ? `<span class="wss">${wsHtml}</span>` : ''}
      </div>
      <div class="group center">
        ${focus ? `<span class="mod title-mod"><span class="dot ${focus.status}"></span><span class="t">${esc(focus.title)}</span>${this.fullscreen ? '<small>[F]</small>' : ''}</span>` : `<span class="mod title-mod dim">no windows</span>`}
      </div>
      <div class="group right">
        ${u ? meter('5h', u.five_hour, '5-hour limit') + meter('wk', u.seven_day, 'Weekly limit') : mod('dim', 'usage after first message')}
        ${warn ? mod('warn-mod', '!', `title="${esc(warn)}"`) : ''}
        ${pct != null ? mod('ctx-mod', `<b>ctx</b> ${pct}%`, `data-info style="--c:${levelColor(pct)}" title="Context used (${esc(Keys.label('info'))} for details)"`) : ''}
        ${fp && fp.m.cost ? mod('cost-mod', fmtCost(fp.m.cost), 'title="This session, API equivalent"') : ''}
        <button class="mod icon-mod" data-launch title="New session (${esc(Keys.label('launcher'))})">${ICON.plus}</button>
        <button class="mod icon-mod" data-newterm title="Terminal (${esc(Keys.label('terminal'))})">${ICON.term}</button>
        <button class="mod icon-mod" data-themes title="Themes (${esc(Keys.label('themes'))})">${ICON.palette}</button>
        <button class="mod icon-mod" data-config title="desk.conf (${esc(Keys.label('config'))})">${ICON.gear}</button>
        ${mod('clock', `${now.toLocaleDateString([], { weekday: 'short' }).toLowerCase()} <b>${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</b>`)}
      </div>`;
    bar.onclick = (e) => {
      const t = e.target.closest('[data-ws],[data-launch],[data-config],[data-info],[data-newterm],[data-themes]');
      if (!t) return;
      if (t.dataset.ws) this.switchWs(+t.dataset.ws);
      else if (t.dataset.launch !== undefined) this.openLauncher();
      else if (t.dataset.config !== undefined) ($('.cfgwin') ? this.closeFloat('.cfgwin') : this.openConfig());
      else if (t.dataset.info !== undefined) this.toggleInfo();
      else if (t.dataset.newterm !== undefined) this.newTerm();
      else if (t.dataset.themes !== undefined) openThemePicker();
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
      <div class="hint"><kbd>${esc(Keys.label('launcher'))}</kbd> open a session &nbsp;·&nbsp; <kbd>${esc(Keys.label('config'))}</kbd> desk.conf &nbsp;·&nbsp; <kbd>${esc(Keys.label('themes'))}</kbd> themes &nbsp;·&nbsp; <kbd>${esc(Keys.mod().label)} 1-9</kbd> workspaces &nbsp;·&nbsp; <a href="#" data-shortcuts-link>change shortcuts</a></div>
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
    const here = this.ws || null;
    items.push({ glyph: '>_', label: `terminal in ${here ? baseName(here) : 'home'}`, sub: Keys.label('terminal'), act: done(() => this.newTerm()) });
    for (const v of Terms.list()) items.push({ glyph: '>_', label: v.title, sub: `switch · terminal · ${baseName(v.meta.cwd)}`, act: done(() => this.setFocus(v.id)) });
    for (const s of this.openSessions()) items.push({ glyph: '◆', label: s.title, sub: `switch · ${baseName(s.cwd)} · ${STATUS_TEXT[s.status] || s.status}`, cls: s.status, act: done(() => this.setFocus(s.id)) });
    for (const p of st.projects) items.push({ glyph: '+', label: `new session in ${p.name}`, sub: p.where, act: done(() => this.newIn(p.where)) });
    for (const h of st.history) items.push({ glyph: '↺', label: h.title, sub: `resume · ${h.where}`, act: done(() => importSession(h.sessionId)) });
    items.push({ glyph: '◐', label: 'themes', sub: Keys.label('themes'), act: done(() => openThemePicker()) });
    items.push({ glyph: '✎', label: 'desk.conf', sub: Keys.label('config'), act: done(() => this.openConfig()) });
    items.push({ glyph: '⚑', label: 'edit the crew', sub: 'helper levels and stats', act: done(() => openCrew()) });
    items.push({ glyph: '⌨', label: 'keyboard shortcuts', sub: `modifier: ${Keys.mod().label}`, act: done(() => openShortcuts()) });
    items.push({ glyph: '★', label: "what's new", sub: 'changelog', act: done(() => openChangelog()) });
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let out = looksLikePath ? items : items.filter((it) => words.every((w) => (it.label + ' ' + it.sub).toLowerCase().includes(w)));
    if (q.trim() && !looksLikePath) {
      const ws = this.ws ? baseName(this.ws) : 'your default folder';
      out.push({ glyph: '❯', label: `new session: “${q.trim()}”`, sub: `in ${ws}`, act: done(() => this.newIn(this.ws || undefined, q.trim())) });
      out.push({ glyph: '⚑', label: `crew session: “${q.trim()}”`, sub: `planner + helpers, in ${ws}`, act: done(() => this.newIn(this.ws || undefined, q.trim(), true)) });
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

  async newIn(cwd, prompt, crew) {
    const s = await createSession(cwd, prompt, crew);
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
      if (cfg.theme !== 'riced') patch.theme = cfg.theme;
      await saveSettings(patch, { apply: cfg.theme !== 'riced' });
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
      $('#floats').insertAdjacentHTML('beforeend', `<div class="info-win fwin"><div class="fwin-bar"><span class="fwin-title">info</span><span class="dim t"></span><button class="icon-btn" data-close title="Close (${esc(Keys.label('info'))})">${ICON.x}</button></div><div class="info-body"></div></div>`);
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
