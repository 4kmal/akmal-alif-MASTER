/* Kessler IV Explorer: renderer, camera controls, labels, HUD and ambient audio.
   Expects the THREE global (three.js r128 UMD) and its postprocessing scripts to be loaded first. */
import { clamp, ss, lerp, pad, wrapA, mulberry32 } from '../kessler-world/kessler-util.js';
import { TYPES, ICON, ZONES, makeField } from '../kessler-world/kessler-zones.js';
import { curvePts } from '../kessler-world/structures.js';
import { layoutZone } from '../kessler-world/layout.js';

(function(){
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const fmtM = m => Math.round(m).toLocaleString('en-US') + ' M';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;

function fail(msg){
  $('#boot-status').textContent = msg;
  $('#boot-status').style.color = 'var(--alert)';
}
if (!window.THREE){ fail('THE 3D LIBRARY DID NOT LOAD. CHECK YOUR CONNECTION AND RELOAD.'); return; }

/* ======================================================================
   Renderer, camera, shared uniforms
   ====================================================================== */
const WORLD = 200, HALF = 100, N = 200, STEP = WORLD / N, NV = N + 1;
const css = getComputedStyle(document.documentElement);
const tok = name => new THREE.Color(css.getPropertyValue(name).trim() || '#ffffff');
const C = {
  void: tok('--void'), signal: tok('--signal'), alert: tok('--alert'), holo: tok('--holo'), holoHi: tok('--holo-hi'),
  deep: new THREE.Color(0x0e2c6a), mid: new THREE.Color(0x2c6fe0), high: new THREE.Color(0x86c4ff), peak: new THREE.Color(0xe2f1ff),
  sHi: new THREE.Color(0xbfe0ff).multiplyScalar(0.8), sMid: new THREE.Color(0x5fa5ff).multiplyScalar(0.5), sLo: new THREE.Color(0x2c66d0).multiplyScalar(0.35),
  face: new THREE.Color(0x4b93ff), road: new THREE.Color(0x9fd8ff), reed: new THREE.Color(0x6cc6ff).multiplyScalar(0.6), reedLo: new THREE.Color(0x1d4fa8).multiplyScalar(0.4),
  water: new THREE.Color(0x3a9bff)
};

const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
} catch (e){ fail('THIS MAP NEEDS WEBGL. TRY A RECENT DESKTOP BROWSER.'); return; }
renderer.setClearColor(C.void, 1);
const scene = new THREE.Scene();
scene.background = C.void.clone();
const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);

let composer = null, bloom = null;
try {
  if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass){
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.66, 0.5, 0.1);
    composer.addPass(bloom);
  }
} catch (e){ composer = null; }

const U = { uTime:{value:0}, uReveal:{value:0}, uScanR:{value:-1000} };

const VS_LINE = `
attribute vec3 aColor; attribute float aAlpha;
#ifdef DASH
attribute float aDist; varying float vDist;
#endif
varying vec3 vColor; varying float vAlpha; varying float vR;
void main(){
  vColor = aColor; vAlpha = aAlpha; vR = length(position.xz);
  #ifdef DASH
  vDist = aDist;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FS_LINE = `
