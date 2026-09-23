'use strict';
// Terminals: xterm.js on the page, a real shell on the server (see lib/terminals.js).
// The classic layout shows them in a dock at the bottom; the riced layout tiles them.

const Terms = {
  info: { available: true },
  views: new Map(),
  lib: null,

  async init() {
    try {
      const d = await api('GET', '/terms');
      this.info = d;
      for (const t of d.terms) this.adopt(t, false);
    } catch {}
  },

  loadLib() {
    if (this.lib) return this.lib;
    const add = (tag, attrs) => new Promise((resolve, reject) => {
      const el = document.createElement(tag);
      Object.assign(el, attrs);
      el.onload = resolve;
      el.onerror = () => reject(new Error('Could not load the terminal. Run "npm install" in the desk folder and restart.'));
      document.head.appendChild(el);
    });
    this.lib = Promise.all([
      add('link', { rel: 'stylesheet', href: 'vendor/xterm.css' }),
      add('script', { src: 'vendor/xterm.js' }).then(() => add('script', { src: 'vendor/addon-fit.js' })),
    ]).catch((err) => { this.lib = null; throw err; });
    return this.lib;
  },

  list() { return [...this.views.values()].sort((a, b) => a.meta.createdAt - b.meta.createdAt); },

  async create({ cwd, sessionId, open } = {}) {
    if (!this.info.available) { toast(this.info.error ? `Terminal is off: node-pty is ${this.info.error}. Run npm install.` : 'Terminal unavailable'); return null; }
    try {
      const t = await api('POST', '/terms', { cwd, sessionId, open, cols: 100, rows: 30 });
      return this.adopt(t, true);
    } catch (err) { toast(err.message); return null; }
  },

  adopt(t, fresh) {
    let v = this.views.get(t.id);
    if (!v) { v = new TermView(t, fresh); this.views.set(t.id, v); }
    return v;
  },

  onData(id, data, end) { this.views.get(id)?.write(data, end); },
  onExit(id) {
    const v = this.views.get(id);
    if (!v) return;
    v.dispose();
    this.views.delete(id);
    L && L.onTermsChanged && L.onTermsChanged();
  },
  onList(list) {
    let added = false;
    for (const t of list) if (!this.views.has(t.id)) { this.adopt(t, false); added = true; }
    if (added && L && L.onTermsChanged) L.onTermsChanged();
  },

  // Open a file in your editor in a new terminal, in the session's folder.
  async openFile(sessionId, file) {
    const v = await this.create({ sessionId, open: file });
    if (v && L.showTerm) L.showTerm(v);
    return v;
  },

  retheme() { for (const v of this.views.values()) v.applyTheme(); },
};

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function termTheme() {
  const v = cssVar;
  return {
    background: v('--panel-2'), foreground: v('--fg'), cursor: v('--accent'), cursorAccent: v('--panel-2'),
    selectionBackground: v('--raised-2'),
    black: v('--raised'), red: v('--bad'), green: v('--ok'), yellow: v('--warn'), blue: v('--ansi-blue'), magenta: v('--ansi-magenta'), cyan: v('--ansi-cyan'), white: v('--fg-2'),
    brightBlack: v('--fg-3'), brightRed: v('--bad'), brightGreen: v('--ok'), brightYellow: v('--warn'), brightBlue: v('--ansi-blue'), brightMagenta: v('--ansi-magenta'), brightCyan: v('--ansi-cyan'), brightWhite: v('--fg'),
  };
}

class TermView {
  constructor(meta, fresh) {
    this.id = meta.id;
    this.meta = meta;
    this.fresh = fresh;
    this.pending = [];
    this.queue = '';
    this.el = document.createElement('div');
    this.el.className = 'term-host';
    this.start().catch((err) => { this.el.innerHTML = `<div class="term-err">${esc(err.message)}</div>`; });
  }

  get title() { return this.meta.title || baseName(this.meta.cwd); }

