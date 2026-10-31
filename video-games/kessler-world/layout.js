/* Kessler IV: lays out one zone's districts, roads and infill buildings.
   Shared by the explorer (single zone at the origin) and the stitched EXEPERT world (zones at offsets).
   The order of rng() calls is part of the map: regions, then roads, then infill. Callers that keep
   drawing (the explorer's patrol contacts) continue from the same rng afterwards. */
import { STYLES, addBox, rotPt, curvePts, NULL_BUF, PALETTE } from './structures.js';

export function layoutZone(Z, o){
  const { ground, maskAt, surf, rng } = o;
  const ox = o.ox || 0, oz = o.oz || 0, C = o.C || PALETTE;
  const L = o.L || NULL_BUF, F = o.F || NULL_BUF, R = o.R || NULL_BUF, col = o.col || null;
  const water = o.water !== undefined ? o.water : Z.water;

  const regions = Z.regions.map((r, i) => ({...r, i, x:ox + r.u * 100, z:oz + r.v * 100, count:0, clear:18}));
  for (const r of regions){
    const ctx = {L, F, col, C, x:r.x, z:r.z, rot:r.rot || 0, rng, ground, water, count:0, clear:18};
    (STYLES[r.style] || (() => {}))(ctx);
    r.count = ctx.count; r.clear = ctx.clear;
  }

  const roadPts = [], roads = [];
  for (const [a, b] of Z.roads){
    const A = regions[a], Bq = regions[b], pts = curvePts(A.x, A.z, Bq.x, Bq.z, (rng() - 0.5) * 0.3, 48, surf, 0.35);
    for (let k = 0; k < pts.length - 3; k += 3){
      const m = Math.min(maskAt(pts[k], pts[k + 2]), 1);
      R.seg(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pts[k + 4], pts[k + 5], C.road, 0.6 * m);
      roadPts.push(pts[k], pts[k + 2]);
    }
    roads.push({a, b, pts});
  }

  let infillCount = 0;
  if (Z.infill){
    const I = Z.infill, Rr = I.radius * 100, ctx = {L, F, col, C, rng, ground, water, count:0};
    for (let a = -Rr; a <= Rr; a += I.cell) for (let b = -Rr; b <= Rr; b += I.cell){
      const [px, pz] = rotPt(ox, oz, a, b, I.rot);
      if (Math.hypot(px - ox, pz - oz) > Rr || rng() > I.p) continue;
      if (maskAt(px, pz) < I.minMask) continue;
      if (I.aboveWater != null && ground(px, pz) < water + I.aboveWater) continue;
      if (regions.some(r => Math.hypot(px - r.x, pz - r.z) < r.clear)) continue;
      let near = false; for (let k = 0; k < roadPts.length; k += 2){ if (Math.abs(roadPts[k] - px) < 3 && Math.abs(roadPts[k + 1] - pz) < 3){ near = true; break; } }
      if (near) continue;
      const w = 1.6 + rng() * 2.4, d = 1.6 + rng() * 2.4, h = I.hmin + Math.pow(rng(), 2.2) * (I.hmax - I.hmin);
      addBox(ctx, px + (rng() - 0.5), pz + (rng() - 0.5), w, d, h, I.rot, {floors:h > 5 ? 2.8 : 0});
    }
    infillCount = ctx.count;
  }

  return {regions, roads, roadPts, infillCount};
}
