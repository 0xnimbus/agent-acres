// App spine: holds the station state, listens to the server's SSE stream and
// renders the crew list and the comms panel next to the world canvas.
'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  let state = null;
  let clockOffset = 0; // server time - local time
  let selected = null;
  const opened = new Set(); // finished-work cards expanded with "read the work"
  const now = () => Date.now() + clockOffset;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const art = await Sprites.load();
  $('credit').innerHTML = art.placeholder
    ? 'Placeholder art. Plug in an art pack with <code>npm run art -- &lt;pack folder&gt;</code>. Built for <a href="https://trevor-pupkin.itch.io/tech-dungeon-roguelite" target="_blank" rel="noopener">Tech Dungeon Roguelite</a> by Trevor Pupkin.'
    : 'Art: <a href="' + esc(art.url) + '" target="_blank" rel="noopener">' + esc(art.credit || art.name) + '</a> (not included in this repo)';

  World.init({ art, canvas: $('world'), getState: () => state, now, onSelect: select });

  // ---- camera + TikTok mode ------------------------------------------------------
  // You drive the camera (scroll to zoom, drag to pan). CAM: AUTO turns on the follow camera.
  function setCam(on) {
    World.setAuto(on);
    $('camBtn').textContent = 'CAM: ' + (on ? 'AUTO' : 'FREE');
    $('camBtn').classList.toggle('on', on);
  }
  $('camBtn').addEventListener('click', () => setCam(!World.getAuto()));
  $('world').addEventListener('mousedown', () => setTimeout(() => setCam(World.getAuto()), 0));
  $('world').addEventListener('wheel', () => setTimeout(() => setCam(World.getAuto()), 0));
  setCam(false);

  // money ticker that counts up instead of jumping
  let shownMoney = 0, targetMoney = 0;
  function tickMoney() {
    if (shownMoney !== targetMoney) {
      const d = targetMoney - shownMoney;
      shownMoney = Math.abs(d) < 1 ? targetMoney : shownMoney + d * 0.12;
      $('hudMoney').textContent = '$' + Math.round(shownMoney).toLocaleString();
    }
    requestAnimationFrame(tickMoney);
  }
  requestAnimationFrame(tickMoney);

  function toast(ev) {
    const a = state.agents[ev.agent];
    if (!a) return;
    const money = World.moneyOf(ev.value);
    const el = document.createElement('div');
    el.className = 'toast';
    const title = ev.title || (ev.result || 'Task done');
    el.innerHTML = '<span class="who" style="color:' + esc(a.color || '#9cc7ff') + '">✓ ' + esc(a.name.toUpperCase()) + '</span>' +
      esc(ev.result || title) + (money ? ' <b>+$' + money.toLocaleString() + '</b>' : '');
    const box = $('toasts');
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
    if (money) { const m = $('hudMoney'); m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
  }

  function select(id) {
    selected = id && id !== selected ? id : null;
    World.setSelected(selected);
    renderCrew();
    renderLists();
  }

  // Levels come from finished tasks: each level needs a few more than the last.
  function level(done) {
    let lv = 1, need = 3, left = done;
    while (left >= need) { left -= need; lv++; need = 3 + lv; }
    return { lv, pct: Math.round((left / need) * 100) };
  }

  // ---- stream ------------------------------------------------------------------
  // Two transports: the local Node server streams over SSE; the hosted (Vercel)
  // version has no long-lived process, so the page polls /api/events instead.
  let polling = false;
  function setSnapshot(snap) {
    state = snap;
    clockOffset = state.serverTime - Date.now();
    setConn('ok', 'ONLINE');
    renderAll();
  }
  function applyEvent(ev) {
    if (!state) return;
    AcresReducer.apply(state, ev);
    World.onEvent(ev, state.agents[ev.agent]);
    renderAll();
    if (ev.type === 'task.done') toast(ev);
  }

  async function connect() {
    let first = null;
    try { first = await (await fetch('/api/state', { cache: 'no-store' })).json(); } catch { /* fall back to SSE */ }
    if (first && first.transport === 'poll') { polling = true; setSnapshot(first); poll(); return; }
    stream();
  }

  let cursor = 0;
  async function poll() {
    if (state && state.cursor != null && !cursor) cursor = state.cursor;
    try {
      const r = await fetch('/api/events?after=' + cursor, { cache: 'no-store' });
      if (r.status === 401) { location.href = '/login'; return; }
      const j = await r.json();
      for (const ev of j.events || []) applyEvent(ev);
      cursor = j.cursor;
      setConn('ok', 'ONLINE');
    } catch { setConn('down', 'RECONNECTING'); }
    setTimeout(poll, document.hidden ? 8000 : 2000);
  }

  // Client-side demo for the hosted version: simulated events never leave this browser.
  let sim = null;
  async function setDemoLocal(on) {
    if (on && !sim) {
      sim = AcresDemo.createSimulator((ev) => applyEvent(Object.assign({ id: 'demo-' + Math.random().toString(36).slice(2), ts: now(), demo: true }, ev)));
      AcresDemo.seedToday(state, now()).forEach((ev, i) => AcresReducer.apply(state, Object.assign(ev, { id: 'day-' + i, demo: true })));
      state.demo = true;
      state.commanderLevel = AcresDemo.DEMO_COMMANDER_LEVEL;
      sim.start(state);
      renderAll();
    } else if (!on && sim) {
      sim.stop(); sim = null;
      const snap = await (await fetch('/api/state', { cache: 'no-store' })).json();
      cursor = snap.cursor; setSnapshot(snap);
    }
  }

  function stream() {
    const es = new EventSource('/api/stream');
    es.addEventListener('snapshot', (m) => setSnapshot(JSON.parse(m.data)));
    es.addEventListener('event', (m) => applyEvent(JSON.parse(m.data)));
    es.addEventListener('pool', (m) => {
      if (!state) return;
      state.pool = JSON.parse(m.data);
      portraits.clear();
      renderCrew();
    });
    es.addEventListener('rating', (m) => {
      if (!state) return;
      const r = JSON.parse(m.data);
      if (r.stars) state.ratings[r.id] = r.stars; else delete state.ratings[r.id];
      renderLists();
    });
    es.onerror = () => setConn('down', 'RECONNECTING');
  }
  function setConn(cls, text) { const c = $('conn'); c.className = 'conn ' + cls; c.textContent = text; }

  $('demoBtn').addEventListener('click', async () => {
    if (polling) return setDemoLocal(!(state && state.demo));
    await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !(state && state.demo) }) });
  });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    $('feed').hidden = b.dataset.tab !== 'feed';
    $('done').hidden = b.dataset.tab !== 'done';
  }));
  $('filter').addEventListener('click', () => select(null));

  $('done').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('.read')) { opened.has(id) ? opened.delete(id) : opened.add(id); renderLists(); }
    if (e.target.closest('.rate')) { card.querySelector('.stars').hidden = false; e.target.closest('.rate').hidden = true; }
    const star = e.target.closest('.stars span');
    if (star) {
      const stars = Number(star.dataset.n);
      const cur = state.ratings[id] || 0;
      const next = stars === cur ? 0 : stars;
      fetch('/api/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, stars: next }) })
        .then((r) => { if (r.ok && polling) { if (next) state.ratings[id] = next; else delete state.ratings[id]; renderLists(); } });
    }
  });

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
    $('stats').innerHTML = '<span><b>' + working + '</b>/' + agents.length + ' WORKING</span>' +
      '<span><b>' + doneToday + '</b> DONE TODAY</span>' +
      (errors ? '<span style="color:var(--err)"><b>' + errors + '</b> NEED ATTENTION</span>' : '');
    const total = agents.reduce((n, a) => n + a.doneCount, 0);
    const today = state.done.filter((d) => d.ts >= startOfDay());
    targetMoney = today.reduce((n, d) => n + World.moneyOf(d.value), 0);
    $('hudStats').textContent = today.length + ' JOBS TODAY \u00b7 ' + working + '/' + agents.length + ' WORKING';
    $('commander').innerHTML = '<span class="hex">⬢</span><div><small>COMMANDER</small><b>Lv ' + (state.commanderLevel || level(total).lv) + '</b></div>';
    const btn = $('demoBtn');
    // While the demo runs the button reads CHAT and switches it off.
    btn.textContent = state.demo ? 'CHAT' : 'DEMO';
    const banner = $('banner');
    banner.hidden = true;
    banner.textContent = 'DEMO MODE: SIMULATED WORK';
  }

  function startOfDay() { const d = new Date(now()); d.setHours(0, 0, 0, 0); return d.getTime(); }

  const portraits = new Map();
  function portrait(a, index) {
    const key = a.id + ':' + World.lookOf(a) + ':' + a.role + ':' + a.color;
    if (!portraits.has(key)) portraits.set(key, World.frameCanvas(a, index, 36));
    return portraits.get(key);
  }

  function renderCrew() {
    $('crewCount').textContent = state.order.length;
    World.assignLooks(state);
    const proj = (a) => (a.role === 'boss' ? 'HQ' : a.project || a.business || 'Other');
    const groups = [];
    for (const id of state.order) {
      const p = proj(state.agents[id]);
      let g = groups.find((x) => x.name === p);
      if (!g) groups.push(g = { name: p, ids: [] });
      g.ids.push(id);
    }
    groups.sort((x, y) => (y.name === 'HQ') - (x.name === 'HQ'));
    const list = $('crew');
    list.innerHTML = groups.map((g) => '<li class="group">' + esc(g.name === 'HQ' ? '★ HQ' : g.name.toUpperCase()) + '</li>' + g.ids.map((id) => {
      const a = state.agents[id];
      const lv = level(a.doneCount + (a.xp || 0));
      const timerStart = a.status === 'working' && a.task ? a.task.startedAt : a.since;
      const dj = World.dummyJob(a);
      const task = a.status === 'working' && a.task
        ? '<div class="task" title="' + esc(a.task.title) + '">' + esc(a.task.title) + (a.lastNote ? ' <span class="count">· ' + esc(a.lastNote) + '</span>' : '') + '</div>'
        : a.status === 'idle' && dj
          ? '<div class="task idle" title="Standby job, not real work">○ ' + esc(dj.title) + '</div>'
          : '<div class="task idle">' + esc(a.status === 'error' ? 'Error: ' + a.lastNote : (a.lastNote || a.business || 'Waiting for work')) + '</div>';
      return '<li data-id="' + esc(id) + '" class="agent' + (id === selected ? ' sel' : '') + (World.isReal(a) ? ' real' : '') + '">' +
        '<div class="portrait" data-portrait="' + esc(id) + '"><i style="background:' + esc(a.color || '#6b7899') + '"></i></div>' +
        '<div><span class="name" style="color:' + esc(a.color || '#e6ecff') + '">' + esc(a.name.toUpperCase()) + '</span>' + (a.model ? ' <span class="model">' + esc(a.model) + '</span>' : a.role === 'lead' ? ' <span class="model">★ ROOM BOSS</span>' : '') + '</div>' +
        '<div class="lvl">Lv ' + lv.lv + '</div>' +
        '<div class="st ' + a.status + '">' + (a.status === 'idle' ? 'STANDBY' : World.isReal(a) ? 'LIVE JOB' : a.status.toUpperCase()) + '</div>' +
        '<div class="timer" data-since="' + timerStart + '">' + World.fmtDur(now() - timerStart) + '</div>' +
        '<div class="xp"><i style="width:' + (a.task && a.task.pct != null ? a.task.pct : lv.pct) + '%"></i></div>' +
        task + '</li>';
    }).join('')).join('');
    list.querySelectorAll('[data-portrait]').forEach((el) => {
      const id = el.dataset.portrait;
      const c = portrait(state.agents[id], state.order.indexOf(id));
      if (c) el.prepend(c.cloneNode ? cloneCanvas(c) : c);
    });
    list.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => select(li.dataset.id)));
  }

  function cloneCanvas(c) {
    const n = document.createElement('canvas');
    n.width = c.width; n.height = c.height;
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }

  function renderLists() {
    const name = (id) => (state.agents[id] ? state.agents[id].name : id);
    const color = (id) => (state.agents[id] && state.agents[id].color) || '#9fb0d0';
    const keep = (x) => !selected || x.agent === selected;
    const filter = $('filter');
    filter.hidden = !selected;
    filter.textContent = selected ? name(selected).toUpperCase() + ' ✕' : '';

    const feed = state.feed.filter(keep).slice(-120).reverse();
    $('feed').innerHTML = feed.length ? feed.map((f) =>
      '<li class="kind-' + f.kind + '"><span class="when">' + clock(f.ts) + '</span><span><span class="who" style="color:' + esc(color(f.agent)) + '">' + esc(name(f.agent)) + '</span> ' +
      '<span class="what">' + esc(f.text) + '</span>' + (f.demo ? ' <span class="demo-tag">DEMO</span>' : '') + '</span></li>').join('')
      : '<li class="empty">No activity yet. Turn on Demo, or have an agent POST to /api/events.</li>';

    const done = state.done.filter(keep).slice(-80).reverse();
    $('doneCount').textContent = state.done.length ? state.done.length : '';
    $('done').innerHTML = done.length ? done.map((d) => {
      const stars = state.ratings[d.id] || 0;
      const link = d.url && /^https?:\/\//.test(d.url);
      return '<li class="card" data-id="' + esc(d.id) + '">' +
        '<div class="head"><span class="who" style="color:' + esc(color(d.agent)) + '">' + esc(name(d.agent).toUpperCase()) + '</span>' +
        (d.demo ? '<span class="demo-tag">DEMO</span>' : '') + '<span class="when">' + clock(d.ts) + '</span></div>' +
        '<div class="title">◷ ' + esc(d.title) + '</div>' +
        '<div class="result">' + esc(d.result) + (d.value ? ' <span class="value">' + esc(d.value) + '</span>' : '') + ' · ' + World.fmtDur(d.ms) + '</div>' +
        '<div class="actions">' +
        (link ? '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">↗ read the work</a>' : '<button class="read">↗ read the work</button>') +
        (stars ? '' : '<button class="rate">rate it</button>') +
        '<span class="stars"' + (stars ? '' : ' hidden') + '>' + [1, 2, 3, 4, 5].map((n) => '<span data-n="' + n + '" class="' + (n <= stars ? 'on' : '') + '">★</span>').join('') + '</span>' +
        '</div>' +
        (opened.has(d.id) ? '<div class="detail">' + esc(d.title) + '<br>' + esc(d.result || 'No details reported.') + (link ? '' : '<br><span class="count">No link was reported for this work. Agents can send a url with task.done.</span>') + '</div>' : '') +
        '</li>';
    }).join('') : '<li class="empty">Finished work shows up here.</li>';
  }

  function clock(ts) { return new Date(ts - clockOffset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  // live timers without re-rendering the whole crew list
  setInterval(() => {
    document.querySelectorAll('.crew .timer[data-since]').forEach((el) => { el.textContent = World.fmtDur(now() - Number(el.dataset.since)); });
  }, 1000);

  // ?audit: publish the layout self-check on the page so it can be read from outside
  if (new URLSearchParams(location.search).has('audit')) {
    setInterval(() => { document.body.dataset.audit = JSON.stringify(World.audit()); }, 2000);
  }

  connect();
})();
