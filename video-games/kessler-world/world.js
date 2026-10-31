/* Kessler IV: the stitched EXEPERT world.
   Bastion, Ridgeback and Silt Basin are laid out on one terrain (1 unit = 1 m):
     Ridgeback sits north of the Bastion plateau, Silt Basin drains to the south-west.
   Each zone keeps its own height function and building layout; the gaps are filled with
   seeded connector terrain and the whole map fades out under a soft island mask.
   buildWorld() is deterministic: the browser and the game server build the same world from the same code.
   No DOM and no THREE in this file. */
import { clamp, ss, mulberry32, makeNoise, fbm, ridged, pad } from './kessler-util.js';
import { ZONES, TYPES, makeField } from './kessler-zones.js';
import { layoutZone } from './layout.js';
import { PlainBuf, NULL_BUF, PALETTE, curvePts } from './structures.js';
import { CollisionWorld } from './collide.js';

export const WORLD_VERSION = 1;
export const WATER_LEVEL = 3.0;
const SEED = 1729;

/* Zone centres in world metres. */
export const PLACEMENT = {
  bastion:  {x:0,    z:0},
  ridgeback:{x:30,   z:-190},
  silt:     {x:-140, z:140}
};
const ZONE_CODE = {bastion:'BA', ridgeback:'RB', silt:'SB'};

/* Inter-zone roads: [zoneA, regionA, zoneB, regionB]. */
const LINKS = [
  ['bastion', 0, 'ridgeback', 4],   // Landing Array -> The Spine
  ['bastion', 3, 'silt', 0],        // Refinery -> Pump Station
  ['ridgeback', 3, 'silt', 1]       // Wind Farm -> Reed Flats (long western trail)
];

/* Playable areas per mode. `full` uses the island mask instead of a circle. */
export const SECTORS = {
  bastion:  {id:'bastion',   name:'BASTION CORE',  x:0,    z:0,    r:80},
  ridgeback:{id:'ridgeback', name:'RIDGEBACK CUT', x:30,   z:-190, r:78},
  silt:     {id:'silt',      name:'SILT BASIN',    x:-140, z:140,  r:82},
  full:     {id:'full',      name:'KESSLER IV',    x:0,    z:0,    r:Infinity}
};

const MARGIN = 150;
export const BOUNDS = (() => {
  const xs = Object.values(PLACEMENT).map(p => p.x), zs = Object.values(PLACEMENT).map(p => p.z);
  return {minX:Math.min(...xs) - MARGIN, maxX:Math.max(...xs) + MARGIN, minZ:Math.min(...zs) - MARGIN, maxZ:Math.max(...zs) + MARGIN};
})();

function fnv(h, x){ h ^= Math.round(x * 100) | 0; return Math.imul(h, 16777619) >>> 0; }

/* Height before the grid: zone fields blended with connector terrain under the island mask. */
export function makeHeightFunction(){
  const zones = ZONES.map(Z => ({Z, ox:PLACEMENT[Z.id].x, oz:PLACEMENT[Z.id].z, field:makeField(Z)}));
  const silt = PLACEMENT.silt;
  const nc = makeNoise(SEED), nm = makeNoise(SEED + 41);
  const connector = (x, z) => {
    const b = fbm(nc, x * 0.011 + 3.1, z * 0.011 - 7.3, 4), r = ridged(nc, x * 0.018 - 2, z * 0.018 + 5, 3);
    const h = 7.5 + b * 5 + r * 5;
    const wet = 1 - ss(0.9, 1.6, Math.hypot(x - silt.x, z - silt.z) / 100);
    return h * (1 - wet) + (2.2 + b * 2.4) * wet;
  };
  const mask = (x, z) => {
    let dmin = Infinity;
    for (const zz of zones) dmin = Math.min(dmin, Math.hypot(x - zz.ox, z - zz.oz) / 100);
    return 1 - ss(1.08, 1.38, dmin + 0.1 * nm(x * 0.012, z * 0.012));
  };
  const height = (x, z) => {
    let ws = 0, hs = 0;
    for (const zz of zones){
      const u = (x - zz.ox) / 100, v = (z - zz.oz) / 100, d = Math.hypot(u, v);
      if (d >= 1) continue;
      const w = 1 - ss(0.6, 1.0, d);
      if (w <= 0) continue;
      hs += w * zz.field.hu(u, v); ws += w;
    }
    const h = ws >= 1 ? hs / ws : hs + (1 - ws) * connector(x, z);
    return Math.max(0, h * mask(x, z));
  };
  return {zones, height, mask};
}

export function waterAt(x, z){
  return Math.hypot(x - PLACEMENT.silt.x, z - PLACEMENT.silt.z) < 128 ? WATER_LEVEL : -Infinity;
}

