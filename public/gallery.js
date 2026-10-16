// Sprite approval page: shows every character look in the art pack animated
// (idle, working, walking) with approve / deny buttons backed by /api/pool.
'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const art = await Sprites.load();
  let state = await (await fetch('/api/state')).json();
  const anims = []; // { canvas, spr }

  function canvasFor(spr, size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    anims.push({ c, spr });
    return c;
  }

  // Which worker currently has each sprite, using the same rule as the station.
  function users() {
    const denied = state.pool.denied;
    const pool = art.looks.filter((l) => !denied.includes(l.key));
    const workers = state.order.filter((id) => state.agents[id].role !== 'boss');
    const out = {};
    const used = new Set();
    const take = (id, i) => { used.add(i); (out[pool[i].key] = out[pool[i].key] || []).push(state.agents[id].name); };
    const rest = [];
    for (const id of workers) {
      const want = state.agents[id].look;
      const i = typeof want === 'string' ? pool.findIndex((x) => x.key === want) : want;
      if (Number.isInteger(i) && i >= 0 && i < pool.length && !used.has(i)) take(id, i); else rest.push(id);
    }
    let next = 0;
    for (const id of rest) {
      while (next < pool.length && used.has(next)) next++;
      if (next < pool.length) take(id, next++);
    }
    return out;
  }

  function render() {
    const denied = new Set(state.pool.denied);
    const who = users();
    $('count').textContent = (art.looks.length - art.looks.filter((l) => denied.has(l.key)).length) + ' / ' + art.looks.length + ' APPROVED';
    anims.length = 0;
    const grid = $('grid');
    grid.innerHTML = '';
    for (const look of art.looks) {
      const isDenied = denied.has(look.key);
      const card = document.createElement('div');
      card.className = 'card ' + (isDenied ? 'denied' : 'approved');
      card.innerHTML = '<h3>' + esc(look.name) + '</h3><div class="who">' +
        (who[look.key] ? 'Used by ' + esc(who[look.key].join(', ')) : isDenied ? 'Denied' : 'Not in use yet') + '</div>';
      const row = document.createElement('div');
      row.className = 'anims';
      for (const [k, label] of [['idle', 'IDLE'], ['work', 'WORKING'], ['walk', 'WALKING']]) {
        const a = document.createElement('div');
        a.className = 'anim';
        a.appendChild(canvasFor(look[k], 32));
        a.insertAdjacentHTML('beforeend', '<span>' + label + '</span>');
        row.appendChild(a);
      }
      card.appendChild(row);
      const acts = document.createElement('div');
      acts.className = 'acts';
      acts.innerHTML = '<button class="yes' + (isDenied ? '' : ' on') + '">✓ APPROVE</button><button class="no' + (isDenied ? ' on' : '') + '">✕ DENY</button>';
      acts.querySelector('.yes').onclick = () => setDenied(look.key, false);
      acts.querySelector('.no').onclick = () => setDenied(look.key, true);
      card.appendChild(acts);
      grid.appendChild(card);
    }
    const boss = $('boss');
    boss.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h3>Boss mech</h3><div class="who">HQ only</div>';
    const row = document.createElement('div');
    row.className = 'anims';
    for (const [k, label] of [['idle', 'IDLE'], ['work', 'WORKING'], ['walk', 'WALKING']]) {
      const a = document.createElement('div');
      a.className = 'anim big';
      a.appendChild(canvasFor(art.boss[k], 64));
      a.insertAdjacentHTML('beforeend', '<span>' + label + '</span>');
      row.appendChild(a);
    }
    card.appendChild(row);
    boss.appendChild(card);
  }

  async function setDenied(key, denied) {
    const r = await fetch('/api/pool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, denied }) });
    const j = await r.json();
    if (j.ok) { state.pool = j.pool; render(); }
  }

  function tick(t) {
    const time = t / 1000;
    for (const { c, spr } of anims) {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, c.width, c.height);
      const f = spr.fps && spr.frames.length > 1 ? spr.frames[Math.floor(time * spr.fps) % spr.frames.length] : spr.frames[0];
      g.drawImage(spr.img, f.sx, f.sy, f.w, f.h, 0, 0, c.width, c.height);
    }
    requestAnimationFrame(tick);
  }

  render();
  requestAnimationFrame(tick);
})();
