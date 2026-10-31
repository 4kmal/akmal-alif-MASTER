/* EXEPERT bots: perceive with line-of-sight checks, react after a delay, aim with an error that settles,
   strafe while fighting and path-find with A* when nobody is in sight. Bots drive the same movement code
   as players by producing input frames. */
import { BTN } from './constants.js';
import { eyeHeight } from './movement.js';
import { WEAPONS } from './weapons.js';

export const DIFFICULTY = {
  easy:  {react:0.85, err:0.09,  settle:1.5, fov:1.7, range:55, turn:4.5, burst:[3, 6],  pause:[0.6, 1.1], jump:0.02},
  normal:{react:0.5,  err:0.045, settle:1.0, fov:2.0, range:80, turn:6.5, burst:[4, 9],  pause:[0.3, 0.7], jump:0.05},
  hard:  {react:0.28, err:0.024, settle:0.7, fov:2.3, range:110, turn:9, burst:[6, 12], pause:[0.15, 0.4], jump:0.09}
};

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export function botLoadout(rng){
  const r = rng();
  return r < 0.45 ? ['breach', 'scatter'] : r < 0.75 ? ['kestrel', 'scatter'] : r < 0.88 ? ['longwire', 'breach'] : ['scatter', 'kestrel'];
}

function perceive(room, p, B, D){
  const m = p.m, ey = m.y + eyeHeight(m), range = Math.min(D.range, p.botRange || Infinity);
  let best = null, bd = Infinity;
  for (const o of room.players.values()){
    if (o === p || !o.alive || !room.isEnemy(p, o) || o.cloak > 0) continue;
    const dx = o.m.x - m.x, dz = o.m.z - m.z, d = Math.hypot(dx, dz);
    if (d > range || d >= bd) continue;
    const ang = Math.abs(wrap(yawTo(dx, dz) - m.yaw));
    const heard = o.firingT > 0 && d < 40;
    if (ang > D.fov / 2 && d > 9 && !heard && B.target !== o.id) continue;
    if (!room.world.collide.clear(m.x, ey, m.z, o.m.x, o.m.y + 1.2, o.m.z)) continue;
    best = o; bd = d;
  }
  if (best){
    if (B.target !== best.id){ B.target = best.id; B.acquire = D.react * (0.7 + room.rng() * 0.6); B.err = D.err * 4; }
    B.seen = room.time; B.lastKnown = {x:best.m.x, z:best.m.z};
  } else if (B.target != null && room.time - B.seen > 1.2){
    B.target = null;
  }
}

function pickGoal(room, p, B){
  const hint = room.mode.botGoal?.(room, p);
  if (hint) return hint;
  if (B.lastKnown && room.time - B.seen < 8) return B.lastKnown;
  // gunfire shows on the radar: head toward the nearest enemy who fired recently
  let loud = null, ld = 90;
  for (const o of room.players.values()){
    if (!o.alive || o.firingT <= 0 || !room.isEnemy(p, o)) continue;
    const d = Math.hypot(o.m.x - p.m.x, o.m.z - p.m.z);
    if (d < ld){ ld = d; loud = o; }
  }
  if (loud) return {x:loud.m.x, z:loud.m.z};
  const S = room.world.sectors[room.sector];
  const near = S && Number.isFinite(S.r) && room.rng() < 0.6;
  const id = room.nav.randomNode(room.rng, n => room.inPlay(n.x, n.z) && (!near || Math.hypot(n.x - S.x, n.z - S.z) < S.r * 0.55));
  return id >= 0 ? {x:room.nav.nodes[id].x, z:room.nav.nodes[id].z} : null;
}