uniform float uReveal; uniform float uScanR; uniform float uOpacity; uniform float uTime;
varying vec3 vColor; varying float vAlpha; varying float vR;
#ifdef DASH
varying float vDist;
#endif
void main(){
  if (vR > uReveal) discard;
  #ifdef DASH
  if (fract(vDist * 0.32 - uTime * 0.9) > 0.5) discard;
  #endif
  float front = smoothstep(uReveal - 16.0, uReveal, vR);
  float scan = exp(-abs(vR - uScanR) * 0.16);
  vec3 c = vColor * (1.0 + front * 3.0 + scan * 0.85);
  gl_FragColor = vec4(c, vAlpha * uOpacity);
}`;
const VS_TER = `
attribute float aMask; varying float vMask; varying vec3 vN; varying vec3 vW;
void main(){ vMask = aMask; vN = normal; vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS_TER = `
uniform vec3 uBg; uniform vec3 uTint; uniform float uReveal;
varying float vMask; varying vec3 vN; varying vec3 vW;
void main(){
  if (vMask < 0.03) discard;
  float l = clamp(dot(normalize(vN), normalize(vec3(-0.45, 0.8, -0.35))), 0.0, 1.0);
  vec2 gp = vW.xz / 10.0;
  vec2 g = abs(fract(gp - 0.5) - 0.5) / fwidth(gp);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  vec3 c = uBg + uTint * (0.025 + 0.085 * l * l) + uTint * line * 0.05;
  float rv = 1.0 - smoothstep(uReveal - 30.0, uReveal, length(vW.xz));
  c = mix(uBg, c, clamp(vMask * 1.4, 0.0, 1.0) * rv);
  gl_FragColor = vec4(c, 1.0);
}`;
const VS_POS = `varying vec3 vW; attribute float aRad; varying float vRad;
void main(){ vW = position; vRad = aRad; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS_HOT = `
uniform vec3 uColor; uniform float uTime; uniform float uReveal; uniform float uOpacity; varying vec3 vW; varying float vRad;
void main(){
  if (length(vW.xz) > uReveal) discard;
  float rim = smoothstep(0.88, 0.99, vRad);
  float wave = pow(fract(vRad * 2.5 - uTime * 0.35), 8.0) * (1.0 - vRad * 0.6);
  float hatch = step(0.84, fract((vW.x + vW.z) * 0.35)) * 0.3;
  float a = rim * 0.9 + wave * 0.45 + hatch * (1.0 - vRad * 0.5) + 0.04;
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;
const FS_WATER = `
uniform vec3 uColor; uniform float uTime; uniform float uReveal; varying vec3 vW; varying float vRad;
void main(){
  float r = length(vW.xz); if (r > uReveal) discard;
  float fade = 1.0 - smoothstep(55.0, 92.0, r);
  float band = pow(abs(sin(vW.z * 1.2 + sin(vW.x * 0.07 + uTime * 0.5) * 1.8)), 30.0);
  float sh = 0.55 + 0.45 * sin(vW.x * 0.12 - uTime * 1.1 + vW.z * 0.04);
  gl_FragColor = vec4(uColor, fade * (0.05 + band * 0.5 * sh));
}`;

function lineMat(opacity = 1, opt = {}){
  return new THREE.ShaderMaterial({
    uniforms:{ uReveal:U.uReveal, uScanR:U.uScanR, uTime:U.uTime, uOpacity:{value:opacity} },
    vertexShader:VS_LINE, fragmentShader:FS_LINE, defines:opt.dash ? {DASH:''} : {},
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:opt.side || THREE.FrontSide
  });
}

class Buf {
  constructor(){ this.p = []; this.c = []; this.a = []; this.d = null; }
  v(x, y, z, col, a){ this.p.push(x, y, z); this.c.push(col.r, col.g, col.b); this.a.push(a); }
  seg(x1, y1, z1, x2, y2, z2, c1, a1, c2 = c1, a2 = a1){ this.v(x1, y1, z1, c1, a1); this.v(x2, y2, z2, c2, a2); }
  quad(p1, p2, p3, p4, col, a1, a2){ // p = [x,y,z]; a1 for p1/p2 (bottom), a2 for p3/p4 (top)
    this.v(...p1, col, a1); this.v(...p2, col, a1); this.v(...p3, col, a2);
    this.v(...p1, col, a1); this.v(...p3, col, a2); this.v(...p4, col, a2);
  }
  tri(p1, p2, p3, col, a){ this.v(...p1, col, a); this.v(...p2, col, a); this.v(...p3, col, a); }
  geo(){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(this.a, 1));
    if (this.d) g.setAttribute('aDist', new THREE.Float32BufferAttribute(this.d, 1));
    return g;
  }
}

/* ======================================================================
   Zone build
   ====================================================================== */
const world = new THREE.Group(); scene.add(world);
const layerObjs = { poi:[], regions:[], hot:[], contacts:[] };
let Zc = null;          // current zone runtime
const state = { zi:0, layers:{poi:true, regions:true, hot:false, contacts:true}, sel:null, revealT0:null, scanT0:0, lastPh:1, loading:false };

try {
  const saved = JSON.parse(localStorage.getItem('kessler-layers') || 'null');
  if (saved) Object.assign(state.layers, saved);
} catch (e){}

function disposeWorld(){
  world.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  world.clear ? world.clear() : world.children.slice().forEach(ch => world.remove(ch));
  layerObjs.poi = []; layerObjs.regions = []; layerObjs.hot = []; layerObjs.contacts = [];
  $('#labels').innerHTML = '';
}

function buildZone(zi, report){
  const Z = ZONES[zi];
  const field = makeField(Z), rng = mulberry32(Z.seed * 3 + 1);
  const H = new Float32Array(NV * NV), M = new Float32Array(NV * NV);
  let maxH = 0;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++){
    const u = i / N * 2 - 1, v = j / N * 2 - 1, k = j * NV + i;
    H[k] = field.h(u, v); M[k] = field.mask(u, v); if (H[k] > maxH) maxH = H[k];
  }
  const sample = (A, x, z) => {
    const fx = clamp((x + HALF) / STEP, 0, N - 1e-4), fz = clamp((z + HALF) / STEP, 0, N - 1e-4);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * NV + i;
    return (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + NV] * (1 - tx) + A[k + NV + 1] * tx) * tz;
  };
  const ground = (x, z) => sample(H, x, z);
  const maskAt = (x, z) => sample(M, x, z);
  const surf = Z.water != null ? (x, z) => Math.max(ground(x, z), Z.water) : ground;
  report(1);

  /* --- terrain occluder --- */
  {
    const pos = new Float32Array(NV * NV * 3), am = new Float32Array(NV * NV);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++){
      const k = j * NV + i; pos[k * 3] = -HALF + i * STEP; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = -HALF + j * STEP; am[k] = M[k];
    }
    const idx = new Uint16Array(N * N * 6); let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
      const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMask', new THREE.BufferAttribute(am, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.ShaderMaterial({
      uniforms:{ uBg:{value:C.void}, uTint:{value:new THREE.Color().fromArray(Z.tint)}, uReveal:U.uReveal },
      vertexShader:VS_TER, fragmentShader:FS_TER, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1
    });
    m.extensions.derivatives = true;
    world.add(new THREE.Mesh(g, m));
  }

  /* --- contours (marching squares) --- */
  {
    const B = new Buf(), ci = Z.ci, levels = Math.floor(maxH / ci) + 1, lc = [], la = [];
    for (let l = 0; l <= levels; l++){
      const t = clamp(l * ci / Math.max(maxH, 1), 0, 1), idx = l % 5 === 0;
      const col = t < 0.5 ? C.deep.clone().lerp(C.mid, t * 2) : C.mid.clone().lerp(C.high, (t - 0.5) * 2);
      if (idx) col.lerp(C.peak, 0.3);
      col.multiplyScalar(idx ? 0.95 : 0.7); lc.push(col); la.push(idx ? 0.95 : 0.55);
    }
    const ex = [0,0,0,0], ez = [0,0,0,0];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
      const ia = j * NV + i, ib = ia + 1, ic = ia + NV + 1, id = ia + NV;
      const a = H[ia], b = H[ib], c = H[ic], d = H[id];
      const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
      const l0 = Math.max(1, Math.ceil(mn / ci)), l1 = Math.floor(mx / ci);
      if (l1 < l0) continue;
      const m = (M[ia] + M[ib] + M[ic] + M[id]) * 0.25; if (m < 0.03) continue;
      const x0 = -HALF + i * STEP, z0 = -HALF + j * STEP, x1 = x0 + STEP, z1 = z0 + STEP;
      for (let l = l0; l <= l1; l++){
        const L = l * ci, ea = a >= L, eb = b >= L, ec = c >= L, ed = d >= L;
        let k = 0;
        if (ea !== eb){ const t = (L - a) / (b - a); ex[k] = x0 + t * STEP; ez[k] = z0; k++; }
        if (eb !== ec){ const t = (L - b) / (c - b); ex[k] = x1; ez[k] = z0 + t * STEP; k++; }
        if (ec !== ed){ const t = (L - c) / (d - c); ex[k] = x1 - t * STEP; ez[k] = z1; k++; }
        if (ed !== ea){ const t = (L - d) / (a - d); ex[k] = x0; ez[k] = z1 - t * STEP; k++; }
        const y = L + 0.12, col = lc[l] || C.high, al = (la[l] || 0.6) * m;
        if (k === 2) B.seg(ex[0], y, ez[0], ex[1], y, ez[1], col, al);
        else if (k === 4){
          if (((a + b + c + d) / 4 >= L) === ea){ B.seg(ex[0], y, ez[0], ex[1], y, ez[1], col, al); B.seg(ex[2], y, ez[2], ex[3], y, ez[3], col, al); }
          else { B.seg(ex[0], y, ez[0], ex[3], y, ez[3], col, al); B.seg(ex[1], y, ez[1], ex[2], y, ez[2], col, al); }
        }
      }
    }
    world.add(new THREE.LineSegments(B.geo(), lineMat(1)));
  }
  report(2);

  /* --- water --- */
  if (Z.water != null){
    const g = new THREE.PlaneGeometry(WORLD, WORLD, 1, 1); g.rotateX(-Math.PI / 2); g.translate(0, Z.water, 0);
    g.setAttribute('aRad', new THREE.Float32BufferAttribute([0,0,0,0], 1));
    const m = new THREE.ShaderMaterial({ uniforms:{uColor:{value:C.water}, uTime:U.uTime, uReveal:U.uReveal}, vertexShader:VS_POS, fragmentShader:FS_WATER, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
    world.add(new THREE.Mesh(g, m));
  }

  /* --- structures, roads, infill (shared layout; consumes rng in map order) --- */
  const L = new Buf(), F = new Buf(), R = new Buf();
  const { regions, infillCount } = layoutZone(Z, {ground, maskAt, surf, rng, C, L, F, R});
  world.add(new THREE.LineSegments(R.geo(), lineMat(1)));
  world.add(new THREE.LineSegments(L.geo(), lineMat(1)));
  world.add(new THREE.Mesh(F.geo(), lineMat(1, {side:THREE.DoubleSide})));
  report(3);

  /* --- POIs --- */
  const pois = Z.pois.map((p, i) => { const x = p.u * 100, z = p.v * 100; return {...p, i, x, z, y:surf(x, z) + 1.4}; });

  /* --- hot zones --- */
  const hots = Z.hot.map((h, i) => ({...h, i, x:h.u * 100, z:h.v * 100, rad:h.r * 100}));
  for (const h of hots){
    const RINGS = 14, SEG = 56, pos = [], rad = [], idx = [];
    pos.push(h.x, surf(h.x, h.z) + 0.6, h.z); rad.push(0);
    for (let r = 1; r <= RINGS; r++) for (let s = 0; s < SEG; s++){
      const t = r / RINGS, a = s / SEG * Math.PI * 2, x = h.x + Math.cos(a) * h.rad * t, z = h.z + Math.sin(a) * h.rad * t;
      pos.push(x, surf(x, z) + 0.6, z); rad.push(t);
    }
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + s, 1 + (s + 1) % SEG);
    for (let r = 1; r < RINGS; r++) for (let s = 0; s < SEG; s++){
      const a = 1 + (r - 1) * SEG + s, b = 1 + (r - 1) * SEG + (s + 1) % SEG, c = a + SEG, d = b + SEG;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({ uniforms:{uColor:{value:C.alert}, uTime:U.uTime, uReveal:U.uReveal, uOpacity:{value:0.9}}, vertexShader:VS_POS, fragmentShader:FS_HOT, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m); world.add(mesh); layerObjs.hot.push(mesh);
  }

  /* --- contacts on patrol loops --- */
  const contacts = [], RT = new Buf(); RT.d = [];
  const total = Z.crew + Z.hostile;
  for (let k = 0; k < total; k++){
    const crew = k < Z.crew, order = regions.map(r => r.i).sort(() => rng() - 0.5).slice(0, 3);
    let pts = [];
    for (let s = 0; s < order.length; s++){
      const A = regions[order[s]], Bq = regions[order[(s + 1) % order.length]];
      const seg = curvePts(A.x + (rng() - 0.5) * 8, A.z + (rng() - 0.5) * 8, Bq.x + (rng() - 0.5) * 8, Bq.z + (rng() - 0.5) * 8, (rng() - 0.5) * 0.4, 40, surf, 0.8);
      pts = pts.concat(s === 0 ? seg : seg.slice(3));
    }
    const cum = [0];
    for (let q = 3; q < pts.length; q += 3) cum.push(cum[cum.length - 1] + Math.hypot(pts[q] - pts[q - 3], pts[q + 2] - pts[q - 1]));
    const col = crew ? C.signal : C.alert;
    for (let q = 0; q < pts.length - 3; q += 3){
      RT.seg(pts[q], pts[q + 1], pts[q + 2], pts[q + 3], pts[q + 4], pts[q + 5], col, crew ? 0.45 : 0.5);
      RT.d.push(cum[q / 3], cum[q / 3 + 1]);
    }
    const code = crew ? 'CR-' + pad(k + 1) : 'HX-' + pad(k - Z.crew + 1);
    contacts.push({crew, code, pts, cum, len:cum[cum.length - 1], speed:(crew ? 3.2 : 2.4) + rng() * 2, s0:rng() * 1000, pos:new THREE.Vector3(), seg:0});
  }
  const routes = new THREE.LineSegments(RT.geo(), lineMat(0.8, {dash:true}));
  world.add(routes); layerObjs.contacts.push(routes);
  report(4);

  // stats per region
  for (const r of regions){
    r.y = ground(r.x, r.z);
    r.nodes = pois.filter(p => Math.hypot(p.x - r.x, p.z - r.z) < 20);
  }
  const structures = regions.reduce((s, r) => s + r.count, 0) + infillCount;
  return {Z, zi, H, M, maxH, ground, maskAt, surf, regions, pois, hots, contacts, structures};
}

/* ======================================================================
   Labels (DOM projected from 3D)
   ====================================================================== */
let labels = [];
function makeLabels(){
  const host = $('#labels'); host.innerHTML = ''; labels = [];
  const add = (el, pos, layer, kind, ref) => { host.appendChild(el); const L = {el, pos, layer, kind, ref, vis:true, r:Math.hypot(pos.x, pos.z)}; labels.push(L); return L; };
  for (const h of Zc.hots){
    const el = document.createElement('button'); el.type = 'button'; el.className = 'hlabel';
    el.innerHTML = ICON.warn + '<span>' + h.name + '</span>';
    el.setAttribute('aria-label', 'Hot zone ' + h.name);
    el.addEventListener('click', () => select({kind:'hot', i:h.i}));
    h.label = add(el, new THREE.Vector3(h.x, Zc.surf(h.x, h.z) + 2, h.z), 'hot', 'hot', h);
  }
  for (const c of Zc.contacts){
    const el = document.createElement('div'); el.className = 'contact ' + (c.crew ? 'crew' : 'hostile');
    el.innerHTML = '<i></i><span>' + c.code + '</span>';
    c.label = add(el, c.pos, 'contacts', 'contact', c);
  }
  for (const p of Zc.pois){
    const el = document.createElement('button'); el.type = 'button'; el.className = 'poi t-' + p.t;
    el.innerHTML = ICON[p.t] + '<span>' + p.code + '</span>';
    el.title = p.code + ' · ' + p.name;
    el.setAttribute('aria-label', TYPES[p.t].label + ' ' + p.code + ', ' + p.name);
    el.addEventListener('click', () => select({kind:'poi', i:p.i}));
    p.label = add(el, new THREE.Vector3(p.x, p.y, p.z), 'poi', 'poi', p);
  }
  for (const r of Zc.regions){
    const el = document.createElement('button'); el.type = 'button'; el.className = 'rlabel';
    el.innerHTML = '<span class="br">[</span> ' + r.name + ' <span class="br">]</span>';
    el.setAttribute('aria-label', 'Region ' + r.name);
    el.addEventListener('click', () => select({kind:'region', i:r.i}));
    r.label = add(el, new THREE.Vector3(r.x, r.y + 9, r.z), 'regions', 'region', r);
  }
}

const vtmp = new THREE.Vector3();
let vw = 1, vh = 1;
function updateLabels(){
  const rev = U.uReveal.value;
  for (const L of labels){
    let show = state.layers[L.layer] && L.r < rev;
    if (L.kind === 'contact') show = show && rev > 900;
    let x = 0, y = 0;
    if (show){
      vtmp.copy(L.pos).project(camera);
      if (vtmp.z > 1 || vtmp.z < -1) show = false;
      else { x = (vtmp.x * 0.5 + 0.5) * vw; y = (-vtmp.y * 0.5 + 0.5) * vh; if (x < -200 || x > vw + 200 || y < -60 || y > vh + 60) show = false; }
    }
    if (show !== L.vis){ L.vis = show; L.el.classList.toggle('off', !show); }
    if (show){
      const t = L.kind === 'region' ? 'translate(-50%,-100%)' : L.kind === 'hot' ? 'translate(-50%,-50%)' : 'translate(-10px,-50%)';
      L.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) ' + t;
    }
  }
}

/* ======================================================================
   Camera controls
   ====================================================================== */
const DMIN = 30, DMAX = 340, PMIN = 0.06, PMAX = 1.22, PTILT = 0.62;
const cam = {tx:0, ty:15, tz:0, dist:330, az:-0.12, pol:0.75};
const G = {tx:0, tz:0, dist:235, az:-0.12, pol:PTILT};
let lastInput = -1e9, flying = false;
const touch = () => { lastInput = performance.now(); flying = false; };

function clampGoal(){
  const r = Math.hypot(G.tx, G.tz); if (r > 92){ G.tx *= 92 / r; G.tz *= 92 / r; }
  G.dist = clamp(G.dist, DMIN, DMAX); G.pol = clamp(G.pol, PMIN, PMAX);
}
function updateCamera(dt, now){
  if (!REDUCED && now - lastInput > 10000 && !flying && !state.sel) G.az += dt * 0.022;
  const k = 1 - Math.exp(-dt * (flying ? 3.4 : 7));
  cam.tx += (G.tx - cam.tx) * k; cam.tz += (G.tz - cam.tz) * k;
  cam.dist = Math.exp(lerp(Math.log(cam.dist), Math.log(G.dist), k));
  cam.az += wrapA(G.az - cam.az) * k;
  cam.pol += (G.pol - cam.pol) * k;
  if (Zc){ const gy = Zc.surf(cam.tx, cam.tz); cam.ty += (gy - cam.ty) * (1 - Math.exp(-dt * 3)); }
  if (flying && Math.abs(G.dist - cam.dist) < 0.5 && Math.hypot(G.tx - cam.tx, G.tz - cam.tz) < 0.3) flying = false;
  const sp = Math.sin(cam.pol), cp = Math.cos(cam.pol);
  camera.position.set(cam.tx + Math.sin(cam.az) * sp * cam.dist, cam.ty + cp * cam.dist, cam.tz + Math.cos(cam.az) * sp * cam.dist);
  camera.lookAt(cam.tx, cam.ty, cam.tz);
}
function wpp(){ return 2 * cam.dist * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, vh); }
function panBy(dx, dy){
  const w = wpp(), rx = Math.cos(cam.az), rz = -Math.sin(cam.az), fx = -Math.sin(cam.az), fz = -Math.cos(cam.az), vy = 1 / Math.max(0.4, Math.cos(cam.pol));
  const mx = (-dx * rx + dy * fx * vy) * w, mz = (-dx * rz + dy * fz * vy) * w;
  G.tx += mx; G.tz += mz; clampGoal(); cam.tx = G.tx; cam.tz = G.tz;
}
function rotateBy(dx, dy){ G.az -= dx * 0.006; G.pol -= dy * 0.004; clampGoal(); cam.az = G.az; cam.pol = G.pol; }
function zoomBy(f){ G.dist *= f; clampGoal(); }
function flyTo(x, z, dist, pol){
  G.tx = x; G.tz = z; G.dist = dist; if (pol != null && G.pol > 0.2) G.pol = Math.min(G.pol, pol);
  clampGoal(); flying = true; lastInput = performance.now();
}
function resetView(){ G.tx = 0; G.tz = 0; G.dist = 235; G.pol = PTILT; G.az = -0.12; flying = true; lastInput = performance.now(); }
function toggleTilt(){ G.pol = G.pol > 0.3 ? PMIN : PTILT; flying = true; lastInput = performance.now(); }

