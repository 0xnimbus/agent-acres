// Demo simulator: makes every rostered agent pick up, progress and finish
// plausible tasks so the farm can be seen working before real agents are wired.
// All events it emits are flagged demo:true by the server and never persisted.
'use strict';

const SCRIPTS = {
  boss: {
    tasks: [
      ["Plan today's work for the crew", 'Split orders across the six businesses'],
      ['Review finished work before delivery', 'Quality check on thumbnails and clips'],
      ['Reassign stalled tasks', 'Anything idle for over an hour'],
      ['Write the daily revenue summary', 'Sales, deliveries, open orders'],
    ],
    steps: ['Read the crew status', 'Checked open orders', 'Assigned tasks', 'Sent notes to the crew'],
    results: ['Crew briefed', 'All deliverables passed review', '2 tasks reassigned', 'Summary written'],
    values: [''],
  },
  thumbnails: {
    tasks: [
      ['Design thumbnail for "10 Rebel Moves" gaming video', 'Fiverr order, 3 variations'],
      ['Thumbnail pack for a cooking channel', '5 thumbnails, bright food close-ups'],
      ['Redo thumbnail after client revision', 'Bigger text, swap background'],
      ['A/B thumbnail set for a tech review', '2 variants for CTR testing'],
    ],
    steps: ['Pulled frames from the video', 'Cut out subject', 'Laid out headline text', 'Exported 1280x720 PNGs'],
    results: ['Delivered 3 thumbnails on Fiverr', 'Client approved, 5-star review', 'Revision delivered'],
    values: ['$25', '$40', '$15', '$60'],
  },
  clipping: {
    tasks: [
      ['Clip 2h podcast into shorts', 'Find the 8 strongest moments'],
      ['Shorts from a livestream VOD', 'Vertical crop, burned-in captions'],
      ['Turn webinar into TikTok clips', '5 clips under 45s'],
    ],
    steps: ['Transcribed the long-form video', 'Scored moments for hooks', 'Cropped to 9:16', 'Added captions', 'Rendered clips'],
    results: ['Delivered 8 shorts', 'Delivered 5 clips with captions', 'Client ordered a monthly package'],
    values: ['$45', '$80', '$120'],
  },
  'geo-agency': {
    tasks: [
      ['AI visibility audit for a dental clinic', 'Check how ChatGPT, Gemini and Perplexity describe them'],
      ['GEO content plan for a roofing company', 'Pages and FAQs that AI answers can cite'],
      ['Monthly AI-visibility report', 'Track brand mentions across assistants'],
      ['Prospect outreach to local HVAC firms', 'Personalised audit teasers'],
    ],
    steps: ['Ran 40 assistant queries', 'Logged citations and competitors', 'Drafted schema and FAQ fixes', 'Wrote client summary'],
    results: ['Audit sent to client', 'Plan approved, retainer signed', 'Report delivered', '3 replies, 1 call booked'],
    values: ['$300', '$750', '$500', ''],
  },
  'mobile-games': {
    tasks: [
      ['Build level 4 of the puzzle game', 'New tile mechanic'],
      ['Fix crash on Android 12 devices', 'Reported by testers'],
      ['Ship TestFlight build 0.6', 'Store screenshots too'],
      ['Balance the in-game economy', 'Coins per level, shop prices'],
    ],
    steps: ['Wrote gameplay code', 'Ran on device', 'Fixed failing test', 'Built release bundle'],
    results: ['Level 4 playable', 'Crash fixed, build uploaded', 'Build 0.6 sent to testers', 'Economy tuned'],
    values: [''],
  },
  ebay: {
    tasks: [
      ['List 5 vintage electronics on eBay', 'Photos, titles, pricing from sold comps'],
      ['Reprice stale listings', 'Items listed over 30 days'],
      ['Answer buyer questions', '4 open messages'],
      ['Ship sold item: Nintendo DS Lite', 'Print label, update tracking'],
    ],
    steps: ['Checked sold comps', 'Wrote titles and item specifics', 'Uploaded photos', 'Published listings'],
    results: ['5 listings live', '12 listings repriced', 'All messages answered', 'Shipped, tracking uploaded'],
    values: ['', '', '', '$85 sale'],
  },
  'fb-marketplace': {
    tasks: [
      ['Post 4 furniture items on Marketplace', 'Local pickup only'],
      ['Reply to 6 buyer messages', 'Filter out lowballers'],
      ['Schedule pickup for the desk sale', 'Confirm time and address'],
      ['Find underpriced flips nearby', 'Search 25 km radius'],
    ],
    steps: ['Wrote listing copy', 'Set prices from local comps', 'Messaged buyers', 'Confirmed pickup'],
    results: ['4 items posted', 'Messages handled, 2 serious buyers', 'Pickup booked for Saturday', 'Found 3 flips worth checking'],
    values: ['', '', '$120 sale', ''],
  },
};

const GENERIC = {
  tasks: [['Work on the next task', 'Generic demo task']],
  steps: ['Planning', 'Doing the work', 'Checking the result'],
  results: ['Done'],
  values: [''],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(a, b) { return a + Math.random() * (b - a); }

function createSimulator(emit) {
  let timers = [];
  let running = false;

  function later(ms, fn) {
    const t = setTimeout(() => { timers = timers.filter((x) => x !== t); if (running) fn(); }, ms);
    timers.push(t);
  }

  function cycle(agentId, firstDelay) {
    const s = SCRIPTS[agentId] || GENERIC;
    later(firstDelay, () => {
      const [title, detail] = pick(s.tasks);
      const task = agentId + '-' + Date.now().toString(36);
      emit({ type: 'task.start', agent: agentId, task, title, detail });
      const duration = rand(18000, 55000);
      const steps = 1 + Math.floor(Math.random() * 3);
      for (let i = 1; i <= steps; i++) {
        later((duration * i) / (steps + 1), () => emit({ type: 'task.progress', agent: agentId, task, note: pick(s.steps), pct: Math.round((100 * i) / (steps + 1)) }));
      }
      later(duration, () => {
        if (Math.random() < 0.07) {
          emit({ type: 'task.fail', agent: agentId, task, error: pick(['Upload timed out', 'Client file was corrupted', 'Rate limited, will retry']) });
        } else {
          const i = Math.floor(Math.random() * s.results.length);
          emit({ type: 'task.done', agent: agentId, task, title, result: s.results[i], value: s.values[i % s.values.length] || undefined });
        }
        cycle(agentId, rand(5000, 16000));
      });
    });
  }

  return {
    start(state) {
      if (running) return;
      running = true;
      // Agents that real events left mid-task keep their task; the rest start cycling.
      state.order.forEach((id, i) => cycle(id, 800 + i * 1500 + rand(0, 2000)));
    },
    stop() {
      running = false;
      timers.forEach(clearTimeout);
      timers = [];
    },
  };
}

if (typeof module === 'object' && module.exports) module.exports = { createSimulator, SCRIPTS };
else self.AcresDemo = { createSimulator, SCRIPTS };
