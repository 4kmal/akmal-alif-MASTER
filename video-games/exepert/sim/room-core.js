/* EXEPERT authoritative match room. Runs in a Web Worker for solo play and in a Durable Object online.
   Transport-agnostic: the host calls join/leave/handle/tick and delivers what `send(pid, text)` hands it. */
import { PROTOCOL, TICK_HZ, PLAYER, BTN, BOT_NAMES, MAX_REWIND_MS, sanitizeName } from './constants.js';
import { createMover, stepMover, moverState, eyeHeight } from './movement.js';
import { WEAPONS, WEAPON_IDS, GRENADE, fireInterval, falloff, spreadFor, shotDirs, aimDir } from './weapons.js';
import { getMode } from './modes/index.js';
import { Nav } from './nav.js';
import { botThink, botLoadout, DIFFICULTY } from './bots.js';
import { mulberry32 } from '../../kessler-world/kessler-util.js';

export const DT = 1 / TICK_HZ;
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const FLAG = { ALIVE:1, CROUCH:2, SLIDE:4, WALL:8, SPRINT:16, ADS:32, DASH:64, RELOAD:128, AIR:256, PROTECT:512, FIRING:1024, MANTLE:2048, WALL_L:4096, SWIM:8192 };

/* Ray against a player standing at q (head sphere + body cylinder). Returns {t, head} or null. */
export function rayPlayer(ox, oy, oz, dx, dy, dz, q, maxT){
  const eye = q.crouch ? PLAYER.crouchEye : PLAYER.eye;
  let best = null;
  // head
  const hx = ox - q.x, hy = oy - (q.y + eye + 0.06), hz = oz - q.z, hr = 0.23;
  const b = hx * dx + hy * dy + hz * dz, c = hx * hx + hy * hy + hz * hz - hr * hr, disc = b * b - c;
  if (disc >= 0){ const t = -b - Math.sqrt(disc); if (t >= 0 && t <= maxT) best = {t, head:true}; }
  // body (vertical cylinder)
  const br = 0.42, y0 = q.y + 0.05, y1 = q.y + eye - 0.16;
  const fx = ox - q.x, fz = oz - q.z, a = dx * dx + dz * dz;
  if (a > 1e-8){
    const bb = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - br * br, d2 = bb * bb - 4 * a * cc;
    if (d2 >= 0){
      const t = (-bb - Math.sqrt(d2)) / (2 * a), y = oy + dy * t;
      if (t >= 0 && t <= maxT && y >= y0 && y <= y1 && (!best || t < best.t)) best = {t, head:false};
    }
  }
  return best;
}

export class Room {
  constructor(opts){
    this.world = opts.world;
    this.nav = new Nav(this.world);
    this.code = opts.code || 'SOLO';
    this.isPrivate = !!opts.isPrivate;
    this.solo = !!opts.solo;
    this.send = opts.send || (() => {});
    this.rng = mulberry32((opts.seed ?? Date.now()) >>> 0);
    this.players = new Map();
    this.nextId = 1;
    this.projectiles = [];
    this.nextProj = 1;
    this.events = [];
    this.time = 0; this.matchTime = 0; this.tickN = 0;
    this.difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
    this.botSetting = opts.bots ?? 'auto';
    this.hostId = null;
    this.phase = opts.lobby ? 'lobby' : 'live';
    this.phaseEnd = 0;
    this.configure({mode:opts.mode || 'tdm', sector:opts.sector});
  }

  /* ------------------------------------------------------------ setup */
  configure({mode, sector, bots, difficulty} = {}){
    if (mode) this.mode = getMode(mode);
    this.modeId = this.mode.id;
    const allowed = this.mode.sectors || [this.mode.sector];
    if (sector && allowed.includes(sector)) this.sector = sector;
    else if (!this.sector || !allowed.includes(this.sector)) this.sector = this.mode.sector;
    if (bots != null) this.botSetting = bots === 'auto' ? 'auto' : clamp(Math.round(fin(bots, 0)), 0, 15);
    if (difficulty && DIFFICULTY[difficulty]) this.difficulty = difficulty;
    this.scoreLimit = this.mode.scoreLimit;
    this.timeLimit = this.mode.timeLimit;
    this.resetMatch();
  }

  resetMatch(){
    this.matchTime = 0; this.result = null; this.projectiles = [];
    this.mode.init(this);
    for (const p of this.players.values()){ p.kills = p.deaths = p.assists = p.score = 0; p.streak = 0; }
    this.syncBots();
    this.balanceTeams();
    for (const p of this.players.values()) this.spawn(p);
    this.events.push({e:'match', m:this.modeId, sec:this.sector, bots:this.botSetting, diff:this.difficulty});
  }

