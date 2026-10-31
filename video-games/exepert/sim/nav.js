/* Bot navigation: A* over the world's walkable grid (world.nav). */
export class Nav {
  constructor(world){
    this.world = world;
    this.nodes = world.nav.nodes;
    this.step = world.nav.step;
    this.index = world.nav.index;
    this.B = world.bounds;
    // label connected components; bots only use the largest one
    this.comp = new Int32Array(this.nodes.length).fill(-1);
    const sizes = [];
    for (const n of this.nodes){
      if (this.comp[n.id] >= 0) continue;
      const c = sizes.length, stack = [n.id]; this.comp[n.id] = c; let size = 0;
      while (stack.length){ const a = stack.pop(); size++; for (const [b] of this.nodes[a].edges) if (this.comp[b] < 0){ this.comp[b] = c; stack.push(b); } }
      sizes.push(size);
    }
    this.main = sizes.indexOf(Math.max(...sizes));
    this.g = new Float64Array(this.nodes.length);
    this.came = new Int32Array(this.nodes.length);
    this.seen = new Uint32Array(this.nodes.length);
    this.stamp = 0;
  }

  nearest(x, z, maxRing = 4){
    const gi = Math.round((x - this.B.minX - this.step / 2) / this.step), gj = Math.round((z - this.B.minZ - this.step / 2) / this.step);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= maxRing && best < 0; r++){
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++){
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const id = this.index.get((gj + dj) * 4096 + (gi + di));
        if (id == null || this.comp[id] !== this.main) continue;
        const n = this.nodes[id], d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d < bd){ bd = d; best = id; }
      }
    }
    return best;
  }

  randomNode(rng, accept){
    for (let k = 0; k < 60; k++){
      const n = this.nodes[Math.floor(rng() * this.nodes.length)];
      if (this.comp[n.id] === this.main && (!accept || accept(n))) return n.id;
    }
    return -1;
  }

  /* A* from node a to node b. Returns node ids (excluding a) or null. */
  path(a, b, maxExpand = 6000){
    if (a < 0 || b < 0) return null;
    if (a === b) return [b];
    const N = this.nodes, s = ++this.stamp, g = this.g, came = this.came, seen = this.seen;
    const tx = N[b].x, tz = N[b].z, h = id => Math.hypot(N[id].x - tx, N[id].z - tz);
    const heap = [[h(a), a]];
    g[a] = 0; came[a] = -1; seen[a] = s;
    let expand = 0;
    while (heap.length && expand++ < maxExpand){
      const [, cur] = pop(heap);
      if (cur === b){
        const out = []; let c = b;
        while (c !== a && c >= 0){ out.push(c); c = came[c]; }
        return out.reverse();
      }
      for (const [nb, cost] of N[cur].edges){
        const ng = g[cur] + cost;
        if (seen[nb] !== s || ng < g[nb]){ seen[nb] = s; g[nb] = ng; came[nb] = cur; push(heap, [ng + h(nb), nb]); }
      }
    }
    return null;
  }
}

function push(h, item){
  h.push(item); let i = h.length - 1;
  while (i > 0){ const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
}
function pop(h){
  const top = h[0], last = h.pop();
  if (h.length){
    h[0] = last; let i = 0;
    for (;;){ const l = i * 2 + 1, r = l + 1; let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; }
  }
  return top;
}
