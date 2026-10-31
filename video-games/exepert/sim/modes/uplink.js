/* Uplink (conquest): seven relays across the whole stitched map. Hold more than the enemy and their
   tickets bleed; every death costs a ticket. Vanguard deploys from Ridgeback's north pass, Syndicate
   from the Silt Basin hatchery, and both can redeploy onto relays they hold, dropping in by pod. */

const POINTS = [
  {zone:'ridgeback', name:'OBSERVATORY'},
  {zone:'ridgeback', name:'SHALE CUT'},
  {zone:'bastion', name:'COMMAND SPIRE'},
  {zone:'bastion', name:'CARGO YARDS'},
  {zone:'bastion', name:'HABITATION RING'},
  {zone:'silt', name:'PUMP STATION'},
  {zone:'silt', name:'CAUSEWAY'}
];
const BASES = [{zone:'ridgeback', name:'NORTH PASS'}, {zone:'silt', name:'HATCHERY'}];
const LETTERS = 'ABCDEFG';
const TICKETS = 300;
const CAP_RATE = 0.085;   // capture progress per second per extra runner (full swing is 2.0)
const BLEED_EVERY = 3;    // seconds between ticket bleeds

function region(world, ref){
  const z = world.zones.find(zz => zz.id === ref.zone);
  return z && z.regions.find(r => r.name === ref.name);
}