export function botThink(room, p, dt){
  const m = p.m, D = DIFFICULTY[room.difficulty] || DIFFICULTY.normal;
  const B = p.brain ||= {target:null, seen:-99, acquire:0, err:0, strafe:1, strafeT:0, think:0, path:null, pi:0, repath:0, goal:null, stuckT:0, sx:m.x, sz:m.z, burst:0, pause:0};
  B.think -= dt;
  if (B.think <= 0){ B.think = 0.2; perceive(room, p, B, D); }

  const f = {dt, mx:0, mz:0, yaw:m.yaw, pitch:m.pitch, b:0, e:0};
  const tgt = B.target != null ? room.players.get(B.target) : null;
  let wantYaw = m.yaw, wantPitch = 0;

  if (tgt && tgt.alive){
    const w = WEAPONS[p.weapon];
    const lead = w.kind === 'bolt' ? Math.hypot(tgt.m.x - m.x, tgt.m.z - m.z) / w.boltSpeed : 0;
    const tx = tgt.m.x + tgt.m.vx * lead, tz = tgt.m.z + tgt.m.vz * lead, ty = tgt.m.y + 1.15 + tgt.m.vy * lead * 0.5;
    const dx = tx - m.x, dz = tz - m.z, dy = ty - (m.y + eyeHeight(m)), d = Math.hypot(dx, dz);
    B.err = Math.max(D.err, B.err - dt * D.err * 3 / D.settle);
    const wob = room.time * 2.3 + p.id;
    wantYaw = yawTo(dx, dz) + Math.sin(wob) * B.err;
    wantPitch = Math.atan2(dy, d) + Math.cos(wob * 1.3) * B.err * 0.6;
    // footwork: keep a weapon-appropriate distance and strafe
    const ideal = w.id === 'scatter' ? [3, 10] : w.id === 'longwire' ? [30, 80] : [10, 32];
    f.mz = d > ideal[1] ? 1 : d < ideal[0] ? -0.7 : 0;
    B.strafeT -= dt;
    if (B.strafeT <= 0){ B.strafe = room.rng() < 0.5 ? -1 : 1; B.strafeT = 0.5 + room.rng() * 1.1; }
    f.mx = B.strafe * 0.85;
    if (room.rng() < D.jump * dt * 10) f.e |= BTN.JUMP;
    if (w.id === 'longwire' || (d > 25 && w.id !== 'scatter')) f.b |= BTN.ADS;
    // trigger discipline: fire in bursts once the reaction time has passed and the aim is close
    B.acquire -= dt;
    const off = Math.abs(wrap(wantYaw - m.yaw)) + Math.abs(wantPitch - m.pitch);
    if (B.acquire <= 0 && off < 0.12 + B.err && d < (w.range || 100)){
      if (B.pause > 0) B.pause -= dt;
      else {
        f.b |= BTN.FIRE;
        if (room.botFire(p)){ B.burst++; if (B.burst >= D.burst[0] + room.rng() * (D.burst[1] - D.burst[0])){ B.burst = 0; B.pause = D.pause[0] + room.rng() * (D.pause[1] - D.pause[0]); } }
      }
    }
    B.path = null;
  } else {
    // roam: follow a path to the goal
    B.repath -= dt;
    if (!B.path || B.pi >= B.path.length || B.repath <= 0){
      B.goal = pickGoal(room, p, B);
      if (B.goal){
        const a = room.nav.nearest(m.x, m.z), b = room.nav.nearest(B.goal.x, B.goal.z);
        B.path = room.nav.path(a, b) || null; B.pi = 0;
      }
      B.repath = 6 + room.rng() * 4;
    }
    if (B.path && B.pi < B.path.length){
      const n = room.nav.nodes[B.path[B.pi]], dx = n.x - m.x, dz = n.z - m.z, d = Math.hypot(dx, dz);
      if (d < 2.8) B.pi++;
      wantYaw = yawTo(dx, dz);
      f.mz = 1;
      if (d > 6 && B.pi < B.path.length - 2) f.b |= BTN.SPRINT;
    }
    wantPitch = 0;
  }

  // unstick: if barely moved for a while, hop and re-plan
  B.stuckT += dt;
  if (B.stuckT > 1.2){
    if (Math.hypot(m.x - B.sx, m.z - B.sz) < 0.8 && f.mz !== 0){ f.e |= BTN.JUMP; B.path = null; B.strafe = -B.strafe; }
    B.stuckT = 0; B.sx = m.x; B.sz = m.z;
  }

  // turn toward the wanted aim at a capped rate
  const turn = D.turn * dt;
  f.yaw = m.yaw + Math.max(-turn, Math.min(turn, wrap(wantYaw - m.yaw)));
  f.pitch = m.pitch + Math.max(-turn, Math.min(turn, wantPitch - m.pitch));
  return f;
}
