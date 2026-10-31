/* The contact page arcade: an EXEPERT cabinet and a 4K-BOY handheld, built procedurally in three.js.
   Drag to orbit, click a machine to focus it, click its buttons (or use the keyboard / a gamepad) to play. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CabinetScreen, HandheldScreen } from './screens.js';

const CRT_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CRT_FS = `
uniform sampler2D map; uniform float uTime; uniform float uPower; uniform float uFlash;
varying vec2 vUv;
vec2 barrel(vec2 uv){ vec2 c = uv * 2.0 - 1.0; c *= 1.0 + 0.07 * dot(c, c); return c * 0.5 + 0.5; }
void main(){
  vec2 uv = barrel(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 col = vec3(texture2D(map, uv + vec2(0.0011, 0.0)).r, texture2D(map, uv).g, texture2D(map, uv - vec2(0.0011, 0.0)).b);
  float scan = 0.8 + 0.2 * sin(uv.y * 384.0 * 3.14159);
  float vig = smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x) * smoothstep(0.0, 0.16, uv.y) * smoothstep(1.0, 0.84, uv.y);
  col *= scan * mix(0.5, 1.0, vig) * 1.35;
  col += vec3(0.01, 0.02, 0.035) * (0.6 + 0.4 * sin(uTime * 40.0 + uv.y * 6.0));
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col * uPower, 1.0);
  #include <colorspace_fragment>
}`;

const KEYMAP = {
  ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right',
  Enter:'START', Space:'A', KeyZ:'A', KeyJ:'A', KeyX:'B', KeyK:'B', ShiftLeft:'SELECT', ShiftRight:'SELECT', Backspace:'SELECT', KeyC:'COIN'
};
const PAD = {0:'A', 1:'B', 8:'SELECT', 9:'START', 12:'up', 13:'down', 14:'left', 15:'right'};

const damp = (k, dt) => 1 - Math.exp(-k * dt);

function canvasTexture(w, h, draw, srgb = true){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function neonText(ctx, text, x, y, size, color, glow){
  ctx.font = `${size}px press-start, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = glow || color; ctx.shadowBlur = size * 0.6; ctx.fillStyle = color;
  ctx.fillText(text, x, y); ctx.shadowBlur = size * 0.25; ctx.fillText(text, x, y); ctx.shadowBlur = 0;
}

export class ArcadeScene {
  constructor(host, {onLaunch, audio, reducedMotion = false, accent = '#00ff41'}){
    this.host = host; this.onLaunch = onLaunch; this.audio = audio; this.reduced = reducedMotion;
    this.accent = new THREE.Color(accent);
    this.accentCss = accent;
    this.disposables = [];
    this.hitTargets = [];
    this.presses = [];
    this.focus = 'overview';
    this.running = false; this.visible = true; this.paused = false;
    this.lastInteract = performance.now(); this.lastFrame = 0;
    this.padPrev = {};
    this.lift = 0;

    const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'arcade-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060b);
    scene.fog = new THREE.Fog(0x05060b, 5, 11);
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 0.32;
    pmrem.dispose();
    this.disposables.push(env);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    this.rig = {target:new THREE.Vector3(0.0, 1.0, 0.2), yaw:0.2, pitch:0.13, dist:4.5};
    this.goal = {target:this.rig.target.clone(), yaw:this.rig.yaw, pitch:this.rig.pitch, dist:this.rig.dist};
    this.user = {yaw:0, pitch:0};

    this.cabScreen = new CabinetScreen({audio, accent, onLaunch:opts => this.launch(opts)});
    this.handScreen = new HandheldScreen({audio, onLaunch:opts => { this.setFocus('cabinet'); setTimeout(() => this.cabScreen.launch(opts), 450); }});

    this.buildRoom();
    this.buildCabinet();
    this.buildHandheld();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();

    this.onVisibility = () => { if (document.hidden) this.stop(); else this.start(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.cabScreen.refreshStatus();
    if (document.fonts?.load) document.fonts.load('12px press-start').then(() => { this.marqueeTex.needsUpdate = true; }).catch(() => {});
    this.start();
  }

  /* ------------------------------------------------------------ build */
  mat(opts){ const m = new THREE.MeshStandardMaterial(opts); this.disposables.push(m); return m; }
  basic(opts){ const m = new THREE.MeshBasicMaterial({toneMapped:false, ...opts}); this.disposables.push(m); return m; }
  geo(g){ this.disposables.push(g); return g; }
  tex(t){ this.disposables.push(t); return t; }
  hit(mesh, device, input = null, part = null){ mesh.userData.hit = {device, input, part}; this.hitTargets.push(mesh); return mesh; }

  buildRoom(){
    const s = this.scene;
    s.add(new THREE.AmbientLight(0x6070a0, 0.35));
    const key = new THREE.SpotLight(0xfff0e0, 9, 9, 0.6, 0.6, 1.4); key.position.set(1.4, 3.4, 2.6); key.target.position.set(0, 0.9, 0.2); s.add(key, key.target);
    const pink = new THREE.PointLight(0xff2a8a, 4, 5, 1.6); pink.position.set(-1.6, 1.6, 0.6); s.add(pink);
    const cyan = new THREE.PointLight(0x2ad4ff, 4, 5, 1.6); cyan.position.set(1.5, 1.2, -0.6); s.add(cyan);
    const accent = new THREE.PointLight(this.accent, 2.5, 3, 1.8); accent.position.set(0.25, 1.85, 1.0); s.add(accent);

    const grid = this.tex(canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      c.strokeStyle = this.accentCss; c.globalAlpha = 0.55; c.lineWidth = 3; c.strokeRect(0, 0, w, h);
      c.globalAlpha = 0.18; c.lineWidth = 1; c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    }));
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping; grid.repeat.set(10, 10);
    const floor = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10, 10)), this.mat({color:0x0b0c14, roughness:0.28, metalness:0.35, emissive:0xffffff, emissiveMap:grid, emissiveIntensity:0.35}));
    floor.rotation.x = -Math.PI / 2; s.add(floor);

    const sign = this.tex(canvasTexture(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      neonText(c, '4KMAL4LIF', w / 2, h * 0.36, 70, '#ffd6f0', '#ff2a8a');
      neonText(c, 'A R C A D E', w / 2, h * 0.74, 44, '#d6fbff', '#2ad4ff');
    }));
    const wall = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10, 4)), this.mat({color:0x07080f, roughness:0.9}));
    wall.position.set(0, 2, -1.2); s.add(wall);
    const signMesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2.4, 0.6)), this.basic({map:sign, transparent:true}));
    signMesh.position.set(-0.1, 2.55, -1.18); s.add(signMesh);
  }

  buildCabinet(){
    const g = new THREE.Group(); g.position.set(0.28, 0, 0); g.rotation.y = -0.14; this.cabinet = g; this.scene.add(g);
    const W = 0.74;
    const P = [[0, 0], [0.62, 0], [0.62, 0.8], [0.8, 0.9], [0.8, 0.95], [0.54, 1.03], [0.5, 1.07], [0.4, 1.63], [0.58, 1.68], [0.6, 1.9], [0, 1.9]];
    const shape = new THREE.Shape(P.map(([x, y]) => new THREE.Vector2(x, y)));
    const body = this.geo(new THREE.ExtrudeGeometry(shape, {depth:W, bevelEnabled:true, bevelThickness:0.008, bevelSize:0.008, bevelSegments:2}));
    body.translate(0, 0, -W / 2); body.rotateY(-Math.PI / 2);
    const art = this.tex(canvasTexture(256, 512, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#120a24'); gr.addColorStop(1, '#05040c');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.lineWidth = 10;
      [['#ff2a8a', 0], ['#2ad4ff', 26], [this.accentCss, 52]].forEach(([col, o]) => { c.strokeStyle = col; c.globalAlpha = 0.85; c.beginPath(); c.moveTo(-40 + o, h * 0.95); c.lineTo(w + 40 + o, h * 0.35); c.stroke(); });
      c.globalAlpha = 1;
      c.save(); c.translate(w * 0.42, h * 0.55); c.rotate(-Math.PI / 2); neonText(c, 'EXEPERT', 0, 0, 30, '#ffffff', '#ff2a8a'); c.restore();
    }));
    art.repeat.set(1 / 0.82, 1 / 1.92); art.offset.set(0.01, 0.0);
    const sideMat = this.mat({map:art, roughness:0.5, metalness:0.15});
    const bodyMat = this.mat({color:0x0d0d16, roughness:0.42, metalness:0.25});
    const cab = this.hit(new THREE.Mesh(body, [sideMat, bodyMat]), 'cabinet', null, 'body');
    g.add(cab);

    // neon trim along both side profiles
    const trimMat = this.basic({color:this.accent});
    for (const side of [-1, 1]){
      const path = new THREE.CurvePath();
      for (let i = 0; i < P.length; i++){
        const a = P[i], b = P[(i + 1) % P.length];
        path.add(new THREE.LineCurve3(new THREE.Vector3(side * (W / 2 + 0.009), a[1], a[0]), new THREE.Vector3(side * (W / 2 + 0.009), b[1], b[0])));
      }
      g.add(new THREE.Mesh(this.geo(new THREE.TubeGeometry(path, 220, 0.006, 6, true)), trimMat));
    }

    // CRT
    this.crtTex = this.tex(new THREE.CanvasTexture(this.cabScreen.canvas));
    this.crtTex.colorSpace = THREE.SRGBColorSpace;
    this.crtMat = new THREE.ShaderMaterial({uniforms:{map:{value:this.crtTex}, uTime:{value:0}, uPower:{value:1}, uFlash:{value:0}}, vertexShader:CRT_VS, fragmentShader:CRT_FS, toneMapped:false});
    this.disposables.push(this.crtMat);
    const screenGeo = this.geo(new THREE.PlaneGeometry(0.56, 0.42, 16, 12));
    const pos = screenGeo.attributes.position;
    for (let i = 0; i < pos.count; i++){ const x = pos.getX(i) / 0.28, y = pos.getY(i) / 0.21; pos.setZ(i, 0.018 * (1 - 0.5 * (x * x + y * y))); }
    screenGeo.computeVertexNormals();
    const screenTilt = -Math.atan2(0.1, 0.56);
    const bezel = new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.66, 0.51, 0.03, 3, 0.02)), this.mat({color:0x050508, roughness:0.6}));
    bezel.position.set(0, 1.35, 0.45); bezel.rotation.x = screenTilt; g.add(bezel);
    this.screen = this.hit(new THREE.Mesh(screenGeo, this.crtMat), 'cabinet', 'START', 'screen');
    this.screen.position.set(0, 1.35, 0.468); this.screen.rotation.x = screenTilt; g.add(this.screen);

    // marquee
    this.marqueeTex = this.tex(canvasTexture(512, 144, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1a0830'); gr.addColorStop(1, '#04020a');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      neonText(c, 'EXEPERT', w / 2, h * 0.46, 54, '#fff4fb', '#ff2a8a');
      neonText(c, 'KESSLER IV · MULTIPLAYER', w / 2, h * 0.84, 12, '#bff6ff', '#2ad4ff');
    }));
    const marquee = this.hit(new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.7, 0.2)), this.basic({map:this.marqueeTex})), 'cabinet', null, 'marquee');
    marquee.position.set(0, 1.79, 0.605); marquee.rotation.x = -0.09; g.add(marquee);

    // control deck
    const deck = new THREE.Group(); deck.position.set(0, 0.995, 0.672); deck.rotation.x = Math.atan2(0.08, 0.26); g.add(deck);
    const panelTex = this.tex(canvasTexture(512, 192, (c, w, h) => {
      c.fillStyle = '#0a0a12'; c.fillRect(0, 0, w, h);
      c.strokeStyle = this.accentCss; c.lineWidth = 3; c.strokeRect(6, 6, w - 12, h - 12);
      c.font = '14px press-start, monospace'; c.fillStyle = '#8fa8d8'; c.textAlign = 'center';
      c.fillText('1P', 92, 30); c.fillText('START', 236, 176); c.fillText('A', 330, 150); c.fillText('B', 392, 150);
    }));
    const panel = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.7, 0.26)), this.mat({map:panelTex, roughness:0.4}));
    panel.rotation.x = -Math.PI / 2; panel.position.y = 0.002; deck.add(panel);
    const stickBase = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.03, 0.034, 0.012, 24)), this.mat({color:0x15151d, metalness:0.6, roughness:0.3}));
    stickBase.position.set(-0.2, 0.008, 0.0); deck.add(stickBase);
    this.stick = new THREE.Group(); this.stick.position.set(-0.2, 0.012, 0); deck.add(this.stick);
    const shaft = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10)), this.mat({color:0xb8bcc8, metalness:0.9, roughness:0.2}));
    shaft.position.y = 0.035; this.stick.add(shaft);
    const ball = this.hit(new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.024, 24, 16)), this.mat({color:0xe0213b, roughness:0.25})), 'cabinet', 'stick', 'stick');
    ball.position.y = 0.075; this.stick.add(ball);
    const btnGeo = this.geo(new THREE.CylinderGeometry(0.019, 0.019, 0.016, 28));
    const ringGeo = this.geo(new THREE.CylinderGeometry(0.024, 0.024, 0.006, 28));
    const ringMat = this.mat({color:0x111116, metalness:0.5, roughness:0.4});
    const buttons = [
      ['A', 0.13, 0.03, 0x2ad46a], ['B', 0.19, 0.03, 0xff3355], ['X', 0.13, -0.035, 0x2a9dff],
      ['Y', 0.19, -0.035, 0xffd23a], ['L', 0.25, 0.0, 0xc04dff], ['R', 0.07, -0.0, 0xff8a2a]
    ];
    this.cabButtons = {};
    for (const [name, x, z, col] of buttons){
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.set(x, 0.003, z); deck.add(ring);
      const b = this.hit(new THREE.Mesh(btnGeo, this.mat({color:col, roughness:0.3, emissive:col, emissiveIntensity:0.18})), 'cabinet', name === 'A' || name === 'B' ? name : 'X', name);
      b.position.set(x, 0.01, z); b.userData.rest = 0.01; deck.add(b); this.cabButtons[name] = b;
    }
    const start = this.hit(new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.05, 0.012, 0.022, 2, 0.005)), this.mat({color:0xeeeeee, roughness:0.3, emissive:0xffffff, emissiveIntensity:0.12})), 'cabinet', 'START', 'start');
    start.position.set(-0.03, 0.007, 0.07); start.userData.rest = 0.007; deck.add(start); this.cabStart = start;

    // coin door
    const door = this.hit(new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.3, 0.32, 0.02, 2, 0.01)), this.mat({color:0x2a2a32, metalness:0.8, roughness:0.35})), 'cabinet', 'COIN', 'coin');
    door.position.set(0, 0.42, 0.625); g.add(door);
    const slotMat = this.basic({color:0xff9a2a});
    for (const x of [-0.06, 0.06]){
      const slot = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.034, 0.06)), slotMat); slot.position.set(x, 0.47, 0.6365); g.add(slot);
      const ret = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.05, 0.03)), this.basic({color:0x3a1505})); ret.position.set(x, 0.36, 0.6365); g.add(ret);
    }
    const kick = new THREE.Mesh(this.geo(new THREE.BoxGeometry(W, 0.012, 0.012)), trimMat); kick.position.set(0, 0.06, 0.627); g.add(kick);
  }

  buildHandheld(){
    const ped = new THREE.Group(); ped.position.set(-0.6, 0, 0.62); ped.rotation.y = 0.35; this.scene.add(ped);
    const column = this.hit(new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.2, 0.24, 0.9, 40)), this.mat({color:0x12121b, roughness:0.3, metalness:0.4})), 'handheld', null, 'pedestal');
    column.position.y = 0.45; ped.add(column);
    const ring = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.2, 0.006, 8, 64)), this.basic({color:new THREE.Color(0xff2a8a)}));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.9; ped.add(ring);
    const stand = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.16, 0.012, 0.12)), this.mat({color:0x9fc8ff, roughness:0.05, metalness:0, transparent:true, opacity:0.35}));
    stand.position.set(0, 0.906, 0); ped.add(stand);

    const hh = new THREE.Group(); this.handheld = hh; ped.add(hh);
    this.handRest = {pos:new THREE.Vector3(0, 1.09, 0.0), rot:new THREE.Euler(-0.32, 0, 0)};
    this.handUp = {pos:new THREE.Vector3(0, 1.2, 0.16), rot:new THREE.Euler(-0.05, 0, 0)};
    hh.position.copy(this.handRest.pos); hh.rotation.copy(this.handRest.rot);
    const Z = 0.0375;
    const shell = this.hit(new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.216, 0.355, 0.075, 4, 0.016)), this.mat({color:0xc9c6bd, roughness:0.55})), 'handheld', null, 'shell');
    hh.add(shell);
    const cart = new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.15, 0.05, 0.02, 2, 0.004)), this.mat({color:0x3c3c46, roughness:0.6}));
    cart.position.set(0, 0.18, -0.022); hh.add(cart);
    const bezelTex = this.tex(canvasTexture(256, 210, (c, w, h) => {
      c.fillStyle = '#4b4a5c'; c.beginPath(); c.roundRect(0, 0, w, h, [10, 10, 40, 10]); c.fill();
      c.fillStyle = '#9b1b54'; c.fillRect(14, 12, 150, 3); c.fillStyle = '#2a3c8a'; c.fillRect(14, 18, 150, 3);
      c.font = '8px press-start, monospace'; c.fillStyle = '#d8d6e8'; c.fillText('DOT MATRIX · CHIPTUNE', 168, 21);
      c.font = '7px press-start, monospace'; c.fillText('BATTERY', 6, 104);
    }));
    const bezel = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.186, 0.152)), this.mat({map:bezelTex, roughness:0.5, transparent:true}));
    bezel.position.set(0, 0.075, Z + 0.001); hh.add(bezel);
    this.lcdTex = this.tex(new THREE.CanvasTexture(this.handScreen.canvas));
    this.lcdTex.colorSpace = THREE.SRGBColorSpace; this.lcdTex.magFilter = THREE.NearestFilter; this.lcdTex.minFilter = THREE.LinearFilter; this.lcdTex.generateMipmaps = false;
    this.lcd = this.hit(new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.108, 0.0972)), this.basic({map:this.lcdTex})), 'handheld', 'A', 'lcd');
    this.lcd.position.set(0.008, 0.072, Z + 0.002); hh.add(this.lcd);
    this.led = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.0035, 10, 8)), this.basic({color:0x330000}));
    this.led.position.set(-0.074, 0.083, Z + 0.003); hh.add(this.led);
    const logoTex = this.tex(canvasTexture(256, 48, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.font = 'italic bold 30px Arial, sans-serif'; c.fillStyle = '#2a3c8a'; c.textBaseline = 'middle';
      c.fillText('4K-BOY', 4, h / 2); c.font = '10px press-start, monospace'; c.fillStyle = '#9b1b54'; c.fillText('™', 128, 14);
    }));
    const logo = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.11, 0.021)), this.basic({map:logoTex, transparent:true, toneMapped:true}));
    logo.position.set(-0.035, -0.014, Z + 0.001); hh.add(logo);

    const dark = this.mat({color:0x1a1a22, roughness:0.45});
    const dpad = new THREE.Group(); dpad.position.set(-0.056, -0.072, Z + 0.004); hh.add(dpad);
    dpad.add(new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.056, 0.018, 0.009, 2, 0.003)), dark));
    dpad.add(new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.018, 0.056, 0.009, 2, 0.003)), dark));
    this.dpad = dpad;
    const zone = this.geo(new THREE.BoxGeometry(0.02, 0.02, 0.02));
    for (const [dir, x, y] of [['up', 0, 0.019], ['down', 0, -0.019], ['left', -0.019, 0], ['right', 0.019, 0]]){
      const z = this.hit(new THREE.Mesh(zone, dark), 'handheld', dir, 'dpad'); z.position.set(x, y, 0); z.visible = false; dpad.add(z);
    }
    const abGeo = this.geo(new THREE.CylinderGeometry(0.0165, 0.0165, 0.01, 28)); abGeo.rotateX(Math.PI / 2);
    this.handButtons = {};
    for (const [name, x, y] of [['A', 0.074, -0.058], ['B', 0.034, -0.076]]){
      const b = this.hit(new THREE.Mesh(abGeo, this.mat({color:0x9b1b54, roughness:0.35})), 'handheld', name, name);
      b.position.set(x, y, Z + 0.005); b.userData.rest = Z + 0.005; b.userData.axis = 'z'; hh.add(b); this.handButtons[name] = b;
    }
    const pill = this.geo(new RoundedBoxGeometry(0.028, 0.008, 0.006, 2, 0.003));
    for (const [name, x] of [['SELECT', -0.022], ['START', 0.02]]){
      const b = this.hit(new THREE.Mesh(pill, this.mat({color:0x75737f, roughness:0.5})), 'handheld', name, name);
      b.position.set(x, -0.128, Z + 0.002); b.rotation.z = 0.45; b.userData.rest = Z + 0.002; b.userData.axis = 'z'; hh.add(b); this.handButtons[name] = b;
    }
    const slit = this.geo(new RoundedBoxGeometry(0.0045, 0.042, 0.004, 1, 0.002));
    for (let k = 0; k < 6; k++){ const s = new THREE.Mesh(slit, dark); s.position.set(0.05 + k * 0.009, -0.138 + k * 0.0, Z + 0.001); s.rotation.z = -0.5; hh.add(s); }
  }

  /* ------------------------------------------------------------ input */
  bindInput(){
    const el = this.renderer.domElement, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null;
    const pick = e => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects(this.hitTargets, false);
      return hits[0] || null;
    };
    this.onPointerDown = e => {
      this.audio?.unlock(); this.touch();
      down = {x:e.clientX, y:e.clientY, yaw:this.user.yaw, pitch:this.user.pitch, drag:false, id:e.pointerId};
      el.setPointerCapture?.(e.pointerId);
    };
    this.onPointerMove = e => {
      if (down && down.id === e.pointerId){
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.drag && Math.hypot(dx, dy) > 5) down.drag = true;
        if (down.drag){
          this.user.yaw = THREE.MathUtils.clamp(down.yaw - dx * 0.005, -0.75, 0.75);
          this.user.pitch = THREE.MathUtils.clamp(down.pitch + dy * 0.004, -0.12, 0.45);
          this.touch();
        }
        return;
      }
      const h = pick(e);
      this.setHover(h ? h.object : null);
    };
    this.onPointerUp = e => {
      if (!down || down.id !== e.pointerId) return;
      const wasDrag = down.drag; down = null;
      if (wasDrag) return;
      const h = pick(e);
      this.click(h);
    };
    this.onPointerLeave = () => this.setHover(null);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', () => { down = null; });
    el.addEventListener('pointerleave', this.onPointerLeave);

    this.onKeyDown = e => {
      if (e.key === 'Escape'){ if (this.focus !== 'overview'){ this.setFocus('overview'); e.preventDefault(); } return; }
      const btn = KEYMAP[e.code]; if (!btn) return;
      e.preventDefault(); this.audio?.unlock(); this.touch();
      if (e.repeat && btn !== 'up' && btn !== 'down' && btn !== 'left' && btn !== 'right') return;
      this.press(this.focus === 'handheld' ? 'handheld' : 'cabinet', btn, true);
    };
    this.onKeyUp = e => { const btn = KEYMAP[e.code]; if (btn && this.focus === 'handheld') this.handScreen.input(btn, false); };
    this.host.addEventListener('keydown', this.onKeyDown);
    this.host.addEventListener('keyup', this.onKeyUp);
  }

  touch(){ this.lastInteract = performance.now(); }

  /* Hover glow for parts with their own standard material (buttons, stick, shells). */
  setHover(obj){
    if (this.hover === obj) return;
    const glow = o => o?.material?.isMeshStandardMaterial ? o.material : null;
    const prev = glow(this.hover);
    if (prev && this.hover.userData.base){ prev.emissive.copy(this.hover.userData.base.c); prev.emissiveIntensity = this.hover.userData.base.i; }
    this.hover = obj;
    const m = glow(obj);
    if (m){
      obj.userData.base ||= {c:m.emissive.clone(), i:m.emissiveIntensity};
      m.emissive.copy(this.accent); m.emissiveIntensity = obj.userData.hit.part === 'shell' || obj.userData.hit.part === 'pedestal' ? 0.08 : 0.5;
    }
    this.host.classList.toggle('is-hovering', !!obj);
  }

  click(h){
    if (!h){ if (this.focus !== 'overview') this.setFocus('overview'); return; }
    const {device, input} = h.object.userData.hit;
    if (this.focus !== device){
      this.setFocus(device);
      if (device === 'handheld') this.handScreen.powerOn();
      return;
    }
    if (!input) return;
    let btn = input;
    if (input === 'stick'){
      const local = h.object.parent.worldToLocal(h.point.clone());
      btn = Math.abs(local.x) > Math.abs(local.z) ? (local.x < 0 ? 'left' : 'right') : (local.z < 0 ? 'up' : 'down');
    }
    if (device === 'handheld' && (input === 'down')) setTimeout(() => this.handScreen.input('down', false), 380);
    this.press(device, btn, true, h.object);
  }

  press(device, btn, down, mesh = null){
    if (device === 'cabinet'){
      const target = mesh || ({A:this.cabButtons.A, B:this.cabButtons.B, START:this.cabStart}[btn]);
      if (target?.userData.rest != null) this.presses.push({mesh:target, t:0});
      if (['up', 'down', 'left', 'right'].includes(btn)) this.stickTilt = {dir:btn, t:0};
      else if (btn === 'X') { this.audio?.press(); return; }
      this.cabScreen.input(btn);
    } else {
      const target = mesh && mesh.userData.rest != null ? mesh : this.handButtons[btn];
      if (target?.userData.rest != null) this.presses.push({mesh:target, t:0});
      if (['up', 'down', 'left', 'right'].includes(btn)) this.dpadTilt = {dir:btn, t:0};
      this.handScreen.input(btn, down);
    }
  }

  setFocus(f){
    this.focus = f; this.touch();
    this.user.yaw = 0; this.user.pitch = 0;
    const g = this.goal;
    if (f === 'overview'){ g.target.set(0.0, 1.0, 0.2); g.yaw = 0.2; g.pitch = 0.13; g.dist = this.fitDist(1.95, 2.15); this.cabScreen.reset(); }
    else if (f === 'cabinet'){ const p = this.cabinet.localToWorld(new THREE.Vector3(0, 1.2, 0.5)); g.target.copy(p); g.yaw = -0.08; g.pitch = 0.12; g.dist = this.fitDist(0.8, 0.95); }
    else if (f === 'handheld'){ const p = this.handheld.parent.localToWorld(this.handUp.pos.clone()); g.target.copy(p); g.yaw = 0.3; g.pitch = 0.16; g.dist = this.fitDist(0.32, 0.42); }
    this.host.dataset.focus = f;
  }

  /* Camera distance that keeps a w x h metre view in frame for the panel's aspect ratio. */
  fitDist(w, h){
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * 2;
    return Math.max(h / t, w / (t * this.camera.aspect));
  }

  /* Camera dive into the CRT, resolved when the screen fills the view. */
  zoomIntoScreen(){
    this.setFocus('cabinet');
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.screen.getWorldQuaternion(new THREE.Quaternion()));
    const p = this.screen.getWorldPosition(new THREE.Vector3());
    const g = this.goal; g.target.copy(p); g.yaw = Math.atan2(n.x, n.z); g.pitch = Math.asin(n.y); g.dist = 0.42;
    this.diving = true;
    if (this.reduced){ this.snap(); return Promise.resolve(); }
    return new Promise(resolve => {
      const t0 = performance.now();
      const step = () => {
        const t = (performance.now() - t0) / 1000;
        this.crtMat.uniforms.uFlash.value = THREE.MathUtils.clamp((t - 0.7) / 0.25, 0, 1);
        if (t > 1.0){ resolve(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  zoomOut(){
    this.diving = false;
    this.crtMat.uniforms.uFlash.value = 0;
    this.cabScreen.state = 'menu';
    this.setFocus('cabinet');
  }

  launch(opts){
    this.onLaunch?.(opts);
  }

  snap(){ const r = this.rig, g = this.goal; r.target.copy(g.target); r.yaw = g.yaw; r.pitch = g.pitch; r.dist = g.dist; }

  /* ------------------------------------------------------------ loop */
  resize(){
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.diving){ this.setFocus(this.focus); if (!this.started){ this.snap(); this.started = true; } }
    this.renderFrame(0);
  }

  setVisible(v){ this.visible = v; if (v) this.start(); else this.stop(); }
  pause(){ this.paused = true; this.stop(); }
  resume(){ this.paused = false; this.start(); }

  start(){
    if (this.running || this.paused || !this.visible || document.hidden) return;
    this.running = true; this.prev = performance.now();
    const loop = now => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const active = now - this.lastInteract < 4000 || this.handScreen.running || this.diving || this.presses.length;
      const interval = active ? 0 : 1000 / 30;
      if (now - this.lastFrame < interval - 1) return;
      const dt = Math.min(0.05, (now - this.prev) / 1000); this.prev = now; this.lastFrame = now;
      this.renderFrame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(){ this.running = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }

  pollPad(){
    const pads = navigator.getGamepads?.() || [];
    const pad = [...pads].find(p => p && p.connected);
    if (!pad || !this.host.contains(document.activeElement) && document.activeElement !== this.host) return;
    const dev = this.focus === 'handheld' ? 'handheld' : 'cabinet';
    for (const [i, btn] of Object.entries(PAD)){
      const on = !!pad.buttons[i]?.pressed, was = !!this.padPrev[i];
      if (on && !was){ this.touch(); this.press(dev, btn, true); }
      if (!on && was && dev === 'handheld') this.handScreen.input(btn, false);
      this.padPrev[i] = on;
    }
  }

  renderFrame(dt){
    const t = performance.now() / 1000;
    if (dt > 0){
      this.pollPad();
      if (this.cabScreen.update(dt)) this.crtTex.needsUpdate = true;
      if (this.handScreen.state !== 'off' && this.handScreen.update(dt)) this.lcdTex.needsUpdate = true;
      this.crtMat.uniforms.uTime.value = t;
      this.led.material.color.setHex(this.handScreen.state === 'off' ? 0x330000 : 0xff2030);

      // camera rig
      const r = this.rig, g = this.goal, k = this.reduced ? 1 : damp(this.diving ? 4.2 : 5, dt);
      r.target.lerp(g.target, k); r.yaw += (g.yaw + (this.diving ? 0 : this.user.yaw) - r.yaw) * k;
      r.pitch += (g.pitch + (this.diving ? 0 : this.user.pitch) - r.pitch) * k; r.dist += (g.dist - r.dist) * k;
      if (!this.reduced && this.focus === 'overview' && performance.now() - this.lastInteract > 6000) this.user.yaw = Math.sin(t * 0.15) * 0.18;

      // handheld lift
      const lt = this.focus === 'handheld' ? 1 : 0;
      this.lift += (lt - this.lift) * (this.reduced ? 1 : damp(6, dt));
      this.handheld.position.lerpVectors(this.handRest.pos, this.handUp.pos, this.lift);
      this.handheld.rotation.x = THREE.MathUtils.lerp(this.handRest.rot.x, this.handUp.rot.x, this.lift);
      if (this.focus !== 'handheld' && !this.reduced) this.handheld.position.y += Math.sin(t * 1.6) * 0.004;

      // button presses
      this.presses = this.presses.filter(p => {
        p.t += dt; const d = Math.sin(Math.min(p.t / 0.14, 1) * Math.PI) * 0.006, m = p.mesh;
        if (m.userData.axis === 'z') m.position.z = m.userData.rest - d; else m.position.y = m.userData.rest - d;
        return p.t < 0.14;
      });
      if (this.stickTilt){
        this.stickTilt.t += dt; const a = Math.sin(Math.min(this.stickTilt.t / 0.2, 1) * Math.PI) * 0.35, d = this.stickTilt.dir;
        this.stick.rotation.set(d === 'up' ? -a : d === 'down' ? a : 0, 0, d === 'left' ? a : d === 'right' ? -a : 0);
        if (this.stickTilt.t > 0.2){ this.stick.rotation.set(0, 0, 0); this.stickTilt = null; }
      }
      if (this.dpadTilt){
        this.dpadTilt.t += dt; const a = Math.sin(Math.min(this.dpadTilt.t / 0.14, 1) * Math.PI) * 0.18, d = this.dpadTilt.dir;
        this.dpad.rotation.set(d === 'up' ? -a : d === 'down' ? a : 0, d === 'left' ? -a : d === 'right' ? a : 0, 0);
        if (this.dpadTilt.t > 0.14){ this.dpad.rotation.set(0, 0, 0); this.dpadTilt = null; }
      }
    }
    const r = this.rig, cp = Math.cos(r.pitch);
    this.camera.position.set(r.target.x + Math.sin(r.yaw) * cp * r.dist, r.target.y + Math.sin(r.pitch) * r.dist, r.target.z + Math.cos(r.yaw) * cp * r.dist);
    this.camera.lookAt(r.target);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(){
    this.stop();
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.host.removeEventListener('keydown', this.onKeyDown);
    this.host.removeEventListener('keyup', this.onKeyUp);
    for (const d of this.disposables) d.dispose?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function createArcadeScene(host, opts){ return new ArcadeScene(host, opts); }