// pointer input
const pointers = new Map();
let gesture = null, downInfo = null;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const rotate = e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey;
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY, rotate});
  gesture = null; downInfo = {x:e.clientX, y:e.clientY, t:performance.now()};
  canvas.classList.add('grabbing'); touch();
});
canvas.addEventListener('pointermove', e => {
  hover.x = e.clientX; hover.y = e.clientY; hover.dirty = true; hover.inside = true;
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1){ if (p.rotate) rotateBy(dx, dy); else panBy(dx, dy); }
  else if (pointers.size === 2){
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
    if (gesture){
      G.dist *= gesture.d / Math.max(d, 1); G.az -= wrapA(ang - gesture.ang); G.pol -= (my - gesture.my) * 0.004;
      clampGoal(); cam.az = G.az; cam.pol = G.pol;
    }
    gesture = {d, ang, my};
  }
  touch();
});
const endPointer = e => {
  pointers.delete(e.pointerId); gesture = null;
  if (!pointers.size) canvas.classList.remove('grabbing');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { hover.inside = false; hover.dirty = true; });
const onWheel = e => { e.preventDefault(); zoomBy(Math.exp(clamp(e.deltaY, -120, 120) * 0.0016)); touch(); };
canvas.addEventListener('wheel', onWheel, {passive:false});
$('#labels').addEventListener('wheel', onWheel, {passive:false});

addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('#v-rail')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase(), s = 40;
  switch (k){
    case 'w': case 'arrowup': panBy(0, s); break;
    case 's': case 'arrowdown': panBy(0, -s); break;
    case 'a': case 'arrowleft': panBy(s, 0); break;
    case 'd': case 'arrowright': panBy(-s, 0); break;
    case 'q': G.az += 0.25; break;
    case 'e': G.az -= 0.25; break;
    case '+': case '=': zoomBy(0.8); break;
    case '-': case '_': zoomBy(1.25); break;
    case 'r': resetView(); break;
    case 't': toggleTilt(); break;
    case 'escape': closeIntel(); return;
    default: return;
  }
  e.preventDefault(); lastInput = performance.now();
});

// view rail
$('#v-in').addEventListener('click', () => { zoomBy(0.75); touch(); });
$('#v-out').addEventListener('click', () => { zoomBy(1.33); touch(); });
$('#v-reset').addEventListener('click', resetView);
$('#v-tilt').addEventListener('click', toggleTilt);
$('#compass').addEventListener('click', () => { G.az = Math.round(G.az / (Math.PI * 2)) * Math.PI * 2; flying = true; lastInput = performance.now(); });
const rail = $('#v-rail');
const railSet = e => { const r = rail.getBoundingClientRect(), f = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); G.dist = Math.exp(lerp(Math.log(DMAX), Math.log(DMIN), f)); touch(); };
rail.addEventListener('pointerdown', e => { rail.setPointerCapture(e.pointerId); railSet(e); });
rail.addEventListener('pointermove', e => { if (rail.hasPointerCapture(e.pointerId)) railSet(e); });
rail.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight'){ zoomBy(0.85); e.preventDefault(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft'){ zoomBy(1.18); e.preventDefault(); } touch(); });

/* ======================================================================
   Cursor pick (ray march against the height field)
   ====================================================================== */