  inPlay(x, z){ return this.world.inSector(this.sector, x, z); }
  isEnemy(a, b){ return a !== b && (this.mode.teams === 0 || a.team !== b.team); }
  humans(){ return [...this.players.values()].filter(p => !p.bot); }

  makePlayer(name, bot){
    const id = this.nextId++;
    const p = {
      id, name, bot, team:-1, m:createMover(), alive:false, hp:PLAYER.hp, shield:0, respawnAt:0, protect:0,
      loadout:['breach', 'scatter'], weapon:'breach', ammo:{}, reloadT:0, swapT:0, heat:0, overheat:0, nextFire:0, firingT:0,
      nades:GRENADE.charges, nadeT:0, kills:0, deaths:0, assists:0, score:0, streak:0, damagers:new Map(), lastHurt:-99,
      seq:0, budget:0.2, hist:[], stormT:0, spawns:0, ping:0, pe:[], token:null, cloak:0
    };
    for (const w of WEAPON_IDS) p.ammo[w] = WEAPONS[w].mag || 0;
    if (bot) p.loadout = botLoadout(this.rng);
    this.players.set(id, p);
    return p;
  }

  join({name, loadout, token} = {}){
    // resume a slot held by a recent disconnect
    if (token){
      for (const p of this.players.values()) if (p.token === token && p.away){ p.away = false; this.welcome(p); return p; }
    }
    const humans = this.humans().length;
    if (humans >= this.mode.maxPlayers) return null;
    const p = this.makePlayer(sanitizeName(name) || `RUNNER-${String(this.nextId).padStart(3, '0')}`, false);
    p.token = token || null;
    if (Array.isArray(loadout)) this.setLoadout(p, loadout);
    if (this.hostId == null) this.hostId = p.id;
    this.syncBots();
    this.assignTeam(p);
    this.spawn(p);
    this.welcome(p);
    this.events.push({e:'join', p:p.id});
    return p;
  }

  welcome(p){
    this.direct(p, {t:'welcome', id:p.id, proto:PROTOCOL, code:this.code, hash:this.world.hash, mode:this.modeId, sector:this.sector,
      phase:this.phase, host:this.hostId, priv:this.isPrivate, solo:this.solo, bots:this.botSetting, diff:this.difficulty, T:r3(this.time), tick:TICK_HZ});
  }

  /* Mark a player as disconnected; their slot is kept for 30 s so they can resume. */
  drop(pid){
    const p = this.players.get(pid); if (!p) return;
    p.away = true; p.awayAt = this.time;
  }

  leave(pid){
    const p = this.players.get(pid); if (!p) return;
    this.players.delete(pid);
    this.events.push({e:'leave', p:pid});
    if (this.hostId === pid){ const h = this.humans()[0]; this.hostId = h ? h.id : null; }
    this.syncBots();
    this.balanceTeams();
  }

  /* Teams are 0..mode.teams-1 (two sides, or several crews). Sentinels keep their own team. */
  teamCounts(except = null){
    const n = new Array(this.mode.teams).fill(0);
    for (const q of this.players.values()) if (q !== except && !q.sentinel && q.team >= 0 && q.team < n.length) n[q.team]++;
    return n;
  }

  assignTeam(p){
    if (p.sentinel) return;
    if (this.mode.teams === 0){ p.team = -1; return; }
    const n = this.teamCounts(p);
    p.team = n.indexOf(Math.min(...n));
  }

  /* Keep teams even by moving bots (never humans) across. */
  balanceTeams(){
    if (this.mode.teams === 0){ for (const p of this.players.values()) if (!p.sentinel) p.team = -1; return; }
    for (const p of this.players.values()) if (!p.sentinel && (p.team < 0 || p.team >= this.mode.teams)) this.assignTeam(p);
    for (let guard = 0; guard < 24; guard++){
      const n = this.teamCounts(), hi = n.indexOf(Math.max(...n)), lo = n.indexOf(Math.min(...n));
      if (n[hi] - n[lo] <= 1) break;
      const bot = [...this.players.values()].find(p => p.bot && !p.sentinel && p.team === hi);
      if (!bot) break;
      bot.team = lo;
    }
  }