export const uplink = {
  id:'uplink', name:'UPLINK', short:'UPL', blurb:'Conquest across all of Kessler IV. Hold the relays, bleed their tickets.',
  teams:2, sector:'full', sectors:['full'], maxPlayers:16, fill:12, scoreLimit:TICKETS, timeLimit:900, respawn:6,

  init(room){
    const W = room.world;
    room.ms = {
      tickets:[TICKETS, TICKETS], bleed:0,
      points:POINTS.map((ref, i) => {
        const r = region(W, ref);
        return {i, letter:LETTERS[i], name:ref.name, zone:ref.zone, x:r.x, z:r.z, y:r.y, r:Math.max(12, Math.min(r.clear || 14, 22)), cap:0, owner:-1, contest:false, n:[0, 0]};
      }),
      bases:BASES.map(ref => { const r = region(W, ref); return {x:r.x, z:r.z, y:r.y}; })
    };
    // the relays nearest each base start owned by that side
    const pts = room.ms.points;
    pts[0].owner = 0; pts[0].cap = -1;
    pts[6].owner = 1; pts[6].cap = 1;
  },

  onKill(room, killer, victim){ if (victim.team >= 0) room.ms.tickets[victim.team] = Math.max(0, room.ms.tickets[victim.team] - 1); },

  tick(room, dt){
    const ms = room.ms;
    for (const pt of ms.points){
      pt.n = [0, 0];
      for (const p of room.players.values()){
        if (!p.alive || p.team < 0) continue;
        if (Math.hypot(p.m.x - pt.x, p.m.z - pt.z) <= pt.r && Math.abs(p.m.y - pt.y) < 16) pt.n[p.team]++;
      }
      const diff = pt.n[1] - pt.n[0];
      const wasContest = pt.contest;
      pt.contest = pt.n[0] > 0 && pt.n[1] > 0 && diff === 0;
      if (pt.contest && !wasContest) room.telemetryCounters.contests = (room.telemetryCounters.contests || 0) + 1;
      const before = pt.owner;
      if (diff !== 0){
        pt.cap = Math.max(-1, Math.min(1, pt.cap + Math.sign(diff) * Math.min(Math.abs(diff), 3) * CAP_RATE * dt));
      } else if (!pt.n[0] && !pt.n[1] && pt.owner >= 0){
        // an unattended relay drifts back to its owner
        const home = pt.owner === 0 ? -1 : 1;
        pt.cap += Math.sign(home - pt.cap) * Math.min(Math.abs(home - pt.cap), CAP_RATE * 0.5 * dt);
      }
      if (pt.cap <= -1) pt.owner = 0;
      else if (pt.cap >= 1) pt.owner = 1;
      else if ((pt.owner === 0 && pt.cap >= 0) || (pt.owner === 1 && pt.cap <= 0)) pt.owner = -1;
      if (pt.owner !== before){
        room.telemetryCounters.captures = (room.telemetryCounters.captures || 0) + 1;
        room.events.push({e:'cap', i:pt.i, o:pt.owner, was:before});
        // runners standing on a relay when it flips get the credit
        if (pt.owner >= 0) for (const p of room.players.values()) if (p.alive && p.team === pt.owner && Math.hypot(p.m.x - pt.x, p.m.z - pt.z) <= pt.r) p.score += 150;
      }
    }
    ms.bleed += dt;
    if (ms.bleed >= BLEED_EVERY){
      ms.bleed = 0;
      const held = [0, 0];
      for (const pt of ms.points) if (pt.owner >= 0) held[pt.owner]++;
      if (held[0] !== held[1]){
        const loser = held[0] < held[1] ? 0 : 1;
        ms.tickets[loser] = Math.max(0, ms.tickets[loser] - Math.abs(held[0] - held[1]));
      }
    }
  },

  result(room){
    const [a, b] = room.ms.tickets;
    if (a <= 0 || b <= 0) return {winner:a > b ? 0 : 1, reason:'TICKETS DEPLETED'};
    if (room.matchTime >= room.timeLimit) return {winner:a === b ? -1 : a > b ? 0 : 1, reason:'TIME'};
    return null;
  },

  hud(room){
    const ms = room.ms;
    return {t:ms.tickets, l:TICKETS, p:ms.points.map(pt => [pt.owner, Math.round(pt.cap * 100), pt.contest ? 1 : 0])};
  },

  /* Static relay data for the client (positions do not change during a match). */
  snapshot(room){
    if (room.tickN % 40 !== 1) return null;
    return {pts:room.ms.points.map(pt => [pt.letter, pt.name, Math.round(pt.x), Math.round(pt.y), Math.round(pt.z), pt.r])};
  },

  onDeploy(room, p, at){
    if (!p.bot) room.telemetryCounters.deploys = (room.telemetryCounters.deploys || 0) + 1;
    p.deploy = at === 'base' || at === 'auto' ? at : Number.isInteger(at) && at >= 0 && at < room.ms.points.length ? at : 'auto';
  },

  spawnPoint(room, p){
    const ms = room.ms, W = room.world;
    const owned = ms.points.filter(pt => pt.owner === p.team && !pt.contest && pt.n[1 - p.team] === 0);
    let anchor = null;
    if (Number.isInteger(p.deploy)){ const pt = ms.points[p.deploy]; if (owned.includes(pt)) anchor = pt; }
    if (!anchor && p.deploy !== 'base' && owned.length){
      // auto: the owned relay closest to the nearest relay we do not own (the front line)
      const front = ms.points.filter(pt => pt.owner !== p.team);
      const score = pt => front.length ? Math.min(...front.map(f => Math.hypot(f.x - pt.x, f.z - pt.z))) : 0;
      anchor = owned.slice().sort((a, b) => score(a) - score(b))[0];
    }
    const base = ms.bases[p.team];
    const c = anchor || base;
    const list = W.spawns.filter(s => Math.hypot(s.x - c.x, s.z - c.z) < (anchor ? 40 : 55));
    if (!list.length) return null;
    const s = list[Math.floor(room.rng() * list.length)];
    return {x:s.x, y:s.y, z:s.z};
  },

  onSpawn(room, p){
    // drop pod: arrive from orbit with a shield until touchdown
    p.m.y += 70; p.m.vy = -42; p.m.ground = false; p.protect = 3;
    room.events.push({e:'pod', p:p.id, x:Math.round(p.m.x * 10) / 10, z:Math.round(p.m.z * 10) / 10});
  },

  botGoal(room, p){
    const pts = room.ms.points.filter(pt => pt.owner !== p.team || pt.contest || pt.n[1 - p.team] > 0);
    if (!pts.length) return null;
    const near = pts.map(pt => ({pt, d:Math.hypot(pt.x - p.m.x, pt.z - p.m.z)})).sort((a, b) => a.d - b.d).slice(0, 2);
    const pick = near[(p.id % 3 === 0 && near.length > 1) ? 1 : 0].pt;
    const a = (p.id * 2.399) % (Math.PI * 2), r = pick.r * 0.5;
    return {x:pick.x + Math.cos(a) * r, z:pick.z + Math.sin(a) * r};
  }
};