const hover = {x:0, y:0, dirty:false, inside:false};
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let cursorRing = null;
{
  const pts = []; for (let s = 0; s <= 48; s++){ const a = s / 48 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  cursorRing = new THREE.Line(g, new THREE.LineBasicMaterial({color:C.signal, transparent:true, opacity:0.9, depthTest:false}));
  cursorRing.renderOrder = 10; cursorRing.visible = false; scene.add(cursorRing);
}
function pickGround(cx, cy){
  if (!Zc) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  if (d.y > -1e-3) return null;
  let t = Math.max(0, (o.y - (Zc.maxH + 6)) / -d.y), prev = t;
  const tEnd = (o.y + 2) / -d.y;
  for (let i = 0; i < 900 && t <= tEnd; i++){
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= Zc.surf(x, z)){
      let lo = prev, hi = t;
      for (let b = 0; b < 8; b++){ const m = (lo + hi) / 2; const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m; if (my <= Zc.surf(mx, mz)) hi = m; else lo = m; }
      const x2 = o.x + d.x * hi, z2 = o.z + d.z * hi;
      if (Math.abs(x2) > HALF || Math.abs(z2) > HALF || Zc.maskAt(x2, z2) < 0.08) return null;
      return {x:x2, y:Zc.surf(x2, z2), z:z2};
    }
    prev = t; t += 0.8;
  }
  return null;
}
const gridRef = (x, z) => pad(Math.round((x + HALF) * 10), 4) + ' ' + pad(Math.round((HALF - z) * 10), 4);
const elevOf = (Z, h) => Z.datum + h * 10;

function updateCursor(){
  if (!hover.dirty) return; hover.dirty = false;
  const hit = hover.inside && !pointers.size ? pickGround(hover.x, hover.y) : null;
  if (!hit){ cursorRing.visible = false; $('#ro-grid').textContent = 'GR ---- ----'; $('#ro-elev').textContent = '— M'; return; }
  cursorRing.visible = true; cursorRing.position.set(hit.x, hit.y + 0.3, hit.z);
  const s = cam.dist / 110; cursorRing.scale.set(s, s, s);
  $('#ro-grid').textContent = 'GR ' + gridRef(hit.x, hit.z);
  $('#ro-elev').textContent = fmtM(elevOf(Zc.Z, Zc.ground(hit.x, hit.z)));
}

/* ======================================================================
   Selection + intel panel
   ====================================================================== */
let selRing = null;
function setSelRing(x, z, r){
  if (selRing){ scene.remove(selRing); selRing.geometry.dispose(); selRing.material.dispose(); selRing = null; }
  if (x == null) return;
  const B = new Buf(), S = 72;
  for (let s = 0; s < S; s++){
    const a1 = s / S * Math.PI * 2, a2 = (s + 1) / S * Math.PI * 2;
    const x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r, x2 = x + Math.cos(a2) * r, z2 = z + Math.sin(a2) * r;
    if (s % 6 < 4) B.seg(x1, Zc.surf(x1, z1) + 0.5, z1, x2, Zc.surf(x2, z2) + 0.5, z2, C.signal, 0.9);
  }
  selRing = new THREE.LineSegments(B.geo(), lineMat(1)); scene.add(selRing);
}
function listFor(kind){ return kind === 'region' ? Zc.regions : kind === 'poi' ? Zc.pois : Zc.hots; }
function nearestRegion(x, z){ let best = null, bd = 1e9; for (const r of Zc.regions){ const d = Math.hypot(r.x - x, r.z - z); if (d < bd){ bd = d; best = r; } } return {r:best, d:bd}; }

function select(sel){
  if (!Zc) return;
  const list = listFor(sel.kind), item = list[sel.i]; if (!item) return;
  if (state.sel && state.sel.item && state.sel.item.label) state.sel.item.label.el.classList.remove('is-active');
  state.sel = {...sel, item};
  if (item.label) item.label.el.classList.add('is-active');
  const Z = Zc.Z, data = [];
  const idx = $('#in-idx'), chip = $('#in-chip');
  idx.textContent = pad(sel.i + 1) + '/' + pad(list.length);
  $('#in-name').textContent = item.name.toUpperCase();
  if (sel.kind === 'region'){
    $('#in-kind').textContent = 'REGION · ' + item.code;
    chip.className = 'chip chip--' + item.threat; chip.textContent = 'THREAT · ' + item.threat.toUpperCase();
    data.push(['GRID', gridRef(item.x, item.z)], ['ELEV', fmtM(elevOf(Z, item.y))], ['STRUCTURES', item.count ? pad(item.count) : '—'], ['NODES', pad(item.nodes.length)]);
    $('#in-desc').textContent = item.desc;
    renderNodes(item.nodes);
    setSelRing(item.x, item.z, 16);
    flyTo(item.x, item.z, 82, 0.9);
  } else if (sel.kind === 'poi'){
    const T = TYPES[item.t], nr = nearestRegion(item.x, item.z);
    $('#in-kind').textContent = T.label + ' · ' + item.code;
    chip.className = 'chip chip--' + item.t; chip.textContent = T.label;
    data.push(['GRID', gridRef(item.x, item.z)], ['ELEV', fmtM(elevOf(Z, Zc.ground(item.x, item.z)))], ['NEAREST', nr.r.name], ['RANGE', fmtM(nr.d * 10)]);
    $('#in-desc').textContent = item.note;
    renderNodes(null);
    setSelRing(item.x, item.z, 4);
    flyTo(item.x, item.z, 52, 0.95);
  } else {
    $('#in-kind').textContent = 'HOT ZONE · HZ-' + pad(item.i + 1);
    chip.className = 'chip chip--hazard'; chip.textContent = 'HAZARD · AVOID';
    const nr = nearestRegion(item.x, item.z);
    data.push(['GRID', gridRef(item.x, item.z)], ['RADIUS', fmtM(item.rad * 10)], ['NEAREST', nr.r.name], ['ELEV', fmtM(elevOf(Z, Zc.ground(item.x, item.z)))]);
    $('#in-desc').textContent = item.desc;
    renderNodes(null);
    setSelRing(item.x, item.z, item.rad + 1.5);
    flyTo(item.x, item.z, Math.max(70, item.rad * 5), 0.9);
    if (!state.layers.hot){ state.layers.hot = true; $('#ly-hot').checked = true; applyLayers(); }
  }
  $('#in-data').innerHTML = data.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('');
  $('#intel').hidden = false; $('#zones').hidden = true;
}
function renderNodes(nodes){
  const wrap = $('#in-nodes-wrap');
  if (!nodes || !nodes.length){ wrap.hidden = true; return; }
  wrap.hidden = false;
  const ul = $('#in-nodes'); ul.innerHTML = '';
  for (const p of nodes){
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button';
    b.innerHTML = '<span class="t-' + p.t + '">' + ICON[p.t] + '</span><span class="nc">' + p.code + '</span><span class="nn">' + p.name + '</span>';
    b.addEventListener('click', () => select({kind:'poi', i:p.i}));
    li.appendChild(b); ul.appendChild(li);
  }
}
function closeIntel(){
  if (state.sel && state.sel.item && state.sel.item.label) state.sel.item.label.el.classList.remove('is-active');
  state.sel = null; setSelRing(null);
  $('#intel').hidden = true; $('#zones').hidden = false;
}
$('#in-close').addEventListener('click', closeIntel);
$('#in-prev').addEventListener('click', () => { if (!state.sel) return; const n = listFor(state.sel.kind).length; select({kind:state.sel.kind, i:(state.sel.i - 1 + n) % n}); });
$('#in-next').addEventListener('click', () => { if (!state.sel) return; const n = listFor(state.sel.kind).length; select({kind:state.sel.kind, i:(state.sel.i + 1) % n}); });

