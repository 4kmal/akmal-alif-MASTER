/* Draws the stitched Kessler IV world in the explorer's holographic style, made solid for a shooter:
   dark terrain with contour lines shaded in, glowing structure edges over solid occluders, water, sky and the
   relay-storm wall around the active sector. */
import * as THREE from 'three';
import { WATER_LEVEL, PLACEMENT } from '../../../kessler-world/world.js';

const lin = v => Math.pow(v, 2.2);

const FOG = `
uniform vec3 uFogColor; uniform float uFogDensity;
vec3 applyFog(vec3 c, float dist){ float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist); return mix(c, uFogColor, clamp(f, 0.0, 1.0)); }`;

const TER_VS = `
attribute float aMask; varying float vMask; varying vec3 vN; varying vec3 vW; varying float vDist;
void main(){
  vMask = aMask; vN = normal; vW = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const TER_FS = `
uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uHigh; uniform vec3 uBase; uniform float uMaxH; uniform float uTime;
varying float vMask; varying vec3 vN; varying vec3 vW; varying float vDist;
${FOG}
float gridLine(vec2 p, float w){ vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p); return 1.0 - min(min(g.x, g.y) / w, 1.0); }
void main(){
  vec3 n = normalize(vN);
  float l = clamp(dot(n, normalize(vec3(-0.45, 0.8, -0.35))), 0.0, 1.0);
  float t = clamp(vW.y / uMaxH, 0.0, 1.0);
  vec3 tint = t < 0.5 ? mix(uDeep, uMid, t * 2.0) : mix(uMid, uHigh, (t - 0.5) * 2.0);
  vec3 c = uBase + tint * (0.05 + 0.16 * l * l);
  // contour lines every metre, index lines every 5 m
  float h = vW.y; float fw = max(fwidth(h), 1e-4);
  float minor = 1.0 - smoothstep(0.0, 1.2, abs(fract(h + 0.5) - 0.5) / fw);
  float major = 1.0 - smoothstep(0.0, 1.6, abs(fract(h / 5.0 + 0.5) - 0.5) * 5.0 / fw);
  float fade = 1.0 - smoothstep(60.0, 220.0, vDist);
  c += tint * (minor * 0.35 * fade + major * 0.9);
  // survey grid every 10 m, finer 2 m grid up close
  c += tint * gridLine(vW.xz / 10.0, 1.0) * 0.18;
  c += tint * gridLine(vW.xz / 2.0, 1.0) * 0.06 * (1.0 - smoothstep(8.0, 40.0, vDist));
  float edge = clamp(vMask * 1.6, 0.0, 1.0);
  c = mix(uBase * 0.6, c, edge);
  gl_FragColor = vec4(applyFog(c, vDist), 1.0);
  #include <colorspace_fragment>
}`;

const LINE_VS = `
attribute vec3 aColor; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; varying float vDist;
void main(){ vColor = aColor; vAlpha = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`;
const LINE_FS = `
uniform float uBoost; uniform float uOpacity; varying vec3 vColor; varying float vAlpha; varying float vDist;
${FOG}
void main(){
  float near = 1.0 + 0.6 * (1.0 - smoothstep(10.0, 60.0, vDist));
  vec3 c = vColor * uBoost * near;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  gl_FragColor = vec4(c * (1.0 - f), vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

const SOLID_VS = `varying vec3 vN; varying float vDist; varying vec3 vW;
void main(){ vN = normalize(normalMatrix * normal); vW = (modelMatrix * vec4(position, 1.0)).xyz; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`;
const SOLID_FS = `
uniform vec3 uColor; uniform vec3 uRim; varying vec3 vN; varying float vDist; varying vec3 vW;
${FOG}
void main(){
  float rim = pow(1.0 - abs(normalize(vN).z), 3.0) * smoothstep(4.0, 30.0, vDist);
  float bands = step(0.94, fract(vW.y / 2.6)) * 0.35;
  vec3 c = uColor + uRim * (rim * 0.05 + bands * 0.06);
  gl_FragColor = vec4(applyFog(c, vDist), 1.0);
  #include <colorspace_fragment>
}`;

const WATER_FS = `
uniform vec3 uColor; uniform float uTime; varying vec3 vW; varying float vDist;
${FOG}
void main(){
  float band = pow(abs(sin(vW.z * 0.9 + sin(vW.x * 0.07 + uTime * 0.5) * 1.8)), 26.0);
  float sh = 0.55 + 0.45 * sin(vW.x * 0.12 - uTime * 1.1 + vW.z * 0.04);
  float r = length(vW.xz - vec2(${PLACEMENT.silt.x.toFixed(1)}, ${PLACEMENT.silt.z.toFixed(1)}));
  float fade = 1.0 - smoothstep(100.0, 128.0, r);
  vec3 c = uColor * (0.18 + band * 0.9 * sh);
  float a = fade * (0.42 + band * 0.35);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  gl_FragColor = vec4(c * (1.0 - f), a);
  #include <colorspace_fragment>
}`;
const POS_VS = `varying vec3 vW; varying float vDist; varying vec2 vUv;
void main(){ vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`;

const STORM_FS = `
uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying float vDist; varying vec3 vW;
void main(){
  float bands = pow(abs(sin(vUv.y * 40.0 - uTime * 2.0 + sin(vUv.x * 60.0) * 0.6)), 10.0);
  float hex = step(0.92, fract(vUv.x * 180.0)) * 0.4;
  float near = 1.0 - smoothstep(6.0, 45.0, vDist);
  float a = (0.04 + bands * 0.4 + hex * 0.25) * near * near * (1.0 - vUv.y) + 0.012 * (1.0 - vUv.y);
  gl_FragColor = vec4(uColor * (0.6 + bands), a);
  #include <colorspace_fragment>
}`;

const SKY_FS = `
uniform float uTime; varying vec3 vW;
void main(){
  vec3 d = normalize(vW - cameraPosition);
  float h = d.y;
  vec3 top = vec3(0.004, 0.008, 0.02), hor = vec3(0.03, 0.06, 0.14), glow = vec3(0.12, 0.05, 0.2);
  vec3 c = mix(hor, top, smoothstep(0.0, 0.5, h));
  c += glow * pow(1.0 - abs(h), 12.0) * 0.6;
  // aurora band
  c += vec3(0.05, 0.25, 0.35) * pow(max(0.0, 1.0 - abs(h - 0.22 - 0.05 * sin(atan(d.x, d.z) * 3.0 + uTime * 0.05)) * 9.0), 3.0) * 0.35;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const PLANET_FS = `
uniform float uTime; varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  if (r > 1.0) discard;
  float lat = p.y;
  float bands = 0.5 + 0.5 * sin(lat * 18.0 + sin(lat * 5.0 + uTime * 0.02) * 2.0);
  vec3 c = mix(vec3(0.12, 0.08, 0.22), vec3(0.32, 0.2, 0.42), bands);
  float lightTerm = clamp(dot(normalize(vec3(p, sqrt(1.0 - r * r))), normalize(vec3(-0.6, 0.4, 0.7))), 0.0, 1.0);
  c *= 0.15 + lightTerm;
  c += vec3(0.25, 0.4, 0.9) * pow(r, 18.0) * 0.8;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export class WorldRender {
  constructor(world, scene, {quality = 'medium'} = {}){
    this.world = world; this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.fog = {uFogColor:{value:new THREE.Color(0x060b16)}, uFogDensity:{value:0.0058}};
    this.uTime = {value:0};
    this.materials = [];
    this.buildTerrain(quality === 'low' ? 3 : 2);
    this.buildStructures();
    this.buildWater();
    this.buildSky();
    this.buildHotZones();
    this.storm = null;
  }

  mat(params){ const m = new THREE.ShaderMaterial(params); this.materials.push(m); return m; }

  buildTerrain(stride){
    const W = this.world, NX = W.NX, NZ = W.NZ, nx = Math.floor((NX - 1) / stride) + 1, nz = Math.floor((NZ - 1) / stride) + 1;
    const pos = new Float32Array(nx * nz * 3), mask = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++){
      const gi = Math.min(i * stride, NX - 1), gj = Math.min(j * stride, NZ - 1), k = gj * NX + gi, v = j * nx + i;
      pos[v * 3] = W.bounds.minX + gi * W.step; pos[v * 3 + 1] = W.H[k]; pos[v * 3 + 2] = W.bounds.minZ + gj * W.step; mask[v] = W.M[k];
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let q = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++){
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = this.mat({
      uniforms:{...this.fog, uTime:this.uTime, uBase:{value:new THREE.Color(0x03060d)}, uDeep:{value:new THREE.Color(0x0e2c6a)}, uMid:{value:new THREE.Color(0x2c6fe0)}, uHigh:{value:new THREE.Color(0x86c4ff)}, uMaxH:{value:Math.max(W.maxH, 1)}},
      vertexShader:TER_VS, fragmentShader:TER_FS
    });
    this.terrain = new THREE.Mesh(g, m);
    this.group.add(this.terrain);
  }

  lineGeo(buf){
    const g = new THREE.BufferGeometry(), c = new Float32Array(buf.c.length);
    for (let i = 0; i < c.length; i++) c[i] = lin(buf.c[i]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(buf.a, 1));
    g.computeBoundingSphere();
    return g;
  }

  buildStructures(){
    const {L, F, R} = this.world.lines;
    const lineMat = (boost, opacity) => this.mat({uniforms:{...this.fog, uBoost:{value:boost}, uOpacity:{value:opacity}}, vertexShader:LINE_VS, fragmentShader:LINE_FS,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending});
    this.group.add(new THREE.LineSegments(this.lineGeo(L), lineMat(2.6, 1)));
    this.group.add(new THREE.LineSegments(this.lineGeo(R), lineMat(2.0, 1)));
    const faces = new THREE.Mesh(this.lineGeo(F), (() => { const m = lineMat(0.55, 1); m.side = THREE.DoubleSide; return m; })());
    this.group.add(faces);

    // solid occluders from the colliders, so cover hides what is behind it
    const parts = [];
    const tmp = new THREE.Object3D();
    for (const it of this.world.collide.items){
      let geo;
      if (it.kind === 'box'){ geo = new THREE.BoxGeometry(it.w, it.y1 - it.y0, it.d); tmp.position.set(it.x, (it.y0 + it.y1) / 2, it.z); tmp.rotation.set(0, -it.rot, 0); }
      else if (it.kind === 'cyl'){ geo = new THREE.CylinderGeometry(it.r, it.r, it.y1 - it.y0, it.thin ? 6 : 14, 1); tmp.position.set(it.x, (it.y0 + it.y1) / 2, it.z); tmp.rotation.set(0, 0, 0); }
      else { geo = new THREE.SphereGeometry(it.r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2); tmp.position.set(it.x, it.y0, it.z); tmp.rotation.set(0, 0, 0); }
      tmp.updateMatrix(); geo.applyMatrix4(tmp.matrix);
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    }
    const merged = mergeNonIndexed(parts);
    const solid = new THREE.Mesh(merged, this.mat({uniforms:{...this.fog, uColor:{value:new THREE.Color(0x050b17)}, uRim:{value:new THREE.Color(0x2c6fe0)}},
      vertexShader:SOLID_VS, fragmentShader:SOLID_FS, polygonOffset:true, polygonOffsetFactor:1.5, polygonOffsetUnits:2}));
    this.group.add(solid);
  }

  buildWater(){
    const s = PLACEMENT.silt, g = new THREE.CircleGeometry(128, 64);
    g.rotateX(-Math.PI / 2); g.translate(s.x, WATER_LEVEL, s.z);
    const m = this.mat({uniforms:{...this.fog, uTime:this.uTime, uColor:{value:new THREE.Color(0x3a9bff)}}, vertexShader:POS_VS, fragmentShader:WATER_FS, transparent:true, depthWrite:false});
    this.water = new THREE.Mesh(g, m); this.group.add(this.water);
  }

  buildSky(){
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.mat({uniforms:{uTime:this.uTime}, vertexShader:POS_VS, fragmentShader:SKY_FS, side:THREE.BackSide, depthWrite:false}));
    sky.renderOrder = -10; this.sky = sky; this.scene.add(sky);
    // stars
    const n = 1400, p = new Float32Array(n * 3), rng = mulberry(7);
    for (let i = 0; i < n; i++){ const u = rng() * 2 - 1, a = rng() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y); p[i * 3] = Math.cos(a) * r * 850; p[i * 3 + 1] = y * 850; p[i * 3 + 2] = Math.sin(a) * r * 850; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({color:0x9fc8ff, size:1.6, sizeAttenuation:false, fog:false, transparent:true, opacity:0.8, depthWrite:false}));
    this.scene.add(this.stars);
    // the gas giant Kessler IV orbits, with its ring
    const planet = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.mat({uniforms:{uTime:this.uTime}, vertexShader:POS_VS, fragmentShader:PLANET_FS, depthWrite:false}));
    planet.position.set(-520, 210, -560); planet.lookAt(0, 0, 0); this.planet = planet; this.scene.add(planet);
    const ring = new THREE.Mesh(new THREE.RingGeometry(260, 330, 96, 1), new THREE.MeshBasicMaterial({color:0x6f5aa8, transparent:true, opacity:0.32, side:THREE.DoubleSide, fog:false, depthWrite:false}));
    ring.position.copy(planet.position); ring.lookAt(0, 0, 0); ring.rotateX(1.15); ring.rotateY(0.25); this.ring = ring; this.scene.add(ring);
  }

  buildHotZones(){
    const g = new THREE.Group();
    for (const z of this.world.zones) for (const h of z.hots){
      const geo = new THREE.RingGeometry(h.r - 0.6, h.r, 64, 1); geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++){ const x = pos.getX(i) + h.x, zz = pos.getZ(i) + h.z; pos.setXYZ(i, x, this.world.surf(x, zz) + 0.15, zz); }
      g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0xff4466, transparent:true, opacity:0.55, side:THREE.DoubleSide, depthWrite:false})));
    }
    this.hot = g; this.group.add(g);
  }

  setSector(sector){
    if (this.storm){ this.group.remove(this.storm); this.storm.geometry.dispose(); this.storm = null; }
    if (!sector || !Number.isFinite(sector.r)) return;
    const g = new THREE.CylinderGeometry(sector.r, sector.r, 140, 160, 1, true);
    g.translate(sector.x, 50, sector.z);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.storm = new THREE.Mesh(g, this.mat({uniforms:{uTime:this.uTime, uColor:{value:new THREE.Color(0xff2a55)}}, vertexShader:POS_VS, fragmentShader:STORM_FS, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending}));
    this.group.add(this.storm);
  }

  update(t, camera){
    this.uTime.value = t;
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
  }
}

function mulberry(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function mergeNonIndexed(geos){
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of geos){
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
