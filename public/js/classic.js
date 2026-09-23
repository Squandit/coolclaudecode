'use strict';
// The classic layout: sidebar on the left, one session in the middle, info cards on the right.

const Classic = {
  openProjects: new Set(store.get('openProjects', [])),
  route: { name: 'home' },

  enter() {
    $('#app').hidden = false;
    const app = $('#app');
    if (!store.get('tray', true)) app.classList.add('no-tray');
    $('#scrim').onclick = () => app.classList.remove('side-open', 'tray-open');
    this.renderSide();
    this.go();
    this.renderDock();
  },

  leave() {
    $('#app').hidden = true;
    for (const p of [...panes.values()]) p.destroy();
    $('#main-body').innerHTML = '';
    $('#dock').hidden = true;
    for (const v of Terms.views.values()) v.el.remove();
  },

  go() {
    const h = location.hash.replace(/^#\/?/, '');
    const app = $('#app');
    app.classList.remove('side-open', 'tray-open');
    closeMenu();
    if (h.startsWith('s/')) return this.showSession(h.slice(2));
    for (const p of [...panes.values()]) p.destroy();
    st.focusId = null;
    this.route = h === 'settings' ? { name: 'settings' } : { name: 'home' };
    if (this.route.name === 'settings') this.renderSettings(); else this.renderHome();
    renderTray();
    this.renderSide();
  },

  async showSession(id) {
    this.route = { name: 'session', id };
    if (!st.sessions.has(id)) {
      try { const d = await api('GET', '/sessions/' + id); st.sessions.set(id, d.session); } catch { location.hash = '#/'; return; }
    }
    for (const p of [...panes.values()]) if (p.id !== id) p.destroy();
    let p = panes.get(id);
    const main = $('#main-body');
    main.onclick = null;
    if (!p) { p = new Pane(id); panes.set(id, p); }
    st.focusId = id;
    main.innerHTML = '';
    main.appendChild(p.el);
    this.renderSide();
    await p.load();
    renderTray();
    p.focusInput();
  },

  onSession(s) { this.renderSideSoon(); if (this.route.name === 'home') this.renderHomeLists(); },
  onRemoved(id) {
    this.renderSide();
    if (this.route.id === id) location.hash = '#/';
  },
  onUsage() { this.renderUsage(); },
  onProjects() { this.renderSideSoon(); if (this.route.name === 'home') this.renderHomeLists(); },
  onTick() { this.renderUsage(); },

  keys(e, act) {
    const run = (fn) => { e.preventDefault(); fn(); return true; };
    if (act && act.id === 'launcher') return run(() => this.newSession());
    if (act && act.id === 'terminal') return run(() => this.toggleDock());
    if (act && act.id === 'info') return run(() => this.toggleInfo());
    if (e.key === 'Escape') $('#app').classList.remove('side-open', 'tray-open');
    return false;
  },

  newSession(cwd) {
    if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
    else this.renderHome();
    requestAnimationFrame(() => {
      if (cwd) { const f = $('#start-folder'); if (f) f.value = cwd; }
      $('#start-text')?.focus();
    });
  },

  putAway: async (id) => {
    await api('PATCH', '/sessions/' + id, { open: false }).catch((err) => toast(err.message));
    if (st.focusId === id) location.hash = '#/';
  },

  toggleInfo() {
    const app = $('#app');
    if (window.matchMedia('(max-width: 1180px)').matches) app.classList.toggle('tray-open');
    else { app.classList.toggle('no-tray'); store.set('tray', !app.classList.contains('no-tray')); }
    focusedPane()?.renderHead();
  },

  renderTray() {
    const tray = $('#tray');
    const p = focusedPane();
    tray.innerHTML = p && p.s ? trayCards(p) : this.trayIdle();
  },

  trayIdle() {
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
  },

  // ---------------------------------------------------------------- terminal dock

  dockActive: null,

  renderDock() {
    const dock = $('#dock');
    const views = Terms.list();
    if (!views.length) { dock.hidden = true; this.dockActive = null; return; }
    if (!views.some((v) => v.id === this.dockActive)) this.dockActive = views[views.length - 1].id;
    if (!dock.dataset.wired) this.wireDock(dock);
    dock.style.height = store.get('dockH', 300) + 'px';
    $('.dock-tabs', dock).innerHTML = views.map((v) => `<button class="dock-tab ${v.id === this.dockActive ? 'on' : ''}" data-tab="${v.id}" title="${esc(v.meta.cwd)}">${ICON.term}<span>${esc(v.title)}</span><i data-kill="${v.id}" title="Close">${ICON.x}</i></button>`).join('');
    const body = $('.dock-body', dock);
    for (const v of views) {
      if (v.el.parentElement !== body) body.appendChild(v.el);
      v.el.hidden = v.id !== this.dockActive;
    }
    if (dock.hidden === false) Terms.views.get(this.dockActive)?.refit();
  },

  wireDock(dock) {
    dock.dataset.wired = '1';
    dock.onclick = async (e) => {
      const kill = e.target.closest('[data-kill]');
      if (kill) { e.stopPropagation(); await Terms.views.get(kill.dataset.kill)?.kill(); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.dockActive = tab.dataset.tab; this.renderDock(); Terms.views.get(this.dockActive)?.focus(); return; }
      if (e.target.closest('[data-newterm]')) this.newTerm();
      if (e.target.closest('[data-hidedock]')) { dock.hidden = true; focusedPane()?.focusInput(); }
    };
    const grip = $('.dock-grip', dock);
    grip.onpointerdown = (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const startY = e.clientY, startH = dock.offsetHeight;
      grip.onpointermove = (ev) => {
        const h = Math.max(120, Math.min(window.innerHeight - 160, startH + (startY - ev.clientY)));
        dock.style.height = h + 'px';
      };
      grip.onpointerup = () => { grip.onpointermove = null; store.set('dockH', dock.offsetHeight); Terms.views.get(this.dockActive)?.refit(); };
    };
  },

  async newTerm() {
    const p = focusedPane();
    const v = await Terms.create(p ? { sessionId: p.id } : {});
    if (v) this.showTerm(v);
  },

  showTerm(v) {
    this.dockActive = v.id;
    $('#dock').hidden = false;
    this.renderDock();
    v.focus();
  },

  toggleDock() {
    const dock = $('#dock');
    if (!Terms.list().length) return this.newTerm();
    if (dock.hidden) { dock.hidden = false; this.renderDock(); Terms.views.get(this.dockActive)?.focus(); }
    else if (dock.contains(document.activeElement)) { dock.hidden = true; focusedPane()?.focusInput(); }
    else Terms.views.get(this.dockActive)?.focus();
  },

  onTermsChanged() { this.renderDock(); },
  onKeysChanged() { this.renderSide(); if (this.route.name === 'settings') this.renderSettings(); else if (this.route.name === 'home') this.renderHome(); },

  // ---------------------------------------------------------------- sidebar

  sideQueued: false,
  renderSideSoon() {
    if (this.sideQueued) return;
    this.sideQueued = true;
    requestAnimationFrame(() => { this.sideQueued = false; this.renderSide(); });
  },

  renderSide() {
    const side = $('#side');
    const scrollTop = $('.side-scroll', side)?.scrollTop || 0;
    const open = sessionsSorted().filter((s) => s.open !== false);
    const groups = new Map();
    for (const s of open) {
      const k = baseName(s.cwd);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const currentId = st.focusId;

    let openHtml = '';
    for (const [name, list] of groups) {
      openHtml += `<div class="group-name">${ICON.folder}${esc(name)}</div>`;
      for (const s of list) {
        const sub = sessionSub(s);
        openHtml += `<div class="s-item ${s.id === currentId ? 'active' : ''}" role="button" tabindex="0" data-open="${s.id}">
          <span class="dot ${s.status}"></span>
          <span class="s-body"><span class="s-title">${esc(s.title)}</span><span class="s-sub ${sub.cls}" data-ago="${s.id}">${esc(sub.text)}</span></span>
          <button class="s-close" title="Put away (keeps history)" data-close="${s.id}">${ICON.x}</button>
        </div>`;
      }
    }
    if (!open.length) openHtml = `<div class="empty-note">Nothing open. Start one above.</div>`;

    let projHtml = '';
    for (const p of st.projects.slice(0, 14)) {
      const isOpen = this.openProjects.has(p.cwd);
      projHtml += `<button class="p-item ${isOpen ? 'open' : ''}" data-proj="${esc(p.cwd)}" title="${esc(p.where)}">
        <span class="chev">${ICON.chev}</span><span class="p-name">${esc(p.name)}</span><span class="p-meta">${p.count} · ${esc(ago(p.updatedAt).replace(' ago', ''))}</span>
      </button>`;
      if (isOpen) {
        const mine = sessionsSorted().filter((s) => s.cwd === p.cwd);
        const theirs = st.history.filter((h) => h.cwd === p.cwd);
        projHtml += `<div class="p-sessions">`;
        projHtml += `<button class="p-sess accent" data-newin="${esc(p.where)}">+ new session here</button>`;
        for (const s of mine) projHtml += `<button class="p-sess" data-open="${s.id}">${esc(s.title)}<small>${esc(ago(s.updatedAt))}</small></button>`;
        for (const h of theirs.slice(0, 8)) projHtml += `<button class="p-sess" data-import="${h.sessionId}" title="From Claude Code">${esc(h.title)}<small>${esc(ago(h.updatedAt))}</small></button>`;
        projHtml += `</div>`;
      }
    }
    if (!st.projects.length) projHtml = `<div class="empty-note">Folders you've used Claude Code in show up here.</div>`;

    side.innerHTML = `
      <div class="brand">${LOGO}<span class="brand-name">desk</span>${st.demo ? '<span class="brand-demo">demo</span>' : ''}</div>
      <button class="new-btn" data-new>${ICON.plus}<span>New session</span><kbd>${esc(Keys.label('launcher'))}</kbd></button>
      <div class="side-scroll">
        <div class="side-label"><span>Open</span><button data-home title="Home">${ICON.home}</button></div>
        ${openHtml}
        <div class="side-label"><span>Projects</span></div>
        ${projHtml}
      </div>
      <div class="usage" id="usage"></div>`;
    $('.side-scroll', side).scrollTop = scrollTop;
    this.renderUsage();

    side.onclick = async (e) => {
      const t = e.target.closest('[data-open],[data-close],[data-proj],[data-new],[data-newin],[data-import],[data-home],[data-settings],[data-themes],[data-dock]');
      if (!t) return;
      if (t.dataset.close) { e.stopPropagation(); this.putAway(t.dataset.close); }
      else if (t.dataset.open) location.hash = '#/s/' + t.dataset.open;
      else if (t.dataset.proj) {
        const c = t.dataset.proj;
        if (this.openProjects.has(c)) this.openProjects.delete(c); else this.openProjects.add(c);
        store.set('openProjects', [...this.openProjects]);
        this.renderSide();
      } else if (t.dataset.new !== undefined) this.newSession();
      else if (t.dataset.newin) this.newSession(t.dataset.newin);
      else if (t.dataset.import) importSession(t.dataset.import);
      else if (t.dataset.home !== undefined) location.hash = '#/';
      else if (t.dataset.settings !== undefined) location.hash = '#/settings';
      else if (t.dataset.themes !== undefined) openThemePicker();
      else if (t.dataset.dock !== undefined) this.toggleDock();
    };
    side.onkeydown = (e) => {
      const t = e.target.closest('[data-open]');
      if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = '#/s/' + t.dataset.open; }
    };
  },

  renderUsage() {
    const el = $('#usage');
    if (!el) return;
    const u = st.usage;
    const settingsBtn = `<span class="usage-btns"><button class="icon-btn" title="Terminal (${esc(Keys.label('terminal'))})" data-dock>${ICON.term}</button><button class="icon-btn" title="Themes (${esc(Keys.label('themes'))})" data-themes>${ICON.palette}</button><button class="icon-btn ${this.route.name === 'settings' ? 'on' : ''}" title="Settings" data-settings>${ICON.gear}</button></span>`;
    const meter = (label, w) => {
      if (!w || w.utilization == null) return '';
      const pct = Math.round(w.utilization * 100);
      return `<div class="meter ${pct >= 85 ? 'hot' : ''}" style="--c:${levelColor(pct)}">
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
    const warn = usageWarning(u);
    el.innerHTML = `<div class="usage-head"><strong>Plan usage</strong>${settingsBtn}</div>
      ${meter('5 hour', u.five_hour)}${meter('week', u.seven_day)}
      ${warn ? `<div class="usage-warn">${esc(warn)}</div>` : ''}
      <div class="usage-foot">updated ${esc(ago(u.updatedAt))}</div>`;
  },

  // ---------------------------------------------------------------- home

  renderHome() {
    const main = $('#main-body');
    main.onclick = null;
    const recentFolder = sessionsSorted()[0] ? prettyish(sessionsSorted()[0].cwd) : '';
    main.innerHTML = `
      <div class="head mobile-only" style="border:0;padding-bottom:0"><button class="icon-btn" data-side>${ICON.menu}</button></div>
      <div class="page"><div class="page-inner">
        <div class="eyebrow">${esc(greeting())}</div>
        <h1 class="hero">What are we making?</h1>
        <p class="lede">Start a session in any folder, or pick up one you left open.</p>
        <div class="starter">
          <textarea id="start-text" placeholder="Describe the thing. Or leave it blank and just open a session." rows="3"></textarea>
          <div class="starter-bar">
            <label class="folder-field" title="Folder Claude works in">${ICON.folder}<input id="start-folder" list="folders" spellcheck="false" placeholder="${esc(st.settings.defaultCwd || recentFolder || st.home)}" value="${esc(st.settings.defaultCwd || '')}"></label>
            <datalist id="folders"></datalist>
            <button class="btn crew-toggle ${store.get('crewStart', false) ? 'on' : ''}" id="start-crew" title="Crew: a planner hands tasks to helpers by difficulty">${ICON.agent} Crew</button>
            <button class="btn" id="resume-last" ${sessionsSorted().length ? '' : 'disabled'}>Resume last</button>
            <button class="btn primary" id="start-go">Start <kbd>${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'} ⏎</kbd></button>
          </div>
        </div>
        <div class="tip"><span><kbd>${esc(Keys.label('launcher'))}</kbd> new session</span><span><kbd>${esc(Keys.label('themes'))}</kbd> themes</span><span><kbd>${esc(Keys.label('terminal'))}</kbd> terminal</span><span><kbd>/</kbd> commands</span><span><kbd>@</kbd> files</span><span>Sessions keep running when you switch away.</span></div>
        <div id="home-lists"></div>
      </div></div>`;
    const go = async () => {
      const btn = $('#start-go');
      btn.disabled = true;
      try {
        const s = await createSession($('#start-folder').value.trim() || undefined, $('#start-text').value.trim() || undefined, store.get('crewStart', false));
        location.hash = '#/s/' + s.id;
      } catch (err) { toast(err.message); btn.disabled = false; }
    };
    $('#start-go').onclick = go;
    $('#start-text').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } };
    $('#start-crew').onclick = (e) => { const on = !store.get('crewStart', false); store.set('crewStart', on); e.currentTarget.classList.toggle('on', on); };
    $('#resume-last').onclick = () => { const s = sessionsSorted()[0]; if (s) location.hash = '#/s/' + s.id; };
    $('[data-side]', main).onclick = () => $('#app').classList.add('side-open');
    this.renderHomeLists();
  },

  renderHomeLists() {
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
      else if (t.dataset.newin) { $('#start-folder').value = t.dataset.newin; $('#start-text').focus(); $('.page').scrollTop = 0; }
    };
  },

  // ---------------------------------------------------------------- settings

  renderSettings() {
    const s = st.settings;
    const seg = (key, list) => `<div class="seg" data-key="${key}">${list.map((x) => `<button data-val="${x.id}" class="${s[key] === x.id ? 'sel' : ''}">${esc(x.name)}</button>`).join('')}</div>`;
    const main = $('#main-body');
    main.innerHTML = `
      <div class="head mobile-only" style="border:0;padding-bottom:0"><button class="icon-btn" data-side>${ICON.menu}</button></div>
      <div class="page"><div class="page-inner">
        <div class="eyebrow">Settings</div>
        <h1 class="hero" style="font-size:38px">Make it yours</h1>
        <p class="lede">Saved to <span class="mono">~/.desk</span> on this machine. Nothing leaves it.</p>

        <div class="set-group"><h2>Look</h2><p>${esc(Keys.label('themes'))} switches themes from anywhere, or use the palette button bottom left. Riced swaps the whole layout for a tiling desktop.</p>
          <div class="themes">
            ${THEMES.map((t) => { const pal = PALETTES[t.palette || 'tokyonight']; return `<button class="theme-card ${s.theme === t.id ? 'sel' : ''}" data-theme="${t.id}"><span class="sw">${themeSwatch(pal).map((c) => `<i style="background:${c}"></i>`).join('')}</span><b>${esc(t.name)}</b><small>${esc(t.note || (pal.light ? 'light' : 'dark'))}</small></button>`; }).join('')}
          </div>
        </div>

        <div class="set-group"><h2>Fonts</h2><p>The interface can be anything; code blocks, diffs and terminals stay monospaced so they line up. In Riced, set <span class="mono">font</span> and <span class="mono">code_font</span> in desk.conf instead.</p>
          <div class="set-row"><label>Interface</label><div class="font-grid">${FONTS.map((f) => `<button class="font-card ${(s.font || 'JetBrains Mono') === f.name ? 'sel' : ''}" data-font="${esc(f.name)}" style="font-family:${esc(fontStack(f.name))}"><b>Aa</b><span>${esc(f.name)}</span></button>`).join('')}</div></div>
          <div class="set-row"><label>Code and terminal</label><div class="font-grid">${FONTS.filter((f) => f.mono).map((f) => `<button class="font-card ${(s.codeFont || 'JetBrains Mono') === f.name ? 'sel' : ''}" data-codefont="${esc(f.name)}" style="font-family:${esc(fontStack(f.name, true))}"><b>{ }</b><span>${esc(f.name)}</span></button>`).join('')}</div></div>
        </div>

        <div class="set-group"><h2>New sessions start with</h2><p>You can change any of these per session from the header.</p>
          <div class="set-row"><label>Auto route<small>Haiku reads each request and picks the model and effort from the table below. When it's off, the model and effort here are used.</small></label><button class="switch ${s.auto ? 'on' : ''}" id="auto-default" aria-pressed="${!!s.auto}"></button></div>
          <div class="set-row"><label>Model</label>${seg('model', MODELS)}</div>
          <div class="set-row"><label>Effort<small>How hard Claude thinks</small></label>${seg('effort', EFFORTS.map((e) => ({ ...e, name: e.id })))}</div>
          <div class="set-row"><label>Permissions<small>What Claude can do without asking</small></label>${seg('permission', PERMS)}</div>
          <div class="set-row"><label>Lean<small>Only file and shell tools: every step sends a much smaller prompt, so it uses less of your limit. No web search, MCP or other extras.</small></label><button class="switch ${s.lean ? 'on' : ''}" id="lean-default" aria-pressed="${!!s.lean}"></button></div>
          <div class="set-row"><label>Folder<small>Where new sessions open</small></label><input class="text-in" data-text="defaultCwd" value="${esc(s.defaultCwd)}" placeholder="${esc(st.home)}" spellcheck="false"></div>
        </div>

        <div class="set-group"><h2>Claude Code</h2><p>desk drives the <span class="mono">claude</span> CLI you already have installed and logged into.</p>
          <div class="set-row"><label>CLI path<small>Leave as <span class="mono">claude</span> if it's on your PATH</small></label><div><input class="text-in" data-text="claudePath" value="${esc(s.claudePath)}" spellcheck="false"><span class="ver" id="ver">checking…</span></div></div>
        </div>

        <div class="set-group"><h2>Terminal</h2><p>${esc(Keys.label('terminal'))} opens it. "Open" on a file starts your editor there.</p>
          <div class="set-row"><label>Editor<small>Leave empty to use <span class="mono">$EDITOR</span></small></label><input class="text-in" data-text="editor" value="${esc(s.editor || '')}" placeholder="${esc(Terms.info.editor || 'nvim')}" spellcheck="false"></div>
          <div class="set-row"><label>Shell<small>Leave empty for your login shell</small></label><input class="text-in" data-text="shell" value="${esc(s.shell || '')}" placeholder="${esc(Terms.info.shell || '')}" spellcheck="false"></div>
          ${Terms.info.available ? '' : `<div class="set-row"><label>Status</label><span style="color:var(--bad)">Off: node-pty is ${esc(Terms.info.error || 'missing')}. Run <span class="mono">npm install</span> and restart.</span></div>`}
        </div>

        <div class="set-group"><h2>Auto route</h2><p>Which model handles each kind of request. Haiku picks the level, which costs about a fifth of a cent and two seconds. Once a conversation passes ${fmtTokens(((s.router || {}).stickAt) || 40000)} tokens it only steps up, because switching down would re-read the whole thing without the cache.</p>
          <button class="btn" data-routes-edit>Edit the routes</button>
        </div>

        <div class="set-group"><h2>Crew</h2><p>A planner (${esc(((s.crew || {}).planner || {}).model || 'opus')}) splits the work and hands each task to the cheapest helper that can do it. Turn it on per session with the crew pill in the header, or the Crew button when you start one.</p>
          <button class="btn" data-crew-edit>${ICON.agent} Edit the crew</button>
        </div>

        <div class="set-group"><h2>Shortcuts</h2><p>The modifier is <b>${esc(Keys.mod().label)}</b>. If your window manager (GlazeWM, i3, Hyprland…) already uses it, pick another or rebind single keys.</p>
          <button class="btn" data-shortcuts>Edit shortcuts</button>
        </div>

        <div class="set-group"><h2>What's new</h2><p>What changed in desk, newest first.</p>
          <button class="btn" data-news>${ICON.news} Read the changelog</button>
        </div>

        <div class="set-group"><h2>Notifications</h2><p>A desktop ping when a session needs you or finishes while you're looking elsewhere.</p>
          <div class="set-row"><label>Notify me</label><button class="switch ${s.notify ? 'on' : ''}" id="notify" aria-pressed="${!!s.notify}"></button></div>
        </div>
      </div></div>`;

    main.onclick = async (e) => {
      const b = e.target.closest('.seg button');
      if (b) {
        const key = b.parentElement.dataset.key;
        $$('button', b.parentElement).forEach((x) => x.classList.toggle('sel', x === b));
        saveSettings({ [key]: b.dataset.val });
        return;
      }
      const t = e.target.closest('[data-theme]');
      if (t) { switchTheme(t.dataset.theme); return; }
      const fc = e.target.closest('[data-font],[data-codefont]');
      if (fc) {
        const key = fc.dataset.font ? 'font' : 'codeFont';
        $$(fc.dataset.font ? '[data-font]' : '[data-codefont]', main).forEach((x) => x.classList.toggle('sel', x === fc));
        await saveSettings({ [key]: fc.dataset.font || fc.dataset.codefont });
        Terms.retheme();
        return;
      }
      if (e.target.closest('#auto-default')) {
        const on = !st.settings.auto;
        $('#auto-default').classList.toggle('on', on);
        saveSettings({ auto: on });
        return;
      }
      if (e.target.closest('#lean-default')) {
        const on = !st.settings.lean;
        $('#lean-default').classList.toggle('on', on);
        saveSettings({ lean: on });
        return;
      }
      if (e.target.closest('#notify')) {
        const on = !st.settings.notify;
        if (on && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
        $('#notify').classList.toggle('on', on);
        saveSettings({ notify: on });
        return;
      }
      if (e.target.closest('[data-news]')) openChangelog();
      if (e.target.closest('[data-shortcuts]')) openShortcuts();
      if (e.target.closest('[data-side]')) $('#app').classList.add('side-open');
    };
    FONTS.forEach((f) => loadFont(f.name));
    for (const input of $$('[data-text]', main)) {
      input.onchange = async () => { await saveSettings({ [input.dataset.text]: input.value.trim() }); if (input.dataset.text === 'claudePath') this.checkVersion(); };
    }
    this.checkVersion();
  },

  async checkVersion() {
    const el = $('#ver');
    if (!el) return;
    el.textContent = 'checking…';
    const { version } = await api('GET', '/version').catch(() => ({}));
    el.textContent = version ? '✓ ' + version : "✗ can't run it";
    el.style.color = version ? 'var(--ok)' : 'var(--bad)';
  },
};

function sessionSub(s) {
  if (s.status === 'working') return { cls: '', text: (panes.get(s.id)?.activity) || 'working…' };
  if (s.status === 'needs_you') return { cls: 'needs', text: 'needs you' };
  if (s.status === 'error') return { cls: 'err', text: 'hit an error' };
  if (s.status === 'done') return { cls: '', text: 'done · ' + ago(s.updatedAt) };
  return { cls: '', text: ago(s.updatedAt) };
}

function usageWarning(u) {
  if (!u) return '';
  if (u.overage) return 'Past your plan limit, using extra usage.';
  if (u.seven_day && u.seven_day.utilization >= 0.85) return `Weekly limit nearly used. It resets in ${resetIn(u.seven_day.resetsAt)}.`;
  if (u.five_hour && u.five_hour.utilization >= 0.85) return `5-hour limit nearly used. It resets in ${resetIn(u.five_hour.resetsAt)}.`;
  return '';
}

function prettyish(cwd) {
  const p = [...panes.values()].find((x) => x.s && x.s.cwd === cwd);
  return (p && p.where) || cwd;
}
