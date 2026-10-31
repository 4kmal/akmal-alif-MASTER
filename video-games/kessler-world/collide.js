/* Kessler IV: collision world for EXEPERT (browser and server).
   Terrain is a height function; structures are rotated boxes, vertical cylinders and domes
   indexed in a uniform XZ grid. Players are vertical cylinders (radius r, height h) standing on y.
   No DOM and no THREE in this file. */
import { clamp } from './kessler-util.js';

const EPS = 1e-6;

export class CollisionWorld {
  constructor({ ground, normalAt, bounds, cell = 8 }){
    this.ground = ground;
    this.normalAt = normalAt || null;
    this.bounds = bounds;
    this.cell = cell;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.items = [];
    this.cells = null;
    this.stamp = new Uint32Array(0);
    this.tick = 1;
  }

  addBox({x, z, w, d, rot = 0, y0, y1, ...rest}){
    const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
    const ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
    this.items.push({kind:'box', x, z, w, d, rot, y0, y1, c, s, hw, hd, minX:x - ex, maxX:x + ex, minZ:z - ez, maxZ:z + ez, ...rest});
  }
  addCyl({x, z, r, y0, y1, ...rest}){
    this.items.push({kind:'cyl', x, z, r, y0, y1, minX:x - r, maxX:x + r, minZ:z - r, maxZ:z + r, ...rest});
  }
  addDome({x, z, r, y0, ...rest}){
    this.items.push({kind:'dome', x, z, r, y0, y1:y0 + r, minX:x - r, maxX:x + r, minZ:z - r, maxZ:z + r, ...rest});
  }

