# EXEPERT

A browser arena shooter on Kessler IV. It is cartridge 01 in the arcade on `/contact/`, and it also runs standalone at `/video-games/exepert/`. Players can join a room directly with `?room=CODE`.

## Run it

| What | Command | Open |
| --- | --- | --- |
| Solo vs bots | `pnpm dev` | `http://localhost:3000/video-games/exepert/` |
| Online rooms | `pnpm build`, then `pnpm dev:worker` (runs the Durable Objects on :8787). Keep `pnpm dev` running too. | Same URL. Vite forwards `/api/exepert` and its WebSockets to :8787. |

XAMPP can't serve this page. The game imports `three` from npm, and only Vite resolves that import.

## How it fits together

| Folder | Holds |
| --- | --- |
| `../kessler-world/` | The stitched map (`world.js`), structure builders and colliders (`structures.js`, `collide.js`). This code is shared with the Kessler explorer. |
| `sim/` | The game rules. They run unchanged in the browser, the solo Web Worker and the Durable Object. No DOM, no THREE. |
| `sim/room-core.js` | The authoritative match room: inputs, firing, lag-compensated hits, projectiles, respawns and snapshots. |
| `sim/movement.js` | Sprint, slide, double jump, wall-run, mantle and phase dash. The client predicts with the same code. |
| `sim/modes/` | Team Deathmatch, Free-for-all, Uplink (conquest) and Extraction. |
| `src/` | The browser client: rendering, HUD, audio, input, menus, and the `net/` transports (solo worker or WebSocket). |
| `../../worker/exepert/` | `/api/exepert` routes, `ExepertRoom` (one Durable Object per room code) and `ExepertLobby` (quick play and status). |

## Modes

| Mode | Map | What it is |
| --- | --- | --- |
| Team Deathmatch | One sector (Bastion, Ridgeback or Silt Basin) | First to 75 kills |
| Free-for-all | One sector | First to 30 kills |
| Uplink | The whole stitched map | Seven relays, tickets, drop-pod deploys onto held relays |
| Extraction | The whole stitched map | Crews of three loot caches, logs and crates, then call a lift at an exfil point. Sentinels guard the hot zones. The crew that banks the most value wins. |

## Controls

| Action | Keys |
| --- | --- |
| Move / jump (×2) / sprint / slide | WASD / Space / Shift / C |
| Phase dash / frag / reload | Q / G / R |
| Fire / aim down sights | Left mouse / right mouse |
| Swap weapon | 1, 2 or the mouse wheel |
| Ping / third-person view / scores | Z / V / Tab |
| Interact | Hold E |
| Uplink deploy choice (while dead) | 1–7 pick a relay, B base, N auto |

Gamepads work as well.
