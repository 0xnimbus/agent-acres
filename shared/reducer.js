// Shared state reducer: turns a stream of agent events into the farm's state.
// Loaded by the Node server (require) and by the browser (<script>), so it must
// stay dependency-free and ES2017-only.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AcresReducer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EVENT_TYPES = [
    'agent.hello',    // register or update an agent: { agent, name?, business?, project?, model?, role?, look?, color? }
    'task.start',     // { agent, task?, title, detail? }
    'task.progress',  // { agent, task?, note, pct? }
    'task.done',      // { agent, task?, title?, result?, url?, value? }
    'task.fail',      // { agent, task?, error }
    'agent.idle',     // { agent, note? }
    'note',           // { agent, text }
    'agent.remove',   // take a worker off the station: { agent } (its finished work stays in the history)
  ];

  const FEED_MAX = 200;
  const DONE_MAX = 1000;

  function emptyState() {
    return { agents: {}, order: [], feed: [], done: [], seq: 0 };
  }

  function validate(ev) {
    if (!ev || typeof ev !== 'object') return 'event must be an object';
    if (!EVENT_TYPES.includes(ev.type)) return 'unknown type "' + ev.type + '" (expected one of ' + EVENT_TYPES.join(', ') + ')';
    if (typeof ev.agent !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(ev.agent)) return 'agent must be an id like "ebay-resale" (letters, digits, - or _)';
    if (ev.type === 'task.start' && !str(ev.title)) return 'task.start needs a title';
    return null;
  }

  function str(v) { return typeof v === 'string' && v.trim().length > 0; }
  function clip(v, n) { return typeof v === 'string' ? v.slice(0, n) : undefined; }

  function ensureAgent(state, id, ts) {
    let a = state.agents[id];
    if (!a) {
      a = state.agents[id] = {
        id, name: id, business: '', project: '', model: '', role: '', look: null, color: null,
        status: 'idle', task: null, since: ts, doneCount: 0, failCount: 0,
        workMs: 0, lastNote: '', demo: false,
      };
      state.order.push(id);
    }
    return a;
  }

  function pushFeed(state, ev, text, kind) {
    state.feed.push({ id: ev.id, ts: ev.ts, agent: ev.agent, kind, text, demo: !!ev.demo });
    if (state.feed.length > FEED_MAX) state.feed.splice(0, state.feed.length - FEED_MAX);
  }

  function stopWork(a, ts) {
    if (a.status === 'working' && a.task) a.workMs += Math.max(0, ts - a.task.startedAt);
  }

  function apply(state, ev) {
    if (ev.type === 'agent.remove') {
      if (state.agents[ev.agent]) {
        delete state.agents[ev.agent];
        state.order = state.order.filter((id) => id !== ev.agent);
        state.seq++;
      }
      return state;
    }
    const ts = ev.ts || Date.now();
    const a = ensureAgent(state, ev.agent, ts);
    if (ev.demo) a.demo = true;
    if (ev.type === 'agent.hello' && typeof ev.script === 'string') a.script = clip(ev.script, 40);
    if (ev.type === 'agent.hello' && typeof ev.xp === 'number') a.xp = Math.max(0, Math.round(ev.xp));
    state.seq++;
    switch (ev.type) {
      case 'agent.hello':
        if (str(ev.name)) a.name = clip(ev.name, 40);
        if (str(ev.business)) a.business = clip(ev.business, 80);
        if (ev.look != null) a.look = ev.look;
        if (str(ev.color)) a.color = clip(ev.color, 20);
        if (str(ev.project)) a.project = clip(ev.project, 40);
        if (str(ev.model)) a.model = clip(ev.model, 40);
        if (str(ev.role)) a.role = clip(ev.role, 20);
        break;
      case 'task.start':
        stopWork(a, ts);
        if (str(ev.model)) a.model = clip(ev.model, 40);
        if (str(ev.project)) a.project = clip(ev.project, 40);
        a.status = 'working';
        a.task = { id: ev.task || ev.id, title: clip(ev.title, 140), detail: clip(ev.detail, 400) || '', startedAt: ts, pct: null, demo: !!ev.demo };
        a.since = ts;
        a.lastNote = '';
        pushFeed(state, ev, a.task.title, 'start');
        break;
      case 'task.progress':
        if (a.task) {
          if (typeof ev.pct === 'number') a.task.pct = Math.max(0, Math.min(100, ev.pct));
        }
        a.lastNote = clip(ev.note, 200) || a.lastNote;
        pushFeed(state, ev, a.lastNote || 'progress', 'progress');
        break;
      case 'task.done': {
        const title = clip(ev.title, 140) || (a.task && a.task.title) || 'Task';
        const startedAt = a.task ? a.task.startedAt : ts;
        stopWork(a, ts);
        a.doneCount++;
        state.done.push({
          id: ev.id, ts, agent: a.id, title, result: clip(ev.result, 400) || '',
          url: clip(ev.url, 500) || '', value: clip(ev.value != null ? String(ev.value) : '', 40),
          ms: ts - startedAt, demo: !!ev.demo,
        });
        if (state.done.length > DONE_MAX) state.done.splice(0, state.done.length - DONE_MAX);
        pushFeed(state, ev, title + (ev.result ? ': ' + clip(ev.result, 120) : ''), 'done');
        a.status = 'idle'; a.task = null; a.since = ts; a.lastNote = '';
        break;
      }
      case 'task.fail':
        stopWork(a, ts);
        a.failCount++;
        pushFeed(state, ev, ((a.task && a.task.title) || 'Task') + ' failed: ' + (clip(ev.error, 160) || 'unknown error'), 'fail');
        a.status = 'error'; a.task = null; a.since = ts; a.lastNote = clip(ev.error, 200) || '';
        break;
      case 'agent.idle':
        stopWork(a, ts);
        a.status = 'idle'; a.task = null; a.since = ts; a.lastNote = clip(ev.note, 200) || '';
        if (ev.note) pushFeed(state, ev, a.lastNote, 'idle');
        break;
      case 'note':
        a.lastNote = clip(ev.text, 200) || a.lastNote;
        pushFeed(state, ev, a.lastNote, 'note');
        break;
    }
    return state;
  }

  return { EVENT_TYPES, emptyState, validate, apply };
});
