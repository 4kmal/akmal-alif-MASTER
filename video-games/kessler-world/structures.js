/* Kessler IV: structure builders shared by the explorer, the EXEPERT client and the game server.
   Builders write to three optional sinks on the context `c`:
     c.L   line segments   (seg)
     c.F   translucent faces (quad, tri)
     c.col solid colliders (box, cyl, dome) for movement and hit tests
   Colours come from `c.C`, so the explorer can pass THREE.Color values and the server plain ones.
   No DOM and no THREE in this file. */
import { lerp } from './kessler-util.js';

export function rotPt(cx, cz, lx, lz, rot){ const c = Math.cos(rot), s = Math.sin(rot); return [cx + lx * c - lz * s, cz + lx * s + lz * c]; }

export function curvePts(ax, az, bx, bz, bend, n, surf, lift){
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
  const cx = (ax + bx) / 2 + nx * bend * len, cz = (az + bz) / 2 + nz * bend * len, out = [];
  for (let i = 0; i <= n; i++){
    const t = i / n, x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx, z = (1 - t) * (1 - t) * az + 2 * (1 - t) * t * cz + t * t * bz;
    out.push(x, surf(x, z) + lift, z);
  }
  return out;
}

/* Plain colour and buffer types for callers without THREE (game world build, server). */
export class Rgb {
  constructor(r, g, b){ this.r = r; this.g = g; this.b = b; }
  static hex(h, s = 1){ return new Rgb(((h >> 16) & 255) / 255 * s, ((h >> 8) & 255) / 255 * s, (h & 255) / 255 * s); }
  clone(){ return new Rgb(this.r, this.g, this.b); }
  multiplyScalar(s){ this.r *= s; this.g *= s; this.b *= s; return this; }
}
export const PALETTE = {
  sHi:Rgb.hex(0xbfe0ff, 0.8), sMid:Rgb.hex(0x5fa5ff, 0.5), sLo:Rgb.hex(0x2c66d0, 0.35),
  face:Rgb.hex(0x4b93ff), peak:Rgb.hex(0xe2f1ff), road:Rgb.hex(0x9fd8ff),
  reed:Rgb.hex(0x6cc6ff, 0.6), reedLo:Rgb.hex(0x1d4fa8, 0.4)
};
export class PlainBuf {
  constructor(){ this.p = []; this.c = []; this.a = []; }
  v(x, y, z, col, a){ this.p.push(x, y, z); this.c.push(col.r, col.g, col.b); this.a.push(a); }
  seg(x1, y1, z1, x2, y2, z2, c1, a1, c2 = c1, a2 = a1){ this.v(x1, y1, z1, c1, a1); this.v(x2, y2, z2, c2, a2); }
  quad(p1, p2, p3, p4, col, a1, a2){
    this.v(...p1, col, a1); this.v(...p2, col, a1); this.v(...p3, col, a2);
    this.v(...p1, col, a1); this.v(...p3, col, a2); this.v(...p4, col, a2);
  }
  tri(p1, p2, p3, col, a){ this.v(...p1, col, a); this.v(...p2, col, a); this.v(...p3, col, a); }
}
export const NULL_BUF = { seg(){}, quad(){}, tri(){}, v(){} };

/* ======================================================================
   Primitive builders (lines L + translucent faces F + colliders col)
   ====================================================================== */