  finalize(){
    const n = this.nx * this.nz, lists = Array.from({length:n}, () => []);
    this.items.forEach((it, id) => {
      it.id = id;
      const [i0, j0] = this.cellOf(it.minX, it.minZ), [i1, j1] = this.cellOf(it.maxX, it.maxZ);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * this.nx + i].push(id);
    });
    this.cells = lists.map(l => Int32Array.from(l));
    this.stamp = new Uint32Array(this.items.length);
    return this;
  }

  cellOf(x, z){
    const i = clamp(Math.floor((x - this.bounds.minX) / this.cell), 0, this.nx - 1);
    const j = clamp(Math.floor((z - this.bounds.minZ) / this.cell), 0, this.nz - 1);
    return [i, j];
  }

  /* Calls fn(item) once for every collider whose XZ box overlaps the query box. */
  query(minX, minZ, maxX, maxZ, fn){
    const t = ++this.tick, [i0, j0] = this.cellOf(minX, minZ), [i1, j1] = this.cellOf(maxX, maxZ);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++){
      const list = this.cells[j * this.nx + i];
      for (let k = 0; k < list.length; k++){
        const id = list[k]; if (this.stamp[id] === t) continue; this.stamp[id] = t;
        const it = this.items[id];
        if (it.maxX < minX || it.minX > maxX || it.maxZ < minZ || it.minZ > maxZ) continue;
        if (fn(it) === false) return;
      }
    }
  }

  /* ---------------- point / footprint helpers ---------------- */
  static local(it, x, z){ const dx = x - it.x, dz = z - it.z; return [dx * it.c + dz * it.s, -dx * it.s + dz * it.c]; }

  /* Horizontal distance from (x,z) to the collider footprint (0 inside). */
  static footDist(it, x, z){
    if (it.kind === 'box'){
      const [lx, lz] = CollisionWorld.local(it, x, z);
      return Math.hypot(Math.max(Math.abs(lx) - it.hw, 0), Math.max(Math.abs(lz) - it.hd, 0));
    }
    return Math.max(Math.hypot(x - it.x, z - it.z) - it.r, 0);
  }

  /* Top surface height of a collider at (x,z), or -Infinity if (x,z) is outside its footprint (with tolerance). */
  static topAt(it, x, z, tol){
    if (it.kind === 'dome'){
      const d = Math.hypot(x - it.x, z - it.z);
      if (d > it.r + tol) return -Infinity;
      const dd = Math.min(d, it.r);
      return it.y0 + Math.sqrt(Math.max(it.r * it.r - dd * dd, 0));
    }
    return CollisionWorld.footDist(it, x, z) <= tol ? it.y1 : -Infinity;
  }

  /* The highest support at or below feetY + stepUp under a player of radius r at (x,z). */
  supportAt(x, z, feetY, r = 0.4, stepUp = 0.55){
    let y = this.ground(x, z), item = null;
    const tol = r * 0.55;
    this.query(x - r, z - r, x + r, z + r, it => {
      if (it.y0 > feetY + stepUp) return;
      const top = CollisionWorld.topAt(it, x, z, tol);
      if (top > y && top <= feetY + stepUp){ y = top; item = it; }
    });
    return {y, item};
  }

  /* Lowest collider underside above headY (for jumping into overhangs). */
  ceilingAt(x, z, footY, headY, r = 0.4){
    let y = Infinity;
    this.query(x - r, z - r, x + r, z + r, it => {
      if (it.kind === 'dome') return;
      if (it.y0 > footY + 0.2 && it.y0 < y && it.y0 <= headY + 0.01 && CollisionWorld.footDist(it, x, z) < r * 0.7) y = it.y0;
    });
    return y;
  }

  /* Push a vertical cylinder out of every collider it overlaps (ignoring anything it can step onto).
     Returns the total XZ correction and the dominant wall normal. */
  pushOut(x, y, z, r, h, stepUp = 0.55){
    let px = 0, pz = 0, best = 0, wnx = 0, wnz = 0, hit = null;
    this.query(x - r, z - r, x + r, z + r, it => {
      const top = it.kind === 'dome' ? it.y0 + it.r : it.y1;
      if (top <= y + stepUp || it.y0 >= y + h) return;
      const cx = x + px, cz = z + pz;
      let nx = 0, nz = 0, pen = 0;
      if (it.kind === 'box'){
        const [lx, lz] = CollisionWorld.local(it, cx, cz);
        const qx = clamp(lx, -it.hw, it.hw), qz = clamp(lz, -it.hd, it.hd), ddx = lx - qx, ddz = lz - qz, dist = Math.hypot(ddx, ddz);
        let ux, uz;
        if (dist > EPS){ if (dist >= r) return; pen = r - dist; ux = ddx / dist; uz = ddz / dist; }
        else {
          const ax = it.hw - Math.abs(lx), az = it.hd - Math.abs(lz);
          if (ax < az){ ux = Math.sign(lx) || 1; uz = 0; pen = ax + r; } else { ux = 0; uz = Math.sign(lz) || 1; pen = az + r; }
        }
        nx = ux * it.c - uz * it.s; nz = ux * it.s + uz * it.c;
      } else {
        let rr = it.r;
        if (it.kind === 'dome'){ const above = Math.max(y + stepUp - it.y0, 0); rr = Math.sqrt(Math.max(it.r * it.r - above * above, 0)); if (rr <= EPS) return; }
        const dx = cx - it.x, dz = cz - it.z, dist = Math.hypot(dx, dz);
        if (dist >= rr + r) return;
        pen = rr + r - dist;
        if (dist > EPS){ nx = dx / dist; nz = dz / dist; } else { nx = 1; nz = 0; }
      }
      px += nx * pen; pz += nz * pen;
      if (pen > best){ best = pen; wnx = nx; wnz = nz; hit = it; }
    });
    return {dx:px, dz:pz, nx:wnx, nz:wnz, hit};
  }

  /* True if a cylinder at (x,y,z) overlaps any collider or sits below the terrain. */
  blocked(x, y, z, r, h){
    if (y < this.ground(x, z) - 0.05) return true;
    let b = false;
    this.query(x - r, z - r, x + r, z + r, it => {
      const top = it.kind === 'dome' ? it.y0 + it.r : it.y1;
      if (top <= y || it.y0 >= y + h) return;
      if (CollisionWorld.footDist(it, x, z) < r){ b = true; return false; }
    });
    return b;
  }

  /* Nearest wall face within reach of a cylinder, used for wall-running. */
  wallNear(x, y, z, r, h, reach = 0.35){
    let best = Infinity, out = null;
    this.query(x - r - reach, z - r - reach, x + r + reach, z + r + reach, it => {
      if (it.kind !== 'box' || it.y1 < y + h * 0.6 || it.y0 > y + 0.3) return;
      const [lx, lz] = CollisionWorld.local(it, x, z);
      const qx = clamp(lx, -it.hw, it.hw), qz = clamp(lz, -it.hd, it.hd), ddx = lx - qx, ddz = lz - qz, dist = Math.hypot(ddx, ddz);
      if (dist <= EPS || dist > r + reach || dist >= best) return;
      const ux = ddx / dist, uz = ddz / dist;
      best = dist; out = {nx:ux * it.c - uz * it.s, nz:ux * it.s + uz * it.c, dist, item:it};
    });
    return out;
  }

  /* ---------------- rays ---------------- */
  raycastTerrain(ox, oy, oz, dx, dy, dz, maxT){
    let prevT = 0, prevD = oy - this.ground(ox, oz);
    if (prevD < 0) return {t:0, x:ox, y:oy, z:oz, kind:'terrain'};
    let t = 0;
    while (t < maxT){
      t = Math.min(maxT, t + clamp(prevD * 0.5, 0.2, 4));
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t, d = y - this.ground(x, z);
      if (d < 0){
        let a = prevT, b = t;
        for (let k = 0; k < 12; k++){ const m = (a + b) / 2; if (oy + dy * m - this.ground(ox + dx * m, oz + dz * m) < 0) b = m; else a = m; }
        const hx = ox + dx * b, hz = oz + dz * b;
        const n = this.normalAt ? this.normalAt(hx, hz) : [0, 1, 0];
        return {t:b, x:hx, y:oy + dy * b, z:hz, nx:n[0], ny:n[1], nz:n[2], kind:'terrain'};
      }
      prevT = t; prevD = d;
      if (dy > 0 && y > 400) break;
    }
    return null;
  }

  static rayItem(it, ox, oy, oz, dx, dy, dz, maxT){
    if (it.kind === 'box'){
      const [lox, loz] = CollisionWorld.local(it, ox, oz);
      const ldx = dx * it.c + dz * it.s, ldz = -dx * it.s + dz * it.c;
      let tmin = 0, tmax = maxT, axis = -1, sgn = 0;
      const slab = (o, d, lo, hi, ax) => {
        if (Math.abs(d) < EPS){ return o >= lo && o <= hi; }
        let t1 = (lo - o) / d, t2 = (hi - o) / d, s = -1;
        if (t1 > t2){ const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin){ tmin = t1; axis = ax; sgn = s; }
        if (t2 < tmax) tmax = t2;
        return tmin <= tmax;
      };
      if (!slab(lox, ldx, -it.hw, it.hw, 0) || !slab(oy, dy, it.y0, it.y1, 1) || !slab(loz, ldz, -it.hd, it.hd, 2)) return null;
      if (axis < 0) return null; // origin inside
      let nx = 0, ny = 0, nz = 0;
      if (axis === 1) ny = sgn; else { const ux = axis === 0 ? sgn : 0, uz = axis === 2 ? sgn : 0; nx = ux * it.c - uz * it.s; nz = ux * it.s + uz * it.c; }
      return {t:tmin, nx, ny, nz};
    }
    if (it.kind === 'cyl'){
      let best = null;
      const fx = ox - it.x, fz = oz - it.z, a = dx * dx + dz * dz;
      if (a > EPS){
        const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - it.r * it.r, disc = b * b - 4 * a * c;
        if (disc >= 0){
          const t = (-b - Math.sqrt(disc)) / (2 * a), y = oy + dy * t;
          if (t >= 0 && t <= maxT && y >= it.y0 && y <= it.y1){ const hx = fx + dx * t, hz = fz + dz * t, l = Math.hypot(hx, hz) || 1; best = {t, nx:hx / l, ny:0, nz:hz / l}; }
        }
      }
      if (Math.abs(dy) > EPS){
        const yc = dy < 0 ? it.y1 : it.y0, t = (yc - oy) / dy;
        if (t >= 0 && t <= maxT && (!best || t < best.t) && Math.hypot(fx + dx * t, fz + dz * t) <= it.r) best = {t, nx:0, ny:dy < 0 ? 1 : -1, nz:0};
      }
      return best;
    }
    // dome: upper hemisphere
    const fx = ox - it.x, fy = oy - it.y0, fz = oz - it.z;
    const b = fx * dx + fy * dy + fz * dz, c = fx * fx + fy * fy + fz * fz - it.r * it.r, disc = b * b - c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    for (const t of [-b - sq, -b + sq]){
      if (t < 0 || t > maxT) continue;
      const hy = fy + dy * t; if (hy < 0) continue;
      return {t, nx:(fx + dx * t) / it.r, ny:hy / it.r, nz:(fz + dz * t) / it.r};
    }
    return null;
  }

  /* Closest collider hit along a ray, walking the grid with a 2D DDA. */
  raycastItems(ox, oy, oz, dx, dy, dz, maxT, skip){
    const B = this.bounds, cs = this.cell, t0 = ++this.tick;
    let best = null;
    let gx = (ox - B.minX) / cs, gz = (oz - B.minZ) / cs;
    let i = Math.floor(gx), j = Math.floor(gz);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > EPS ? cs / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > EPS ? cs / Math.abs(dz) : Infinity;
    let tx = Math.abs(dx) > EPS ? ((dx > 0 ? i + 1 - gx : gx - i) * cs) / Math.abs(dx) : Infinity;
    let tz = Math.abs(dz) > EPS ? ((dz > 0 ? j + 1 - gz : gz - j) * cs) / Math.abs(dz) : Infinity;
    let tCell = 0;
    for (let guard = 0; guard < 4096; guard++){
      if (i >= 0 && j >= 0 && i < this.nx && j < this.nz){
        const list = this.cells[j * this.nx + i];
        for (let k = 0; k < list.length; k++){
          const id = list[k]; if (this.stamp[id] === t0) continue; this.stamp[id] = t0;
          const it = this.items[id]; if (skip && skip(it)) continue;
          const h = CollisionWorld.rayItem(it, ox, oy, oz, dx, dy, dz, best ? best.t : maxT);
          if (h && (!best || h.t < best.t)){ h.item = it; best = h; }
        }
      }
      tCell = Math.min(tx, tz);
      if (tCell > maxT || (best && tCell > best.t)) break;
      if (tx < tz){ tx += tdx; i += si; } else { tz += tdz; j += sj; }
      if ((si > 0 && i >= this.nx) || (si < 0 && i < 0)) { if (Math.abs(dx) > EPS) break; }
      if ((sj > 0 && j >= this.nz) || (sj < 0 && j < 0)) { if (Math.abs(dz) > EPS) break; }
    }
    if (best){ best.x = ox + dx * best.t; best.y = oy + dy * best.t; best.z = oz + dz * best.t; best.kind = best.item.kind; }
    return best;
  }

  /* Nearest hit of terrain or structures. dir must be normalised. */
  raycast(ox, oy, oz, dx, dy, dz, maxT, opts = {}){
    const a = opts.items === false ? null : this.raycastItems(ox, oy, oz, dx, dy, dz, maxT, opts.skip);
    const b = opts.terrain === false ? null : this.raycastTerrain(ox, oy, oz, dx, dy, dz, a ? a.t : maxT);
    return b && (!a || b.t < a.t) ? b : a;
  }

  /* Line of sight between two points (true if nothing solid is between them). */
  clear(ax, ay, az, bx, by, bz){
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < EPS) return true;
    return !this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.05);
  }
}
