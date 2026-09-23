'use strict';
// A Pane is one session's view: header, transcript, permission cards and composer.
// The classic layout shows one at a time; the tiling layout shows many side by side.

const st = {
  settings: {},
  usage: null,
  demo: false,
  home: '~',
  system: null,
  sessions: new Map(),
  projects: [],
  history: [],
  focusId: null,
  prevStatus: new Map(),
};
const panes = new Map();

function sessionsSorted() {
  return [...st.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
function focusedPane() { return st.focusId ? panes.get(st.focusId) : null; }

function freshModel() {
  return {
    todos: [], tasks: new Map(), files: new Map(), toolInputs: new Map(),
    turns: 0, timeMs: 0, tools: 0, tokIn: 0, tokOut: 0, cacheR: 0, cacheW: 0, cost: 0,
    ctx: null, window: 200000, modelName: null,
  };
}

function patchCounts(hunks) {
  let add = 0, del = 0;
  for (const h of hunks || []) for (const l of h.lines || []) { if (l[0] === '+') add++; else if (l[0] === '-') del++; }
  return { add, del };
}

function stringsToHunks(oldS, newS) {
  const lines = [];
  if (oldS) for (const l of String(oldS).replace(/\n$/, '').split('\n')) lines.push('-' + l);
  if (newS) for (const l of String(newS).replace(/\n$/, '').split('\n')) lines.push('+' + l);
  return [{ oldStart: 0, newStart: 0, lines, noNumbers: true }];
}

function diffRows(hunks) {
  let rows = '';
  const adds = [];
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

function describeTool(name, input, s, result) {
  const i = input || {};
  const file = (p) => `<span class="mono">${esc(rel(p, s.cwd))}</span>`;
  const q = (x, n = 80) => esc(String(x || '').length > n ? String(x).slice(0, n) + '…' : String(x || ''));
  switch (name) {
    case 'Read': {
      const n = result?.file?.numLines;
      return { ico: ICON.read, c: 'var(--info)', html: `<b>Read</b> ${file(i.file_path)}${n ? ` <span class="dim">${n} lines</span>` : ''}` };
    }
    case 'Write': return { ico: ICON.write, c: 'var(--ok)', html: `<b>${result?.type === 'update' ? 'Rewrote' : 'Wrote'}</b> ${file(i.file_path)}` };
    case 'Edit':
    case 'MultiEdit': {
      const n = patchCounts(result?.structuredPatch);
      const count = name === 'MultiEdit' ? (i.edits || []).length : 1;
      const tally = result?.structuredPatch ? ` <span class="dim">(${count} change${count === 1 ? '' : 's'}, <span class="n-add">+${n.add}</span> <span class="n-del">−${n.del}</span>)</span>` : '';
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
      return { ico: ICON.todo, c: 'var(--ok)', html: `<b>Updated the to-do list</b>${i.subject ? ` <span class="dim">${q(i.subject, 60)}</span>` : ''}` };
    case 'Task': case 'Agent': return { ico: ICON.agent, c: 'var(--you)', html: `<b>Sent a helper</b> ${q(i.description || i.subagent_type || '', 80)}` };
    case 'AskUserQuestion': return { ico: ICON.ask, c: 'var(--hot)', html: `<b>Asked you</b> ${q(i.questions?.[0]?.question || '', 80)}` };
    case 'ExitPlanMode': return { ico: ICON.plan, c: 'var(--info)', html: `<b>Proposed a plan</b>` };
    case 'EnterPlanMode': return { ico: ICON.plan, c: 'var(--info)', html: `<b>Switched to planning</b>` };
    case 'Skill': return { ico: ICON.skill, c: 'var(--warn)', html: `<b>Used skill</b> <span class="mono">${q(i.skill || i.command || '')}</span>` };
  }
  if (name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    return { ico: ICON.plug, c: 'var(--info)', html: `<b>${esc(server)}</b> · ${esc(rest.join('__'))}` };
  }
  return { ico: ICON.spark, c: 'var(--fg-2)', html: `<b>${esc(name)}</b>` };
}

class Pane {
  constructor(id) {
    this.id = id;
    this.askState = new Map();
    this.files = null;
    this.branch = null;
    this.where = null;
    this.el = document.createElement('section');
    this.el.className = 'pane';
    this.el.dataset.pane = id;
    this.el.innerHTML = `<div class="pane-in">
      <header class="head"></header>
      <div class="scroll"><div class="log"><div class="items"></div><div class="live"></div><div class="tail"></div></div></div>
      <div class="composer"><div class="composer-box">
        <div class="pop" hidden></div>
        <div class="composer-row"><span class="prompt-sign">❯</span><textarea rows="1" spellcheck="true"></textarea></div>
        <div class="composer-bar">
          <div class="hints"><span><kbd>⏎</kbd>send</span><span><kbd>⇧⏎</kbd>new line</span><span><kbd>/</kbd>commands</span><span><kbd>@</kbd>files</span></div>
          <button class="btn primary send-btn">Send</button>
        </div>
      </div></div>
    </div>`;
    const q = (sel) => this.el.querySelector(sel);
    this.$head = q('.head');
    this.$scroll = q('.scroll');
    this.$items = q('.items');
    this.$live = q('.live');
    this.$tail = q('.tail');
    this.$ta = q('textarea');
    this.$btn = q('.send-btn');
    this.$pop = q('.pop');
    this.reset();
    this.wireComposer();
    this.el.addEventListener('mousedown', () => { if (typeof onPaneFocus === 'function') onPaneFocus(this); });
  }

  get s() { return st.sessions.get(this.id); }

  reset() {
    this.loading = true;
    this.buffer = [];
    this.seq = 0;
    this.m = freshModel();
    this.tools = new Map();
    this.liveText = '';
    this.activity = null;
    this.pendingKey = '';
    this.$items.innerHTML = '';
    this.$live.innerHTML = '';
    this.$tail.innerHTML = '';
  }

  async load() {
    this.reset();
    this.renderHead();
    let data;
    try { data = await api('GET', '/sessions/' + this.id); } catch (err) { toast(err.message); return false; }
    st.sessions.set(this.id, data.session);
    this.branch = data.branch;
    this.where = data.where;
    for (const ev of data.events) this.applyEvent(ev, false);
    this.loading = false;
    for (const ev of this.buffer) this.applyEvent(ev, false);
    this.buffer = [];
    this.renderHead();
    this.renderTail();
    this.renderComposerState();
    this.renderEmpty();
    this.scrollToEnd(true);
    Changes.refreshSoon(this.id, 50);
    return true;
  }

  destroy() {
    this.el.remove();
    panes.delete(this.id);
  }

  focusInput() { this.$ta.focus({ preventScroll: true }); }

  // ---- server messages

  onEvent(ev) {
    if (this.loading) this.buffer.push(ev);
    else this.applyEvent(ev, true);
  }

  onSession() {
    this.renderHead();
    this.renderTail();
    this.renderComposerState();
    if (this === focusedPane()) renderTraySoon();
  }

  onActivity(text) {
    this.activity = text;
    this.renderActivity();
  }

  onDelta(msg) {
    if (this.loading) return;
    if (msg.block === 'thinking') { if (!this.activity) { this.activity = 'Thinking'; this.renderActivity(); } return; }
    if (msg.reset) this.liveText = '';
    this.liveText += msg.text;
    if (this.liveRaf) return;
    this.liveRaf = requestAnimationFrame(() => {
      this.liveRaf = 0;
      const stick = this.nearBottom();
      this.$live.innerHTML = this.liveText ? `<div class="say live">${md(this.liveText)}</div>` : '';
      this.renderEmpty();
      if (stick) this.scrollToEnd(true);
    });
  }

  // ---- header

  ctxPct() {
    const m = this.m;
    if (!m.ctx) return null;
    return Math.min(100, Math.round(((m.ctx.cached + m.ctx.fresh) / m.window) * 100));
  }

  renderHead() {
    const s = this.s;
    if (!s) return;
    const model = byId(MODELS, s.model);
    const effort = byId(EFFORTS, s.effort);
    const perm = byId(PERMS, s.permission);
    const pct = this.ctxPct();
    const trayShown = !$('#app').classList.contains('no-tray');
    this.$head.innerHTML = `
      <button class="icon-btn mobile-only" data-side>${ICON.menu}</button>
      <span class="win-dot dot ${s.status}"></span>
      <div class="head-left">
        <div class="head-title"><span class="title-text">${esc(s.title)}</span><button class="icon-btn rename" title="Rename">${ICON.pencil}</button></div>
        <div class="head-meta">
          <span class="mono where" title="${esc(s.cwd)}">${esc(this.where || s.cwd)}</span>
          ${this.branch ? `<span class="branch">${ICON.branch}<span class="mono">${esc(this.branch)}</span></span>` : ''}
          <span class="status-chip ${s.status}"><span class="dot ${s.status}"></span>${esc(STATUS_TEXT[s.status] || s.status)}</span>
        </div>
      </div>
      <div class="head-right">
        <button class="pill model" data-menu="model">${esc(model ? model.name : s.model)}</button>
        <button class="pill" data-menu="effort">${esc(effort ? effort.name : s.effort)}</button>
        <button class="pill perm-${s.permission}" data-menu="perm">${esc(perm ? perm.name : s.permission)}</button>
        <button class="pill ghost ctx-pill" data-ctx title="Context used">${pct == null ? '' : `<span class="ctx-ring" style="--p:${pct};--c:${levelColor(pct)}"></span>`}${pct == null ? 'context' : pct + '%'}<span class="k">${pct == null ? '' : 'context'}</span></button>
        <button class="icon-btn tray-btn ${trayShown ? 'on' : ''}" data-tray title="Toggle side panel">${ICON.panel}</button>
        <button class="icon-btn" data-menu="more" title="More">${ICON.more}</button>
        <button class="icon-btn win-close" data-winclose title="Put away (Alt Q)">${ICON.x}</button>
      </div>`;
    this.$head.onclick = (e) => {
      const t = e.target.closest('[data-menu],[data-tray],[data-ctx],[data-side],[data-winclose],.rename');
      if (!t) return;
      if (t.classList.contains('rename')) return this.startRename();
      if (t.dataset.side !== undefined) return $('#app').classList.add('side-open');
      if (t.dataset.winclose !== undefined) return putAway(this.id);
      if (t.dataset.tray !== undefined || t.dataset.ctx !== undefined) return toggleInfo();
      this.openMenu(t, t.dataset.menu);
    };
  }

  startRename() {
    const el = $('.title-text', this.$head);
    const s = this.s;
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

  openMenu(anchor, kind) {
    const s = this.s;
    let items;
    if (kind === 'model') items = MODELS.map((m) => ({ id: m.id, main: m.name, sel: s.model === m.id }));
    else if (kind === 'effort') items = EFFORTS.map((m) => ({ id: m.id, main: m.name, sel: s.effort === m.id }));
    else if (kind === 'perm') items = PERMS.map((m) => ({ id: m.id, main: m.name, sub: m.sub, sel: s.permission === m.id }));
    else items = [
      { id: 'copy-resume', main: 'Copy terminal command', sub: `claude --resume ${s.sessionId.slice(0, 8)}…` },
      { id: 'copy-path', main: 'Copy folder path' },
      { id: 'close', main: 'Put away', sub: 'Hide it, keep the history' },
      { id: 'delete', main: 'Delete from desk', sub: "Claude Code's own transcript stays" },
    ];
    openMenu(anchor, kind + this.id, items, async (id) => {
      if (kind === 'model') await this.patch({ model: id });
      else if (kind === 'effort') await this.patch({ effort: id });
      else if (kind === 'perm') await this.patch({ permission: id });
      else if (id === 'copy-resume') copy(`cd "${s.cwd}" && claude --resume ${s.sessionId}`, 'Command copied');
      else if (id === 'copy-path') copy(s.cwd, 'Path copied');
      else if (id === 'close') putAway(s.id);
      else if (id === 'delete') {
        if (!confirm(`Delete "${s.title}" from desk?`)) return;
        await api('DELETE', '/sessions/' + s.id).catch((err) => toast(err.message));
      }
    });
  }

  async patch(patch) {
    const s = this.s;
    try {
      const next = await api('PATCH', '/sessions/' + s.id, patch);
      st.sessions.set(next.id, next);
      this.renderHead();
      renderTraySoon();
      if (s.status === 'working' && (patch.model || patch.effort || patch.permission)) toast('Takes effect from the next message');
    } catch (err) { toast(err.message); }
  }

  // ---- events

  reduce(ev) {
    const m = this.m;
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

  applyEvent(ev, live) {
    if (ev.seq && ev.seq <= this.seq) return;
    if (ev.seq) this.seq = ev.seq;
    const stick = live && this.nearBottom();
    this.reduce(ev);
    this.renderEvent(ev);
    if (live) {
      if (ev.type === 'result' || ev.type === 'user') Changes.refreshSoon(this.id);
      if (this === focusedPane()) renderTraySoon();
      this.renderEmpty();
      if (ev.type === 'assistant' || ev.type === 'result') { this.renderHead(); if (typeof onPaneStats === 'function') onPaneStats(this); }
      if (stick) this.scrollToEnd();
    }
  }

  nearBottom() {
    const sc = this.$scroll;
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
  }
  scrollToEnd(force) {
    const sc = this.$scroll;
    if (force || this.nearBottom()) sc.scrollTop = sc.scrollHeight;
  }

  renderEmpty() {
    const s = this.s;
    if (!s) return;
    const existing = $('.empty-session', this.$items);
    const hasContent = [...this.$items.children].some((c) => !c.classList.contains('empty-session')) || this.liveText;
    if (hasContent || s.status === 'working' || this.loading) { existing?.remove(); return; }
    if (!existing) {
      this.$items.insertAdjacentHTML('afterbegin', `<div class="empty-session"><div><div class="eyebrow">${esc(baseName(s.cwd))}</div><h2>What are we making?</h2><p>Claude works in <span class="mono">${esc(this.where || s.cwd)}</span>. Type below to start.</p></div></div>`);
    }
  }

  add(html) {
    this.$items.insertAdjacentHTML('beforeend', html);
    return this.$items.lastElementChild;
  }

  endLive() {
    this.liveText = '';
    this.$live.innerHTML = '';
  }

  renderEvent(ev) {
    const s = this.s;
    if (ev.t === 'prompt') {
      this.endLive();
      const time = ev.ts ? clock(new Date(ev.ts)) : '';
      this.add(`<div class="prompt"><div class="who">you<time>${esc(time)}</time></div><div class="prompt-text">${esc(ev.text)}</div></div>`);
    } else if (ev.t === 'compact') {
      this.add(`<div class="divider">context compacted</div>`);
    } else if (ev.t === 'error') {
      this.endLive();
      this.add(`<div class="err-card">${esc(ev.text)}</div>`);
    } else if (ev.t === 'decision') {
      const t = this.tools.get(ev.toolUseId);
      const html = `<div class="decision ${ev.allow ? '' : 'no'}">${ev.allow ? (ev.always ? 'you allowed this for the session' : 'you allowed this') : 'you said no'}</div>`;
      if (t) t.el.insertAdjacentHTML('beforeend', html); else this.add(html);
    } else if (ev.type === 'assistant') {
      if (ev.parent) return;
      for (const c of ev.message.content || []) {
        if (c.type === 'text' && c.text.trim()) { this.endLive(); this.add(`<div class="say">${md(c.text)}</div>`); }
        else if (c.type === 'thinking' && c.thinking && c.thinking.trim()) this.add(`<details class="thinking"><summary>${ICON.brain} thought about it</summary><div>${esc(c.thinking)}</div></details>`);
        else if (c.type === 'tool_use') this.addTool(c, s);
      }
    } else if (ev.type === 'user') {
      if (ev.parent) return;
      for (const c of ev.message.content || []) if (c.type === 'tool_result') this.finishTool(c, ev.result, s);
    } else if (ev.type === 'result') {
      this.endLive();
      // A finished turn has no running tools. Clear any spinner that never got a result.
      for (const t of this.tools.values()) {
        const spin = t.result === undefined && $('.spin', t.el);
        if (spin) spin.parentElement.innerHTML = '<span class="tool-state dim">–</span>';
      }
      if (ev.isError && ev.text) this.add(`<div class="err-card">${esc(ev.text)}</div>`);
      const out = ev.usage ? ev.usage.output_tokens || 0 : 0;
      const bits = [];
      if (ev.durationMs) bits.push(`<b>${fmtDur(ev.durationMs)}</b>`);
      if (ev.cost) bits.push(fmtCost(ev.cost));
      if (ev.steps) bits.push(`${ev.steps} step${ev.steps === 1 ? '' : 's'}`);
      if (out) bits.push(`${fmtTokens(out)} tokens out`);
      if (ev.subtype === 'error_during_execution') bits.push('stopped');
      if (bits.length) this.add(`<div class="turn-foot">${bits.join('<span>·</span>')}</div>`);
    }
  }

  // ---- tools

  addTool(c, s) {
    const d = describeTool(c.name, c.input, s);
    const el = this.add(`<div class="tool" data-tool="${esc(c.id)}">
      <button class="tool-row"><span class="tool-ico" style="--c:${d.c}">${d.ico}</span><span class="tool-text">${d.html}</span><span class="tool-state"><span class="spin"></span></span></button>
    </div>`);
    const entry = { el, name: c.name, input: c.input || {}, detail: null };
    this.tools.set(c.id, entry);
    // Show edits right away from the tool input, then swap in the real patch when it lands.
    if (c.name === 'Edit' && c.input) entry.diff = this.appendDiff(el, c.input.file_path, stringsToHunks(c.input.old_string, c.input.new_string), s, false);
    if (c.name === 'MultiEdit' && c.input?.edits) entry.diff = this.appendDiff(el, c.input.file_path, c.input.edits.flatMap((e) => stringsToHunks(e.old_string, e.new_string)), s, false);
    if (c.name === 'ExitPlanMode' && c.input?.plan) el.insertAdjacentHTML('beforeend', `<div class="tool-detail"><div class="say" style="margin:0">${md(c.input.plan)}</div></div>`);
    $('.tool-row', el).onclick = () => this.toggleToolDetail(entry);
  }

  finishTool(c, result, s) {
    const entry = this.tools.get(c.tool_use_id);
    if (!entry) return;
    entry.result = result;
    entry.content = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('\n') : '';
    entry.isError = !!c.is_error;
    const d = describeTool(entry.name, entry.input, s, result);
    $('.tool-text', entry.el).innerHTML = d.html;
    entry.el.classList.add(entry.isError ? 'failed' : 'ok');
    $('.tool-state', entry.el).innerHTML = entry.isError ? `<span class="tool-state err">✗</span>` : `<span class="tool-state ok">✓</span>`;
    const patch = result && Array.isArray(result.structuredPatch) ? result.structuredPatch : null;
    const fp = result?.filePath || entry.input.file_path;
    if (!entry.isError && ['Edit', 'MultiEdit', 'Write'].includes(entry.name)) {
      let hunks = patch && patch.length ? patch : null;
      if (!hunks && entry.name === 'Write') hunks = stringsToHunks('', entry.input.content || '');
      if (hunks) {
        entry.diff?.remove();
        entry.diff = this.appendDiff(entry.el, fp, hunks, s, true);
      }
    }
    if (entry.isError) {
      entry.diff?.remove();
      this.openToolDetail(entry);
    }
  }

  toolDetailHtml(entry) {
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
  openToolDetail(entry) {
    if (entry.detail) return;
    entry.detail = document.createElement('div');
    entry.detail.className = 'tool-detail';
    entry.detail.innerHTML = this.toolDetailHtml(entry);
    $('.tool-row', entry.el).after(entry.detail);
  }
  toggleToolDetail(entry) {
    if (entry.detail) { entry.detail.remove(); entry.detail = null; } else this.openToolDetail(entry);
  }

  appendDiff(parent, filePath, hunks, s, final) {
    const { rows, adds } = diffRows(hunks);
    const n = patchCounts(hunks);
    const long = n.add + n.del > 24;
    const el = document.createElement('div');
    el.className = 'diff';
    el.innerHTML = `<div class="diff-head"><span class="mono">${esc(rel(filePath, s.cwd))}</span><span class="n-add">+${n.add}</span><span class="n-del">−${n.del}</span>${final ? '' : '<span class="dim">pending</span>'}
      ${long ? '<button data-act="grow">expand</button>' : ''}<button data-act="open" title="Open in a terminal">open</button><button data-act="copy">copy</button></div>
      <div class="diff-body ${long ? 'clip' : ''}">${rows}</div>`;
    el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'copy') copy(adds.join('\n'), 'Copied the new lines');
      if (b.dataset.act === 'open') Terms.openFile(this.id, filePath);
      if (b.dataset.act === 'grow') { const body = $('.diff-body', el); body.classList.toggle('clip'); b.textContent = body.classList.contains('clip') ? 'expand' : 'collapse'; }
    };
    // Keep the diff right under the tool row, above any "you allowed this" note.
    const anchor = parent.querySelector('.tool-detail') || parent.querySelector('.tool-row');
    if (anchor) anchor.after(el); else parent.appendChild(el);
    return el;
  }

  // ---- tail: activity + permission prompts

  renderActivity() {
    const s = this.s;
    if (!s) return;
    let el = $('.activity', this.$tail);
    if (s.status !== 'working') { el?.remove(); return; }
    if (!el) { this.$tail.insertAdjacentHTML('afterbegin', `<div class="activity"><span class="dots"><i></i><i></i><i></i></span><span></span></div>`); el = $('.activity', this.$tail); }
    el.lastElementChild.textContent = this.activity || 'Working';
    if (typeof refreshAgos === 'function') refreshAgos();
  }

  renderTail() {
    const s = this.s;
    if (!s) return;
    const stick = this.nearBottom();
    if (s.status !== 'working') this.activity = null;
    this.renderActivity();
    const pending = s.pending || [];
    const key = pending.map((p) => p.requestId).join(',');
    if (key !== this.pendingKey) {
      this.pendingKey = key;
      $$('.ask', this.$tail).forEach((x) => x.remove());
      for (const p of pending) this.$tail.appendChild(this.askCard(p));
      if (stick) this.scrollToEnd(true);
    }
    this.el.classList.toggle('urgent', s.status === 'needs_you');
  }

  askCard(p) {
    const s = this.s;
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
        const lines = String(i.content || '').split('\n');
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

    const picks = this.askState.get(p.requestId) || {};
    this.askState.set(p.requestId, picks);
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
      if (b.dataset.a === 'deny') return answer({ allow: false, message: note || undefined });
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

  // ---- composer

  wireComposer() {
    const ta = this.$ta, pop = this.$pop, btn = this.$btn;
    let popItems = [], popSel = 0, popTrigger = null;

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
      this.renderComposerState();
    };

    const updatePop = async () => {
      const upto = ta.value.slice(0, ta.selectionStart);
      const slash = upto.match(/^\/([\w:-]*)$/);
      const at = upto.match(/(^|\s)@([^\s@]*)$/);
      if (slash) {
        const s = this.s;
        const cmds = s.commands && s.commands.length ? s.commands : [{ name: 'compact', description: 'Summarise to free up context' }, { name: 'clear', description: 'Start the context over' }, { name: 'review', description: 'Review changes' }];
        const qq = slash[1].toLowerCase();
        popItems = cmds.filter((c) => c.name.toLowerCase().includes(qq)).sort((a, b) => a.name.toLowerCase().indexOf(qq) - b.name.toLowerCase().indexOf(qq)).slice(0, 30)
          .map((c) => ({ label: '/' + c.name, sub: c.description, insert: '/' + c.name + ' ' }));
        popTrigger = { start: 0 };
        popSel = 0;
        showPop();
      } else if (at) {
        if (!this.files) {
          this.files = [];
          try { this.files = (await api('GET', `/sessions/${this.id}/files`)).files; } catch {}
        }
        const qq = at[2].toLowerCase();
        const scored = [];
        for (const f of this.files) {
          const lf = f.toLowerCase();
          if (!lf.includes(qq)) continue;
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

    ta.addEventListener('input', () => { autosize(); updatePop(); this.renderComposerState(); });
    ta.addEventListener('click', updatePop);
    ta.addEventListener('blur', () => setTimeout(closePop, 150));
    ta.addEventListener('keydown', (e) => {
      if (!pop.hidden && popItems.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); popSel = (popSel + 1) % popItems.length; return showPop(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); popSel = (popSel - 1 + popItems.length) % popItems.length; return showPop(); }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pick(popSel); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closePop(); }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    pop.addEventListener('mousedown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); pick(+b.dataset.k); } });
    btn.onclick = () => {
      const s = this.s;
      const busy = s && (s.status === 'working' || s.status === 'needs_you');
      if (busy && !ta.value.trim()) return stop();
      send();
    };

    const send = async () => {
      const text = ta.value.trim();
      if (!text) return;
      ta.value = '';
      autosize();
      closePop();
      this.renderComposerState();
      try { await api('POST', `/sessions/${this.id}/send`, { text }); this.scrollToEnd(true); }
      catch (err) { toast(err.message); ta.value = text; autosize(); this.renderComposerState(); }
    };
    const stop = async () => {
      try { await api('POST', `/sessions/${this.id}/stop`); } catch (err) { toast(err.message); }
    };
  }

  renderComposerState() {
    const s = this.s;
    if (!s) return;
    const busy = s.status === 'working' || s.status === 'needs_you';
    const hasText = !!this.$ta.value.trim();
    if (busy && !hasText) { this.$btn.className = 'btn stop send-btn'; this.$btn.textContent = 'Stop'; this.$btn.disabled = false; }
    else { this.$btn.className = 'btn primary send-btn'; this.$btn.textContent = busy ? 'Queue' : 'Send'; this.$btn.disabled = !hasText; }
    this.$ta.placeholder = busy ? 'Claude is on it. Type to queue a follow-up…' : 'What are we making?';
  }
}

// ------------------------------------------------------------------ menus (shared)

let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

function openMenu(anchor, key, items, onPick) {
  if (menuEl && menuEl.dataset.key === key) return closeMenu();
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.dataset.key = key;
  menuEl.innerHTML = items.map((it) => `<button data-id="${esc(it.id)}" class="${it.sel ? 'sel' : ''}"><span class="tick">${it.sel ? '✓' : ''}</span><span><div class="m-main">${esc(it.main)}</div>${it.sub ? `<div class="m-sub">${esc(it.sub)}</div>` : ''}</span></button>`).join('');
  document.body.appendChild(menuEl);
  const a = anchor.getBoundingClientRect();
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  let top = a.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
  menuEl.style.top = top + 'px';
  menuEl.style.left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) + 'px';
  menuEl.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeMenu();
    onPick(b.dataset.id);
  };
}

function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg || 'Copied'), () => toast("Couldn't copy"));
}

// ------------------------------------------------------------------ the info cards (tray)

let trayQueued = false;
function renderTraySoon() {
  if (trayQueued) return;
  trayQueued = true;
  requestAnimationFrame(() => { trayQueued = false; renderTray(); });
}

function trayCards(p) {
  const s = p.s;
  const m = p.m;
  const todos = m.tasks.size ? [...m.tasks.values()] : m.todos;
  const done = todos.filter((t) => t.status === 'completed').length;
  const smallCheck = ICON.check.replace('width="14" height="14"', 'width="10" height="10"');
  const todoHtml = todos.length
    ? `<ul class="todo">${todos.map((t) => `<li class="${t.status}"><span class="box">${t.status === 'completed' ? smallCheck : ''}</span><span>${esc(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content)}</span></li>`).join('')}</ul>`
    : `<div class="card-empty">Claude's plan shows up here when it makes one.</div>`;

  const files = [...m.files.entries()];
  let fa = 0, fd = 0;
  for (const [, f] of files) { fa += f.add; fd += f.del; }
  const filesHtml = files.length
    ? `<ul class="files">${files.map(([fp, f]) => {
        const r = rel(fp, s.cwd);
        const dir = r.includes('/') ? r.slice(0, r.lastIndexOf('/') + 1) : '';
        return `<li><button class="fn" data-diff="${esc(r)}" data-sid="${p.id}" title="${esc(r)}"><small>${esc(dir)}</small>${esc(baseName(r))}</button><span class="n-add">+${f.add}</span><span class="n-del">−${f.del}</span><button class="row-act" data-openfile="${esc(fp)}" data-sid="${p.id}" title="Open in a terminal">${ICON.term}</button></li>`;
      }).join('')}</ul>`
    : `<div class="card-empty">No files changed yet.</div>`;

  const pct = p.ctxPct();
  const cached = m.ctx ? m.ctx.cached : 0, fresh = m.ctx ? m.ctx.fresh : 0;
  const free = Math.max(0, m.window - cached - fresh);
  const w = (n) => (n / m.window) * 100 + '%';

  return `
    <section class="card">
      <div class="card-head"><h3>To do</h3><span class="count">${todos.length ? `${done} of ${todos.length}` : ''}</span></div>
      ${todoHtml}
    </section>
    ${Changes.card(p)}
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
        <dt>Model</dt><dd>${esc(shortModel(m.modelName || s.modelName) || s.model)}</dd>
        <dt>Effort</dt><dd>${esc(s.effort || 'default')}</dd>
        <dt>Session</dt><dd title="${esc(s.sessionId)}">${esc(s.sessionId.slice(0, 8))}</dd>
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
