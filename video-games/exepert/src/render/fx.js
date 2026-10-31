/* Pooled combat effects: tracer beams, blaster bolts, sparks and explosions. */
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 0, 1);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpC = new THREE.Color();

class BeamPool {
  constructor(scene, n){
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({toneMapped:false, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false}), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = Array.from({length:n}, () => ({life:0}));
    this.next = 0;
  }
  add(o, e, color, width, life){
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    Object.assign(it, {o:o.slice(), e:e.slice(), color:new THREE.Color(color), width, life, max:life});
  }
  update(dt){
    let n = 0;
    for (const it of this.items){
      if (it.life <= 0) continue;
      it.life -= dt;
      const k = Math.max(it.life / it.max, 0);
      // the beam's tail catches up with its head as it fades
      const sx = it.o[0] + (it.e[0] - it.o[0]) * (1 - k) * 0.85, sy = it.o[1] + (it.e[1] - it.o[1]) * (1 - k) * 0.85, sz = it.o[2] + (it.e[2] - it.o[2]) * (1 - k) * 0.85;
      tmpD.set(it.e[0] - sx, it.e[1] - sy, it.e[2] - sz);
      const len = tmpD.length(); if (len < 0.01) continue;
      tmpQ.setFromUnitVectors(UP, tmpD.multiplyScalar(1 / len));
      tmpV.set((sx + it.e[0]) / 2, (sy + it.e[1]) / 2, (sz + it.e[2]) / 2);
      tmpS.set(it.width, it.width, len);
      tmpM.compose(tmpV, tmpQ, tmpS);
      this.mesh.setMatrixAt(n, tmpM);
      this.mesh.setColorAt(n, tmpC.copy(it.color).multiplyScalar(0.4 + k * 2.4));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class FX {
  constructor(scene){
    this.scene = scene;
    this.beams = new BeamPool(scene, 160);
    // bolts
    this.boltMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 1.4), new THREE.MeshBasicMaterial({color:0xff3355, toneMapped:false}), 96);
    this.boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.boltMesh.frustumCulled = false; scene.add(this.boltMesh);
    this.bolts = new Map();
    // sparks
    const N = this.sparkN = 900;
    this.sp = {pos:new Float32Array(N * 3), vel:new Float32Array(N * 3), col:new Float32Array(N * 3), life:new Float32Array(N), next:0};
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.sp.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({size:0.14, vertexColors:true, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, toneMapped:false}));
    this.sparks.frustumCulled = false; scene.add(this.sparks);
    // explosions
    this.booms = [];
    this.boomGeo = new THREE.SphereGeometry(1, 20, 12);
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 48); this.ringGeo.rotateX(-Math.PI / 2);
    // grenades
    this.nadeGeo = new THREE.SphereGeometry(0.11, 12, 8);
    this.nadeMat = new THREE.MeshBasicMaterial({color:0xffb02a, toneMapped:false});
    this.nades = new Map();
  }

  tracer(o, e, color = '#9fe8ff', width = 0.025, life = 0.07){ this.beams.add(o, e, color, width, life); }
  rail(o, e){ this.beams.add(o, e, '#d4ff3a', 0.09, 0.45); this.beams.add(o, e, '#ffffff', 0.025, 0.25); }

  bolt(id, o, v, speed){ this.bolts.set(id, {x:o[0], y:o[1], z:o[2], vx:v[0] * speed, vy:v[1] * speed, vz:v[2] * speed, life:1.4}); }
  pop(id, x, y, z, hit){ this.bolts.delete(id); this.spark(x, y, z, hit ? 10 : 14, hit ? 0xff6a7a : 0xff3355, 5); }

  spark(x, y, z, n = 10, color = 0x9fe8ff, speed = 6){
    const S = this.sp; tmpC.set(color);
    for (let i = 0; i < n; i++){
      const k = S.next; S.next = (S.next + 1) % this.sparkN;
      S.pos[k * 3] = x; S.pos[k * 3 + 1] = y; S.pos[k * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), s = speed * (0.3 + Math.random() * 0.7);
      S.vel[k * 3] = Math.cos(a) * r * s; S.vel[k * 3 + 1] = Math.abs(u) * s + 1; S.vel[k * 3 + 2] = Math.sin(a) * r * s;
      S.col[k * 3] = tmpC.r; S.col[k * 3 + 1] = tmpC.g; S.col[k * 3 + 2] = tmpC.b;
      S.life[k] = 0.25 + Math.random() * 0.35;
    }
  }

  boom(x, y, z){
    const core = new THREE.Mesh(this.boomGeo, new THREE.MeshBasicMaterial({color:0xffc070, toneMapped:false, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false}));
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({color:0xff6a3a, toneMapped:false, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide}));
    core.position.set(x, y, z); ring.position.set(x, y + 0.1, z);
    this.scene.add(core, ring);
    this.booms.push({core, ring, t:0});
    this.spark(x, y + 0.3, z, 60, 0xffa040, 14);
    this.spark(x, y + 0.3, z, 30, 0xffffff, 9);
  }

  nade(id, x, y, z){
    let m = this.nades.get(id);
    if (!m){ m = new THREE.Mesh(this.nadeGeo, this.nadeMat); this.scene.add(m); this.nades.set(id, m); }
    m.position.set(x, y, z); m.userData.seen = performance.now();
  }

  update(dt, world){
    this.beams.update(dt);
    // bolts fly until they pop (or expire)
    let n = 0;
    for (const [id, b] of this.bolts){
      b.life -= dt; if (b.life <= 0){ this.bolts.delete(id); continue; }
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (world && b.y < world.ground(b.x, b.z)){ this.pop(id, b.x, b.y, b.z, false); continue; }
      tmpD.set(b.vx, b.vy, b.vz).normalize();
      tmpQ.setFromUnitVectors(UP, tmpD); tmpV.set(b.x, b.y, b.z); tmpS.set(1, 1, 1);
      tmpM.compose(tmpV, tmpQ, tmpS); this.boltMesh.setMatrixAt(n++, tmpM);
    }
    this.boltMesh.count = n; this.boltMesh.instanceMatrix.needsUpdate = true;
    // sparks
    const S = this.sp;
    for (let k = 0; k < this.sparkN; k++){
      if (S.life[k] <= 0){ S.pos[k * 3 + 1] = -9999; continue; }
      S.life[k] -= dt;
      S.vel[k * 3 + 1] -= 14 * dt;
      S.pos[k * 3] += S.vel[k * 3] * dt; S.pos[k * 3 + 1] += S.vel[k * 3 + 1] * dt; S.pos[k * 3 + 2] += S.vel[k * 3 + 2] * dt;
      const f = 1 - dt * 4; S.col[k * 3] *= f; S.col[k * 3 + 1] *= f; S.col[k * 3 + 2] *= f;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
    // explosions
    this.booms = this.booms.filter(b => {
      b.t += dt; const k = b.t / 0.6;
      b.core.scale.setScalar(0.5 + k * 6); b.core.material.opacity = Math.max(0, 1 - k);
      b.ring.scale.setScalar(1 + k * 10); b.ring.material.opacity = Math.max(0, 0.9 - k);
      if (k >= 1){ b.core.removeFromParent(); b.ring.removeFromParent(); b.core.material.dispose(); b.ring.material.dispose(); return false; }
      return true;
    });
    // grenades not refreshed by a snapshot for a moment have exploded or gone
    const now = performance.now();
    this.nadeMat.color.setHex(Math.floor(now / 160) % 2 ? 0xffb02a : 0xff3030);
    for (const [id, m] of this.nades){
      if (now - m.userData.seen > 250){ m.removeFromParent(); this.nades.delete(id); }
    }
  }
}