  syncBots(){
    const humans = this.humans().filter(p => !p.away).length;
    const want = this.botSetting === 'auto' ? Math.max(this.mode.fill - humans, 0) : this.botSetting;
    const target = clamp(want, 0, Math.max(this.mode.maxPlayers - humans, 0));
    const bots = [...this.players.values()].filter(p => p.bot && !p.sentinel);
    while (bots.length > target){ const b = bots.pop(); this.players.delete(b.id); this.events.push({e:'leave', p:b.id}); }
    const used = new Set(bots.map(b => b.name));
    while (bots.length < target){
      let name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)];
      for (let k = 0; used.has(name) && k < 40; k++) name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)];
      if (used.has(name)) name += '-' + (bots.length + 1);
      used.add(name);
      const b = this.makePlayer(name, true);
      this.assignTeam(b); this.spawn(b);
      bots.push(b);
      this.events.push({e:'join', p:b.id});
    }
  }

  setLoadout(p, [a, b]){
    if (WEAPONS[a] && WEAPONS[b] && a !== b){ p.loadout = [a, b]; if (!p.alive || !p.loadout.includes(p.weapon)) p.weapon = a; }
  }

  /* ------------------------------------------------------------ spawning */
  chooseSpawn(p){
    const W = this.world;
    let list = W.spawns.filter(s => this.inPlay(s.x, s.z) && (!this.mode.spawnFilter || this.mode.spawnFilter(this, p, s)));
    if (!list.length) list = W.spawns.filter(s => this.inPlay(s.x, s.z));
    if (!list.length) list = W.spawns;
    let best = list[0], bs = -Infinity;
    for (const s of list){
      let de = 90, dm = 60, crowd = 0;
      for (const q of this.players.values()){
        if (q === p || !q.alive) continue;
        const d = Math.hypot(q.m.x - s.x, q.m.z - s.z);
        if (d < 3.5) crowd++;
        if (this.isEnemy(p, q)) de = Math.min(de, d); else dm = Math.min(dm, d);
      }
      let score = Math.min(de, 70) - (this.mode.teams ? Math.min(dm, 60) * 0.3 : 0) + this.rng() * 10 - crowd * 200;
      if (de < 14) score -= 60;
      if (this.mode.spawnBonus) score += this.mode.spawnBonus(this, p, s);
      if (score > bs){ bs = score; best = s; }
    }
    return best;
  }

  spawn(p, at = null){
    const s = at || this.mode.spawnPoint?.(this, p) || this.chooseSpawn(p);
    const S = this.world.sectors[this.sector] || {x:0, z:0};
    const yaw = Math.atan2(-(S.x - s.x), -(S.z - s.z));
    p.m = createMover(s.x, s.y, s.z, yaw);
    p.alive = true; p.hp = PLAYER.hp; p.shield = 0; p.protect = PLAYER.spawnShield; p.lastHurt = -99;
    p.weapon = p.loadout[0]; p.reloadT = 0; p.swapT = 0; p.heat = 0; p.overheat = 0; p.stormT = 0;
    for (const w of WEAPON_IDS) p.ammo[w] = WEAPONS[w].mag || 0;
    p.nades = GRENADE.charges; p.hist = []; p.damagers.clear(); p.spawns++;
    p.brain = null;
    this.mode.onSpawn?.(this, p);
    this.events.push({e:'spawn', p:p.id});
  }

  /* ------------------------------------------------------------ messages */
  handle(pid, msg){
    const p = this.players.get(pid);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t){
      case 'in': this.applyInput(p, msg.f); break;
      case 'fire': this.fire(p, msg); break;
      case 'swap': this.swap(p, msg.w | 0); break;
      case 'loadout': if (Array.isArray(msg.l)) this.setLoadout(p, msg.l.slice(0, 2)); break;
      case 'ping': this.direct(p, {t:'pong', c:msg.c, T:r3(this.time)}); p.ping = clamp(fin(msg.rtt), 0, 2000) | 0; break;
      case 'mark': if (this.phase !== 'post') this.events.push({e:'mark', p:p.id, x:r2(fin(msg.x)), y:r2(fin(msg.y)), z:r2(fin(msg.z)), team:p.team}); break;
      case 'team': if (this.mode.teams && this.phase === 'lobby' && Number.isInteger(msg.team) && msg.team >= 0 && msg.team < this.mode.teams){ p.team = msg.team; this.balanceTeams(); } break;
      case 'config': if (pid === this.hostId && this.phase !== 'live') this.configure(msg); break;
      case 'start': if (pid === this.hostId && this.phase === 'lobby'){ this.phase = 'live'; this.resetMatch(); this.events.push({e:'phase', ph:'live'}); } break;
      case 'name': { const n = sanitizeName(msg.name); if (n) p.name = n; break; }
      case 'deploy': this.mode.onDeploy?.(this, p, msg.at); break;
    }
  }

  applyInput(p, frames){
    if (!Array.isArray(frames)) return;
    for (const raw of frames.slice(0, 40)){
      if (!raw || typeof raw !== 'object') continue;
      const s = fin(raw.s, -1);
      if (s <= p.seq) continue;
      const f = {dt:clamp(fin(raw.dt), 0, 0.1), mx:clamp(fin(raw.mx), -1, 1), mz:clamp(fin(raw.mz), -1, 1), yaw:fin(raw.yaw, p.m.yaw), pitch:clamp(fin(raw.pitch), -1.5, 1.5), b:raw.b | 0, e:raw.e | 0};
      if (f.dt > p.budget + 1e-4) break; // more simulated time than real time has passed: drop (speed hack guard)
      p.budget -= f.dt;
      p.seq = s;
      if (!p.alive || this.phase === 'post'){ p.m.yaw = f.yaw; p.m.pitch = f.pitch; continue; }
      const ev = stepMover(p.m, f, this.world);
      this.moveEvents(p, ev);
      if (f.e & BTN.RELOAD) this.reload(p);
      if (f.e & BTN.NADE) this.throwNade(p);
      if (f.e & BTN.USE) this.mode.onUse?.(this, p);
      this.mode.onUseHeld?.(this, p, f.b & BTN.USE ? f.dt : 0);
      p.held = f.b;
    }
  }

  moveEvents(p, ev){
    if (ev.dashed) this.events.push({e:'fx', p:p.id, k:'dash'});
    if (ev.doubleJumped) this.events.push({e:'fx', p:p.id, k:'jump2'});
    if (ev.wallJumped) this.events.push({e:'fx', p:p.id, k:'walljump'});
  }

  swap(p, slot){
    const w = p.loadout[slot === 1 ? 1 : 0];
    if (!w || w === p.weapon || !p.alive) return;
    p.weapon = w; p.swapT = 0.35; p.reloadT = 0;
  }

  reload(p){
    const w = WEAPONS[p.weapon];
    if (!p.alive || !w.mag || p.reloadT > 0 || p.ammo[w.id] >= w.mag) return;
    p.reloadT = w.reload;
    this.events.push({e:'fx', p:p.id, k:'reload'});
  }

  /* ------------------------------------------------------------ combat */
  fire(p, msg){
    const seed = fin(msg.s) >>> 0, rt = clamp(fin(msg.rt, this.time), this.time - MAX_REWIND_MS / 1000, this.time);
    let yaw = fin(msg.yaw, p.m.yaw), pitch = clamp(fin(msg.pitch, p.m.pitch), -1.5, 1.5);
    if (Math.abs(wrap(yaw - p.m.yaw)) > 0.45 || Math.abs(pitch - p.m.pitch) > 0.45){ yaw = p.m.yaw; pitch = p.m.pitch; }
    if (msg.w && msg.w !== p.weapon && p.loadout.includes(msg.w)){ p.weapon = msg.w; p.swapT = 0; }
    return this.shoot(p, {yaw, pitch, seed, rt});
  }

  botFire(p){
    return this.shoot(p, {yaw:p.m.yaw, pitch:p.m.pitch, seed:(this.rng() * 4294967296) >>> 0, rt:this.time});
  }

  shoot(p, {yaw, pitch, seed, rt}){
    const w = WEAPONS[p.weapon];
    if (!p.alive || this.phase === 'post' || p.swapT > 0 || p.reloadT > 0 || this.time < p.nextFire) return false;
    if (w.mag){
      if (p.ammo[w.id] <= 0){ this.reload(p); return false; }
      p.ammo[w.id]--;
    } else if (w.heat){
      if (p.overheat > 0) return false;
      p.heat += w.heat;
      if (p.heat >= 1){ p.heat = 1; p.overheat = w.overheat; }
    }
    p.nextFire = this.time + fireInterval(w) * 0.82;
    p.protect = 0; p.firingT = 0.35;
    const m = p.m, eye = [m.x, m.y + eyeHeight(m), m.z];
    const dirs = shotDirs(w, yaw, pitch, spreadFor(w, m), seed);

    if (w.kind === 'bolt'){
      const d = dirs[0], id = this.nextProj++;
      const o = [eye[0] + d[0] * 0.5, eye[1] + d[1] * 0.5 - 0.08, eye[2] + d[2] * 0.5];
      this.projectiles.push({id, kind:'bolt', owner:p.id, w:w.id, x:o[0], y:o[1], z:o[2], vx:d[0] * w.boltSpeed, vy:d[1] * w.boltSpeed, vz:d[2] * w.boltSpeed, life:w.range / w.boltSpeed, dist:0});
      this.events.push({e:'bolt', id, p:p.id, o:o.map(r2), v:d.map(r3)});
      if (p.ammo[w.id] <= 0 && w.mag) this.reload(p);
      return true;
    }

    // smart pellets bend toward one enemy inside the cone
    if (w.homing){
      const f = aimDir(yaw, pitch);
      let lock = null, la = w.homing;
      for (const q of this.players.values()){
        if (!q.alive || !this.isEnemy(p, q)) continue;
        const dx = q.m.x - eye[0], dy = q.m.y + 1.1 - eye[1], dz = q.m.z - eye[2], d = Math.hypot(dx, dy, dz);
        if (d > w.range) continue;
        const a = Math.acos(clamp((dx * f[0] + dy * f[1] + dz * f[2]) / d, -1, 1));
        if (a < la && this.world.collide.clear(eye[0], eye[1], eye[2], q.m.x, q.m.y + 1.1, q.m.z)){ la = a; lock = [dx / d, dy / d, dz / d]; }
      }
      if (lock) for (const d of dirs){ d[0] = d[0] * 0.5 + lock[0] * 0.5; d[1] = d[1] * 0.5 + lock[1] * 0.5; d[2] = d[2] * 0.5 + lock[2] * 0.5; const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l; }
    }

    const tally = new Map(), ends = [];
    for (const d of dirs){
      const res = this.trace(p, eye, d, w.range, rt, w.pierce || 1);
      ends.push(r2(res.end[0]), r2(res.end[1]), r2(res.end[2]));
      for (const h of res.hits){
        const amt = w.dmg * falloff(w, h.t) * (h.head ? w.head : 1);
        const cur = tally.get(h.q) || {d:0, head:false};
        cur.d += amt; cur.head = cur.head || h.head; tally.set(h.q, cur);
      }
    }
    this.events.push({e:'shot', p:p.id, w:w.id, o:eye.map(r2), x:ends});
    for (const [q, {d, head}] of tally) this.damage(q, d, p, w.id, head, m);
    if (w.mag && p.ammo[w.id] <= 0) this.reload(p);
    return true;
  }

  rewind(q, rt){
    const H = q.hist;
    if (!H.length || rt >= H[H.length - 1][0]) return {x:q.m.x, y:q.m.y, z:q.m.z, crouch:q.m.crouch || q.m.slide > 0};
    for (let i = H.length - 1; i > 0; i--){
      const a = H[i - 1], b = H[i];
      if (a[0] <= rt){
        const k = (rt - a[0]) / Math.max(b[0] - a[0], 1e-6);
        return {x:a[1] + (b[1] - a[1]) * k, y:a[2] + (b[2] - a[2]) * k, z:a[3] + (b[3] - a[3]) * k, crouch:!!(k < 0.5 ? a[4] : b[4])};
      }
    }
    const a = H[0]; return {x:a[1], y:a[2], z:a[3], crouch:!!a[4]};
  }

  trace(p, o, d, range, rt, pierce){
    const wh = this.world.collide.raycast(o[0], o[1], o[2], d[0], d[1], d[2], range);
    const maxT = wh ? wh.t : range;
    const hits = [];
    for (const q of this.players.values()){
      if (!q.alive || q === p || !this.isEnemy(p, q)) continue;
      const pos = this.rewind(q, rt);
      const h = rayPlayer(o[0], o[1], o[2], d[0], d[1], d[2], pos, maxT);
      if (h) hits.push({q, t:h.t, head:h.head});
    }
    hits.sort((a, b) => a.t - b.t);
    const used = hits.slice(0, pierce);
    const tEnd = pierce === 1 && used.length ? used[0].t : maxT;
    return {hits:used, end:[o[0] + d[0] * tEnd, o[1] + d[1] * tEnd, o[2] + d[2] * tEnd], wall:wh};
  }

  damage(q, amount, from, wid, head = false, src = null){
    if (!q.alive || q.protect > 0 || amount <= 0 || this.phase === 'post') return;
    if (from && from !== q && !this.isEnemy(from, q)) return;
    let left = amount;
    if (q.shield > 0){ const s = Math.min(q.shield, left * 0.7); q.shield -= s; left -= s; }
    q.hp -= left; q.lastHurt = this.time;
    if (from && from !== q) q.damagers.set(from.id, this.time);
    const killed = q.hp <= 0;
    if (from && from !== q) from.pe.push({e:'hit', v:q.id, d:Math.round(amount), h:head ? 1 : 0, k:killed ? 1 : 0});
    q.pe.push({e:'hurt', d:Math.round(amount), x:src ? r2(src.x) : null, z:src ? r2(src.z) : null});
    if (killed) this.kill(q, from && from !== q ? from : null, wid, head);
  }

  kill(v, k, wid, head){
    v.alive = false; v.hp = 0; v.deaths++; v.streak = 0;
    v.respawnAt = this.time + (this.mode.respawn ?? PLAYER.respawn);
    const assists = [];
    if (k){
      k.kills++; k.streak++; k.score += 100 + (head ? 25 : 0);
      for (const [id, t] of v.damagers){
        if (id === k.id || this.time - t > 8) continue;
        const a = this.players.get(id); if (a){ a.assists++; a.score += 40; assists.push(id); }
      }
    }
    v.damagers.clear();
    if (this.phase === 'live') this.mode.onKill(this, k, v, {wid, head});
    this.mode.onDeath?.(this, v, k);
    this.events.push({e:'kill', k:k ? k.id : -1, v:v.id, w:wid, h:head ? 1 : 0, a:assists, s:k ? k.streak : 0});
  }

  throwNade(p){
    if (!p.alive || p.nades <= 0 || this.phase === 'post') return;
    p.nades--;
    const m = p.m, d = aimDir(m.yaw, Math.min(m.pitch + 0.14, 1.4)), id = this.nextProj++;
    const o = [m.x + d[0] * 0.6, m.y + eyeHeight(m) - 0.1, m.z + d[2] * 0.6];
    const v = [d[0] * GRENADE.speed + m.vx * 0.4, d[1] * GRENADE.speed + 2 + m.vy * 0.3, d[2] * GRENADE.speed + m.vz * 0.4];
    this.projectiles.push({id, kind:'nade', owner:p.id, x:o[0], y:o[1], z:o[2], vx:v[0], vy:v[1], vz:v[2], fuse:GRENADE.fuse});
    this.events.push({e:'nade', id, p:p.id, o:o.map(r2), v:v.map(r2)});
    p.protect = 0;
  }

  explode(g){
    const R = GRENADE.radius, owner = this.players.get(g.owner);
    this.events.push({e:'boom', x:r2(g.x), y:r2(g.y), z:r2(g.z)});
    for (const q of this.players.values()){
      if (!q.alive) continue;
      const cy = q.m.y + 1.0, d = Math.hypot(q.m.x - g.x, cy - g.y, q.m.z - g.z);
      if (d > R) continue;
      if (owner && q !== owner && !this.isEnemy(owner, q)) continue;
      if (!this.world.collide.clear(g.x, g.y + 0.3, g.z, q.m.x, cy, q.m.z)) continue;
      let dmg = GRENADE.dmg * Math.pow(1 - d / R, 1.15);
      if (q === owner) dmg *= 0.5;
      // knockback
      const k = (1 - d / R) * 9 / Math.max(d, 0.5);
      q.m.vx += (q.m.x - g.x) * k; q.m.vz += (q.m.z - g.z) * k; q.m.vy += 3 * (1 - d / R);
      this.damage(q, dmg, owner && q !== owner ? owner : q, 'frag', false, g);
    }
  }

  tickProjectiles(dt){
    const cw = this.world.collide;
    this.projectiles = this.projectiles.filter(pr => {
      if (pr.kind === 'bolt'){
        const sp = Math.hypot(pr.vx, pr.vy, pr.vz), step = sp * dt, dx = pr.vx / sp, dy = pr.vy / sp, dz = pr.vz / sp;
        const wh = cw.raycast(pr.x, pr.y, pr.z, dx, dy, dz, step);
        let best = null; const maxT = wh ? wh.t : step, owner = this.players.get(pr.owner);
        for (const q of this.players.values()){
          if (!q.alive || q.id === pr.owner || (owner && !this.isEnemy(owner, q))) continue;
          const h = rayPlayer(pr.x, pr.y, pr.z, dx, dy, dz, {x:q.m.x, y:q.m.y, z:q.m.z, crouch:q.m.crouch || q.m.slide > 0}, maxT);
          if (h && (!best || h.t < best.t)) best = {...h, q};
        }
        if (best){
          const w = WEAPONS[pr.w];
          this.damage(best.q, w.dmg * falloff(w, pr.dist + best.t) * (best.head ? w.head : 1), owner, pr.w, best.head, {x:pr.x, z:pr.z});
          this.events.push({e:'pop', id:pr.id, x:r2(pr.x + dx * best.t), y:r2(pr.y + dy * best.t), z:r2(pr.z + dz * best.t), hit:1});
          return false;
        }
        if (wh){ this.events.push({e:'pop', id:pr.id, x:r2(wh.x), y:r2(wh.y), z:r2(wh.z), hit:0}); return false; }
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt; pr.dist += step;
        pr.life -= dt;
        return pr.life > 0;
      }
      // grenade: bounce, then explode
      pr.fuse -= dt;
      if (pr.fuse <= 0){ this.explode(pr); return false; }
      pr.vy -= 15 * dt;
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
      if (sp > 0.01){
        const step = sp * dt, dx = pr.vx / sp, dy = pr.vy / sp, dz = pr.vz / sp;
        const h = cw.raycast(pr.x, pr.y, pr.z, dx, dy, dz, step + 0.08);
        if (h){
          const n = [h.nx ?? 0, h.ny ?? 1, h.nz ?? 0], vn = pr.vx * n[0] + pr.vy * n[1] + pr.vz * n[2];
          pr.vx = (pr.vx - 2 * vn * n[0]) * 0.45; pr.vy = (pr.vy - 2 * vn * n[1]) * 0.38; pr.vz = (pr.vz - 2 * vn * n[2]) * 0.45;
          pr.x = h.x + n[0] * 0.06; pr.y = h.y + n[1] * 0.06; pr.z = h.z + n[2] * 0.06;
        } else { pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt; }
      }
      const g = this.world.ground(pr.x, pr.z) + 0.06;
      if (pr.y < g){ pr.y = g; pr.vy = Math.abs(pr.vy) * 0.3; pr.vx *= 0.7; pr.vz *= 0.7; }
      return true;
    });
  }

  /* ------------------------------------------------------------ tick */
  tick(dt = DT){
    this.time += dt; this.tickN++;
    if (this.phase === 'live') this.matchTime += dt;

    for (const p of [...this.players.values()]){
      if (p.away && this.time - p.awayAt > 30){ this.leave(p.id); continue; }
      if (!p.bot) p.budget = Math.min(p.budget + dt * 1.06, 0.4);
      if (!p.alive){
        if (this.phase !== 'post' && this.time >= p.respawnAt && !this.mode.noRespawn?.(this, p)) this.spawn(p);
        continue;
      }
      if (p.bot){
        const f = botThink(this, p, dt);
        const ev = stepMover(p.m, f, this.world);
        this.moveEvents(p, ev);
        p.held = f.b;
        if (f.e & BTN.NADE) this.throwNade(p);
      }
      const w = WEAPONS[p.weapon];
      p.protect = Math.max(0, p.protect - dt);
      p.swapT = Math.max(0, p.swapT - dt);
      p.firingT = Math.max(0, p.firingT - dt);
      p.cloak = Math.max(0, (p.cloak || 0) - dt);
      if (p.reloadT > 0){ p.reloadT -= dt; if (p.reloadT <= 0){ p.reloadT = 0; p.ammo[w.id] = w.mag; } }
      if (p.overheat > 0){ p.overheat -= dt; if (p.overheat <= 0){ p.overheat = 0; p.heat = 0.3; } }
      else if (WEAPONS.kestrel.heat) p.heat = Math.max(0, p.heat - WEAPONS.kestrel.cool * dt);
      if (p.nades < GRENADE.charges){ p.nadeT += dt; if (p.nadeT >= GRENADE.regen){ p.nadeT = 0; p.nades++; } }
      if (p.hp < PLAYER.hp && this.time - p.lastHurt > PLAYER.regenDelay) p.hp = Math.min(PLAYER.hp, p.hp + PLAYER.regenRate * dt);
      // the relay storm outside the playable sector
      if (!this.inPlay(p.m.x, p.m.z)){ p.stormT += dt; if (p.stormT > 5) this.damage(p, 22 * dt, null, 'storm'); }
      else p.stormT = 0;
      if (p.m.y < -30) this.damage(p, 999, null, 'fall');
      p.hist.push([this.time, p.m.x, p.m.y, p.m.z, p.m.crouch || p.m.slide > 0 ? 1 : 0]);
      if (p.hist.length > 26) p.hist.shift();
    }

    this.tickProjectiles(dt);
    if (this.phase === 'live'){
      this.mode.tick(this, dt);
      const r = this.mode.result(this);
      if (r){ this.result = r; this.phase = 'post'; this.phaseEnd = this.time + 12; this.events.push({e:'end', r}); }
    } else if (this.phase === 'post' && this.time >= this.phaseEnd){
      this.phase = this.isPrivate ? 'lobby' : 'live';
      this.resetMatch();
      this.events.push({e:'phase', ph:this.phase});
    }
    this.snapshot();
  }

  flags(p){
    const m = p.m;
    let f = 0;
    if (p.alive) f |= FLAG.ALIVE;
    if (m.crouch) f |= FLAG.CROUCH;
    if (m.slide > 0) f |= FLAG.SLIDE;
    if (m.wall){ f |= FLAG.WALL; if ((m.wall.nx * Math.cos(m.yaw) - m.wall.nz * Math.sin(m.yaw)) > 0) f |= FLAG.WALL_L; }
    if (m.sprint) f |= FLAG.SPRINT;
    if (m.ads) f |= FLAG.ADS;
    if (m.dash > 0) f |= FLAG.DASH;
    if (p.reloadT > 0) f |= FLAG.RELOAD;
    if (!m.ground) f |= FLAG.AIR;
    if (p.protect > 0) f |= FLAG.PROTECT;
    if (p.firingT > 0) f |= FLAG.FIRING;
    if (m.mantle) f |= FLAG.MANTLE;
    if (m.water > 1.2) f |= FLAG.SWIM;
    return f;
  }

  snapshot(){
    const ps = [];
    for (const p of this.players.values()){
      const m = p.m;
      ps.push([p.id, r2(m.x), r2(m.y), r2(m.z), r3(m.yaw), r3(m.pitch), this.flags(p), Math.ceil(Math.max(p.hp, 0)), WEAPON_IDS.indexOf(p.weapon), p.team]);
    }
    const shared = {t:'s', T:r3(this.time), p:ps, ph:this.phase, tl:Math.max(0, Math.round(this.timeLimit - this.matchTime)), m:this.mode.hud(this)};
    const nades = this.projectiles.filter(pr => pr.kind === 'nade');
    if (nades.length) shared.g = nades.map(n => [n.id, r2(n.x), r2(n.y), r2(n.z)]);
    if (this.events.length){ shared.ev = this.events; this.events = []; }
    if (this.tickN % TICK_HZ === 1 || shared.ev?.some(e => e.e === 'join' || e.e === 'leave' || e.e === 'kill' || e.e === 'match')) shared.ro = this.roster();
    if (this.result && this.phase === 'post') shared.res = this.result;
    const extra = this.mode.snapshot?.(this);
    if (extra) shared.x = extra;
    const base = JSON.stringify(shared).slice(0, -1);
    for (const p of this.players.values()){
      if (p.bot || p.away) continue;
      const w = WEAPONS[p.weapon];
      const me = {s:p.seq, st:moverState(p.m), al:p.alive ? 1 : 0, hp:Math.ceil(Math.max(p.hp, 0)), sh:Math.ceil(p.shield), w:p.weapon, l:p.loadout,
        a:w.mag ? p.ammo[w.id] : null, rl:r2(p.reloadT), ht:r2(p.heat), oh:p.overheat > 0 ? 1 : 0, n:p.nades, sp:p.spawns,
        ri:p.alive ? 0 : Math.max(0, r2(p.respawnAt - this.time)), sto:r2(p.stormT), pr:p.protect > 0 ? 1 : 0, sw:r2(p.swapT)};
      const personal = this.mode.personal?.(this, p);
      if (personal) me.x = personal;
      if (p.pe.length){ me.pe = p.pe; p.pe = []; }
      this.send(p.id, base + ',"me":' + JSON.stringify(me) + '}');
    }
    for (const p of this.players.values()) if (p.bot) p.pe.length = 0;
  }

  roster(){
    return [...this.players.values()].map(p => [p.id, p.name, p.team, p.bot ? 1 : 0, p.kills, p.deaths, p.assists, p.score, p.ping, p.id === this.hostId ? 1 : 0, p.away ? 1 : 0]);
  }

  direct(p, obj){ if (!p.bot) this.send(p.id, JSON.stringify(obj)); }

  stats(){ return {code:this.code, mode:this.modeId, sector:this.sector, humans:this.humans().filter(p => !p.away).length, bots:[...this.players.values()].filter(p => p.bot).length, phase:this.phase, priv:this.isPrivate, max:this.mode.maxPlayers}; }
}
