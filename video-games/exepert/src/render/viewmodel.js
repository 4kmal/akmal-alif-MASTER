/* First-person weapon models, rendered in their own pass over the world.
   Procedural: each gun is a handful of boxes and cylinders with emissive accents. */
import * as THREE from 'three';
import { WEAPONS } from '../../sim/weapons.js';

const DARK = new THREE.MeshStandardMaterial({color:0x151a24, metalness:0.75, roughness:0.32});
const MID = new THREE.MeshStandardMaterial({color:0x2a3242, metalness:0.6, roughness:0.4});
const GLOVE = new THREE.MeshStandardMaterial({color:0x0c0f15, metalness:0.1, roughness:0.85});

function glow(color){ return new THREE.MeshBasicMaterial({color, toneMapped:false}); }
function add(g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0){ const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; }
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r, l, s = 12) => { const g = new THREE.CylinderGeometry(r, r, l, s); g.rotateX(Math.PI / 2); return g; };

function buildGun(id){
  const g = new THREE.Group(), w = WEAPONS[id], acc = glow(w.color);
  let muzzle = -0.5;
  if (id === 'breach'){
    add(g, B(0.065, 0.085, 0.4), DARK, 0, 0, -0.12);
    add(g, C(0.016, 0.26), MID, 0, 0.01, -0.42);
    add(g, B(0.05, 0.15, 0.06), MID, 0, -0.1, -0.06, 0.25);
    add(g, B(0.045, 0.12, 0.05), DARK, 0, -0.09, 0.08, -0.3);
    add(g, B(0.06, 0.07, 0.18), DARK, 0, 0.0, 0.16);
    add(g, B(0.006, 0.012, 0.3), acc, 0.034, 0.02, -0.12); add(g, B(0.006, 0.012, 0.3), acc, -0.034, 0.02, -0.12);
    add(g, B(0.05, 0.004, 0.004), acc, 0, 0.11, -0.04); add(g, B(0.004, 0.004, 0.004), acc, 0, 0.095, -0.04);
    add(g, B(0.004, 0.04, 0.05), MID, 0.025, 0.07, -0.04); add(g, B(0.004, 0.04, 0.05), MID, -0.025, 0.07, -0.04);
    muzzle = -0.56;
  } else if (id === 'kestrel'){
    add(g, C(0.04, 0.46, 16), DARK, 0, 0, -0.16);
    for (let k = 0; k < 5; k++) add(g, C(0.046, 0.018, 16), MID, 0, 0, -0.32 + k * 0.05);
    add(g, C(0.014, 0.14), MID, 0, 0, -0.45);
    add(g, B(0.04, 0.14, 0.05), DARK, 0, -0.1, -0.02, 0.2);
    add(g, B(0.05, 0.11, 0.05), MID, 0, -0.08, 0.1, -0.25);
    add(g, C(0.02, 0.1), acc, 0, 0.055, -0.08);
    add(g, B(0.03, 0.03, 0.2), DARK, 0, 0.06, -0.1);
    add(g, B(0.018, 0.018, 0.34), acc, 0.045, 0, -0.16);
    muzzle = -0.53;
  } else if (id === 'longwire'){
    add(g, B(0.07, 0.09, 0.5), DARK, 0, 0, -0.12);
    add(g, B(0.016, 0.03, 0.44), acc, 0.026, -0.01, -0.5); add(g, B(0.016, 0.03, 0.44), acc, -0.026, -0.01, -0.5);
    add(g, B(0.05, 0.012, 0.44), MID, 0, 0.012, -0.5);
    add(g, C(0.028, 0.2, 14), MID, 0, 0.085, -0.06);
    add(g, C(0.03, 0.006, 14), acc, 0, 0.085, -0.165);
    add(g, B(0.05, 0.14, 0.05), MID, 0, -0.11, -0.02, 0.25);
    add(g, B(0.06, 0.09, 0.2), DARK, 0, -0.01, 0.2);
    muzzle = -0.74;
  } else {
    add(g, B(0.09, 0.1, 0.36), DARK, 0, 0, -0.1);
    add(g, C(0.026, 0.3), MID, 0, 0.02, -0.34);
    add(g, C(0.03, 0.12), DARK, 0, -0.04, -0.3);
    add(g, B(0.05, 0.15, 0.06), MID, 0, -0.11, 0.02, 0.22);
    add(g, B(0.06, 0.08, 0.2), DARK, 0, -0.01, 0.17);
    add(g, B(0.05, 0.03, 0.04), acc, 0, 0.065, -0.2);
    add(g, B(0.092, 0.01, 0.12), acc, 0, 0.0, -0.18);
    muzzle = -0.5;
  }
  // gloved hands
  add(g, B(0.06, 0.07, 0.1), GLOVE, 0.0, -0.08, 0.06);
  add(g, B(0.06, 0.06, 0.1), GLOVE, -0.01, -0.05, -0.26);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({color:w.color, toneMapped:false, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, map:flashTexture()}));
  flash.position.set(0, 0.01, muzzle); flash.visible = false; g.add(flash);
  const flash2 = flash.clone(); flash2.rotation.y = Math.PI / 2; g.add(flash2);
  g.userData = {flash, flash2, muzzle};
  return g;
}

