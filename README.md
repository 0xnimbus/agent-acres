# Agent Acres

A pixel-art space station where you watch your AI agents work. Each project gets its own room,
linked by hallways to the middle **HQ** room where the boss agent (the big mech) runs the crew.
Inside a room every agent gets a character, a desk with a name tag and a `RUN 0:51` timer, and a
wall monitor; desks light up while their agent works. The side panels follow StarNet's layout: a
crew list with portraits and levels, a commander level, and a COMMS feed where each finished job
has **read the work** and **rate it** buttons. Scroll on the map to zoom, drag to pan, double-click to fit. When an agent starts a task it walks to its desk, its screen lights
up and a run timer starts; when it finishes, the result lands in **Finished work** and the agent
wanders off to the lounge until the next job.

Inspired by [StarNet](https://github.com/androoAGI/starnet)'s idea that the station is a picture
of live runtime state. Agent Acres is the small version of that: it does not run agents, it
**shows** the agents you already run. Anything that can make an HTTP request or append a line to
a file can report in.

- One Node file, no dependencies, no build step (Node 18+).
- Live updates over Server-Sent Events, so any number of browser tabs stay in sync.
- Demo mode simulates the whole crew. Demo events are flagged, shown with a DEMO banner and never saved.
- Art is plug and play through a manifest. The repo ships procedural placeholder art so a fresh clone runs.

## Run it

```bash
git clone https://github.com/0xnimbus/agent-acres.git
cd agent-acres
npm run demo        # or: node server.js --demo
```

Open <http://127.0.0.1:8790>. Use the **Demo** button to switch the simulator on or off.
`npm start` runs without the simulator, so you only see what real agents report.

## Recording videos

The desktop view is built to be recorded as is (OBS, or Windows Game Bar with Win+Alt+R):

- **Director camera (CAM: AUTO, on by default):** it glides in on whichever agent just started or
  finished something, holds the shot, then pulls back to the whole station. Scrolling, dragging or
  pressing the button switches to CAM: FREE.
- **Map HUD:** money earned today counts up as paid work lands, with jobs done and agents working.
  Each finished job also pops a card in the bottom-left of the map.
- **Game feel:** finished jobs pop a coin burst, a bouncing `+$40`, a ring at the desk and a small
  screen shake (paid work only). A vignette and faint scanlines give it a monitor feel.

While demo mode is on, the DEMO MODE banner stays on screen so recordings of the simulation are not
mistaken for real earnings.

## Your crew

The default crew lives in [`agents.example.json`](agents.example.json):

| id | name | chamber (project) | model |
| --- | --- | --- | --- |
| `boss` | Boss | HQ (middle, `"role": "boss"`) | Claude Opus 5 |
| `thumbnails` | Thumbs | Fiverr Thumbnails | |
| `clipping` | Clipper | Fiverr Clipping | |
| `geo-agency` | Geo | GEO Agency | |
| `mobile-games` | Pixel | Mobile Games | |
| `ebay` | Bay | eBay Resale | |
| `fb-marketplace` | Market | FB Marketplace | |

Copy it to `agents.json` (gitignored) to rename agents, move them between projects, set models,
change name-tag colors or pick looks. Agents that share a `project` share a chamber; a new project
gets a new chamber automatically. Agents that are not in the roster appear the first time they
send an event (send `agent.hello` with a `project` to put them in the right chamber).

## Reporting work from an agent

Every event is a JSON object with a `type` and an `agent` id.

| type | fields | what the farm shows |
| --- | --- | --- |
| `agent.hello` | `name`, `business`, `project`, `model`, `role`, `look`, `color` | adds or updates the agent (`role: "boss"` puts it in HQ) |
| `task.start` | `title` (required), `detail`, `task` | walks to the desk, screen on, timer starts |
| `task.progress` | `note`, `pct` (0-100) | speech bubble, progress bar |
| `task.done` | `result`, `title`, `url`, `value` | Finished work entry, floating `+$40` |
| `task.fail` | `error` | red status, failure in the feed |
| `agent.idle` | `note` | walks to the lounge |
| `note` | `text` | a line in the live feed |

`ts` (ms since epoch) and `id` are optional; the server fills them in.

**HTTP** (single event or an array):

```bash
curl -X POST http://127.0.0.1:8790/api/events \
  -H "Content-Type: application/json" \
  -d '{"type":"task.start","agent":"ebay","title":"List 5 vintage electronics"}'
```

**CLI helper:**

```bash
node bin/emit.js task.start ebay "List 5 vintage electronics"
node bin/emit.js task.progress ebay "Uploaded photos" --pct 60
node bin/emit.js task.done ebay "5 listings live" --url https://www.ebay.com/sch/... --value "$85"
```

**File inbox**, for agents that cannot make HTTP calls: append one JSON event per line to
`data/inbox.ndjson`. The server picks up new lines within half a second.

**Python:**

```python
import json, urllib.request
def report(**ev):
    req = urllib.request.Request("http://127.0.0.1:8790/api/events", json.dumps(ev).encode(),
                                 {"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=3)

report(type="task.start", agent="clipping", title="Clip 2h podcast into shorts")
```

Real events are kept in `data/events.ndjson`, so the farm comes back the way you left it after a
restart. Other endpoints: `GET /api/state` (current snapshot), `GET /api/stream` (SSE),
`POST /api/demo` with `{"on": true|false}`, `POST /api/rate` with `{"id": "<done id>", "stars": 0-5}`.

The server listens on `127.0.0.1` only. To accept events from other machines set `HOST=0.0.0.0`
and `AGENT_ACRES_TOKEN=<secret>`; agents then send `Authorization: Bearer <secret>`.

## Art

Agent Acres was designed around the
[**Tech Dungeon Roguelite** asset pack by Trevor Pupkin](https://trevor-pupkin.itch.io/tech-dungeon-roguelite).
That pack is paid and its license does not allow redistribution, so **none of its art is in this
repository**. If you own it, plug it in:

```bash
npm run art -- "C:\path\to\Tech Dungeon Roguelite - Asset Pack (v7)"
```

This copies the pack into the gitignored `assets/` folder and installs
[`manifests/tech-dungeon.json`](manifests/tech-dungeon.json) as `assets/manifest.json`. Reload the
page. `node bin/art.js --off` goes back to the placeholder art.

### Using a different pack

A manifest maps roles to sprite sheets. Frames are `[column, row]` in units of `cell`:

```json
{
  "name": "My pack", "credit": "My pack by Someone", "url": "https://...",
  "sheets": { "props": "my-pack/props.png", "hero": "my-pack/hero.png" },
  "sprites": {
    "deskWork": { "sheet": "props", "cell": [32, 32], "frames": [[0, 2], [1, 2]], "fps": 5 }
  },
  "characters": [
    { "sheet": "hero", "cell": [32, 32], "idle": [[0, 0]], "work": [[1, 0], [2, 0]], "walk": [[0, 1], [1, 1], [2, 1], [3, 1]] }
  ]
}
```

Roles: `floor`, `floorAccent`, `floorVent`, `wall`, `wallTrim`, `wallBottom`, `railLeft`, `railRight`, `hazard`, `wallMonitorOff`, `floorGrate`, `floorPanel`, `stripeBlue`, `stripeYellow`, `stripeRed`, `pillar`, `wallLight`, `wallLightGreen`, `deskWork`, `deskIdle`,
`screenWork` (64x32), `screenIdle`, `wallMonitor`, `console`, `tank` (32x64), `crate`,
`crateOpen`, `capsule`. Add a top-level `"boss"` entry (same shape as a character, any cell size) for the HQ boss. Any role you leave out falls back to the placeholder art. If there are
more agents than character looks, extra agents reuse a look tinted with their name-tag color.

## Tests

```bash
npm test
```

## License

Code: MIT. The placeholder art is drawn by the code and covered by the same license. Third-party
art packs keep their own licenses and are not part of this repository.