export function addBox(c, x, z, w, d, h, rot, o = {}){
  const C = c.C;
  const y0 = o.y0 != null ? o.y0 : c.ground(x, z);
  const yb = y0 - 1.5, yt = y0 + h, br = o.bright || 1;
  const P = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx, sz]) => rotPt(x, z, sx * w / 2, sz * d / 2, rot));
  const hi = o.bright ? C.sHi.clone().multiplyScalar(br) : C.sHi;
  for (let k = 0; k < 4; k++){
    const [ax, az] = P[k], [bx, bz] = P[(k + 1) % 4];
    c.L.seg(ax, yt, az, bx, yt, bz, hi, 0.9);
    c.L.seg(ax, y0, az, bx, y0, bz, C.sLo, 0.3);
    c.L.seg(ax, yb, az, ax, yt, az, C.sLo, 0.15, hi, 0.85);
    c.F.quad([ax, yb, az], [bx, yb, bz], [bx, yt, bz], [ax, yt, az], C.face, 0.01, 0.075);
  }
  if (c.col) c.col.box({x, z, w, d, rot, y0:yb, y1:yt});
  const fs = o.floors != null ? o.floors : (h > 6 ? 3 : 0);
  if (fs > 0) for (let y = y0 + fs; y < yt - 0.8; y += fs)
    for (let k = 0; k < 4; k++){ const [ax, az] = P[k], [bx, bz] = P[(k + 1) % 4]; c.L.seg(ax, y, az, bx, y, bz, C.sMid, 0.32); }
  if (!o.noRoof){
    c.F.quad([P[0][0], yt, P[0][1]], [P[1][0], yt, P[1][1]], [P[2][0], yt, P[2][1]], [P[3][0], yt, P[3][1]], C.face, 0.065, 0.065);
    if (!o.part && w > 3.2 && d > 3.2 && c.rng() < 0.55){
      const [rx, rz] = rotPt(x, z, (c.rng() - 0.5) * w * 0.3, (c.rng() - 0.5) * d * 0.3, rot);
      addBox(c, rx, rz, w * (0.25 + c.rng() * 0.25), d * (0.25 + c.rng() * 0.25), 0.8 + c.rng() * 1.6, rot, {y0:yt, part:true, floors:0, noRoof:true});
    }
  }
  if (!o.part) c.count++;
}
export function addCyl(c, x, z, r, h, o = {}){
  const C = c.C;
  const y0 = o.y0 != null ? o.y0 : c.ground(x, z), yb = y0 - 1.2, yt = y0 + h, S = o.sides || 14;
  const bands = o.bands != null ? o.bands : 2;
  const pts = []; for (let s = 0; s < S; s++){ const a = s / S * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
  for (let s = 0; s < S; s++){
    const [ax, az] = pts[s], [bx, bz] = pts[(s + 1) % S];
    c.L.seg(ax, yt, az, bx, yt, bz, C.sHi, 0.85);
    c.L.seg(ax, y0, az, bx, y0, bz, C.sLo, 0.3);
    for (let b = 1; b <= bands; b++){ const y = y0 + h * b / (bands + 1); c.L.seg(ax, y, az, bx, y, bz, C.sMid, 0.3); }
    if (s % 2 === 0) c.L.seg(ax, yb, az, ax, yt, az, C.sLo, 0.15, C.sHi, 0.7);
    c.F.quad([ax, yb, az], [bx, yb, bz], [bx, yt, bz], [ax, yt, az], C.face, 0.012, 0.1);
    c.F.tri([x, yt, z], [ax, yt, az], [bx, yt, bz], C.face, 0.08);
  }
  if (c.col) c.col.cyl({x, z, r, y0:yb, y1:yt});
  c.count++;
  return yt;
}
export function addDome(c, x, z, r, o = {}){
  const C = c.C;
  const y0 = o.y0 != null ? o.y0 : c.ground(x, z), S = 24, R = 6, M = 12;
  for (let k = 0; k <= R; k++){
    const ph = k / R * Math.PI * 0.5 * 0.94, rr = r * Math.cos(ph), y = y0 + r * Math.sin(ph);
    for (let s = 0; s < S; s++){
      const a1 = s / S * Math.PI * 2, a2 = (s + 1) / S * Math.PI * 2;
      c.L.seg(x + Math.cos(a1) * rr, y, z + Math.sin(a1) * rr, x + Math.cos(a2) * rr, y, z + Math.sin(a2) * rr, k === 0 ? C.sMid : C.sHi, k === 0 ? 0.5 : 0.55);
    }
  }
  for (let m = 0; m < M; m++){
    const a = m / M * Math.PI * 2 + (o.twist || 0);
    for (let k = 0; k < R; k++){
      const p1 = k / R * Math.PI * 0.47, p2 = (k + 1) / R * Math.PI * 0.47;
      c.L.seg(x + Math.cos(a) * r * Math.cos(p1), y0 + r * Math.sin(p1), z + Math.sin(a) * r * Math.cos(p1),
              x + Math.cos(a) * r * Math.cos(p2), y0 + r * Math.sin(p2), z + Math.sin(a) * r * Math.cos(p2), C.sMid, 0.45, C.sHi, 0.7);
    }
  }
  // slit for observatory
  if (o.slit){ const a = o.slit; c.L.seg(x + Math.cos(a) * r, y0 + 1, z + Math.sin(a) * r, x, y0 + r, z, C.peak, 0.9); }
  if (c.col) c.col.dome({x, z, r, y0});
  c.count++;
}
export function addMast(c, x, z, y0, h, o = {}){
  const C = c.C;
  const legs = [0, 1, 2].map(k => k / 3 * Math.PI * 2 + 0.3);
  const base = o.base || 0.9;
  const at = (k, t) => { const rr = base * (1 - t * 0.7); return [x + Math.cos(legs[k]) * rr, y0 + h * t, z + Math.sin(legs[k]) * rr]; };
  for (let k = 0; k < 3; k++){ const a = at(k, 0), b = at(k, 1); c.L.seg(...a, ...b, C.sMid, 0.5, C.sHi, 0.95); }
  const steps = Math.max(4, Math.round(h / 2));
  for (let i = 0; i < steps; i++){
    const t1 = i / steps, t2 = (i + 1) / steps;
    for (let k = 0; k < 3; k++){ const a = at(k, t1), b = at((k + 1) % 3, t2); c.L.seg(...a, ...b, C.sMid, 0.32); }
  }
  const top = [x, y0 + h, z];
  c.L.seg(top[0] - 1.2, top[1], top[2], top[0] + 1.2, top[1], top[2], C.peak, 0.9);
  c.L.seg(top[0], top[1], top[2] - 1.2, top[0], top[1], top[2] + 1.2, C.peak, 0.9);
  c.L.seg(...top, top[0], top[1] + 2.5, top[2], C.peak, 0.9);
  if (o.guys){
    for (let k = 0; k < 3; k++){
      const a = legs[k] + 0.5, ax = x + Math.cos(a) * h * 0.45, az = z + Math.sin(a) * h * 0.45;
      c.L.seg(x, y0 + h * 0.78, z, ax, c.ground(ax, az), az, C.sMid, 0.35, C.sLo, 0.2);
    }
  }
  if (c.col) c.col.cyl({x, z, r:base * 0.65, y0, y1:y0 + h, thin:true});
  c.count++;
}
export function addPad(c, x, z, r){
  const C = c.C;
  const y = c.ground(x, z) + 0.25, S = 28;
  for (let s = 0; s < S; s++){
    const a1 = s / S * Math.PI * 2, a2 = (s + 1) / S * Math.PI * 2;
    c.L.seg(x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, x + Math.cos(a2) * r, y, z + Math.sin(a2) * r, C.sHi, 0.7);
    if (s % 2 === 0) c.L.seg(x + Math.cos(a1) * r * 0.72, y, z + Math.sin(a1) * r * 0.72, x + Math.cos(a2) * r * 0.72, y, z + Math.sin(a2) * r * 0.72, C.sMid, 0.45);
    c.F.tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a2) * r, y, z + Math.sin(a2) * r], C.face, 0.05);
  }
  const k = r * 0.32;
  c.L.seg(x - k, y, z - k, x - k, y, z + k, C.peak, 0.7);
  c.L.seg(x + k, y, z - k, x + k, y, z + k, C.peak, 0.7);
  c.L.seg(x - k, y, z, x + k, y, z, C.peak, 0.7);
  c.count++;
}
export function addTurbine(c, x, z, h, ang, spin){
  const C = c.C;
  const y0 = c.ground(x, z), hub = [x, y0 + h, z];
  c.L.seg(x - 0.35, y0, z, x - 0.12, y0 + h, z, C.sMid, 0.4, C.sHi, 0.85);
  c.L.seg(x + 0.35, y0, z, x + 0.12, y0 + h, z, C.sMid, 0.4, C.sHi, 0.85);
  const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx, len = h * 0.46;
  c.L.seg(hub[0] - dx * 1.2, hub[1], hub[2] - dz * 1.2, hub[0] + dx * 1.4, hub[1], hub[2] + dz * 1.4, C.sHi, 0.9);
  for (let b = 0; b < 3; b++){
    const th = spin + b * Math.PI * 2 / 3;
    const ex = hub[0] + dx * 1.4 + px * Math.cos(th) * len, ey = hub[1] + Math.sin(th) * len, ez = hub[2] + dz * 1.4 + pz * Math.cos(th) * len;
    c.L.seg(hub[0] + dx * 1.4, hub[1], hub[2] + dz * 1.4, ex, ey, ez, C.sHi, 0.9, C.sMid, 0.5);
  }
  if (c.col) c.col.cyl({x, z, r:0.4, y0:y0 - 0.5, y1:y0 + h, thin:true});
  c.count++;
}

