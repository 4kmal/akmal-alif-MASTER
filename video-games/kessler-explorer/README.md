# Kessler IV Explorer

A holographic 3D surface map of three fictional zones (Bastion, Ridgeback, Silt Basin). Terrain, contours and buildings are generated in code from seeded noise; there are no model or image assets.

## Run it

The page uses ES modules, so it must be served over HTTP (opening the file directly with `file://` will not work).

- XAMPP: `http://localhost/akmal-alif-MASTER/video-games/kessler-explorer/`
- Vite (from the repo root, `pnpm dev`): `http://localhost:3000/video-games/kessler-explorer/`

Vite picks up `index.html` automatically, so `pnpm build` includes this page with no config changes.

## Files

| File | What it holds |
| --- | --- |
| `index.html` | HUD markup and script tags. three.js r128 and its bloom postprocessing load from CDNs as globals before the app module. |
| `kessler.css` | All styles. Design tokens (colours, fonts, sizes) are on `:root` at the top. |
| `../kessler-world/kessler-zones.js` | Map content: each zone's terrain function, regions, points of interest, hot zones and contact counts. Start here to add a zone or change what is on the map. |
| `../kessler-world/kessler-util.js` | Pure helpers: clamp/lerp, seeded RNG, simplex noise, fBm and ridged noise. |
| `../kessler-world/structures.js` | Structure builders (`STYLES`, `addBox`, …). They draw lines and faces and, when given a collider sink, emit solid shapes for EXEPERT. |
| `../kessler-world/layout.js` | `layoutZone()`: districts, roads and infill for one zone, in the RNG order that defines the map. |
| `kessler-main.js` | Everything else: renderer and shaders, zone build, label projection, camera controls, HUD, intel panel and the WebAudio ambient player. |

The `../kessler-world/` folder is shared with the EXEPERT shooter (`video-games/exepert/`) and its game server, which stitch all three zones into one map (`world.js`) with collision (`collide.js`).

## Notes

- World units: the map is 200 × 200 units and 1 unit = 10 m. Zone positions in `kessler-zones.js` use `u, v` in `[-1, 1]`, which maps to world `x, z = u * 100, v * 100`.
- A region's `style` picks its buildings from `STYLES` in `kessler-main.js` (`pads`, `tower`, `ring`, `tanks`, `stacks`, `mast`, `dome`, `turbines`, `huts`, `adit`, `causeway`, `dock`, `hatch`, `reeds`, `buoy`).
- Layer toggles and the last zone opened are remembered in `localStorage` (`kessler-layers`, `kessler-zone`). A `#bastion`, `#ridgeback` or `#silt` hash opens that zone directly.
- Controls: drag to pan, right-drag or Shift-drag to rotate and tilt, wheel to zoom, `WASD`/arrows, `Q`/`E`, `+`/`-`, `R` recenter, `T` toggle 2D/3D, `Esc` close details.
