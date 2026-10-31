/* EXEPERT weapons. Spread uses a seeded generator per shot so the server can check the client's aim. */
import { mulberry32 } from '../../kessler-world/kessler-util.js';

export const WEAPONS = {
  breach:{
    id:'breach', slot:0, name:'VX-9 BREACH', role:'PULSE RIFLE', kind:'hitscan', auto:true,
    rpm:720, dmg:22, head:1.6, falloff:[28, 70, 0.62], range:220, mag:32, reload:1.9,
    spread:{hip:0.024, ads:0.0035, move:0.018, air:0.04}, recoil:0.011, kick:0.016, zoom:1.35, color:'#9fe8ff'
  },
  kestrel:{
    id:'kestrel', slot:1, name:'KESTREL E-7', role:'BLASTER CARBINE', kind:'bolt', auto:true,
    rpm:400, dmg:30, head:1.5, falloff:[60, 140, 0.8], range:180, boltSpeed:150, heat:0.09, cool:0.5, overheat:1.6,
    spread:{hip:0.02, ads:0.006, move:0.014, air:0.03}, recoil:0.014, kick:0.02, zoom:1.25, color:'#ff3b5c'
  },
  longwire:{
    id:'longwire', slot:2, name:'LONGWIRE', role:'RAIL RIFLE', kind:'rail', auto:false,
    rpm:48, dmg:110, head:2.0, falloff:[200, 300, 1], range:320, mag:5, reload:2.4, charge:0.5, pierce:3,
    spread:{hip:0.05, ads:0.0, move:0.03, air:0.06}, recoil:0.05, kick:0.06, zoom:3.4, color:'#d4ff3a'
  },
  scatter:{
    id:'scatter', slot:3, name:'SCATTER-12', role:'SMART SHOTGUN', kind:'pellets', auto:false,
    rpm:85, dmg:13, head:1.25, pellets:9, falloff:[9, 26, 0.35], range:45, mag:6, reload:2.3, homing:0.09,
    spread:{hip:0.075, ads:0.055, move:0.01, air:0.02}, recoil:0.04, kick:0.05, zoom:1.15, color:'#ffb02a'
  }
};
export const WEAPON_IDS = Object.keys(WEAPONS);

export const GRENADE = { fuse:2.1, radius:7.5, dmg:115, speed:19, charges:2, regen:14 };

export const fireInterval = w => 60 / w.rpm;

export function falloff(w, dist){
  const [a, b, min] = w.falloff;
  if (dist <= a) return 1;
  if (dist >= b) return min;
  return 1 - (1 - min) * (dist - a) / (b - a);
}

export function spreadFor(w, m){
  const s = w.spread;
  let v = m.ads ? s.ads : s.hip;
  const h = Math.hypot(m.vx || 0, m.vz || 0);
  v += s.move * Math.min(1, h / 7.6);
  if (!m.ground && !m.wall) v += s.air;
  if (m.crouch && m.ground) v *= 0.7;
  return v;
}

/* Aim direction from yaw/pitch (yaw 0 looks down -z). */
export function aimDir(yaw, pitch){
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/* Directions for one trigger pull: one ray, or one per pellet, jittered inside `spread` radians. */
export function shotDirs(w, yaw, pitch, spread, seed){
  const rng = mulberry32(seed >>> 0), n = w.pellets || 1, out = [];
  const f = aimDir(yaw, pitch);
  // basis around the aim
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const ux = -f[1] * rz, uy = rz * f[0] - rx * f[2], uz = f[1] * rx; // up = right x forward
  for (let i = 0; i < n; i++){
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * spread;
    const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    let dx = f[0] + rx * ca + ux * sa, dy = f[1] + uy * sa, dz = f[2] + rz * ca + uz * sa;
    const l = Math.hypot(dx, dy, dz); out.push([dx / l, dy / l, dz / l]);
  }
  return out;
}
