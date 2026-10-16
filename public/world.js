// The farm floor: one walled chamber per project arranged around a middle
// chamber where the boss agent sits. Inside a project chamber every agent gets
// a pod (desk, rug, name plate, wall screen); characters walk between their
// desk and an idle spot as their status changes.
'use strict';

const World = (() => {
  const T = 32;          // tile size in world pixels
  const POD_W = 4, POD_H = 3, WALL_H = 2;
  const WALK_SPEED = 70; // world px per second
  const HQ = 'HQ';
  // Chamber slots in a 3-wide grid, filled around the middle (1,1) which is the boss's.
  const RING = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [1, 2], [0, 2], [2, 2]];

  let art = null;
  let canvas, ctx;
  let layout = null;
  const ents = new Map(); // agent id -> entity
  const effects = [];
  const tinted = new Map();
  let hoverId = null;
  let selectedId = null;
  let onSelect = () => {};
  let getState = () => null;
  let now = () => Date.now();

  function init(opts) {
    art = opts.art;
    canvas = opts.canvas;
    ctx = canvas.getContext('2d');
    onSelect = opts.onSelect || onSelect;
    getState = opts.getState;
    now = opts.now || now;
    canvas.addEventListener('mousemove', (e) => { hoverId = hit(e); canvas.style.cursor = hoverId ? 'pointer' : 'default'; });
    canvas.addEventListener('mouseleave', () => { hoverId = null; });
    canvas.addEventListener('click', (e) => { const id = hit(e); onSelect(id); });
    requestAnimationFrame(frame);
  }

  function setSelected(id) { selectedId = id; }

  const isBoss = (a) => a.role === 'boss';
  const projectOf = (a) => (isBoss(a) ? HQ : a.project || a.business || 'Other');

  // ---- layout ---------------------------------------------------------------
  function buildLayout(state) {
    const groups = new Map();
    const bosses = [];
    for (const id of state.order) {
      const a = state.agents[id];
      if (isBoss(a)) { bosses.push(id); continue; }
      const p = projectOf(a);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(id);
    }
    const maxN = Math.max(1, ...[...groups.values()].map((g) => g.length));
    const podCols = Math.min(2, maxN);
    const podRows = Math.ceil(maxN / podCols);
    const CW = Math.max(8, 2 + podCols * POD_W);
    const CH = WALL_H + podRows * POD_H + 1;

    const projects = [...groups.keys()];
    const slots = RING.slice();
    for (let r = 3; slots.length < projects.length; r++) for (let c = 0; c < 3; c++) slots.push([c, r]);
    const gridRows = Math.max(3, ...slots.slice(0, projects.length).map((s) => s[1] + 1));

    const chambers = [];
    const pods = {};
    const origin = (c, r) => ({ x0: 1 + c * (CW + 1), y0: 1 + r * (CH + 1) });

    const hq = Object.assign({ name: 'HQ', boss: true, agents: bosses }, origin(1, 1));
    chambers.push(hq);
    bosses.forEach((id, i) => {
      const cx = (hq.x0 + CW / 2) * T + (i - (bosses.length - 1) / 2) * 76;
      const feet = (hq.y0 + WALL_H) * T + 74;
      pods[id] = { boss: true, chamber: hq, work: { x: cx, y: feet }, idle: { x: cx, y: feet }, plate: { x: cx, y: feet + 3 }, gapY: feet };
    });

    projects.forEach((name, pi) => {
      const [c, r] = slots[pi];
      const ch = Object.assign({ name, boss: false, agents: groups.get(name) }, origin(c, r));
      chambers.push(ch);
      const ids = groups.get(name);
      ids.forEach((id, k) => {
        const row = Math.floor(k / podCols), col = k % podCols;
        const inRow = Math.min(podCols, ids.length - row * podCols);
        const px0 = ch.x0 + 1 + (CW - 2 - inRow * POD_W) / 2 + col * POD_W + 0.5;
        const py0 = ch.y0 + WALL_H + row * POD_H;
        const desk = { x: Math.round((px0 + 0.75) * T), y: Math.round((py0 + 0.45) * T) };
        pods[id] = {
          chamber: ch, px0, py0, desk,
          work: { x: desk.x + T + 10, y: desk.y + 30 },
          idle: { x: Math.round(px0 * T + 10), y: desk.y + 38 },
          plate: { x: Math.round((px0 + 1.5) * T), y: (py0 + 2) * T + 3 },
          screen: { x: Math.round((px0 + 1.5) * T - 32), y: ch.y0 * T + 20 },
          gapY: (py0 + 2) * T + 26,
        };
      });
    });

    const wT = 1 + 3 * (CW + 1);
    const hT = 1 + gridRows * (CH + 1);
    const key = state.order.map((id) => id + ':' + projectOf(state.agents[id])).join('|');
    return { key, CW, CH, wT, hT, w: wT * T, h: hT * T, chambers, pods };
  }

  function targetFor(a) {
    const pod = layout.pods[a.id];
    if (a.status === 'idle') return Object.assign({ kind: 'idle' }, pod.idle);
    return Object.assign({ kind: 'desk' }, pod.work);
  }

  function sync(state) {
    const key = state.order.map((id) => id + ':' + projectOf(state.agents[id])).join('|');
    if (!layout || layout.key !== key) {
      layout = buildLayout(state);
      ents.clear(); // chambers moved: respawn everyone at their spot
    }
    for (const id of state.order) {
      const a = state.agents[id];
      const tgt = targetFor(a);
      let e = ents.get(id);
      if (!e) {
        e = { id, x: tgt.x, y: tgt.y, path: [], facing: tgt.kind === 'desk' ? -1 : 1, at: tgt.kind, t: Math.random() * 10, bubble: null };
        ents.set(id, e);
      }
      const last = e.path.length ? e.path[e.path.length - 1] : { x: e.x, y: e.y };
      if (Math.abs(last.x - tgt.x) > 1 || Math.abs(last.y - tgt.y) > 1) {
        const gy = layout.pods[id].gapY;
        e.path = [{ x: e.x, y: gy }, { x: tgt.x, y: gy }, { x: tgt.x, y: tgt.y }];
        e.at = null;
        e.goal = tgt.kind;
      }
    }
  }

  // ---- events -> effects ------------------------------------------------------
  function onEvent(ev) {
    const e = ents.get(ev.agent);
    if (!e) return;
    if (ev.type === 'task.progress' && ev.note) e.bubble = { text: ev.note, until: performance.now() + 4500 };
    if (ev.type === 'task.start') e.bubble = { text: ev.title, until: performance.now() + 4000 };
    if (ev.type === 'task.done') addEffect(e, ev.value ? '+' + String(ev.value).replace(/^\+/, '') : 'done!', '#7ee08a');
    if (ev.type === 'task.fail') addEffect(e, 'failed', '#ff6b6b');
  }

  function addEffect(e, text, color) {
    const p = layout && layout.pods[e.id];
    effects.push({ x: e.x, y: e.y - (p && p.boss ? 68 : 34), text, color, t0: performance.now(), dur: 2200 });
  }

  // ---- render ----------------------------------------------------------------
  let lastT = performance.now();
  let view = { zoom: 1, ox: 0, oy: 0 };

  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    const state = getState();
    if (state && art) {
      sync(state);
      step(dt);
      draw(t / 1000, state);
    }
    requestAnimationFrame(frame);
  }

  function step(dt) {
    for (const e of ents.values()) {
      e.t += dt;
      if (!e.path.length) continue;
      const p = e.path[0];
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      const move = WALK_SPEED * dt;
      if (Math.abs(dx) > 0.5) e.facing = dx < 0 ? -1 : 1;
      if (d <= move) { e.x = p.x; e.y = p.y; e.path.shift(); if (!e.path.length) { e.at = e.goal; e.facing = e.at === 'desk' ? -1 : 1; } }
      else { e.x += (dx / d) * move; e.y += (dy / d) * move; }
    }
  }

  function frameOf(spr, time, offset) {
    if (!spr.fps || spr.frames.length < 2) return spr.frames[0];
    return spr.frames[Math.floor((time + (offset || 0)) * spr.fps) % spr.frames.length];
  }

  function blit(spr, time, x, y, opts) {
    const f = frameOf(spr, time, opts && opts.offset);
    if (opts && opts.flip) {
      ctx.save();
      ctx.translate(x + f.w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(spr.img, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
      ctx.restore();
    } else {
      ctx.drawImage(spr.img, f.sx, f.sy, f.w, f.h, x, y, f.w, f.h);
    }
  }

  function lookFor(a, index) {
    const looks = art.looks;
    const li = Number.isInteger(a.look) ? a.look : index;
    const base = looks[((li % looks.length) + looks.length) % looks.length];
    if (li < looks.length) return base;
    const key = li + ':' + (a.color || '');
    if (!tinted.has(key)) tinted.set(key, Sprites.tintLook(base, a.color || ['#ff8a65', '#ba68c8', '#4dd0e1', '#fff176'][li % 4]));
    return tinted.get(key);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(200, Math.floor(r.width)), h = Math.max(200, Math.floor(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    let zoom = Math.min(w / layout.w, h / layout.h);
    zoom = zoom >= 1 ? Math.floor(zoom * 4) / 4 : zoom;
    view = { zoom, ox: Math.floor((w - layout.w * zoom) / 2), oy: Math.floor((h - layout.h * zoom) / 2), dpr, w, h };
  }

  function draw(time, state) {
    resize();
    const { zoom, ox, oy, dpr } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f1220';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, ox * dpr, oy * dpr);
    ctx.imageSmoothingEnabled = false;
    const R = art.roles;
    const { CW, CH } = layout;

    // corridor floor everywhere
    for (let ty = 0; ty < layout.hT; ty++) {
      for (let tx = 0; tx < layout.wT; tx++) {
        blit((tx * 7 + ty * 13) % 23 === 0 ? R.floorVent : R.floor, time, tx * T, ty * T);
      }
    }
    ctx.fillStyle = 'rgba(8,10,20,.45)';
    ctx.fillRect(0, 0, layout.w, layout.h);

    for (const ch of layout.chambers) drawChamber(ch, time, state);

    // desks and characters, back to front
    const drawables = [];
    for (const id of state.order) {
      const a = state.agents[id], p = layout.pods[id];
      if (!p) continue;
      if (!p.boss) drawables.push({ y: p.desk.y + T - 1, draw: () => blit(a.status === 'working' ? R.deskWork : R.deskIdle, time, p.desk.x, p.desk.y, { offset: (p.px0 % 7) * 0.21 }) });
      const e = ents.get(id);
      if (e) drawables.push({ y: e.y, draw: () => character(a, e, state.order.indexOf(id), time) });
    }
    drawables.sort((a, b) => a.y - b.y).forEach((d) => d.draw());

    for (const id of state.order) {
      const e = ents.get(id);
      if (e) overhead(state.agents[id], e);
    }
    drawEffects();
  }

  function drawChamber(ch, time, state) {
    const { CW, CH } = layout;
    const R = art.roles;
    const x = ch.x0 * T, y = ch.y0 * T, w = CW * T, h = CH * T;
    // inner floor
    for (let ty = ch.y0 + WALL_H; ty < ch.y0 + CH - 1; ty++) for (let tx = ch.x0 + 1; tx < ch.x0 + CW - 1; tx++) blit(R.floor, time, tx * T, ty * T);
    // walls: top band, sides, bottom with a doorway
    for (let ty = ch.y0; ty < ch.y0 + WALL_H; ty++) for (let tx = ch.x0; tx < ch.x0 + CW; tx++) blit(R.wall, time, tx * T, ty * T);
    for (let tx = ch.x0; tx < ch.x0 + CW; tx++) blit(R.wallTrim, time, tx * T, (ch.y0 + WALL_H - 1) * T + 8);
    const door = Math.floor(ch.x0 + CW / 2) - 1;
    for (let ty = ch.y0 + WALL_H; ty < ch.y0 + CH; ty++) {
      blit(R.wall, time, x, ty * T);
      blit(R.wall, time, x + w - T, ty * T);
    }
    for (let tx = ch.x0 + 1; tx < ch.x0 + CW - 1; tx++) if (tx !== door && tx !== door + 1) blit(R.wall, time, tx * T, y + h - T);

    const anyWorking = ch.agents.some((id) => state.agents[id] && state.agents[id].status === 'working');
    if (ch.boss) {
      // HQ: big screens either side of the boss, tanks in the corners
      blit(anyWorking ? R.screenWork : R.screenIdle, time, x + T * 1.2, y + 20);
      blit(anyWorking ? R.screenWork : R.screenIdle, time + 0.4, x + w - T * 1.2 - 64, y + 20);
      blit(R.tank, time, x + T + 2, y + WALL_H * T - 4);
      blit(R.tank, time + 0.5, x + w - 2 * T - 2, y + WALL_H * T - 4);
      blit(R.console, time, x + T + 4, y + h - 2 * T - 2);
      blit(R.console, time + 0.3, x + w - 2 * T - 4, y + h - 2 * T - 2);
    } else {
      for (const id of ch.agents) {
        const p = layout.pods[id], a = state.agents[id];
        for (let ry = 0; ry < POD_H - 1; ry++) for (let rx = 0; rx < POD_W - 1; rx++) blit(R.floorAccent, time, (p.px0 + rx) * T, (p.py0 + ry) * T);
        blit(a.status === 'working' ? R.screenWork : R.screenIdle, time, p.screen.x, p.screen.y, { offset: (p.px0 % 5) * 0.37 });
      }
      if (ch.agents.length === 1) blit(R.crate, time, x + w - 2 * T + 2, y + h - 2 * T - 4);
    }
    // chamber sign
    ctx.font = '700 7px system-ui, sans-serif';
    ctx.textAlign = 'center';
    label(ch.boss ? '★ HQ' : ch.name.toUpperCase(), x + w / 2, y + 9, ch.boss ? '#f5c542' : '#c9d4ee', 'rgba(15,18,32,.85)');
    // name plates
    for (const id of ch.agents) plate(state.agents[id], layout.pods[id].plate.x, layout.pods[id].plate.y, id === selectedId || id === hoverId);
  }

  function character(a, e, index, time) {
    const p = layout.pods[a.id];
    const look = p.boss ? art.boss : lookFor(a, index);
    const size = p.boss ? 64 : 32;
    const walking = e.path.length > 0;
    const spr = walking ? look.walk : (a.status === 'working' && e.at === 'desk') ? look.work : look.idle;
    const sel = a.id === selectedId || a.id === hoverId;
    const rx = p.boss ? 20 : 8;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y - 1, rx, rx * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    if (sel) {
      ctx.strokeStyle = a.color || '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(e.x, e.y - 1, rx + 3, rx * 0.38 + 1.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const bob = !walking && spr.frames.length < 2 ? Math.round(Math.sin(e.t * 2.4) * 0.6) : 0;
    blit(spr, e.t, Math.round(e.x - size / 2), Math.round(e.y - size + 1 + bob), { flip: !p.boss && e.facing < 0 });
  }

  function overhead(a, e) {
    const p = layout.pods[a.id];
    const x = Math.round(e.x), y = Math.round(e.y - (p.boss ? 66 : 34));
    ctx.font = '600 6px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    let text, color;
    if (a.status === 'working') { text = '▶ ' + fmtDur(now() - (a.task ? a.task.startedAt : a.since)); color = '#7ee08a'; }
    else if (a.status === 'error') { text = '! error'; color = '#ff6b6b'; }
    else { text = 'zz ' + fmtDur(now() - a.since); color = '#9fb0d0'; }
    label(text, x, y, color, 'rgba(15,18,32,.8)');
    if (e.bubble && performance.now() < e.bubble.until) {
      const t = e.bubble.text.length > 34 ? e.bubble.text.slice(0, 33) + '…' : e.bubble.text;
      ctx.font = '500 6px system-ui, sans-serif';
      const w = ctx.measureText(t).width + 8;
      const bx = Math.round(Math.max(4, Math.min(layout.w - w - 4, x - w / 2))), by = y - 18;
      ctx.fillStyle = '#f4f6fb';
      roundRect(bx, by, w, 10, 3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 2, by + 10); ctx.lineTo(x + 2, by + 10); ctx.lineTo(x, by + 13); ctx.fill();
      ctx.fillStyle = '#1b1f33';
      ctx.textAlign = 'left';
      ctx.fillText(t, bx + 4, by + 7.3);
      ctx.textAlign = 'center';
    }
  }

  function plate(a, x, y, highlight) {
    const sub = a.model ? a.model : a.business;
    ctx.font = '500 5px system-ui, sans-serif';
    const biz = sub.length > 30 ? sub.slice(0, 29) + '…' : sub;
    const w = Math.max(48, ctx.measureText(biz).width + 10);
    const bx = Math.round(x - w / 2);
    ctx.fillStyle = highlight ? 'rgba(40,46,78,.95)' : 'rgba(20,24,42,.88)';
    roundRect(bx, y, w, 18, 3); ctx.fill();
    ctx.fillStyle = a.color || '#9fb0d0';
    ctx.fillRect(bx, y + 2, 2, 14);
    ctx.fillStyle = a.status === 'working' ? '#7ee08a' : a.status === 'error' ? '#ff6b6b' : '#6b7899';
    ctx.beginPath(); ctx.arc(bx + w - 5, y + 5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4f6fb';
    ctx.font = '700 7px system-ui, sans-serif';
    ctx.fillText(a.name, x, y + 8);
    ctx.fillStyle = a.model ? '#f5c542' : '#9fb0d0';
    ctx.font = '500 5px system-ui, sans-serif';
    ctx.fillText(biz, x, y + 15);
  }

  function label(text, x, y, color, bg) {
    const w = ctx.measureText(text).width + 6;
    ctx.fillStyle = bg;
    roundRect(Math.round(x - w / 2), y - 6, w, 8.5, 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 0.5);
  }

  function drawEffects() {
    const t = performance.now();
    ctx.font = '700 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i];
      const k = (t - f.t0) / f.dur;
      if (k >= 1) { effects.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = '#0f1220';
      ctx.fillText(f.text, f.x + 0.6, f.y - k * 18 + 0.6);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - k * 18);
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hit(ev) {
    if (!layout) return null;
    const r = canvas.getBoundingClientRect();
    const wx = (ev.clientX - r.left - view.ox) / view.zoom;
    const wy = (ev.clientY - r.top - view.oy) / view.zoom;
    for (const e of ents.values()) {
      const big = layout.pods[e.id] && layout.pods[e.id].boss;
      if (Math.abs(wx - e.x) < (big ? 26 : 10) && wy > e.y - (big ? 62 : 30) && wy < e.y + 2) return e.id;
    }
    for (const [id, p] of Object.entries(layout.pods)) {
      if (p.boss) continue;
      if (wx >= p.px0 * T && wx < (p.px0 + POD_W - 1) * T && wy >= p.py0 * T && wy < (p.py0 + POD_H - 0.4) * T) return id;
    }
    return null;
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(ss) : p(m) + ':' + p(ss);
  }

  return { init, onEvent, setSelected, fmtDur };
})();
