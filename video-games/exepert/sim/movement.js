/* EXEPERT player movement, shared by client prediction and the authoritative server.
   Titanfall / CoD style: sprint, slide, double jump, wall-run, wall-jump, mantle and a phase dash.
   Yaw 0 looks down -z (three.js camera convention); positive yaw turns left. */
import { MOVE, PLAYER, BTN } from './constants.js';

const SUB = 1 / 60;

export function createMover(x = 0, y = 0, z = 0, yaw = 0){
  return {
    x, y, z, vx:0, vy:0, vz:0, yaw, pitch:0,
    ground:true, coyote:0, jumps:0, crouch:false, slide:0, sprint:false,
    wall:null, wallT:0, wallCd:0, lastWall:null,
    dash:0, dashCd:0, dx:0, dz:0,
    mantle:null, water:0, ads:false
  };
}

/* Copy only the fields that define movement, for snapshots and reconciliation. */
export const MOVER_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'ground', 'coyote', 'jumps', 'crouch', 'slide', 'sprint', 'wall', 'wallT', 'wallCd', 'lastWall', 'dash', 'dashCd', 'dx', 'dz', 'mantle', 'water'];
export function moverState(m){
  const o = {};
  for (const k of MOVER_KEYS){ const v = m[k]; o[k] = v && typeof v === 'object' ? {...v} : v; }
  return o;
}
export function applyMoverState(m, s){
  for (const k of MOVER_KEYS){ const v = s[k]; m[k] = v && typeof v === 'object' ? {...v} : v; }
}

export function eyeHeight(m){ return m.crouch || m.slide > 0 ? PLAYER.crouchEye : PLAYER.eye; }
export function bodyHeight(m){ return m.crouch || m.slide > 0 ? PLAYER.crouchHeight : PLAYER.height; }

/**
 * Advance one input frame.
 * @param m mover state (mutated)
 * @param f input frame {dt, mx, mz, yaw, pitch, b, e} where b = held buttons, e = pressed this frame
 * @param world built Kessler world (collide, waterAt, normalAt)
 * @returns events {jumped, doubleJumped, wallJumped, landed, dashed, mantled, slid}
 */
export function stepMover(m, f, world){
  const ev = {};
  m.yaw = f.yaw; m.pitch = Math.max(-1.5, Math.min(1.5, f.pitch));
  let t = Math.min(Math.max(f.dt, 0), 0.1);
  let first = true;
  while (t > 1e-6){
    const dt = Math.min(SUB, t); t -= dt;
    step(m, f, dt, world, ev, first);
    first = false;
  }
  return ev;
}

