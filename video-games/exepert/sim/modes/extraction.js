/* Extraction (Marathon-style): crews of three drop onto Kessler IV, loot caches, data logs and crates,
   and bank their haul only by calling a lift at an exfil point and riding it out. Dying drops your pack
   for anyone to take. Sentinel drones guard the hot zones, where the loot is richer. Most value banked wins. */
import { PLAYER } from '../constants.js';
import { mulberry32 } from '../../../kessler-world/kessler-util.js';

const CREWS = 4;
const SLOTS = 8;
const USE_RANGE = 2.6;
const LIFT_CALL = 60, LIFT_STAY = 12, LIFT_COOLDOWN = 25, LIFT_RADIUS = 9;
const NEED = {cache:1.5, log:0.8, crate:0.6, pack:0.9, lift:1.2};

const r1 = v => Math.round(v * 10) / 10;

export const extraction = {
  id:'extraction', name:'EXTRACTION', short:'EXT', blurb:'Loot Kessler IV with your crew, call a lift and get out alive. Bank the most to win.',
  teams:CREWS, sector:'full', sectors:['full'], maxPlayers:12, fill:9, scoreLimit:0, timeLimit:900, respawn:20,

  init(room){
    const W = room.world, rng = mulberry32((room.rng() * 4294967296) >>> 0);
    // clear sentinels from a previous match
    for (const p of [...room.players.values()]) if (p.sentinel){ room.players.delete(p.id); room.events.push({e:'leave', p:p.id}); }
    const loot = [];
    let id = 1;
    const hotAt = (x, z) => W.zones.some(zz => zz.hots.some(h => Math.hypot(h.x - x, h.z - z) < h.r));
    for (const zone of W.zones){
      for (const poi of zone.pois){
        if (poi.t === 'ca') loot.push({id:id++, kind:'cache', name:poi.name, code:poi.id, x:poi.x, y:poi.y, z:poi.z, items:3, value:250 + Math.floor(rng() * 250), shield:50});
        if (poi.t === 'lr') loot.push({id:id++, kind:'log', name:poi.name, code:poi.id, x:poi.x, y:poi.y, z:poi.z, items:1, value:300 + Math.floor(rng() * 300), shield:0});
      }
    }
    // scattered crates at random standable spots
    const spots = W.spawns.slice().sort(() => rng() - 0.5).slice(0, 30);
    for (const s of spots) loot.push({id:id++, kind:'crate', name:'SUPPLY CRATE', code:'', x:s.x, y:s.y, z:s.z, items:1, value:60 + Math.floor(rng() * 120), shield:0, heal:40});
    for (const l of loot){ if (hotAt(l.x, l.z)) l.value = Math.round(l.value * 1.8); l.taken = false; }
    const exfils = [];
    for (const zone of W.zones) for (const poi of zone.pois) if (poi.t === 'ex') exfils.push({i:exfils.length, name:poi.name, code:poi.id, x:poi.x, y:poi.y, z:poi.z, state:'idle', t:0, by:-1});
    room.ms = {loot, exfils, bank:new Array(CREWS).fill(0), nextLoot:id, use:new Map()};
    // one sentinel drone guards every hot zone
    let k = 1;
    for (const zone of W.zones) for (const h of zone.hots){
      const s = room.makePlayer(`SENTINEL-${String(k++).padStart(2, '0')}`, true);
      s.sentinel = true; s.team = 90; s.loadout = ['kestrel', 'breach']; s.guard = {x:h.x, z:h.z, r:h.r}; s.botRange = 35;
    }
  },

  onSpawn(room, p){
    p.pack = {items:0, value:0}; p.useT = 0;
    if (p.sentinel) p.hp = 80;
    else {
      // drop in from orbit like Uplink
      p.m.y += 60; p.m.vy = -40; p.m.ground = false; p.protect = 3;
    }
  },

  noRespawn(room, p){ return !!p.sentinel; },

  spawnPoint(room, p){
    const W = room.world;
    if (p.sentinel){
      const g = p.guard, list = W.spawns.filter(s => Math.hypot(s.x - g.x, s.z - g.z) < g.r + 8);
      const s = list.length ? list[Math.floor(room.rng() * list.length)] : null;
      return s ? {x:s.x, y:s.y, z:s.z} : null;
    }
    // crews land together, far from other crews
    const mates = [...room.players.values()].filter(q => q !== p && q.alive && q.team === p.team && !q.sentinel);
    if (mates.length){
      const m = mates[0].m;
      const list = W.spawns.filter(s => Math.hypot(s.x - m.x, s.z - m.z) < 40);
      if (list.length){ const s = list[Math.floor(room.rng() * list.length)]; return {x:s.x, y:s.y, z:s.z}; }
    }
    let best = null, bs = -Infinity;
    for (let k = 0; k < 40; k++){
      const s = W.spawns[Math.floor(room.rng() * W.spawns.length)];
      let d = 200;
      for (const q of room.players.values()) if (q.alive && q.team !== p.team) d = Math.min(d, Math.hypot(q.m.x - s.x, q.m.z - s.z));
      if (d > bs){ bs = d; best = s; }
    }
    return best ? {x:best.x, y:best.y, z:best.z} : null;
  },

  onKill(){},

  onDeath(room, v){
    if (v.sentinel || !v.pack || v.pack.items === 0) return;
    const ms = room.ms;
    ms.loot.push({id:ms.nextLoot++, kind:'pack', name:`${v.name}'S PACK`, code:'', x:v.m.x, y:v.m.y, z:v.m.z, items:v.pack.items, value:v.pack.value, shield:0, taken:false});
    room.events.push({e:'drop', p:v.id, v:v.pack.value});
    v.pack = {items:0, value:0};
  },

  /* What a runner standing here could interact with. */
  target(room, p){
    const ms = room.ms;
    let best = null, bd = USE_RANGE;
    for (const l of ms.loot){
      if (l.taken) continue;
      const d = Math.hypot(l.x - p.m.x, l.z - p.m.z);
      if (d < bd && Math.abs(l.y - p.m.y) < 3){ bd = d; best = {kind:l.kind, ref:l}; }
    }
    if (!best) for (const ex of ms.exfils){
      if (ex.state !== 'idle') continue;
      if (Math.hypot(ex.x - p.m.x, ex.z - p.m.z) < LIFT_RADIUS * 0.6) return {kind:'lift', ref:ex};
    }
    return best;
  },

  onUseHeld(room, p, dt){
    if (!p.alive || p.sentinel) return;
    const t = this.target(room, p);
    if (!t || dt <= 0){ p.useT = 0; p.useRef = null; return; }
    if (p.useRef !== t.ref){ p.useRef = t.ref; p.useT = 0; }
    p.useT += dt;
    if (p.useT >= NEED[t.kind]){ p.useT = 0; p.useRef = null; this.complete(room, p, t); }
  },

  complete(room, p, t){
    if (t.kind === 'lift'){
      const ex = t.ref; ex.state = 'called'; ex.t = LIFT_CALL; ex.by = p.team;
      room.telemetryCounters.lifts = (room.telemetryCounters.lifts || 0) + 1;
      room.events.push({e:'lift', i:ex.i, s:'called', t:LIFT_CALL, by:p.id});
      return;
    }
    const l = t.ref;
    if (p.pack.items + l.items > SLOTS && l.kind !== 'crate'){ p.pe.push({e:'full'}); return; }
    l.taken = true;
    room.telemetryCounters.loots = (room.telemetryCounters.loots || 0) + 1;
    p.pack.items = Math.min(SLOTS, p.pack.items + l.items); p.pack.value += l.value;
    if (l.shield) p.shield = Math.min(100, p.shield + l.shield);
    if (l.heal) p.hp = Math.min(PLAYER.hp, p.hp + l.heal);
    room.events.push({e:'loot', p:p.id, id:l.id, k:l.kind, v:l.value});
  },

  tick(room, dt){
    const ms = room.ms;
    // bots loot what they stand next to and call lifts when their packs are heavy
    for (const p of room.players.values()){
      if (!p.bot || p.sentinel || !p.alive) continue;
      const t = this.target(room, p);
      if (t && (t.kind !== 'lift' || p.pack.items >= 4)) this.onUseHeld(room, p, dt);
      else p.useT = 0;
    }
    for (const ex of ms.exfils){
      if (ex.state === 'called'){
        ex.t -= dt;
        if (ex.t <= 0){ ex.state = 'here'; ex.t = LIFT_STAY; room.events.push({e:'lift', i:ex.i, s:'here', t:LIFT_STAY}); }
      } else if (ex.state === 'here'){
        ex.t -= dt;
        for (const p of room.players.values()){
          if (!p.alive || p.sentinel) continue;
          if (Math.hypot(p.m.x - ex.x, p.m.z - ex.z) <= LIFT_RADIUS && Math.abs(p.m.y - ex.y) < 6){
            const v = p.pack.value;
            ms.bank[p.team] += v; p.score += v; p.banked = (p.banked || 0) + v;
            room.telemetryCounters.extracted = (room.telemetryCounters.extracted || 0) + 1;
            room.telemetryCounters.extractedValue = (room.telemetryCounters.extractedValue || 0) + v;
            room.events.push({e:'extract', p:p.id, v, i:ex.i});
            p.pack = {items:0, value:0};
            p.alive = false; p.respawnAt = room.time + 8; p.extracted = true;
          }
        }
        if (ex.t <= 0){ ex.state = 'cooldown'; ex.t = LIFT_COOLDOWN; room.events.push({e:'lift', i:ex.i, s:'gone', t:LIFT_COOLDOWN}); }
      } else if (ex.state === 'cooldown'){
        ex.t -= dt; if (ex.t <= 0){ ex.state = 'idle'; ex.t = 0; }
      }
    }
  },

  result(room){
    if (room.matchTime < room.timeLimit) return null;
    const b = room.ms.bank, top = Math.max(...b), winners = b.map((v, i) => v === top ? i : -1).filter(i => i >= 0);
    return {winner:winners.length === 1 && top > 0 ? winners[0] : -1, reason:'RELAY COLLAPSE', bank:b};
  },

  hud(room){
    const ms = room.ms;
    return {b:ms.bank, x:ms.exfils.map(ex => [ex.state === 'idle' ? 0 : ex.state === 'called' ? 1 : ex.state === 'here' ? 2 : 3, Math.ceil(ex.t)]), taken:ms.loot.filter(l => l.taken).map(l => l.id)};
  },

  snapshot(room){
    if (room.tickN % 40 !== 1) return null;
    const ms = room.ms;
    return {
      loot:ms.loot.filter(l => !l.taken).map(l => [l.id, l.kind, r1(l.x), r1(l.y), r1(l.z), l.value]),
      ex:ms.exfils.map(ex => [ex.code, ex.name, r1(ex.x), r1(ex.y), r1(ex.z)])
    };
  },

  personal(room, p){
    const t = p.alive ? this.target(room, p) : null;
    return {pk:[p.pack?.items || 0, p.pack?.value || 0, SLOTS], it:t ? [t.kind, t.ref.name || t.ref.code, Math.round((p.useT || 0) / NEED[t.kind] * 100)] : null, bk:p.banked || 0};
  },

  botGoal(room, p){
    if (p.sentinel){
      const g = p.guard, a = room.rng() * Math.PI * 2, r = room.rng() * g.r;
      return {x:g.x + Math.cos(a) * r, z:g.z + Math.sin(a) * r};
    }
    const ms = room.ms;
    if (p.pack.items >= 4 || room.timeLimit - room.matchTime < 120){
      const ex = ms.exfils.filter(e => e.state !== 'cooldown').sort((a, b) => Math.hypot(a.x - p.m.x, a.z - p.m.z) - Math.hypot(b.x - p.m.x, b.z - p.m.z))[0];
      if (ex) return {x:ex.x, z:ex.z};
    }
    const l = ms.loot.filter(l => !l.taken).sort((a, b) => Math.hypot(a.x - p.m.x, a.z - p.m.z) - Math.hypot(b.x - p.m.x, b.z - p.m.z))[p.id % 2];
    return l ? {x:l.x, z:l.z} : null;
  }
};