let FLASH_TEX = null;
function flashTexture(){
  if (FLASH_TEX) return FLASH_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.beginPath();
  for (let k = 0; k < 8; k++){ const a = k / 8 * Math.PI * 2, r = k % 2 ? 14 : 32; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  x.fill();
  FLASH_TEX = new THREE.CanvasTexture(c);
  return FLASH_TEX;
}

export class ViewModel {
  constructor(){
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x101018, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1, 2, 1); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x3f8cff, 1.2); rim.position.set(-2, 0.5, -1); this.scene.add(rim);
    this.rig = new THREE.Group(); this.scene.add(this.rig);
    this.guns = {};
    for (const id of Object.keys(WEAPONS)){ const g = buildGun(id); g.visible = false; this.rig.add(g); this.guns[id] = g; }
    this.current = null;
    this.t = 0; this.bob = 0; this.kickV = 0; this.kickRot = 0; this.swayX = 0; this.swayY = 0; this.adsK = 0; this.lower = 0; this.flashT = 0;
  }

  setWeapon(id){ if (this.current === id) return; for (const [k, g] of Object.entries(this.guns)) g.visible = k === id; this.current = id; this.lower = 1; }
  kick(amount){ this.kickV += amount * 4; this.kickRot += amount * 6; this.flashT = 0.05; }
  resize(aspect){ this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  /* s: {speed, sprint, ads, air, slide, reload (0..1 progress or 0), swap, dyaw, dpitch, wall, dead} */
  update(dt, s){
    this.t += dt;
    const g = this.guns[this.current]; if (!g) return;
    this.rig.visible = !s.dead;
    this.adsK += ((s.ads ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    const moving = Math.min(s.speed / 7.6, 1) * (s.air || s.slide ? 0.2 : 1);
    this.bob += dt * (s.sprint ? 13 : 9) * (0.3 + moving);
    const bobAmp = (1 - this.adsK * 0.85) * moving;
    this.swayX += ((-s.dyaw * 1.4) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += ((s.dpitch * 1.4) - this.swayY) * Math.min(1, dt * 10);
    this.kickV *= Math.exp(-dt * 18); this.kickRot *= Math.exp(-dt * 14);
    this.lower = Math.max(0, this.lower - dt * 3.2);
    const sprintK = s.sprint && !s.ads ? 1 : 0;
    const reload = s.reload > 0 ? Math.sin(Math.min(s.reload, 1) * Math.PI) : 0;
    const hip = new THREE.Vector3(0.17, -0.15, -0.32), ads = new THREE.Vector3(0, -0.086, -0.24);
    const p = hip.lerp(ads, this.adsK);
    p.x += Math.sin(this.bob) * 0.012 * bobAmp + this.swayX * 0.02 + sprintK * 0.03;
    p.y += Math.abs(Math.cos(this.bob)) * 0.012 * bobAmp - this.swayY * 0.02 - this.lower * 0.25 - reload * 0.08 - sprintK * 0.04 + (s.air ? 0.015 : 0);
    p.z += this.kickV * 0.04;
    this.rig.position.copy(p);
    this.rig.rotation.set(this.kickRot * 0.05 + reload * 0.5 - sprintK * 0.25 + this.swayY * 0.05, this.swayX * 0.08 + sprintK * 0.55, (s.slide ? 0.3 : 0) + (s.wall || 0) * 0.25 - reload * 0.4);
    const f = this.flashT > 0; this.flashT -= dt;
    g.userData.flash.visible = f; g.userData.flash2.visible = f;
    if (f){ g.userData.flash.rotation.z = Math.random() * 3; g.userData.flash.scale.setScalar(0.8 + Math.random() * 0.6); }
  }
}