/* ======================================================================
   Layers
   ====================================================================== */
function applyLayers(){
  for (const o of layerObjs.hot) o.visible = state.layers.hot;
  for (const o of layerObjs.contacts) o.visible = state.layers.contacts;
  try { localStorage.setItem('kessler-layers', JSON.stringify(state.layers)); } catch (e){}
}
[['poi', '#ly-poi'], ['regions', '#ly-regions'], ['hot', '#ly-hot'], ['contacts', '#ly-contacts']].forEach(([k, sel]) => {
  const el = $(sel); el.checked = state.layers[k];
  el.addEventListener('change', () => { state.layers[k] = el.checked; applyLayers(); });
});
$('#layers-toggle').addEventListener('click', () => {
  const open = $('#left').classList.toggle('open'); $('#layers-toggle').setAttribute('aria-expanded', String(open));
});

/* ======================================================================
   Compass, rail, scale
   ====================================================================== */
const PPD = 3.4, CARD = {0:'N', 45:'NE', 90:'E', 135:'SE', 180:'S', 225:'SW', 270:'W', 315:'NW'};
(function buildCompass(){
  let html = '';
  for (let d = -360; d <= 720; d += 5){
    const n = ((d % 360) + 360) % 360, x = ((d + 360) * PPD).toFixed(1);
    if (n % 45 === 0) html += '<span class="ct ct--card" style="left:' + x + 'px"><b>' + CARD[n] + '</b></span>';
    else if (n % 15 === 0) html += '<span class="ct ct--maj" style="left:' + x + 'px"><b>' + n + '</b></span>';
    else html += '<span class="ct" style="left:' + x + 'px"></span>';
  }
  $('#c-tape').innerHTML = html;
})();
let compassW = 400, lastHdg = -1, lastRail = -1, lastScale = -1;
function updateHUD(){
  const hdg = (((-cam.az * 180 / Math.PI) % 360) + 360) % 360;
  if (Math.abs(hdg - lastHdg) > 0.05){
    lastHdg = hdg;
    $('#c-tape').style.transform = 'translateX(' + (compassW / 2 - (hdg + 360) * PPD).toFixed(1) + 'px)';
    const r = Math.round(hdg) % 360;
    $('#c-card').textContent = CARD[(Math.round(hdg / 45) * 45) % 360];
    $('#c-deg').textContent = pad(r, 3) + '°';
  }
  const f = 1 - (Math.log(cam.dist) - Math.log(DMIN)) / (Math.log(DMAX) - Math.log(DMIN));
  if (Math.abs(f - lastRail) > 0.002){ lastRail = f; $('#v-fill').style.height = (clamp(f, 0, 1) * 100).toFixed(1) + '%'; rail.setAttribute('aria-valuenow', String(Math.round(f * 100))); }
  const mpp = wpp() * 10;
  if (lastScale <= 0 || Math.abs(mpp - lastScale) / lastScale > 0.01){
    lastScale = mpp;
    const raw = 100 * mpp, nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].filter(v => v <= raw).pop() || 10;
    $('#scale-bar').style.width = Math.round(nice / mpp) + 'px';
    $('#scale-label').textContent = nice >= 1000 ? (nice / 1000) + ' KM' : nice + ' M';
  }
  const tl = G.pol > 0.3 ? '2D' : '3D';
  if (tl !== lastTilt){ lastTilt = tl; $('#v-tilt').textContent = tl; }
}
let lastTilt = '';

/* ======================================================================
   Zone cards (thumbnails drawn from each zone's height field)
   ====================================================================== */
function drawThumb(cv, Z){
  const ctx = cv.getContext('2d'), W = cv.width, Hh = cv.height, res = 110;
  const f = makeField(Z), A = new Float32Array((res + 1) * (res + 1)), Mk = new Float32Array((res + 1) * (res + 1));
  let mx = 0;
  for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++){ const u = i / res * 2 - 1, v = j / res * 2 - 1, k = j * (res + 1) + i; A[k] = f.h(u, v); Mk[k] = f.mask(u, v); mx = Math.max(mx, A[k]); }
  ctx.fillStyle = css.getPropertyValue('--void').trim(); ctx.fillRect(0, 0, W, Hh);
  const scale = W / 1.7, ox = W / 2, oy = Hh / 2, ci = Z.ci * 3;
  const P = (u, v) => [ox + u * scale / 2 * 1.0, oy + v * scale / 2 * 1.0];
  ctx.lineWidth = 1.2;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++){
    const k = j * (res + 1) + i, a = A[k], b = A[k + 1], c = A[k + res + 2], d = A[k + res + 1];
    const m = (Mk[k] + Mk[k + 1] + Mk[k + res + 1] + Mk[k + res + 2]) / 4; if (m < 0.05) continue;
    const mn = Math.min(a, b, c, d), mxx = Math.max(a, b, c, d);
    for (let l = Math.max(1, Math.ceil(mn / ci)); l <= Math.floor(mxx / ci); l++){
      const L = l * ci, pts = [];
      const u0 = i / res * 2 - 1, v0 = j / res * 2 - 1, s = 2 / res;
      if ((a >= L) !== (b >= L)) pts.push([u0 + (L - a) / (b - a) * s, v0]);
      if ((b >= L) !== (c >= L)) pts.push([u0 + s, v0 + (L - b) / (c - b) * s]);
      if ((c >= L) !== (d >= L)) pts.push([u0 + s - (L - c) / (d - c) * s, v0 + s]);
      if ((d >= L) !== (a >= L)) pts.push([u0, v0 + s - (L - d) / (a - d) * s]);
      if (pts.length >= 2){
        const t = L / mx;
        ctx.strokeStyle = 'rgba(' + Math.round(60 + t * 120) + ',' + Math.round(130 + t * 90) + ',255,' + (0.25 + 0.6 * m * (l % 5 === 0 ? 1 : 0.6)).toFixed(2) + ')';
        ctx.beginPath(); const p1 = P(...pts[0]), p2 = P(...pts[1]); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      }
    }
  }
  ctx.fillStyle = css.getPropertyValue('--signal').trim();
  for (const r of Z.regions){ const [x, y] = P(r.u, r.v); ctx.fillRect(x - 2.5, y - 2.5, 5, 5); }
}
function buildZoneCards(){
  const host = $('#zones'); host.innerHTML = '';
  ZONES.forEach((Z, zi) => {
    if (zi === state.zi) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'zcard';
    b.innerHTML = '<span class="zc-head"><span class="zc-name">' + Z.name + '</span><span class="zc-idx">' + pad(zi + 1) + '/' + pad(ZONES.length) + '</span></span>' +
      '<canvas class="zc-thumb" width="520" height="200"></canvas>' +
      '<span class="zc-foot"><span>' + pad(Z.regions.length) + ' REGIONS · ' + pad(Z.pois.length) + ' NODES · ' + Z.code + '</span><span class="zc-go" aria-hidden="true">→</span></span>';
    b.setAttribute('aria-label', 'Deploy to ' + Z.name);
    b.addEventListener('click', () => loadZone(zi));
    host.appendChild(b);
    const cv = b.querySelector('canvas');
    if (!thumbCache[zi]){ const off = document.createElement('canvas'); off.width = 520; off.height = 200; drawThumb(off, Z); thumbCache[zi] = off; }
    cv.getContext('2d').drawImage(thumbCache[zi], 0, 0);
  });
}
const thumbCache = {};

