/* Procedural "runner" models with team neon strips and code-driven animation
   (run cycle, crouch, slide, wall-run lean, airborne tuck, aim pitch, death fall). */
import * as THREE from 'three';
import { FLAG } from '../../sim/room-core.js';

const G = {};
function box(w, h, d){ const k = `${w}|${h}|${d}`; return G[k] ||= new THREE.BoxGeometry(w, h, d); }
const ARMOR = new THREE.MeshStandardMaterial({color:0x1b2130, metalness:0.55, roughness:0.42});
const UNDER = new THREE.MeshStandardMaterial({color:0x0b0e16, metalness:0.2, roughness:0.8});
const GUN = new THREE.MeshStandardMaterial({color:0x0e1118, metalness:0.7, roughness:0.35});
const WHITE = new THREE.Color(0xffffff);

function part(parent, geo, mat, x, y, z){ const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = false; parent.add(m); return m; }
function pivot(parent, x, y, z){ const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

export class Runner {
  constructor(color){
    this.root = new THREE.Group();
    this.base = new THREE.Color(color);
    this.glow = new THREE.MeshBasicMaterial({color:new THREE.Color(color), toneMapped:false});
    this.visorMat = new THREE.MeshBasicMaterial({color:new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), toneMapped:false});
    const body = this.body = pivot(this.root, 0, 0, 0);
    const hips = this.hips = pivot(body, 0, 0.95, 0);
    part(hips, box(0.34, 0.16, 0.2), UNDER, 0, 0, 0);
    const torso = this.torso = pivot(hips, 0, 0.06, 0);
    part(torso, box(0.44, 0.5, 0.27), ARMOR, 0, 0.27, 0);
    part(torso, box(0.46, 0.04, 0.29), this.glow, 0, 0.1, 0);
    part(torso, box(0.32, 0.36, 0.14), ARMOR, 0, 0.3, 0.2);
    part(torso, box(0.04, 0.3, 0.02), this.glow, 0.1, 0.3, 0.28);
    part(torso, box(0.04, 0.3, 0.02), this.glow, -0.1, 0.3, 0.28);
    part(torso, box(0.18, 0.1, 0.32), ARMOR, 0.28, 0.5, 0);
    part(torso, box(0.18, 0.1, 0.32), ARMOR, -0.28, 0.5, 0);
    const head = this.head = pivot(torso, 0, 0.56, 0);
    part(head, box(0.25, 0.27, 0.27), ARMOR, 0, 0.13, 0.01);
    part(head, box(0.22, 0.07, 0.04), this.visorMat, 0, 0.15, -0.13);
    part(head, box(0.03, 0.12, 0.2), this.glow, 0.13, 0.16, 0.02);
    // arms hold the rifle forward
    this.armL = pivot(torso, -0.27, 0.46, 0); this.armR = pivot(torso, 0.27, 0.46, 0);
    for (const [arm, s] of [[this.armL, -1], [this.armR, 1]]){
      part(arm, box(0.11, 0.3, 0.11), ARMOR, 0, -0.15, 0);
      const fore = pivot(arm, 0, -0.3, 0); arm.userData.fore = fore;
      part(fore, box(0.1, 0.28, 0.1), UNDER, 0, -0.14, 0);
      part(fore, box(0.11, 0.03, 0.11), this.glow, 0, -0.04, 0);
      arm.rotation.x = -0.9; fore.rotation.x = -0.8; arm.rotation.z = s * -0.15;
    }
    const gun = this.gun = pivot(torso, 0.05, 0.25, -0.38);
    part(gun, box(0.07, 0.1, 0.62), GUN, 0, 0, 0);
    part(gun, box(0.02, 0.02, 0.5), this.glow, 0, 0.055, 0);
    part(gun, box(0.05, 0.14, 0.06), GUN, 0, -0.1, 0.1);
    this.legL = pivot(hips, -0.11, -0.04, 0); this.legR = pivot(hips, 0.11, -0.04, 0);
    for (const leg of [this.legL, this.legR]){
      part(leg, box(0.15, 0.44, 0.17), ARMOR, 0, -0.22, 0);
      const knee = pivot(leg, 0, -0.44, 0); leg.userData.knee = knee;
      part(knee, box(0.13, 0.44, 0.15), UNDER, 0, -0.22, 0);
      part(knee, box(0.14, 0.03, 0.16), this.glow, 0, -0.08, -0.01);
      part(knee, box(0.15, 0.08, 0.26), ARMOR, 0, -0.44, -0.04);
    }
    this.phase = Math.random() * 6; this.dead = 0; this.lean = 0; this.roll = 0; this.crouchK = 0;
  }

  setColor(color){ this.base.set(color); this.glow.color.set(color); this.visorMat.color.set(color).lerp(WHITE, 0.35); }

  /* s: {x,y,z,yaw,pitch,flags,speed,vy}; dt seconds */
  update(dt, s, t){
    const f = s.flags, alive = f & FLAG.ALIVE;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    if (!alive){
      if (this.deadT === undefined) this.deadT = t;
      this.dead = Math.min(1, this.dead + dt * 2.8);
      this.body.rotation.x = -this.dead * 1.45; this.body.position.y = -this.dead * 0.1;
      this.glow.color.copy(this.base).multiplyScalar(Math.max(0.1, 1 - (t - this.deadT)));
      // flicker out, then hide until respawn
      this.root.visible = t - this.deadT < 1.6 && ((t * 14 | 0) % 2 === 0 || t - this.deadT < 0.7);
      return;
    }
    if (this.deadT !== undefined){ this.dead = 0; this.deadT = undefined; this.body.rotation.x = 0; this.body.position.y = 0; this.root.visible = true; }
    const crouch = (f & FLAG.CROUCH) && !(f & FLAG.SLIDE) ? 1 : 0, slide = f & FLAG.SLIDE ? 1 : 0, air = f & FLAG.AIR ? 1 : 0, wall = f & FLAG.WALL ? 1 : 0;
    this.crouchK += (crouch - this.crouchK) * Math.min(1, dt * 12);
    const sp = Math.min(s.speed, 11);
    this.phase += sp * dt * (f & FLAG.SPRINT ? 1.35 : 1.6);
    const swing = air || slide ? 0 : Math.min(sp / 6, 1) * (f & FLAG.SPRINT ? 0.95 : 0.7);
    const a = Math.sin(this.phase);
    this.legL.rotation.x = a * swing - (air ? 0.7 : 0) - this.crouchK * 0.9 - slide * 1.3;
    this.legR.rotation.x = -a * swing - (air ? 0.2 : 0) - this.crouchK * 0.9 - slide * 1.1;
    this.legL.userData.knee.rotation.x = Math.max(0, -Math.cos(this.phase)) * swing * 1.3 + (air ? 1.1 : 0) + this.crouchK * 1.6 + slide * 0.3;
    this.legR.userData.knee.rotation.x = Math.max(0, Math.cos(this.phase)) * swing * 1.3 + (air ? 0.5 : 0) + this.crouchK * 1.6 + slide * 0.2;
    this.hips.position.y = 0.95 - this.crouchK * 0.42 - slide * 0.55 + Math.abs(Math.cos(this.phase)) * swing * 0.05;
    this.torso.rotation.x = -s.pitch * 0.55 + (f & FLAG.SPRINT ? 0.18 : 0) + slide * 0.5 + this.crouchK * 0.15;
    this.head.rotation.x = -s.pitch * 0.4;
    this.torso.rotation.y = Math.sin(this.phase) * swing * 0.12;
    const wantRoll = wall ? (f & FLAG.WALL_L ? -0.35 : 0.35) : 0;
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 10);
    this.body.rotation.z = this.roll;
    const wantLean = slide ? -0.55 : f & FLAG.DASH ? 0.35 : 0;
    this.lean += (wantLean - this.lean) * Math.min(1, dt * 10);
    this.body.rotation.x = this.lean;
    // spawn shield: the strips pulse white
    if (f & FLAG.PROTECT) this.glow.color.copy(this.base).lerp(WHITE, 0.5 + 0.5 * Math.sin(t * 20));
    else this.glow.color.copy(this.base);
  }

  dispose(){ this.glow.dispose(); this.visorMat.dispose(); this.root.removeFromParent(); }
}