/* Region styles: each one builds a district around (c.x, c.z) and sets c.clear (keep-out radius for infill). */
export const STYLES = {
  pads(c){
    for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++){ const [px, pz] = rotPt(c.x, c.z, (a - 0.5) * 13, (b - 1) * 12, c.rot); addPad(c, px, pz, 4.6); }
    for (const s of [-1, 1]){
      const [gx, gz] = rotPt(c.x, c.z, s * 13.5, -9, c.rot), [hx, hz] = rotPt(c.x, c.z, s * 13.5, 9, c.rot), [mx, mz] = rotPt(c.x, c.z, s * 13.5, 0, c.rot);
      const gy = c.ground(mx, mz);
      addBox(c, gx, gz, 1, 1, 15, c.rot, {y0:gy, floors:2.5, noRoof:true});
      addBox(c, hx, hz, 1, 1, 15, c.rot, {y0:gy, floors:2.5, noRoof:true});
      addBox(c, mx, mz, 1.4, 19, 1.4, c.rot, {y0:gy + 14, floors:0, noRoof:true, bright:1.2});
    }
    const [tx, tz] = rotPt(c.x, c.z, 0, -21, c.rot); addBox(c, tx, tz, 8, 4.5, 8, c.rot, {floors:2.6});
    c.clear = 26;
  },
  tower(c){
    const y = c.ground(c.x, c.z);
    addBox(c, c.x, c.z, 13, 13, 20, c.rot, {y0:y, floors:3});
    addBox(c, c.x, c.z, 8.5, 8.5, 22, c.rot + 0.785, {y0:y + 20, floors:2.6, bright:1.15});
    addBox(c, c.x, c.z, 5, 5, 14, c.rot, {y0:y + 42, floors:2.2, bright:1.3});
    addMast(c, c.x, c.z, y + 56, 18, {base:1.2});
    for (let k = 0; k < 12; k++){
      const a = k / 12 * Math.PI * 2 + c.rng() * 0.3, R = 17 + c.rng() * 8;
      addBox(c, c.x + Math.cos(a) * R, c.z + Math.sin(a) * R, 4 + c.rng() * 4, 4 + c.rng() * 4, 6 + c.rng() * 12, c.rot, {floors:3});
    }
    c.clear = 28;
  },
  ring(c){
    const n = 16, R = 14;
    for (let k = 0; k < n; k++){ const a = k / n * Math.PI * 2; addBox(c, c.x + Math.cos(a) * R, c.z + Math.sin(a) * R, 5.4, 3.6, 5 + (k % 3) * 2, a + Math.PI / 2, {floors:2.6}); }
    addDome(c, c.x, c.z, 6.5);
    for (let k = 0; k < 5; k++){ const a = c.rng() * Math.PI * 2, R2 = 21 + c.rng() * 4; addBox(c, c.x + Math.cos(a) * R2, c.z + Math.sin(a) * R2, 3 + c.rng() * 2, 3 + c.rng() * 2, 2.5 + c.rng() * 3, a); }
    c.clear = 24;
  },
  tanks(c){
    const C = c.C, pts = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++){
      if (a === 1 && b === -1) continue;
      const [px, pz] = rotPt(c.x, c.z, a * 9, b * 9, c.rot);
      addCyl(c, px, pz, 2.6 + c.rng() * 1.4, 5 + c.rng() * 4); pts.push([px, pz]);
    }
    for (let i = 0; i < 3; i++){ const [px, pz] = rotPt(c.x, c.z, -16, (i - 1) * 7, c.rot); addCyl(c, px, pz, 1.3, 20 + c.rng() * 9, {bands:7, sides:10}); pts.push([px, pz]); }
    for (let i = 0; i < pts.length - 1; i++){
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], y = Math.max(c.ground(ax, az), c.ground(bx, bz)) + 3.4;
      c.L.seg(ax, y, az, bx, y, bz, C.sHi, 0.5); c.L.seg(ax, y + 0.6, az, bx, y + 0.6, bz, C.sMid, 0.4);
    }
    c.clear = 24;
  },
  stacks(c){
    const C = c.C;
    for (let a = -3; a <= 3; a++) for (let b = -2; b <= 2; b++){
      if (c.rng() < 0.16) continue;
      const [px, pz] = rotPt(c.x, c.z, a * 4.2, b * 8, c.rot), n = 1 + Math.floor(c.rng() * 4);
      addBox(c, px, pz, 2.6, 6.4, n * 2.6, c.rot, {floors:2.6, noRoof:n > 2});
    }
    for (const s of [-1, 1]){
      const [ax, az] = rotPt(c.x, c.z, -16, s * 4, c.rot), [bx, bz] = rotPt(c.x, c.z, 16, s * 4, c.rot), y = c.ground(c.x, c.z) + 13;
      c.L.seg(ax, y, az, bx, y, bz, C.sHi, 0.75);
      c.L.seg(ax, c.ground(ax, az), az, ax, y, az, C.sMid, 0.5); c.L.seg(bx, c.ground(bx, bz), bz, bx, y, bz, C.sMid, 0.5);
    }
    c.clear = 24;
  },
  mast(c){
    addMast(c, c.x, c.z, c.ground(c.x, c.z), 34, {guys:true});
    addBox(c, c.x + 6, c.z + 3, 4, 3, 3, 0.3); addBox(c, c.x - 5, c.z + 5, 3, 3, 2.5, 0.3);
    c.clear = 12;
  },
  dome(c){
    addDome(c, c.x, c.z, 7.5, {slit:-0.6});
    addBox(c, c.x + 12, c.z + 2, 6, 4, 4, c.rot); addBox(c, c.x - 10, c.z + 6, 4, 4, 3, c.rot);
    addMast(c, c.x + 12, c.z - 7, c.ground(c.x + 12, c.z - 7), 11);
    c.clear = 16;
  },
  turbines(c){
    for (let k = 0; k < 9; k++){
      const [px, pz] = rotPt(c.x, c.z, (k - 4) * 7.5, Math.sin(k * 1.7) * 3, c.rot);
      addTurbine(c, px, pz, 15 + c.rng() * 4, c.rot + 0.3, c.rng() * Math.PI * 2);
    }
    c.clear = 30;
  },
  huts(c){
    for (let k = 0; k < 6; k++){ const a = c.rng() * Math.PI * 2, r = 3 + c.rng() * 9; addBox(c, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 3 + c.rng() * 2.5, 3 + c.rng() * 2.5, 2.4 + c.rng() * 2, c.rot + c.rng() * 0.3); }
    c.clear = 14;
  },
  adit(c){
    addBox(c, c.x, c.z, 6, 5, 3.5, c.rot);
    const [mx, mz] = rotPt(c.x, c.z, 5, -4, c.rot); addMast(c, mx, mz, c.ground(mx, mz), 13);
    const [bx, bz] = rotPt(c.x, c.z, -6, 3, c.rot); addBox(c, bx, bz, 3, 3, 2.2, c.rot);
    c.clear = 12;
  },
  causeway(c){
    const C = c.C, L = 116, yd = c.water + 1.5;
    let prev = null, step = 0;
    for (let s = -L / 2; s <= L / 2; s += 4, step++){
      const [px, pz] = rotPt(c.x, c.z, 0, s, c.rot);
      const [lx, lz] = rotPt(px, pz, -1.7, 0, c.rot), [rx, rz] = rotPt(px, pz, 1.7, 0, c.rot);
      if (step % 2 === 0){ c.L.seg(lx, Math.min(c.ground(lx, lz), c.water) - 1, lz, lx, yd, lz, C.sLo, 0.25, C.sMid, 0.55); c.L.seg(rx, Math.min(c.ground(rx, rz), c.water) - 1, rz, rx, yd, rz, C.sLo, 0.25, C.sMid, 0.55); }
      if (prev){ c.L.seg(prev[0], yd, prev[1], lx, yd, lz, C.sHi, 0.85); c.L.seg(prev[2], yd, prev[3], rx, yd, rz, C.sHi, 0.85); c.F.quad([prev[0], yd, prev[1]], [prev[2], yd, prev[3]], [rx, yd, rz], [lx, yd, lz], C.face, 0.07, 0.07); }
      prev = [lx, lz, rx, rz];
    }
    if (c.col) c.col.box({x:c.x, z:c.z, w:3.4, d:L, rot:c.rot, y0:yd - 0.6, y1:yd, deck:true});
    const pyl = [];
    for (let s = -L / 2 + 6; s <= L / 2 - 6; s += 21){ const [px, pz] = rotPt(c.x, c.z, 2.6, s, c.rot); addMast(c, px, pz, yd, 10, {base:0.5}); pyl.push([px, pz]); }
    for (let i = 0; i < pyl.length - 1; i++){
      const [ax, az] = pyl[i], [bx, bz] = pyl[i + 1];
      for (let k = 0; k < 10; k++){
        const t1 = k / 10, t2 = (k + 1) / 10, sag = t => 4 * t * (1 - t) * 2.2;
        c.L.seg(lerp(ax, bx, t1), yd + 10 - sag(t1), lerp(az, bz, t1), lerp(ax, bx, t2), yd + 10 - sag(t2), lerp(az, bz, t2), C.sHi, 0.5);
      }
    }
    c.clear = 0;
  },
  dock(c){
    const C = c.C;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++){
      if (c.rng() < 0.15) continue;
      const [px, pz] = rotPt(c.x, c.z, a * 7.5, b * 6.5, c.rot);
      addBox(c, px, pz, 6, 5, 3.5 + c.rng() * 2, c.rot + (c.rng() - 0.5) * 0.12, {y0:c.water - 2, floors:2.4});
    }
    for (let k = 0; k < 3; k++){ const [px, pz] = rotPt(c.x, c.z, 16, (k - 1) * 7, c.rot); addBox(c, px, pz, 16, 1.6, 0.6, c.rot, {y0:c.water + 0.3, floors:0, noRoof:true}); }
    const [cx2, cz2] = rotPt(c.x, c.z, 4, -9, c.rot);
    addMast(c, cx2, cz2, c.water, 14, {base:0.8});
    const [jx, jz] = rotPt(cx2, cz2, 9, 3, c.rot);
    c.L.seg(cx2, c.water + 14, cz2, jx, c.water + 12.5, jz, C.sHi, 0.8);
    addBox(c, jx, jz, 2.4, 5.8, 2.4, c.rot + 0.3, {y0:c.water + 6, floors:0});
    c.L.seg(jx, c.water + 12.5, jz, jx, c.water + 8.4, jz, C.sMid, 0.6);
    c.clear = 18;
  },
  hatch(c){
    for (let k = 0; k < 5; k++){ const [px, pz] = rotPt(c.x, c.z, (k - 2) * 5.5, 0, c.rot); addBox(c, px, pz, 4, 22, 3.2, c.rot, {floors:0}); }
    const [ox, oz] = rotPt(c.x, c.z, 0, -16, c.rot); addBox(c, ox, oz, 9, 5, 6, c.rot, {floors:3});
    c.clear = 18;
  },
  reeds(c){
    const C = c.C;
    for (let k = 0; k < 900; k++){
      const a = c.rng() * Math.PI * 2, r = Math.sqrt(c.rng()) * 20, px = c.x + Math.cos(a) * r, pz = c.z + Math.sin(a) * r;
      const y = Math.max(c.ground(px, pz), c.water - 0.4), h = 0.8 + c.rng() * 1.6;
      c.L.seg(px, y, pz, px + (c.rng() - 0.5) * 0.6, y + h, pz + (c.rng() - 0.5) * 0.6, C.reedLo, 0.2, C.reed, 0.5);
    }
    addBox(c, c.x - 6, c.z - 8, 2.4, 2.4, 2, 0.4, {y0:c.water + 0.4});
    c.clear = 22;
  },
  buoy(c){
    addCyl(c, c.x, c.z, 3, 1.2, {y0:c.water - 0.4, bands:0, sides:16});
    addMast(c, c.x, c.z, c.water + 0.8, 16, {base:0.7});
    c.clear = 8;
  }
};