  async start() {
    await Terms.loadLib();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const fontFamily = cssVar('--font-mono') || 'monospace';
    const tiling = document.body.classList.contains('layout-tiling');
    this.term = new Terminal({
      fontFamily,
      fontSize: tiling ? parseInt(cssVar('--fs'), 10) || 13 : 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: termTheme(),
    });
    this.fit = new FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.el);
    // Let the app's own shortcuts through instead of sending them to the shell.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const act = Keys.action(e);
      if (!act) return true;
      if (document.body.classList.contains('layout-tiling')) return false;
      return !['themes', 'terminal', 'launcher', 'info'].includes(act.id);
    });
    // Draw the scrollback so far, then anything that arrived while we fetched it, without repeats.
    const d = await api('GET', `/terms/${this.id}/buffer`).catch(() => null);
    this.bufEnd = d ? d.end : 0;
    if (d && d.data) this.term.write(d.data);
    const pending = this.pending;
    this.pending = [];
    for (const c of pending) this.write(c.data, c.end);
    this.term.onData((d) => this.send(d));
    this.ro = new ResizeObserver(() => this.refit());
    this.ro.observe(this.el);
    this.refit();
    if (this.wantFocus) this.term.focus();
  }

  write(data, end) {
    if (!this.term || this.bufEnd == null) { this.pending.push({ data, end }); return; }
    if (end != null) {
      if (end <= this.bufEnd) return;
      const start = end - data.length;
      if (start < this.bufEnd) data = data.slice(this.bufEnd - start);
    }
    this.term.write(data);
  }

  send(data) {
    this.queue += data;
    if (this.sending) return;
    this.sending = true;
    const flush = async () => {
      while (this.queue) {
        const chunk = this.queue;
        this.queue = '';
        await api('POST', `/terms/${this.id}/input`, { data: chunk }).catch(() => {});
      }
      this.sending = false;
    };
    flush();
  }

  refit() {
    if (!this.term || !this.el.isConnected || !this.el.offsetWidth || !this.el.offsetHeight) return;
    try { this.fit.fit(); } catch { return; }
    const { cols, rows } = this.term;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols; this.rows = rows;
    clearTimeout(this.rt);
    this.rt = setTimeout(() => api('POST', `/terms/${this.id}/resize`, { cols, rows }).catch(() => {}), 80);
  }

  focus() {
    if (this.term) { this.term.focus(); requestAnimationFrame(() => this.refit()); }
    else this.wantFocus = true;
  }

  applyTheme() {
    if (!this.term) return;
    this.term.options.theme = termTheme();
    this.term.options.fontFamily = cssVar('--font-mono') || 'monospace';
    if (document.body.classList.contains('layout-tiling')) this.term.options.fontSize = parseInt(cssVar('--fs'), 10) || 13;
    this.cols = 0;
    this.refit();
  }

  kill() { return api('DELETE', '/terms/' + this.id).catch(() => {}); }

  dispose() {
    this.ro?.disconnect();
    try { this.term?.dispose(); } catch {}
    this.el.remove();
  }
}

// ------------------------------------------------------------------ git changes

const Changes = {
  data: new Map(),   // session id -> { isRepo, branch, files, at }
  timers: new Map(),

  refreshSoon(sessionId, delay = 700) {
    clearTimeout(this.timers.get(sessionId));
    this.timers.set(sessionId, setTimeout(() => this.refresh(sessionId), delay));
  },

  async refresh(sessionId) {
    if (!sessionId || !st.sessions.has(sessionId)) return;
    try {
      const d = await api('GET', `/sessions/${sessionId}/changes`);
      d.at = Date.now();
      this.data.set(sessionId, d);
      if (st.focusId === sessionId) renderTraySoon();
    } catch {}
  },

  card(p) {
    const d = this.data.get(p.id);
    if (!d) { this.refreshSoon(p.id, 50); return ''; }
    if (!d.isRepo) return '';
    const KIND = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', U: 'new, not tracked' };
    let add = 0, del = 0;
    for (const f of d.files) { add += f.add || 0; del += f.del || 0; }
    const rows = d.files.slice(0, 60).map((f) => {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/', f.path.length - 2) + 1) : '';
      const name = f.path.slice(dir.length);
      return `<li>
        <span class="gk k-${f.kind}" title="${KIND[f.kind] || f.kind}${f.staged ? ', staged' : ''}">${f.kind === 'U' ? '?' : f.kind}</span>
        <button class="fn" data-diff="${esc(f.path)}" data-sid="${p.id}" title="Show the diff"><small>${esc(dir)}</small>${esc(name)}</button>
        ${f.add != null ? `<span class="n-add">+${f.add}</span>` : ''}${f.del ? `<span class="n-del">−${f.del}</span>` : ''}
        ${f.kind !== 'D' && !f.path.endsWith('/') ? `<button class="row-act" data-openfile="${esc(f.path)}" data-sid="${p.id}" title="Open in a terminal">${ICON.term}</button>` : ''}
      </li>`;
    }).join('');
    const branch = d.branch ? `${ICON.branch}<span>${esc(d.branch)}</span>${d.ahead ? ` <span title="ahead of upstream">↑${d.ahead}</span>` : ''}${d.behind ? ` <span title="behind upstream">↓${d.behind}</span>` : ''}` : '';
    return `<section class="card changes-card">
      <div class="card-head"><h3>Changes</h3><span class="count">${d.files.length ? `${d.files.length} · <span class="n-add">+${add}</span> <span class="n-del">−${del}</span>` : 'clean'}<button class="row-act" data-refresh="${p.id}" title="Refresh">${ICON.refresh}</button></span></div>
      ${branch ? `<div class="git-branch">${branch}</div>` : ''}
      ${d.files.length ? `<ul class="files git-files">${rows}</ul>` : `<div class="card-empty">Nothing changed since the last commit.</div>`}
    </section>`;
  },

  async openDiff(sessionId, file) {
    const s = st.sessions.get(sessionId);
    if (!s) return;
    const win = openModal({
      title: file,
      sub: 'git diff',
      cls: 'diff-modal',
      actions: `<button class="btn" data-open>${ICON.term} Open in terminal</button><button class="btn" data-copy>Copy path</button>`,
      body: `<div class="card-empty" style="padding:16px">Loading…</div>`,
    });
    $('[data-open]', win).onclick = () => { closeModal(); Terms.openFile(sessionId, file); };
    $('[data-copy]', win).onclick = () => copy(file, 'Path copied');
    try {
      const d = await api('GET', `/sessions/${sessionId}/diff?path=${encodeURIComponent(file)}`);
      const body = $('.modal-body', win);
      if (!body) return;
      if (d.binary) { body.innerHTML = `<div class="card-empty" style="padding:16px">Binary file, nothing to show.</div>`; return; }
      const hunks = parseUnified(d.diff);
      if (!hunks.length) { body.innerHTML = `<div class="card-empty" style="padding:16px">No changes in this file.</div>`; return; }
      const n = patchCounts(hunks);
      $('.fwin-bar .dim', win).innerHTML = `${d.untracked ? 'new file' : 'git diff'} · <span class="n-add">+${n.add}</span> <span class="n-del">−${n.del}</span>`;
      body.innerHTML = `<div class="diff"><div class="diff-body">${diffRows(hunks).rows}</div></div>`;
    } catch (err) {
      const body = $('.modal-body', win);
      if (body) body.innerHTML = `<div class="err-card" style="margin:16px">${esc(err.message)}</div>`;
    }
  },
};