/* ======================================================================
   Zone loading flow
   ====================================================================== */
const SEGS = 30;
$('#boot-bar').innerHTML = '<i></i>'.repeat(SEGS);
const wait = ms => new Promise(r => setTimeout(r, REDUCED ? 0 : ms));
function setBar(f){ const n = Math.round(f * SEGS); document.querySelectorAll('#boot-bar i').forEach((el, i) => el.classList.toggle('on', i < n)); }

async function loadZone(zi){
  if (state.loading) return;
  state.loading = true; closeIntel();
  const Z = ZONES[zi], boot = $('#boot');
  boot.classList.toggle('soft', !!Zc); boot.classList.remove('done');
  $('#boot-name').textContent = Z.name;
  const steps = ['SAMPLING ELEVATION…', 'TRACING CONTOURS…', 'RAISING STRUCTURES…', 'LINKING CONTACTS…'];
  for (let k = 0; k < steps.length; k++){ $('#boot-status').textContent = steps[k]; setBar(0.08 + k * 0.2); await wait(Zc ? 110 : 150); }
  disposeWorld();
  let built;
  try { built = buildZone(zi, () => {}); }
  catch (err){ console.error(err); fail('SURFACE DATA FAILED TO DECODE. RELOAD TO TRY AGAIN.'); state.loading = false; return; }
  Zc = built; state.zi = zi;
  try { localStorage.setItem('kessler-zone', String(zi)); } catch (e){}
  setBar(1); $('#boot-status').textContent = 'SURFACE GEOMETRY DECODED';
  makeLabels(); applyLayers(); updateZoneHUD(); buildZoneCards();
  try { history.replaceState(null, '', '#' + Z.id); } catch (e){}
  // camera intro
  cam.tx = 0; cam.tz = 0; cam.ty = Zc.surf(0, 0); cam.dist = 330; cam.pol = 0.78; cam.az = -0.5;
  G.tx = 0; G.tz = 0; G.dist = 235; G.pol = PTILT; G.az = -0.12; flying = true; lastInput = performance.now();
  await wait(300);
  boot.classList.add('done');
  U.uReveal.value = 0; state.revealT0 = performance.now();
  state.loading = false;
}
function updateZoneHUD(){
  const Z = Zc.Z;
  $('#dz-name').textContent = Z.name; $('#dz-code').textContent = 'SECTOR ' + Z.code + ' · KESSLER IV'; $('#dz-blurb').textContent = Z.blurb;
  $('#zone-idx').textContent = pad(state.zi + 1) + '/' + pad(ZONES.length);
  $('#watermark').textContent = Z.name;
  $('#s-code').textContent = Z.code; $('#s-crew').textContent = pad(Z.crew); $('#s-regions').textContent = pad(Z.regions.length);
  $('#s-nodes').textContent = pad(Z.pois.length, 3); $('#s-struct').textContent = pad(Zc.structures, 3); $('#s-peak').textContent = fmtM(elevOf(Z, Zc.maxH));
  $('#lc-poi').textContent = pad(Z.pois.length); $('#lc-regions').textContent = pad(Z.regions.length); $('#lc-hot').textContent = pad(Z.hot.length); $('#lc-contacts').textContent = pad(Z.crew + Z.hostile);
  const counts = {lm:0, lr:0, ex:0, ca:0}; Z.pois.forEach(p => counts[p.t]++);
  $('#poi-legend').innerHTML = Object.keys(TYPES).map(t => '<span><span class="t-' + t + '">' + ICON[t] + '</span>' + pad(counts[t]) + ' ' + TYPES[t].label.replace(' POINT', '').replace('SUPPLY ', '') + '</span>').join('');
  $('#ro-ci').textContent = Math.round(Z.ci * 10) + ' M'; $('#ro-idx').textContent = Math.round(Z.ci * 50) + ' M';
  $('#ro-water').innerHTML = Z.water != null ? ' · WATER <b>' + fmtM(elevOf(Z, Z.water)) + '</b>' : '';
}
$('#dz-more').addEventListener('click', () => {
  const b = $('#dz-brief'), open = b.hidden; b.hidden = !open;
  $('#dz-more').textContent = open ? '[−]' : '[+]'; $('#dz-more').setAttribute('aria-expanded', String(open));
});
$('#dz-prev').addEventListener('click', () => loadZone((state.zi - 1 + ZONES.length) % ZONES.length));
$('#dz-next').addEventListener('click', () => loadZone((state.zi + 1) % ZONES.length));
if (COARSE) $('#ro-hint').textContent = 'DRAG PAN · PINCH ZOOM · TWIST ROTATE · TWO-FINGER DRAG TILT';

/* ======================================================================
   Contacts animation
   ====================================================================== */
function updateContacts(t){
  if (!Zc) return;
  for (const c of Zc.contacts){
    let s = (c.s0 + t * c.speed) % c.len;
    let i = c.seg; if (c.cum[i] > s) i = 0;
    while (i < c.cum.length - 2 && c.cum[i + 1] < s) i++;
    c.seg = i;
    const f = (s - c.cum[i]) / Math.max(1e-6, c.cum[i + 1] - c.cum[i]), q = i * 3;
    c.pos.set(lerp(c.pts[q], c.pts[q + 3], f), lerp(c.pts[q + 1], c.pts[q + 4], f) + 0.6, lerp(c.pts[q + 2], c.pts[q + 5], f));
  }
}

/* ======================================================================
   Ambient signal player (WebAudio, generated live)
   ====================================================================== */