/**
 * Build the world.
 * @param {object} [opts]
 * @param {boolean} [opts.visual] also collect holographic line/face buffers for rendering
 * @param {number} [opts.step] terrain grid spacing in metres (must match between client and server)
 * @param {(p:number)=>void} [opts.progress]
 */
export function buildWorld(opts = {}){
  const step = opts.step || 1, progress = opts.progress || (() => {});
  const B = BOUNDS, NX = Math.round((B.maxX - B.minX) / step) + 1, NZ = Math.round((B.maxZ - B.minZ) / step) + 1;
  const {zones, height, mask} = makeHeightFunction();
  const H = new Float32Array(NX * NZ), M = new Float32Array(NX * NZ);
  let maxH = 0;
  for (let j = 0; j < NZ; j++){
    const z = B.minZ + j * step;
    for (let i = 0; i < NX; i++){
      const x = B.minX + i * step, k = j * NX + i;
      const m = mask(x, z); M[k] = m;
      H[k] = m > 0 ? height(x, z) : 0;
      if (H[k] > maxH) maxH = H[k];
    }
    if ((j & 63) === 0) progress(0.6 * j / NZ);
  }
  const sample = (A, x, z) => {
    const fx = clamp((x - B.minX) / step, 0, NX - 1 - 1e-4), fz = clamp((z - B.minZ) / step, 0, NZ - 1 - 1e-4);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * NX + i;
    return (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + NX] * (1 - tx) + A[k + NX + 1] * tx) * tz;
  };
  const ground = (x, z) => sample(H, x, z);
  const maskAt = (x, z) => sample(M, x, z);
  const surf = (x, z) => Math.max(ground(x, z), waterAt(x, z));
  const normalAt = (x, z) => {
    const e = step, hx = ground(x + e, z) - ground(x - e, z), hz = ground(x, z + e) - ground(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  };

  /* ---- structures ---- */
  const visual = !!opts.visual;
  const L = visual ? new PlainBuf() : NULL_BUF, F = visual ? new PlainBuf() : NULL_BUF, R = visual ? new PlainBuf() : NULL_BUF;
  const cw = new CollisionWorld({ground, normalAt, bounds:B});
  let zoneTag = null;
  const col = {
    box:b => cw.addBox({...b, zone:zoneTag}),
    cyl:c => cw.addCyl({...c, zone:zoneTag}),
    dome:d => cw.addDome({...d, zone:zoneTag})
  };
  const zoneOut = [];
  for (const zz of zones){
    const {Z, ox, oz, field} = zz;
    zoneTag = Z.id;
    const zmask = (x, z) => field.mask((x - ox) / 100, (z - oz) / 100);
    const rng = mulberry32(Z.seed * 3 + 1);
    const lay = layoutZone(Z, {ox, oz, ground, maskAt:zmask, surf, rng, C:PALETTE, L, F, R, col, water:Z.water != null ? WATER_LEVEL : null});
    const code = ZONE_CODE[Z.id];
    zoneOut.push({
      id:Z.id, name:Z.name, code:Z.code, short:code, ox, oz, tint:Z.tint, blurb:Z.blurb,
      regions:lay.regions.map(r => ({id:`${code}-${r.code}`, zone:Z.id, name:r.name, x:r.x, z:r.z, y:ground(r.x, r.z), clear:r.clear, threat:r.threat, style:r.style, desc:r.desc})),
      pois:Z.pois.map(p => {
        const x = ox + p.u * 100, z = oz + p.v * 100;
        return {id:`${code}/${p.code}`, zone:Z.id, t:p.t, type:TYPES[p.t].label, name:p.name, note:p.note, x, z, y:surf(x, z)};
      }),
      hots:Z.hot.map((h, i) => ({id:`${code}-HZ${pad(i + 1)}`, zone:Z.id, name:h.name, desc:h.desc, x:ox + h.u * 100, z:oz + h.v * 100, r:h.r * 100})),
      roads:lay.roads.map(rd => rd.pts),
      structures:lay.regions.reduce((s, r) => s + r.count, 0) + lay.infillCount
    });
  }
  zoneTag = 'link';
  const lrng = mulberry32(SEED * 7 + 3), links = [];
  const byId = Object.fromEntries(zoneOut.map(z => [z.id, z]));
  for (const [za, ra, zb, rb] of LINKS){
    const A = byId[za].regions[ra], Bq = byId[zb].regions[rb];
    const pts = curvePts(A.x, A.z, Bq.x, Bq.z, (lrng() - 0.5) * 0.25, 96, surf, 0.35);
    for (let k = 0; k < pts.length - 3; k += 3) R.seg(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pts[k + 4], pts[k + 5], PALETTE.road, 0.45);
    links.push({from:A.id, to:Bq.id, pts});
  }
  cw.finalize();
  progress(0.75);

  /* ---- spawn anchors: rings around each district plus points along the roads ---- */
  const PR = 0.42, PH = 1.8;
  const standable = (x, z) => {
    if (maskAt(x, z) < 0.75) return null;
    const g = ground(x, z), n = normalAt(x, z);
    if (n[1] < 0.8 || waterAt(x, z) - g > 0.6) return null;
    if (cw.blocked(x, g + 0.05, z, PR + 0.3, PH)) return null;
    return g;
  };
  const srng = mulberry32(SEED * 13 + 5), spawns = [];
  for (const zo of zoneOut){
    for (const r of zo.regions){
      for (let k = 0; k < 10; k++){
        const a = k / 10 * Math.PI * 2 + srng() * 0.4, d = r.clear + 3 + srng() * 7;
        const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d, y = standable(x, z);
        if (y != null) spawns.push({x, y, z, zone:zo.id, region:r.id});
      }
    }
    for (const pts of zo.roads){
      for (let k = 0; k < pts.length; k += 3 * 12){
        const x = pts[k] + (srng() - 0.5) * 6, z = pts[k + 2] + (srng() - 0.5) * 6, y = standable(x, z);
        if (y != null) spawns.push({x, y, z, zone:zo.id, region:null});
      }
    }
  }
  progress(0.82);

  /* ---- navigation grid for bots ---- */
  const NS = 8, nav = {step:NS, nodes:[], index:new Map()};
  for (let z = B.minZ + NS / 2; z < B.maxZ; z += NS) for (let x = B.minX + NS / 2; x < B.maxX; x += NS){
    let px = x, pz = z, y = standable(px, pz);
    if (y == null){
      // nudge around blocked cells so streets between buildings stay connected
      for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3], [3, -3], [-3, 3]]){ y = standable(x + ox, z + oz); if (y != null){ px = x + ox; pz = z + oz; break; } }
    }
    if (y == null) continue;
    const gi = Math.round((x - B.minX - NS / 2) / NS), gj = Math.round((z - B.minZ - NS / 2) / NS);
    const id = nav.nodes.length;
    nav.nodes.push({id, x:px, y, z:pz, gi, gj, wet:waterAt(px, pz) > y, edges:[]});
    nav.index.set(gj * 4096 + gi, id);
  }
  const edgeOk = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = Math.hypot(dx, dz), n = Math.ceil(L2 / 1.5);
    let py = a.y;
    for (let s = 1; s <= n; s++){
      const t = s / n, x = a.x + dx * t, z = a.z + dz * t, y = ground(x, z);
      if (Math.abs(y - py) > 1.1 * (L2 / n)) return false;
      if (cw.blocked(x, y + 0.3, z, PR, PH - 0.3)) return false;
      py = y;
    }
    return true;
  };
  for (const a of nav.nodes){
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [-1, 1]]){
      const bid = nav.index.get((a.gj + dj) * 4096 + (a.gi + di));
      if (bid == null) continue;
      const b = nav.nodes[bid];
      if (!edgeOk(a, b)) continue;
      const cost = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * (a.wet || b.wet ? 1.8 : 1);
      a.edges.push([bid, cost]); b.edges.push([a.id, cost]);
    }
  }
  progress(0.95);

  /* ---- fingerprint ---- */
  let h = 0x811c9dc5;
  h = fnv(h, NX); h = fnv(h, NZ); h = fnv(h, WORLD_VERSION);
  for (let k = 0; k < H.length; k += 97) h = fnv(h, H[k]);
  for (const it of cw.items) { h = fnv(h, it.x); h = fnv(h, it.z); h = fnv(h, it.y0); h = fnv(h, it.y1); }
  h = fnv(h, spawns.length); h = fnv(h, nav.nodes.length);
  progress(1);

  const inSector = (sector, x, z) => {
    const s = typeof sector === 'string' ? SECTORS[sector] : sector;
    if (!s || s.id === 'full') return maskAt(x, z) > 0.55;
    return Math.hypot(x - s.x, z - s.z) <= s.r && maskAt(x, z) > 0.55;
  };

  return {
    version:WORLD_VERSION, step, NX, NZ, H, M, maxH, bounds:B,
    ground, maskAt, surf, normalAt, waterAt, height,
    zones:zoneOut, links, collide:cw, spawns, nav, sectors:SECTORS, inSector,
    lines:visual ? {L, F, R} : null,
    hash:h.toString(16).padStart(8, '0')
  };
}
