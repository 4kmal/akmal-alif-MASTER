/* EXEPERT client: predicts the local player with the shared movement code, interpolates everyone else,
   fires locally (server confirms hits), and drives rendering, sound and the HUD. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PROTOCOL, BTN, INTERP_MS, TEAMS } from '../sim/constants.js';
import { createMover, stepMover, applyMoverState, eyeHeight } from '../sim/movement.js';
import { WEAPONS, WEAPON_IDS, fireInterval, spreadFor, shotDirs, aimDir } from '../sim/weapons.js';
import { FLAG, rayPlayer } from '../sim/room-core.js';
import { getMode } from '../sim/modes/index.js';
import { WorldRender } from './render/world-render.js';
import { Runner } from './render/characters.js';
import { FX } from './render/fx.js';
import { ViewModel } from './render/viewmodel.js';
import { Hud, playerColor, esc } from './hud.js';
import { MODE_UI } from './modes-ui.js';
import { settings } from './settings.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, k) => a + wrap(b - a) * k;

export class Game {
  constructor({canvas, world, input, audio, transport, onEvent}){
    this.canvas = canvas; this.world = world; this.input = input; this.audio = audio; this.transport = transport; this.onEvent = onEvent || (() => {});
    this.players = new Map(); this.roster = new Map();
    this.myId = null; this.mode = getMode('tdm'); this.sector = null; this.phase = 'live';
    this.me = createMover(); this.meAlive = false; this.meState = null; this.spawns = -1;
    this.pending = []; this.outbox = []; this.seq = 0; this.lastSend = 0;
    this.yaw = 0; this.pitch = 0; this.recoil = 0;
    this.offset = null; this.rtt = 0; this.lastPing = 0;
    this.nextFire = 0; this.charge = 0; this.localShots = 0; this.lastAmmoSeq = -1;
    this.camOffset = new THREE.Vector3(); this.eyeK = 1.62;
    this.third = false; this.scoreHeld = false; this.marks = []; this.time = 0;
    this.deathAt = null; this.killer = null; this.result = null;
    this.setupRenderer();
    this.hud = new Hud(world);
    transport.onmessage = text => this.onMessage(text);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  setupRenderer(){
    const q = settings.quality;
    const r = this.renderer = new THREE.WebGLRenderer({canvas:this.canvas, antialias:q !== 'low', powerPreference:'high-performance'});
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.25 : 0.85));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060b16, 0.0058);
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.3; pm.dispose();
    scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x0a0c14, 1.3));
    const sun = new THREE.DirectionalLight(0xcfe0ff, 1.4); sun.position.set(-80, 120, -60); scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1400);
    this.worldRender = new WorldRender(this.world, scene, {quality:q});
    this.fx = new FX(scene);
    this.view = new ViewModel();
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    const vp = new RenderPass(this.view.scene, this.view.camera); vp.clear = false; vp.clearDepth = true; this.composer.addPass(vp);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), q === 'high' ? 0.75 : 0.6, 0.45, 0.82);
    this.bloom.enabled = q !== 'low';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.onResize = () => this.resize(); window.addEventListener('resize', this.onResize); this.resize();
  }

  resize(){
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h; this.view.resize(w / h);
    this.applyFov(1);
  }

  applyFov(zoom){
    const h = THREE.MathUtils.degToRad(settings.fov);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / this.camera.aspect)) / zoom;
    this.camera.updateProjectionMatrix();
  }

  send(msg){ this.transport.send(msg); }
  flush(){ if (this.outbox.length){ this.send({t:'in', f:this.outbox}); this.outbox = []; } this.lastSend = performance.now(); }

  /* ------------------------------------------------------------ network in */
  onMessage(text){
    let m; try { m = typeof text === 'string' ? JSON.parse(text) : text; } catch { return; }
    if (m.t === 'welcome'){
      if (m.proto !== PROTOCOL){ this.onEvent({type:'version'}); return; }
      if (m.hash !== this.world.hash) console.warn('EXEPERT world hash differs from the server', m.hash, this.world.hash);
      this.myId = m.id; this.code = m.code; this.host = m.host; this.isPrivate = m.priv; this.solo = m.solo;
      this.config = {bots:m.bots, diff:m.diff};
      this.setMode(m.mode, m.sector); this.phase = m.phase;
      this.onEvent({type:'welcome', msg:m});
      return;
    }
    if (m.t === 'pong'){ this.rtt = performance.now() - m.c; return; }
    if (m.t === 'error'){ this.onEvent({type:'error', msg:m}); return; }
    if (m.t !== 's') return;
    const now = performance.now() / 1000, sample = m.T - now;
    if (this.offset == null || Math.abs(sample - this.offset) > 0.4) this.offset = sample; else this.offset += (sample - this.offset) * 0.05;
    this.phase = m.ph; this.timeLeft = m.tl; this.modeHud = m.m; this.result = m.res || null;
    if (m.x) this.modeData = Object.assign(this.modeData || {}, m.x);
    if (m.ro) this.updateRoster(m.ro);
    const seen = new Set();
    for (const row of m.p){
      const [id, x, y, z, yaw, pitch, flags, hp, wi, team] = row; seen.add(id);
      let p = this.players.get(id);
      if (!p){ p = {id, buf:[], runner:null, team}; this.players.set(id, p); }
      p.team = team; p.hp = hp; p.weapon = WEAPON_IDS[wi]; p.flags = flags;
      p.buf.push({T:m.T, x, y, z, yaw, pitch, flags});
      if (p.buf.length > 30) p.buf.shift();
    }
    for (const [id, p] of this.players) if (!seen.has(id)){ p.runner?.dispose(); this.players.delete(id); }
    if (m.g) for (const [id, x, y, z] of m.g) this.fx.nade(id, x, y, z);
    if (m.ev) for (const e of m.ev) this.event(e);
    if (m.me) this.reconcile(m.me);
  }

  setMode(id, sector){
    if (this.mode) MODE_UI[this.mode.id]?.dispose?.(this);
    this.modeData = null; this.deployPick = null;
    this.mode = getMode(id); this.sector = this.world.sectors[sector] || null;
    this.worldRender.setSector(this.sector);
  }

  updateRoster(ro){
    const ids = new Set();
    for (const [id, name, team, bot, kills, deaths, assists, score, ping, host, away] of ro){
      ids.add(id);
      this.roster.set(id, {id, name, team, bot, kills, deaths, assists, score, ping, host, away, alive:!!(this.players.get(id)?.flags & FLAG.ALIVE)});
      if (host) this.host = id;
    }
    for (const id of [...this.roster.keys()]) if (!ids.has(id)) this.roster.delete(id);
    this.onEvent({type:'roster'});
  }

  get myTeam(){ return this.roster.get(this.myId)?.team ?? -1; }
  isEnemy(id){ if (id === this.myId) return false; if (this.mode.teams === 0) return true; const r = this.roster.get(id); return r ? r.team !== this.myTeam : true; }
  name(id){ return this.roster.get(id)?.name || '???'; }

  reconcile(me){
    this.meState = me;
    const respawned = me.sp !== this.spawns;
    if (respawned || !!me.al !== this.meAlive){
      this.spawns = me.sp; this.meAlive = !!me.al;
      applyMoverState(this.me, me.st);
      this.pending = this.pending.filter(f => f.s > me.s);
      if (respawned && me.al){ this.yaw = this.players.get(this.myId)?.buf.at(-1)?.yaw ?? this.yaw; this.pitch = 0; this.deathAt = null; this.killer = null; this.onEvent({type:'spawn'}); }
      this.camOffset.set(0, 0, 0);
    } else if (this.meAlive){
      this.pending = this.pending.filter(f => f.s > me.s);
      const before = [this.me.x, this.me.y, this.me.z];
      const sim = createMover(); applyMoverState(sim, me.st); sim.yaw = this.me.yaw; sim.pitch = this.me.pitch;
      for (const f of this.pending) stepMover(sim, f, this.world);
      const dx = sim.x - before[0], dy = sim.y - before[1], dz = sim.z - before[2], err = Math.hypot(dx, dy, dz);
      applyMoverState(this.me, sim);
      if (err < 2) this.camOffset.x -= dx, this.camOffset.y -= dy, this.camOffset.z -= dz; // smooth small corrections
      else this.camOffset.set(0, 0, 0);
    }
    for (const e of me.pe || []) this.personal(e);
    if (me.w && this.view.current !== me.w){ this.view.setWeapon(me.w); this.audio.swap(); this.localAmmo = me.a ?? 0; }
    // predicted ammo: follow the server down, but jump up immediately on reload or respawn
    if (me.a != null && (me.a !== this.serverAmmo || me.w !== this.serverAmmoW)){
      this.localAmmo = me.a > (this.serverAmmo ?? -1) || me.w !== this.serverAmmoW ? me.a : Math.min(this.localAmmo ?? me.a, me.a);
      this.serverAmmo = me.a; this.serverAmmoW = me.w;
    }
  }

  personal(e){
    if (e.e === 'hit'){ this.hud.hitmarker(!!e.h, !!e.k, e.d); this.audio.hit(!!e.h, !!e.k); }
    else if (e.e === 'hurt'){
      this.audio.hurt();
      if (e.x != null){ const a = Math.atan2(e.x - this.me.x, e.z - this.me.z); this.hud.hurt(this.yaw + Math.PI - a); }
      this.shake = Math.min(1, (this.shake || 0) + e.d / 60);
    }
  }

  event(e){
    const self = e.p === this.myId;
    const pos = id => { const p = this.players.get(id)?.buf.at(-1); return p ? [p.x, p.y + 1.4, p.z] : null; };
    switch (e.e){
      case 'shot': {
        if (self) break;
        const w = WEAPONS[e.w];
        for (let i = 0; i < e.x.length; i += 3){
          const end = [e.x[i], e.x[i + 1], e.x[i + 2]], o = [e.o[0], e.o[1] - 0.15, e.o[2]];
          if (w.kind === 'rail') this.fx.rail(o, end); else this.fx.tracer(o, end, w.color, e.w === 'scatter' ? 0.02 : 0.03, 0.08);
          if (i === 0) this.fx.spark(...end, 4, 0x9fe8ff, 3);
        }
        this.audio.shot(e.w, e.o);
        break;
      }
      case 'bolt': if (!self) { this.fx.bolt(e.id, e.o, e.v, WEAPONS.kestrel.boltSpeed); this.audio.shot('kestrel', e.o); } break;
      case 'pop': this.fx.pop(e.id, e.x, e.y, e.z, e.hit); this.audio.impact([e.x, e.y, e.z]); break;
      case 'nade': this.fx.nade(e.id, ...e.o); break;
      case 'boom': this.fx.boom(e.x, e.y, e.z); this.audio.boom([e.x, e.y, e.z]); { const d = Math.hypot(e.x - this.me.x, e.z - this.me.z); if (d < 20) this.shake = Math.min(1.5, (this.shake || 0) + (20 - d) / 14); } break;
      case 'fx': if (!self){ const p = pos(e.p); if (e.k === 'dash'){ this.audio.dash(p); if (p) this.fx.spark(p[0], p[1], p[2], 18, 0x2ad4ff, 5); } else if (e.k === 'jump2' || e.k === 'walljump') this.audio.jump(p, true); else if (e.k === 'reload') this.audio.reload(p); } break;
      case 'kill': {
        const k = e.k >= 0 ? this.roster.get(e.k) || {id:e.k, name:this.name(e.k)} : null, v = this.roster.get(e.v) || {id:e.v, name:this.name(e.v)};
        this.hud.feed(this.hud.killLine(k, v, e.w, e.h, this.mode), e.k === this.myId || e.v === this.myId);
        if (e.k === this.myId && e.v !== this.myId){
          const streak = e.s >= 3 ? ` · ${e.s} STREAK` : '';
          this.hud.toast(`+${100 + (e.h ? 25 : 0)} ELIMINATED ${esc(v.name)}${e.h ? ' · HEADSHOT' : ''}${streak}`);
        } else if (e.a?.includes(this.myId)) this.hud.toast('+40 ASSIST');
        if (e.v === this.myId){ this.deathAt = performance.now(); this.killer = e.k; this.audio.death(); }
        const vp = pos(e.v); if (vp) this.fx.spark(vp[0], vp[1] - 0.4, vp[2], 26, new THREE.Color(playerColor(v, this.mode)).getHex(), 4);
        break;
      }
      case 'mark': if (!this.mode.teams || e.team === this.myTeam){ this.marks.push({x:e.x, y:e.y, z:e.z, t:performance.now(), who:this.name(e.p)}); this.audio.ui(); } break;
      case 'end': this.onEvent({type:'end', result:e.r}); break;
      case 'match': this.setMode(e.m, e.sec); this.config = {bots:e.bots, diff:e.diff}; this.onEvent({type:'match'}); break;
      case 'phase': this.onEvent({type:'phase', phase:e.ph}); break;
      case 'join': case 'leave': break;
      default: this.modeEvent?.(e);
    }
    MODE_UI[this.mode.id]?.event?.(this, e);
  }

  /* ------------------------------------------------------------ frame */
  frame(t){
    if (!this.running) return;
    this.raf = requestAnimationFrame(tt => this.frame(tt));
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000)); this.last = t; this.time += dt;
    const inp = this.input.frame(dt);
    const active = this.input.locked || !!this.input.pad();
    if (active){
      this.yaw = wrap(this.yaw + inp.dyaw);
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + inp.dpitch));
    } else { inp.mx = inp.mz = 0; inp.b = 0; inp.e = 0; }
    // recoil recovers toward the aim
    const rec = this.recoil * Math.min(1, dt * 9); this.recoil -= rec; this.pitch = Math.min(1.45, this.pitch + rec);
    const live = this.meAlive && this.phase !== 'post';
    const f = {s:++this.seq, dt, mx:inp.mx, mz:inp.mz, yaw:this.yaw, pitch:this.pitch, b:inp.b, e:inp.e};
    if (live){
      const ev = stepMover(this.me, f, this.world);
      if (ev.jumped) this.audio.jump(null, false);
      if (ev.doubleJumped || ev.wallJumped) this.audio.jump(null, true);
      if (ev.dashed){ this.audio.dash(null); this.dashFov = 1; }
      if (ev.landed) this.audio.land(ev.landed);
      if (ev.landed > 25){ // drop pod touchdown
        this.fx.spark(this.me.x, this.me.y + 0.2, this.me.z, 50, 0x9fe8ff, 12);
        this.audio.boom([this.me.x, this.me.y, this.me.z]); this.shake = 1.2;
      }
      if (ev.mantled) this.audio.jump(null, false);
      if (ev.slid) this.audio.dash(null);
      this.pending.push(f);
      if (this.pending.length > 240) this.pending.shift();
      const hs = Math.hypot(this.me.vx, this.me.vz);
      if (this.me.ground && hs > 2.5){ this.stepT = (this.stepT || 0) + dt * hs; if (this.stepT > 2.2){ this.stepT = 0; this.audio.step(null, this.me.water > 0.2); } }
    }
    this.outbox.push(f);
    if (this.myId != null){
      this.weaponFrame(inp, dt, live);
      if (inp.edges.has('ping') && live) this.ping();
      if (performance.now() - this.lastSend > 50) this.flush();
      if (performance.now() - this.lastPing > 2000){ this.lastPing = performance.now(); this.send({t:'ping', c:performance.now(), rtt:Math.round(this.rtt)}); }
    }
    MODE_UI[this.mode.id]?.input?.(this, inp);
    if (inp.edges.has('view')) this.third = !this.third;
    this.scoreHeld = (this.input.held.has('score') || this.input.padHeldScore) && this.myId != null;
    if (inp.edges.has('pause')) this.onEvent({type:'pause'});
    this.render(dt);
  }

  weaponFrame(inp, dt, live){
    const me = this.meState; if (!me) return;
    const w = WEAPONS[me.w]; if (!w) return;
    // swapping
    let slot = null;
    if (inp.edges.has('w1')) slot = 0; else if (inp.edges.has('w2')) slot = 1; else if (inp.wheel || inp.edges.has('w-next')) slot = me.l.indexOf(me.w) === 0 ? 1 : 0;
    if (slot != null && me.l[slot] !== me.w && live){ this.flush(); this.send({t:'swap', w:slot}); this.charge = 0; return; }
    if (!live || me.rl > 0 || me.sw > 0 || me.oh) { this.charge = 0; return; }
    const ammoLeft = w.mag ? this.localAmmo : 1;
    const now = performance.now() / 1000;
    const held = !!(inp.b & BTN.FIRE), pressed = !!(inp.e & BTN.FIRE);
    if (w.kind === 'rail'){
      if (held && now >= this.nextFire && ammoLeft > 0){
        if (this.charge === 0) this.audio.charge();
        this.charge += dt;
        if (this.charge >= w.charge){ this.charge = 0; this.fire(w, now); }
      } else this.charge = 0;
      return;
    }
    const want = w.auto ? held : pressed;
    if (want && now >= this.nextFire){
      if (w.mag && ammoLeft <= 0){ if (pressed) this.audio.dry(); return; }
      this.fire(w, now);
    }
  }

  fire(w, now){
    this.nextFire = now + fireInterval(w);
    const seed = (Math.random() * 4294967296) >>> 0;
    const eye = [this.me.x, this.me.y + eyeHeight(this.me), this.me.z];
    const renderT = this.serverNow() - INTERP_MS / 1000;
    this.flush();
    this.send({t:'fire', s:seed, w:w.id, yaw:this.yaw, pitch:this.pitch, rt:renderT});
    // local visuals: tracer to whatever the shot hits on this screen
    const dirs = shotDirs(w, this.yaw, this.pitch, spreadFor(w, this.me), seed);
    const fwd = aimDir(this.yaw, this.pitch), right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const ads = this.me.ads ? 0 : 1;
    const muzzle = [eye[0] + fwd[0] * 0.7 + right[0] * 0.16 * ads, eye[1] + fwd[1] * 0.7 - 0.12 * ads, eye[2] + fwd[2] * 0.7 + right[2] * 0.16 * ads];
    if (w.kind === 'bolt'){
      this.fx.bolt(`me${seed}`, muzzle, dirs[0], w.boltSpeed);
    } else {
      for (const d of dirs){
        const end = this.localTrace(eye, d, w.range);
        if (w.kind === 'rail') this.fx.rail(muzzle, end.p); else this.fx.tracer(muzzle, end.p, w.color, w.id === 'scatter' ? 0.018 : 0.025, 0.06);
        if (end.hit === 'world') this.fx.spark(...end.p, 5, 0x9fe8ff, 3);
      }
    }
    if (w.mag) this.localAmmo--;
    this.view.kick(w.kick);
    this.recoil += w.recoil * (this.me.ads ? 0.55 : 1);
    this.yaw += (Math.random() - 0.5) * w.recoil * 0.4;
    this.audio.shot(w.id);
  }

  localTrace(o, d, range){
    const wh = this.world.collide.raycast(o[0], o[1], o[2], d[0], d[1], d[2], range);
    let t = wh ? wh.t : range, hit = wh ? 'world' : null;
    for (const p of this.players.values()){
      if (p.id === this.myId || !(p.flags & FLAG.ALIVE) || !this.isEnemy(p.id) || !p.r) continue;
      const h = rayPlayer(o[0], o[1], o[2], d[0], d[1], d[2], {x:p.r.x, y:p.r.y, z:p.r.z, crouch:!!(p.r.flags & FLAG.CROUCH)}, t);
      if (h){ t = h.t; hit = 'player'; }
    }
    return {p:[o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], hit};
  }

  ping(){
    const eye = [this.me.x, this.me.y + eyeHeight(this.me), this.me.z], d = aimDir(this.yaw, this.pitch);
    const end = this.localTrace(eye, d, 250).p;
    this.send({t:'mark', x:end[0], y:end[1], z:end[2]});
  }

  serverNow(){ return performance.now() / 1000 + (this.offset ?? 0); }

  /* ------------------------------------------------------------ render */
  interp(p, rt){
    const B = p.buf; if (!B.length) return null;
    if (rt <= B[0].T) return B[0];
    for (let i = B.length - 1; i > 0; i--){
      const a = B[i - 1], b = B[i];
      if (a.T <= rt){
        if (rt > b.T){ return b; }
        const k = (rt - a.T) / Math.max(b.T - a.T, 1e-4);
        return {x:a.x + (b.x - a.x) * k, y:a.y + (b.y - a.y) * k, z:a.z + (b.z - a.z) * k, yaw:lerpAngle(a.yaw, b.yaw, k), pitch:a.pitch + (b.pitch - a.pitch) * k, flags:k < 0.5 ? a.flags : b.flags,
          speed:Math.hypot(b.x - a.x, b.z - a.z) / Math.max(b.T - a.T, 1e-3)};
      }
    }
    return B[B.length - 1];
  }

  render(dt){
    const rt = this.serverNow() - INTERP_MS / 1000;
    const camPos = new THREE.Vector3();
    // remote players
    const mmPlayers = [];
    for (const p of this.players.values()){
      const r = p.id === this.myId ? null : this.interp(p, rt);
      if (p.id !== this.myId){
        if (!r) continue;
        p.r = r;
        const col = playerColor({id:p.id, team:p.team}, this.mode);
        if (!p.runner){ p.runner = new Runner(col); this.scene.add(p.runner.root); p.col = col; }
        if (p.col !== col){ p.runner.setColor(col); p.col = col; }
        if (p.lastStep == null) p.lastStep = 0;
        const speed = r.speed ?? 0;
        p.runner.update(dt, {...r, speed}, this.time);
        if ((r.flags & FLAG.ALIVE) && !(r.flags & FLAG.AIR) && speed > 3){ p.lastStep += dt * speed; if (p.lastStep > 2.4){ p.lastStep = 0; this.audio.step([r.x, r.y, r.z], false); } }
        mmPlayers.push({id:p.id, x:r.x, z:r.z, yaw:r.yaw, flags:r.flags, enemy:this.isEnemy(p.id), color:col, spotted:false});
      } else if (p.runner){ p.runner.root.visible = this.third && this.meAlive; }
    }
    // local player body (third person only)
    const mine = this.players.get(this.myId);
    if (mine && this.third){
      if (!mine.runner){ mine.runner = new Runner(playerColor({id:this.myId, team:this.myTeam}, this.mode)); this.scene.add(mine.runner.root); }
      const fl = mine.flags ?? 0;
      mine.runner.update(dt, {x:this.me.x, y:this.me.y, z:this.me.z, yaw:this.yaw, pitch:this.pitch, flags:(fl & ~(FLAG.CROUCH | FLAG.SLIDE | FLAG.AIR | FLAG.WALL)) | (this.me.crouch ? FLAG.CROUCH : 0) | (this.me.slide > 0 ? FLAG.SLIDE : 0) | (!this.me.ground ? FLAG.AIR : 0) | (this.me.wall ? FLAG.WALL : 0) | FLAG.ALIVE, speed:Math.hypot(this.me.vx, this.me.vz)}, this.time);
    }

    // camera
    this.camOffset.multiplyScalar(Math.exp(-dt * 12));
    const targetEye = eyeHeight(this.me);
    this.eyeK += (targetEye - this.eyeK) * Math.min(1, dt * 14);
    const m = this.me;
    if (this.meAlive || this.deathAt == null){
      camPos.set(m.x + this.camOffset.x, m.y + this.eyeK + this.camOffset.y, m.z + this.camOffset.z);
      this.camera.position.copy(camPos);
      this.camera.rotation.set(0, 0, 0); this.camera.rotation.order = 'YXZ';
      const roll = m.wall ? ((m.wall.nx * Math.cos(this.yaw) - m.wall.nz * Math.sin(this.yaw)) > 0 ? 0.12 : -0.12) : 0;
      this.roll = (this.roll || 0) + (roll - (this.roll || 0)) * Math.min(1, dt * 8);
      const sh = (this.shake || 0); this.shake = Math.max(0, sh - dt * 2.5);
      this.camera.rotation.set(this.pitch + (Math.random() - 0.5) * sh * 0.03, this.yaw + (Math.random() - 0.5) * sh * 0.03, this.roll);
      if (this.third){
        const back = new THREE.Vector3(0.6, 0.35, 3.2).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
        const hit = this.world.collide.raycast(camPos.x, camPos.y, camPos.z, back.x / back.length(), back.y / back.length(), back.z / back.length(), back.length());
        this.camera.position.add(back.multiplyScalar(hit ? Math.max(0.2, hit.t - 0.3) / back.length() : 1));
      }
    } else {
      // death cam: rise above the body and watch the killer
      const k = Math.min(1, (performance.now() - this.deathAt) / 900);
      const kp = this.killer != null ? this.players.get(this.killer)?.r : null;
      this.camera.position.set(m.x, m.y + 1.6 + k * 3.5, m.z);
      if (kp) this.camera.lookAt(kp.x, kp.y + 1.2, kp.z); else this.camera.rotation.set(-0.6 * k, this.yaw, 0, 'YXZ');
    }
    // FOV: sprint, slide and dash widen, ADS zooms
    const w = WEAPONS[this.meState?.w] || WEAPONS.breach;
    const speedK = Math.min(Math.hypot(m.vx, m.vz) / 10, 1);
    this.dashFov = Math.max(0, (this.dashFov || 0) - dt * 3);
    const zoom = m.ads && this.meAlive ? w.zoom : 1 / (1 + speedK * 0.06 + this.dashFov * 0.12);
    this.zoomK = (this.zoomK || 1) + (zoom - (this.zoomK || 1)) * Math.min(1, dt * 14);
    this.applyFov(this.zoomK);
    this.input.adsScale = m.ads ? 0.55 / Math.sqrt(w.zoom) : 1;

    // view model
    this.view.update(dt, {speed:Math.hypot(m.vx, m.vz), sprint:m.sprint, ads:m.ads && this.meAlive, air:!m.ground, slide:m.slide > 0, wall:m.wall ? 1 : 0,
      reload:this.meState?.rl > 0 ? 1 - this.meState.rl / (w.reload || 1) : 0, dyaw:0, dpitch:0, dead:!this.meAlive || this.third || this.phase === 'post'});

    this.fx.update(dt, this.world);
    MODE_UI[this.mode.id]?.update?.(this, dt);
    this.worldRender.update(this.time, this.camera);
    this.audio.listener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.yaw);
    this.composer.render(dt);
    this.updateHud(dt, mmPlayers);
  }

  project(x, y, z){
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight];
  }

  updateHud(dt, mmPlayers){
    const H = this.hud, me = this.meState;
    H.tick(dt);
    H.compass(this.yaw);
    H.minimap({id:this.myId, x:this.me.x, z:this.me.z, yaw:this.yaw}, mmPlayers, this.sector, {objectives:MODE_UI[this.mode.id]?.mapObjectives?.(this) || []});
    if (me){
      H.vitals({hp:me.hp, sh:me.sh, dashCd:this.me.dashCd, n:me.n});
      H.weapon(me);
      const w = WEAPONS[me.w];
      const sp = spreadFor(w, this.me) * window.innerHeight / (this.camera.fov * Math.PI / 180);
      H.crosshair(this.charge > 0 ? (1 - this.charge / w.charge) * 30 : sp, this.me.ads);
      H.storm(me.sto);
      if (!me.al && this.phase !== 'post'){
        const k = this.killer;
        const by = k != null && k >= 0 && k !== this.myId ? `ELIMINATED BY <span style="color:${playerColor(this.roster.get(k) || {id:k}, this.mode)}">${esc(this.name(k))}</span>` : 'ELIMINATED';
        H.center(`${by}<small>REDEPLOYING IN ${Math.ceil(me.ri)}</small>`, `dead${Math.ceil(me.ri)}${k}`);
      } else if (this.phase === 'lobby') H.center(`WARM-UP<small>${this.myId === this.host ? 'START THE MATCH FROM THE MENU (ESC)' : 'WAITING FOR THE HOST TO START'}</small>`, 'lobby' + this.host);
      else H.center('', '');
    }
    const ui = MODE_UI[this.mode.id];
    if (ui && this.modeHud) H.objective(ui.objective(this, this.modeHud, this.timeLeft ?? 0));
    H.extra(ui?.extra?.(this) || '');
    // world markers: teammate names, pings, mode objectives
    for (const p of this.players.values()){
      if (p.id === this.myId || !p.r || !(p.r.flags & FLAG.ALIVE)) continue;
      const enemy = this.isEnemy(p.id);
      if (enemy) continue;
      const d = Math.hypot(p.r.x - this.me.x, p.r.z - this.me.z); if (d > 120) continue;
      const s = this.project(p.r.x, p.r.y + 2.1, p.r.z); if (!s) continue;
      H.marker('p' + p.id, s[0], s[1], esc(this.name(p.id)), 'nametag');
      H.markerEls.get('p' + p.id).style.color = playerColor({id:p.id, team:p.team}, this.mode);
    }
    const now = performance.now();
    this.marks = this.marks.filter(mk => now - mk.t < 6000);
    this.marks.forEach((mk, i) => { const s = this.project(mk.x, mk.y + 0.5, mk.z); if (s) H.marker('m' + i + mk.t, s[0], s[1], `<i></i>${Math.round(Math.hypot(mk.x - this.me.x, mk.z - this.me.z))}m`, 'marker ping'); });
    ui?.markers?.(this, (key, x, y, z, html, cls) => { const s = this.project(x, y, z); if (s) H.marker(key, s[0], s[1], html, cls); });
    H.sweepMarkers();
    const sbHead = this.code && this.code !== 'SOLO' ? `ROOM ${this.code}` : 'SOLO';
    H.scoreboard(this.scoreHeld || this.phase === 'post', [...this.roster.values()].map(r => ({...r, alive:!!(this.players.get(r.id)?.flags & FLAG.ALIVE)})), this.mode, this.myId, sbHead);
  }

  dispose(){
    this.running = false; cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.transport.close();
    for (const p of this.players.values()) p.runner?.dispose();
    this.hud.show(false);
    this.renderer.dispose();
  }
}