function step(m, f, dt, world, ev, first){
  const cw = world.collide, b = f.b | 0, e = first ? (f.e | 0) : 0, R = PLAYER.radius;
  m.dashCd = Math.max(0, m.dashCd - dt);
  m.wallCd = Math.max(0, m.wallCd - dt);
  m.ads = !!(b & BTN.ADS);

  // mantle animation owns the body until it finishes
  if (m.mantle){
    const mt = m.mantle; mt.t += dt;
    const k = Math.min(1, mt.t / MOVE.mantleTime), up = Math.min(1, k * 1.6);
    m.x = mt.x0 + (mt.x1 - mt.x0) * k; m.z = mt.z0 + (mt.z1 - mt.z0) * k; m.y = mt.y0 + (mt.y1 - mt.y0) * up;
    if (k >= 1){ m.mantle = null; m.ground = true; m.vy = 0; m.vx = mt.vx; m.vz = mt.vz; }
    return;
  }

  // wish direction from yaw
  const sy = Math.sin(m.yaw), cy = Math.cos(m.yaw);
  let wx = -sy * f.mz + cy * f.mx, wz = -cy * f.mz - sy * f.mx;
  const wl = Math.hypot(wx, wz); if (wl > 1){ wx /= wl; wz /= wl; }
  const forward = f.mz > 0.3;

  const water = world.waterAt(m.x, m.z), depth = water - m.y;
  m.water = depth > 0 ? depth : 0;
  const swim = depth > 1.25;

  // crouch / slide
  const wantCrouch = !!(b & BTN.CROUCH);
  const hs = Math.hypot(m.vx, m.vz);
  if ((e & BTN.CROUCH) && m.ground && hs > 6.2 && m.slide <= 0 && !swim){
    const ux = m.vx / hs, uz = m.vz / hs, boost = Math.max(hs, MOVE.slideBoost);
    m.vx = ux * boost; m.vz = uz * boost; m.slide = MOVE.slideTime; ev.slid = true;
  }
  if (m.slide > 0){
    m.slide -= dt;
    if (!wantCrouch || Math.hypot(m.vx, m.vz) < MOVE.slideMin || !m.ground) m.slide = 0;
  }
  if (wantCrouch) m.crouch = true;
  else if (m.crouch){
    // stand up only if there is head room
    const ceil = cw.ceilingAt(m.x, m.z, m.y, m.y + PLAYER.height, R);
    if (ceil > m.y + PLAYER.height) m.crouch = false;
  }

  m.sprint = !!(b & BTN.SPRINT) && forward && !m.ads && !m.crouch;
  let speed = m.crouch ? MOVE.crouch : m.ads ? MOVE.ads : m.sprint ? MOVE.sprint : MOVE.walk;
  if (m.water > 0.5) speed *= MOVE.water;

  // dash (phase dash): a short burst along the wish direction
  if ((e & BTN.DASH) && m.dashCd <= 0){
    let dx = wx, dz = wz;
    if (Math.hypot(dx, dz) < 0.1){ dx = -sy; dz = -cy; }
    const l = Math.hypot(dx, dz); m.dx = dx / l; m.dz = dz / l;
    m.dash = MOVE.dashTime; m.dashCd = MOVE.dashCooldown; m.wall = null; ev.dashed = true;
  }

  // jumping
  if (m.ground) m.coyote = MOVE.coyote; else m.coyote = Math.max(0, m.coyote - dt);
  if (e & BTN.JUMP){
    if (m.wall){
      m.vx = m.vx * 0.8 + m.wall.nx * MOVE.wallJumpOut + wx * 1.5; m.vz = m.vz * 0.8 + m.wall.nz * MOVE.wallJumpOut + wz * 1.5;
      m.vy = MOVE.wallJumpUp; m.lastWall = m.wall; m.wall = null; m.wallCd = MOVE.wallReattach; m.jumps = 0; ev.wallJumped = true;
    } else if (m.coyote > 0 || swim){
      m.vy = swim ? 4.2 : MOVE.jump; m.ground = false; m.coyote = 0; m.slide = 0; ev.jumped = true;
    } else if (m.jumps < 1){
      m.vy = MOVE.doubleJump; m.jumps++;
      const h = Math.hypot(m.vx, m.vz), target = Math.max(h, speed);
      if (Math.hypot(wx, wz) > 0.1){ m.vx = m.vx * 0.4 + wx * target * 0.6; m.vz = m.vz * 0.4 + wz * target * 0.6; }
      ev.doubleJumped = true;
    }
  }

  // horizontal velocity
  if (m.dash > 0){
    m.dash -= dt;
    m.vx = m.dx * MOVE.dashSpeed; m.vz = m.dz * MOVE.dashSpeed; m.vy = Math.max(m.vy, 0);
    if (m.dash <= 0){ m.vx = m.dx * Math.max(speed, MOVE.walk); m.vz = m.dz * Math.max(speed, MOVE.walk); }
  } else if (m.slide > 0){
    const h = Math.hypot(m.vx, m.vz), nh = Math.max(0, h - MOVE.slideFriction * dt);
    if (h > 0){ m.vx *= nh / h; m.vz *= nh / h; }
    m.vx += wx * 2 * dt; m.vz += wz * 2 * dt;
  } else if (m.wall){
    // run along the wall: keep the velocity in the wall plane and above a minimum speed
    const n = m.wall, vn = m.vx * n.nx + m.vz * n.nz;
    m.vx -= n.nx * vn; m.vz -= n.nz * vn;
    const h = Math.hypot(m.vx, m.vz), want = Math.max(h, MOVE.sprint);
    if (h > 0.01){ m.vx *= want / h; m.vz *= want / h; }
    m.vx -= n.nx * 0.5; m.vz -= n.nz * 0.5;
  } else {
    const accel = m.ground ? MOVE.accelGround : MOVE.accelAir;
    const tx = wx * speed, tz = wz * speed;
    if (m.ground){
      const k = Math.min(1, accel * dt);
      m.vx += (tx - m.vx) * k; m.vz += (tz - m.vz) * k;
    } else {
      // air control: steer toward the wish without slowing momentum down
      const h = Math.hypot(m.vx, m.vz), k = Math.min(1, accel * dt);
      m.vx += (tx - m.vx) * k * (Math.hypot(tx, tz) > 0.1 ? 1 : 0.15);
      m.vz += (tz - m.vz) * k * (Math.hypot(tx, tz) > 0.1 ? 1 : 0.15);
      const nh = Math.hypot(m.vx, m.vz);
      if (nh < h && Math.hypot(tx, tz) > 0.1){ const s = Math.max(nh, h * 0.995) / (nh || 1); m.vx *= s; m.vz *= s; }
    }
  }

  // gravity / buoyancy
  if (m.dash <= 0){
    if (m.wall){ m.wallT += dt; m.vy = Math.max(m.vy - MOVE.wallGravity * dt, -1.5); if (m.wallT > MOVE.wallTime){ m.lastWall = m.wall; m.wall = null; m.wallCd = MOVE.wallReattach; } }
    else if (swim){ m.vy += (Math.min(depth - 1.2, 1) * 14 - m.vy * 3) * dt; }
    else if (!m.ground) m.vy -= MOVE.gravity * dt;
  }

  // integrate horizontally with collision
  const H = bodyHeight(m);
  const ox = m.x, oz = m.z;
  m.x += m.vx * dt; m.z += m.vz * dt;
  const B = world.bounds;
  m.x = Math.max(B.minX + 2, Math.min(B.maxX - 2, m.x)); m.z = Math.max(B.minZ + 2, Math.min(B.maxZ - 2, m.z));
  let wallHit = null;
  for (let it = 0; it < 3; it++){
    const p = cw.pushOut(m.x, m.y, m.z, R, H, m.ground ? MOVE.stepUp : 0.25);
    if (!p.hit) break;
    m.x += p.dx; m.z += p.dz;
    const l = Math.hypot(p.dx, p.dz) || 1, nx = p.dx / l, nz = p.dz / l, vn = m.vx * nx + m.vz * nz;
    if (vn < 0){ m.vx -= nx * vn; m.vz -= nz * vn; }
    wallHit = {nx, nz, item:p.hit};
  }

  // mantle onto ledges we run into
  if (wallHit && !m.wall && Math.hypot(wx, wz) > 0.3 && (wx * wallHit.nx + wz * wallHit.nz) < -0.4 && m.vy < 3){
    const px = m.x - wallHit.nx * (R + 0.35), pz = m.z - wallHit.nz * (R + 0.35);
    const top = cw.supportAt(px, pz, m.y + MOVE.mantleMax, R * 0.6, 0);
    const rise = top.y - m.y;
    if (rise > MOVE.mantleMin && rise <= MOVE.mantleMax && !cw.blocked(px, top.y + 0.02, pz, R * 0.9, PLAYER.crouchHeight)){
      const h = Math.max(Math.hypot(m.vx, m.vz), MOVE.walk);
      m.mantle = {t:0, x0:m.x, y0:m.y, z0:m.z, x1:px, y1:top.y, z1:pz, vx:-wallHit.nx * h * 0.7, vz:-wallHit.nz * h * 0.7};
      m.vx = m.vz = m.vy = 0; m.wall = null; m.slide = 0; ev.mantled = true;
      return;
    }
  }

  // start a wall-run
  if (!m.ground && !m.wall && m.wallCd <= 0 && m.dash <= 0 && !swim){
    const hsp = Math.hypot(m.vx, m.vz);
    if (hsp > MOVE.wallMinSpeed){
      const w = cw.wallNear(m.x, m.y, m.z, R, H, 0.3);
      if (w){
        const along = Math.abs(m.vx * w.nx + m.vz * w.nz) / hsp;
        const above = m.y - world.ground(m.x, m.z);
        const same = m.lastWall && Math.abs(m.lastWall.nx - w.nx) < 0.1 && Math.abs(m.lastWall.nz - w.nz) < 0.1 && m.wallCd > -0.2;
        if (along < 0.75 && above > 0.9 && !same){ m.wall = {nx:w.nx, nz:w.nz}; m.wallT = 0; m.vy = Math.max(m.vy, 1.6); m.jumps = 0; ev.wallRun = true; }
      }
    }
  } else if (m.wall){
    const w = cw.wallNear(m.x, m.y, m.z, R, H, 0.45);
    if (!w || (b & BTN.CROUCH) || Math.hypot(m.vx, m.vz) < 2){ m.lastWall = m.wall; m.wall = null; m.wallCd = MOVE.wallReattach; }
    else { m.wall.nx = w.nx; m.wall.nz = w.nz; }
  }

  // vertical integration and ground
  const wasGround = m.ground;
  m.y += m.vy * dt;
  const ceil = cw.ceilingAt(m.x, m.z, m.y, m.y + H, R);
  if (m.y + H > ceil && m.vy > 0){ m.y = ceil - H; m.vy = 0; }
  const sup = cw.supportAt(m.x, m.z, Math.max(m.y, m.y - m.vy * dt), R, wasGround ? MOVE.stepUp : 0.2);
  if (m.y < sup.y && m.vy > 0.01) m.y = sup.y; // rising out of a slope or step
  if (m.y <= sup.y + 0.001 && m.vy <= 0.01){
    if (!wasGround && m.vy < -2) ev.landed = -m.vy;
    m.y = sup.y; m.vy = 0; m.ground = true; m.jumps = 0; m.wall = null; m.lastWall = null;
  } else if (wasGround && m.vy <= 0 && m.y - sup.y < 0.6 && m.dash <= 0){
    m.y = sup.y; m.vy = 0; m.ground = true; // stick to slopes and steps going down
  } else {
    m.ground = false;
  }

  // steep terrain: slide down instead of walking up
  if (m.ground && !sup.item){
    const n = world.normalAt(m.x, m.z);
    if (n[1] < MOVE.maxSlope){
      m.vx += n[0] * MOVE.gravity * dt * 1.4; m.vz += n[2] * MOVE.gravity * dt * 1.4;
      const into = (m.x - ox) * n[0] + (m.z - oz) * n[2];
      if (into < 0){ m.x -= n[0] * into; m.z -= n[2] * into; }
    }
  }
}