// Clicks on any file list, anywhere.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-diff],[data-openfile],[data-refresh]');
  if (!t) return;
  e.preventDefault();
  if (t.dataset.refresh) Changes.refresh(t.dataset.refresh);
  else if (t.dataset.openfile) Terms.openFile(t.dataset.sid, t.dataset.openfile);
  else if (t.dataset.diff) Changes.openDiff(t.dataset.sid, t.dataset.diff);
});

// ------------------------------------------------------------------ theme picker

function openThemePicker() {
  const start = st.settings.theme;
  let sel = Math.max(0, THEMES.findIndex((t) => t.id === start));
  const riceColors = (typeof parseRice === 'function' ? parseRice(st.settings.rice || DEFAULT_RICE).cfg.colors : 'tokyonight');
  const win = openModal({
    title: 'Themes',
    sub: '↑↓ to preview · ⏎ to keep · esc to go back',
    cls: 'theme-modal',
    body: `<div class="theme-list">${THEMES.map((t, i) => {
      const pal = PALETTES[t.palette || riceColors];
      return `<button data-i="${i}" class="${t.id === start ? 'current' : ''}">
        <span class="sw">${themeSwatch(pal).map((c) => `<i style="background:${c}"></i>`).join('')}</span>
        <span class="nm">${esc(t.name)}</span>
        <small>${esc(t.note || (pal.light ? 'light' : 'dark') + (t.layout === 'classic' ? ', classic layout' : ''))}</small>
      </button>`;
    }).join('')}</div>`,
    onClose: () => { if (!committed) applyTheme(); },
  });
  let committed = false;
  const buttons = $$('.theme-list button', win);
  const show = () => {
    buttons.forEach((b, i) => b.classList.toggle('sel', i === sel));
    buttons[sel].scrollIntoView({ block: 'nearest' });
    // Preview palettes live; switching layout waits until you pick it.
    const t = THEMES[sel];
    const curLayout = (byId(THEMES, st.settings.theme) || THEMES[0]).layout;
    if (t.layout === 'classic' && curLayout === 'classic') applyTheme(t.id);
  };
  const pick = async () => {
    committed = true;
    const id = THEMES[sel].id;
    closeModal();
    if (id !== start) await switchTheme(id);
  };
  win.addEventListener('mousemove', (e) => {
    const b = e.target.closest('[data-i]');
    if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; show(); }
  });
  win.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { sel = +b.dataset.i; pick(); } });
  win.tabIndex = -1;
  win.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); sel = (sel + 1) % THEMES.length; show(); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); sel = (sel - 1 + THEMES.length) % THEMES.length; show(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(); }
  });
  show();
  win.focus();
}

// ------------------------------------------------------------------ what's new

