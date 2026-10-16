// App spine: holds the farm state, listens to the server's SSE stream and
// renders the crew list, live feed and finished work next to the world canvas.
'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let clockOffset = 0; // server time - local time
  let selected = null;
  let tab = 'feed';
  const now = () => Date.now() + clockOffset;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const art = await Sprites.load();
  $('credit').innerHTML = art.placeholder
    ? 'Placeholder art. Plug in an art pack with <code>npm run art -- &lt;pack folder&gt;</code>. Built for <a href="https://trevor-pupkin.itch.io/tech-dungeon-roguelite" target="_blank" rel="noopener">Tech Dungeon Roguelite</a> by Trevor Pupkin.'
    : 'Art: <a href="' + esc(art.url) + '" target="_blank" rel="noopener">' + esc(art.credit || art.name) + '</a> (not included in this repo)';

  World.init({ art, canvas: $('world'), getState: () => state, now, onSelect: select });

  function select(id) {
    selected = id && id !== selected ? id : null;
    World.setSelected(selected);
    renderCrew();
    renderLists();
  }

  // ---- stream ------------------------------------------------------------------
  function connect() {
    const es = new EventSource('/api/stream');
    es.addEventListener('snapshot', (m) => {
      state = JSON.parse(m.data);
      clockOffset = state.serverTime - Date.now();
      setConn('live', 'live');
      renderAll();
    });
    es.addEventListener('event', (m) => {
      if (!state) return;
      const ev = JSON.parse(m.data);
      AcresReducer.apply(state, ev);
      World.onEvent(ev, state.agents[ev.agent]);
      renderAll();
    });
    es.onerror = () => setConn('down', 'reconnecting…');
  }
  function setConn(cls, text) { const c = $('conn'); c.className = 'conn ' + cls; c.textContent = text; }

  $('demoBtn').addEventListener('click', async () => {
    await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !(state && state.demo) }) });
  });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    $('feed').hidden = tab !== 'feed';
    $('done').hidden = tab !== 'done';
  }));

  // ---- rendering ---------------------------------------------------------------
  function renderAll() {
    renderHeader();
    renderCrew();
    renderLists();
  }

  function renderHeader() {
    const agents = state.order.map((id) => state.agents[id]);
    const working = agents.filter((a) => a.status === 'working').length;
    const errors = agents.filter((a) => a.status === 'error').length;
    const doneToday = state.done.filter((d) => d.ts >= startOfDay()).length;
    $('stats').innerHTML = '<span><b>' + working + '</b> / ' + agents.length + ' working</span>' +
      '<span><b>' + doneToday + '</b> done today</span>' +
      (errors ? '<span style="color:var(--err)"><b>' + errors + '</b> need attention</span>' : '');
    const btn = $('demoBtn');
    btn.textContent = 'Demo: ' + (state.demo ? 'on' : 'off');
    btn.classList.toggle('on', !!state.demo);
    const banner = $('banner');
    banner.hidden = !state.demo;
    banner.textContent = 'DEMO MODE: simulated work, nothing here is real';
  }

  function startOfDay() { const d = new Date(now()); d.setHours(0, 0, 0, 0); return d.getTime(); }

  function renderCrew() {
    $('crewCount').textContent = state.order.length;
    // HQ first, then one group per project chamber
    const proj = (a) => (a.role === 'boss' ? 'HQ' : a.project || a.business || 'Other');
    const groups = [];
    for (const id of state.order) {
      const p = proj(state.agents[id]);
      let g = groups.find((x) => x.name === p);
      if (!g) groups.push(g = { name: p, ids: [] });
      g.ids.push(id);
    }
    groups.sort((x, y) => (y.name === 'HQ') - (x.name === 'HQ'));
    $('crew').innerHTML = groups.map((g) => '<li class="group">' + esc(g.name === 'HQ' ? '★ HQ' : g.name) + '</li>' + g.ids.map((id) => {
      const a = state.agents[id];
      const timerStart = a.status === 'working' && a.task ? a.task.startedAt : a.since;
      const task = a.status === 'working' && a.task
        ? '<div class="task" title="' + esc(a.task.title) + '">' + esc(a.task.title) + (a.lastNote ? ' <span class="timer">· ' + esc(a.lastNote) + '</span>' : '') + '</div>'
        : '<div class="task idle">' + esc(a.status === 'error' ? 'Error: ' + a.lastNote : (a.lastNote || 'Waiting for work')) + '</div>';
      const pct = a.task && a.task.pct != null ? '<div class="bar"><i style="width:' + a.task.pct + '%"></i></div>' : '';
      return '<li data-id="' + esc(id) + '" class="' + (id === selected ? 'sel' : '') + '">' +
        '<span class="sw" style="background:' + esc(a.color || '#6b7899') + '"></span>' +
        '<div><span class="name">' + esc(a.name) + '</span> <span class="pill ' + a.status + '">' + a.status.toUpperCase() + '</span><div class="biz">' + esc(a.business) + (a.model ? ' <span class="model">' + esc(a.model) + '</span>' : '') + '</div></div>' +
        '<div class="meta"><div class="timer" data-since="' + timerStart + '">' + World.fmtDur(now() - timerStart) + '</div><div class="biz">' + a.doneCount + ' done</div></div>' +
        task + pct + '</li>';
    }).join('')).join('');
    $('crew').querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => select(li.dataset.id)));
  }

  function renderLists() {
    const name = (id) => (state.agents[id] ? state.agents[id].name : id);
    const color = (id) => (state.agents[id] && state.agents[id].color) || '#9fb0d0';
    const keep = (x) => !selected || x.agent === selected;
    const feed = state.feed.filter(keep).slice(-120).reverse();
    $('feed').innerHTML = feed.length ? feed.map((f) =>
      '<li class="kind-' + f.kind + '"><span class="when">' + clock(f.ts) + '</span><span><span class="who" style="color:' + esc(color(f.agent)) + '">' + esc(name(f.agent)) + '</span> ' +
      '<span class="what">' + esc(f.text) + '</span>' + (f.demo ? '<span class="demo-tag">DEMO</span>' : '') + '</span></li>').join('')
      : '<li class="empty">No activity yet. Turn on Demo, or have an agent POST to /api/events.</li>';
    const done = state.done.filter(keep).slice().reverse();
    $('doneCount').textContent = state.done.length ? '(' + state.done.length + ')' : '';
    $('done').innerHTML = done.length ? done.map((d) =>
      '<li class="kind-done"><span class="when">' + clock(d.ts) + '</span><span><span class="who" style="color:' + esc(color(d.agent)) + '">' + esc(name(d.agent)) + '</span> ' +
      '<span class="what">' + esc(d.title) + '</span>' + (d.value ? '<span class="value">' + esc(d.value) + '</span>' : '') +
      (d.demo ? '<span class="demo-tag">DEMO</span>' : '') +
      '<br><span class="timer">' + World.fmtDur(d.ms) + '</span> ' + esc(d.result) +
      (d.url && /^https?:\/\//.test(d.url) ? ' <a href="' + esc(d.url) + '" target="_blank" rel="noopener">open</a>' : '') + '</span></li>').join('')
      : '<li class="empty">Finished work shows up here.</li>';
  }

  function clock(ts) { return new Date(ts - clockOffset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  // live timers without re-rendering the whole crew list
  setInterval(() => {
    document.querySelectorAll('.crew .timer[data-since]').forEach((el) => { el.textContent = World.fmtDur(now() - Number(el.dataset.since)); });
  }, 1000);

  connect();
})();