const TRACKS = [
  {name:'ORBITAL DRIFT', root:55.0, notes:[0, 7, 12, 16, 19], cut:520, q:4, noise:0.035, ping:880},
  {name:'BRINE PUMPS', root:48.99, notes:[0, 5, 10, 12, 17], cut:380, q:6, noise:0.06, ping:659.25},
  {name:'RELAY SILENCE', root:61.74, notes:[0, 3, 7, 10, 14], cut:760, q:3, noise:0.025, ping:1174.66}
];
const audio = {ctx:null, master:null, an:null, delay:null, voice:null, playing:false, i:0, acc:0, t0:0, bins:null};
function ensureCtx(){
  if (audio.ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  const ctx = new AC(), comp = ctx.createDynamicsCompressor(), master = ctx.createGain(), an = ctx.createAnalyser();
  master.gain.value = 0.6; an.fftSize = 128; an.smoothingTimeConstant = 0.82;
  master.connect(comp); comp.connect(an); an.connect(ctx.destination);
  const dl = ctx.createDelay(1.0), fb = ctx.createGain(); dl.delayTime.value = 0.42; fb.gain.value = 0.38; dl.connect(fb); fb.connect(dl); dl.connect(master);
  Object.assign(audio, {ctx, master, an, delay:dl, bins:new Uint8Array(an.frequencyBinCount)});
  return true;
}
function startVoice(i){
  const T = TRACKS[i], ctx = audio.ctx, now = ctx.currentTime;
  const bus = ctx.createGain(); bus.gain.setValueAtTime(0, now); bus.gain.linearRampToValueAtTime(0.3, now + 3); bus.connect(audio.master);
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = T.cut; filt.Q.value = T.q; filt.connect(bus);
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.045; lg.gain.value = T.cut * 0.6; lfo.connect(lg); lg.connect(filt.frequency);
  const nodes = [lfo];
  T.notes.forEach((n, k) => {
    const f = T.root * Math.pow(2, n / 12);
    [-7, 7].forEach(det => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = k === 0 ? 'sawtooth' : 'triangle'; o.frequency.value = f; o.detune.value = det; g.gain.value = k === 0 ? 0.16 : 0.08;
      o.connect(g); g.connect(filt); nodes.push(o);
    });
  });
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), ch = buf.getChannelData(0);
  for (let k = 0; k < ch.length; k++) ch[k] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
  ns.buffer = buf; ns.loop = true; bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8; ng.gain.value = T.noise;
  ns.connect(bp); bp.connect(ng); ng.connect(bus); nodes.push(ns);
  nodes.forEach(nd => nd.start());
  return {bus, nodes};
}
function stopVoice(v){
  const ctx = audio.ctx, t = ctx.currentTime;
  v.bus.gain.cancelScheduledValues(t); v.bus.gain.setValueAtTime(v.bus.gain.value, t); v.bus.gain.linearRampToValueAtTime(0, t + 1.4);
  v.nodes.forEach(n => { try { n.stop(t + 1.5); } catch (e){} });
  setTimeout(() => { try { v.bus.disconnect(); } catch (e){} }, 2000);
}
function ping(){
  if (!audio.playing) return;
  const ctx = audio.ctx, t = ctx.currentTime, T = TRACKS[audio.i];
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(T.ping, t); o.frequency.exponentialRampToValueAtTime(T.ping * 0.985, t + 1.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  o.connect(g); g.connect(audio.master); g.connect(audio.delay); o.start(t); o.stop(t + 1.7);
}
const PLAY_ICON = '<path d="M2.5 1 11 6l-8.5 5z" fill="currentColor"/>', PAUSE_ICON = '<path d="M2.5 1h2.6v10H2.5zM6.9 1h2.6v10H6.9z" fill="currentColor"/>';
function playerUI(){
  $('#p-icon').innerHTML = audio.playing ? PAUSE_ICON : PLAY_ICON;
  $('#p-play').setAttribute('aria-label', audio.playing ? 'Pause ambient signal' : 'Play ambient signal');
  $('#p-title').textContent = TRACKS[audio.i].name;
}
$('#p-play').addEventListener('click', async () => {
  if (!ensureCtx()){ $('#p-title').textContent = 'AUDIO NOT SUPPORTED HERE'; return; }
  if (audio.playing){ audio.acc += audio.ctx.currentTime - audio.t0; audio.playing = false; await audio.ctx.suspend(); }
  else {
    await audio.ctx.resume();
    if (!audio.voice){ audio.voice = startVoice(audio.i); audio.acc = 0; }
    audio.t0 = audio.ctx.currentTime; audio.playing = true; ping();
  }
  playerUI();
});
function skip(d){
  audio.i = (audio.i + d + TRACKS.length) % TRACKS.length; audio.acc = 0;
  if (audio.voice){ stopVoice(audio.voice); audio.voice = null; }
  if (audio.playing){ audio.voice = startVoice(audio.i); audio.t0 = audio.ctx.currentTime; }
  playerUI();
}
$('#p-prev').addEventListener('click', () => skip(-1));
$('#p-next').addEventListener('click', () => skip(1));
const viz = $('#p-viz'), vctx = viz.getContext('2d');
let vizIdleDrawn = false;
function drawViz(){
  const w = viz.width, h = viz.height;
  const elapsed = audio.ctx ? audio.acc + (audio.playing ? audio.ctx.currentTime - audio.t0 : 0) : 0;
  $('#p-time').textContent = (audio.i + 1) + '/' + TRACKS.length + ' · ' + pad(Math.floor(elapsed / 60)) + ':' + pad(Math.floor(elapsed % 60)) + ' / LIVE';
  if (!audio.playing){
    if (vizIdleDrawn) return; vizIdleDrawn = true;
    vctx.clearRect(0, 0, w, h); vctx.fillStyle = css.getPropertyValue('--rule-hi').trim();
    for (let x = 0; x < w; x += 6) vctx.fillRect(x, h - 4, 3, 3);
    return;
  }
  vizIdleDrawn = false;
  audio.an.getByteFrequencyData(audio.bins);
  vctx.clearRect(0, 0, w, h);
  const n = Math.floor(w / 6); vctx.fillStyle = css.getPropertyValue('--signal').trim();
  for (let k = 0; k < n; k++){
    const b = audio.bins[Math.floor(k / n * audio.bins.length * 0.7)] / 255, bh = Math.max(3, b * h);
    vctx.fillRect(k * 6, h - bh, 3, bh);
  }
}

/* ======================================================================
   Resize + main loop
   ====================================================================== */
function resize(){
  const r = $('#app').getBoundingClientRect(); vw = r.width; vh = r.height;
  const pr = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pr); renderer.setSize(vw, vh, false);
  camera.aspect = vw / Math.max(1, vh); camera.updateProjectionMatrix();
  if (composer){ if (composer.setPixelRatio) composer.setPixelRatio(pr); composer.setSize(vw, vh); }
  compassW = $('#compass').clientWidth; lastHdg = -1; lastScale = -1;
  const pr2 = Math.min(window.devicePixelRatio || 1, 2); viz.width = Math.round(viz.clientWidth * pr2) || 300; viz.height = Math.round(14 * pr2); vizIdleDrawn = false;
}
addEventListener('resize', resize);

const REVEAL_MS = REDUCED ? 1 : 2200, SCAN_MS = 8000;
let last = performance.now();
function tick(now){
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  U.uTime.value = now / 1000;
  if (state.revealT0 != null){
    const k = clamp((now - state.revealT0) / REVEAL_MS, 0, 1);
    U.uReveal.value = (1 - Math.pow(1 - k, 3)) * 175;
    if (k >= 1){ state.revealT0 = null; U.uReveal.value = 1e4; state.scanT0 = now; state.lastPh = 1; }
  }
  if (state.revealT0 == null && !REDUCED && Zc){
    const ph = ((now - state.scanT0) % SCAN_MS) / SCAN_MS;
    if (ph < state.lastPh) ping();
    state.lastPh = ph; U.uScanR.value = ph * 230 - 20;
  } else U.uScanR.value = -1000;
  updateCamera(dt, now);
  updateContacts(now / 1000);
  updateLabels();
  updateCursor();
  updateHUD();
  drawViz();
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

resize();
const fromHash = ZONES.findIndex(z => '#' + z.id === location.hash);
let startZone = fromHash >= 0 ? fromHash : 0;
if (fromHash < 0){ try { const s = parseInt(localStorage.getItem('kessler-zone'), 10); if (s >= 0 && s < ZONES.length) startZone = s; } catch (e){} }
playerUI();
requestAnimationFrame(tick);
loadZone(startZone);
})();