async function openChangelog() {
  const win = openModal({ title: "What's new", sub: '', cls: 'news-modal', body: `<div class="card-empty" style="padding:16px">Loading…</div>` });
  try {
    const d = await api('GET', '/changelog');
    $('.fwin-bar .dim', win).textContent = 'desk ' + d.version;
    $('.modal-body', win).innerHTML = `<div class="say news">${md(d.text.replace(/^# .*\n/, ''))}</div>`;
    store.set('seenVersion', d.version);
  } catch (err) { $('.modal-body', win).innerHTML = `<div class="err-card" style="margin:16px">${esc(err.message)}</div>`; }
}

// ------------------------------------------------------------------ crew editor

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-crew-go]');
  if (go) { go.disabled = true; panes.get(go.dataset.crewGo)?.sendText('go'); return; }
  if (e.target.closest('[data-crew-edit]')) openCrew();
});

async function openCrew() {
  const MODELS_ = ['haiku', 'sonnet', 'opus', 'fable'];
  const EFFORTS_ = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
  let info = { defaults: null, stats: { levels: [], total: 0 } };
  try { info = await api('GET', '/crew'); } catch {}
  let crew = JSON.parse(JSON.stringify(st.settings.crew || info.defaults));
  const sel = (list, v, attr) => `<select ${attr}>${list.map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}>${x || 'default'}</option>`).join('')}</select>`;
  const stats = new Map((info.stats.levels || []).map((l) => [l.level, l]));
  const draw = () => `<div class="crew-pane">
    <p class="crew-intro">In crew mode the planner splits your request into tasks and hands each one to the cheapest helper that can do it well. If a helper fails, the task moves up a level. Pick crew or solo per session from the header.</p>
    <table class="table crew-table">
      <thead><tr><th>Level</th><th>Model</th><th>Effort</th><th>What it gets</th><th class="num">Runs</th><th class="num">Escalated</th><th class="num">Avg tokens</th></tr></thead>
      <tbody>
        <tr class="planner-row"><td><b>Planner</b></td><td>${sel(MODELS_, crew.planner.model, 'data-p="model"')}</td><td>${sel(EFFORTS_, crew.planner.effort, 'data-p="effort"')}</td><td class="dim">Plans, hands out tasks, checks results</td><td></td><td></td><td></td></tr>
        ${crew.levels.map((l, i) => {
          const s = stats.get(l.id);
          return `<tr><td>${lvlBadge(l.id)}</td><td>${sel(MODELS_, l.model, `data-i="${i}" data-k="model"`)}</td><td>${sel(EFFORTS_, l.effort, `data-i="${i}" data-k="effort"`)}</td>
            <td><input class="text-in" data-i="${i}" data-k="job" value="${esc(l.job)}"></td>
            <td class="num">${s ? s.runs : '·'}</td><td class="num">${s && s.runs ? Math.round((s.escalated / s.runs) * 100) + '%' : '·'}</td><td class="num">${s ? fmtTokens(s.avgTokens) : '·'}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="crew-opts">
      <label>Escalate a task at most <input class="text-in num-in" type="number" min="0" max="6" data-opt="escalate" value="${crew.escalate}"> times</label>
      <label class="chk"><input type="checkbox" data-opt="approve" ${crew.approve ? 'checked' : ''}> Show me the plan before helpers start</label>
      <label class="chk"><input type="checkbox" data-opt="skipSmall" ${crew.skipSmall !== false ? 'checked' : ''}> Let the planner skip planning for one-file changes</label>
    </div>
    <div class="crew-actions">
      <button class="btn primary" data-save>Save</button>
      <button class="link-btn" data-defaults>Reset to defaults</button>
      <span class="dim">${info.stats.total ? `${info.stats.total} helper runs logged so far` : 'Stats fill in as helpers run.'}</span>
    </div>
  </div>`;
  const win = openModal({ title: 'Crew', sub: 'planner and helper levels', cls: 'crew-modal', body: draw() });
  const body = $('.modal-body', win);
  body.oninput = body.onchange = (e) => {
    const t = e.target;
    if (t.dataset.p) crew.planner[t.dataset.p] = t.value;
    else if (t.dataset.k) crew.levels[+t.dataset.i][t.dataset.k] = t.value;
    else if (t.dataset.opt === 'escalate') crew.escalate = +t.value || 0;
    else if (t.dataset.opt === 'approve') crew.approve = t.checked;
    else if (t.dataset.opt === 'skipSmall') crew.skipSmall = t.checked;
  };
  body.onclick = async (e) => {
    if (e.target.closest('[data-defaults]')) { crew = JSON.parse(JSON.stringify(info.defaults)); body.innerHTML = draw(); return; }
    if (e.target.closest('[data-save]')) {
      await saveSettings({ crew }, { apply: false });
      toast('Crew saved. Idle crew sessions pick it up from their next message.');
      closeModal();
    }
  };
}
