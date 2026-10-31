/* RELAY RUN: the 4K-BOY's built-in cartridge. An endless runner across the Kessler relay line.
   A / UP jumps (press twice in the air for the jump kit), DOWN ducks under drones, START restarts. */
import { createGamingAnalytics } from '../../js/gaming-analytics.js';
export const LCD = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']; // darkest -> lightest
const W = 160, H = 144, GROUND = 118, HI_KEY = 'arcade-relayrun-hi';

const RUNNER = [ // 8x10, 1 = dark, 2 = mid
  '..1111..',
  '..1221..',
  '..1111..',
  '...11...',
  '.111111.',
  '1.1111.1',
  '..1111..',
  '..1..1..',
  '.11..11.',
  '.1....1.'
];
const RUNNER_B = [
  '..1111..',
  '..1221..',
  '..1111..',
  '...11...',
  '.111111.',
  '1.1111.1',
  '..1111..',
  '...11...',
  '..1..1..',
  '..11.11.'
];
const DUCK = [
  '........',
  '........',
  '........',
  '........',
  '..1111..',
  '.112211.',
  '11111111',
  '1.1111.1',
  '.11..11.',
  '.1....1.'
];

function sprite(ctx, rows, x, y, s = 1){
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++){
    const ch = rows[r][c];
    if (ch === '.') continue;
    ctx.fillStyle = ch === '1' ? LCD[0] : LCD[1];
    ctx.fillRect(x + c * s, y + r * s, s, s);
  }
}

export class RelayRun {
  constructor(audio){
    this.audio = audio;
    this.analytics = createGamingAnalytics({ gameId:'relay-run', autoStart:false });
    try { this.hi = Number(localStorage.getItem(HI_KEY)) || 0; } catch { this.hi = 0; }
    this.reset();
    this.state = 'ready';
  }

  reset(){
    this.y = 0; this.vy = 0; this.jumps = 0; this.duck = 0;
    this.speed = 70; this.dist = 0; this.score = 0; this.t = 0;
    this.obs = []; this.next = 1.2; this.parallax = 0; this.flash = 0;
  }

  startRun(){
    this.analytics?.end({ status:'abandoned', reason:'reset' });
    this.analytics = createGamingAnalytics({ gameId:'relay-run', autoStart:false });
    this.analytics.start({ transport:'handheld', entrypoint:'contact-arcade', mode:'endless' });
    this.analytics.interaction('start');
  }

  finish(reason, status = reason === 'collision' ? 'completed' : 'abandoned'){
    if (this.state === 'run' || reason === 'collision') {
      if (status === 'completed') this.analytics?.result({ status, reason, score:this.score, distance:this.dist, details:{ end_reason:reason } });
      this.analytics?.end({ status, reason, score:this.score, distance:this.dist });
    }
  }

  input(btn, down = true){
    if (!down){ if (btn === 'down') this.duck = Math.min(this.duck, 0.08); return; }
    if (this.state !== 'run'){
      if (btn === 'A' || btn === 'START' || btn === 'up'){ this.reset(); this.startRun(); this.state = 'run'; this.audio?.select(); }
      return;
    }
    if (btn === 'A' || btn === 'up'){
      if (this.jumps < 2){ this.vy = this.jumps === 0 ? 150 : 128; this.jumps++; this.duck = 0; this.audio?.jump(); }
    } else if (btn === 'down'){
      this.duck = 0.45;
      if (this.y > 0) this.vy = Math.min(this.vy, -160);
    }
  }

  update(dt){
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.state !== 'run') return;
    this.speed = Math.min(170, 70 + this.dist * 0.018);
    this.dist += this.speed * dt;
    this.parallax += this.speed * dt;
    const s = Math.floor(this.dist / 10);
    if (Math.floor(s / 100) > Math.floor(this.score / 100)) this.audio?.score();
    this.score = s;
    this.vy -= 420 * dt; this.y = Math.max(0, this.y + this.vy * dt);
    if (this.y === 0){ this.vy = 0; this.jumps = 0; }
    if (this.duck > 0) this.duck -= dt;

    this.next -= dt;
    if (this.next <= 0){
      const air = this.dist > 400 && Math.random() < 0.35;
      this.obs.push(air ? {x:W + 8, w:12, h:7, y:7 + Math.random() * 2, air:true} : {x:W + 8, w:6 + Math.floor(Math.random() * 3) * 3, h:10 + Math.floor(Math.random() * 3) * 4, y:0, air:false});
      this.next = Math.max(0.55, 1.5 - this.dist / 3000) + Math.random() * 0.7;
    }
    for (const o of this.obs) o.x -= this.speed * dt;
    this.obs = this.obs.filter(o => o.x > -20);

    // collision: runner box
    const ducking = this.duck > 0 && this.y === 0;
    const rx = 24, rw = 8, rh = ducking ? 6 : 10, ry = this.y;
    for (const o of this.obs){
      const ox = o.x, oy = o.y, ow = o.w, oh = o.h;
      if (rx + rw - 1 > ox && rx + 1 < ox + ow && ry < oy + oh && ry + rh > oy + 1){
        this.state = 'over'; this.flash = 0.25; this.audio?.hit(); this.finish('collision');
        if (this.score > this.hi){ this.hi = this.score; try { localStorage.setItem(HI_KEY, String(this.hi)); } catch {} }
      }
    }
  }

  draw(ctx){
    ctx.fillStyle = this.flash > 0 ? LCD[1] : LCD[3];
    ctx.fillRect(0, 0, W, H);
    // distant relay masts
    ctx.fillStyle = LCD[2];
    for (let k = 0; k < 5; k++){
      const x = ((k * 47 - this.parallax * 0.2) % 235 + 235) % 235 - 30;
      ctx.fillRect(x + 6, 62, 2, 56); ctx.fillRect(x, 66, 14, 2); ctx.fillRect(x + 2, 74, 10, 1);
      ctx.fillRect(x + 4, 58, 6, 4);
    }
    // contour hills
    ctx.fillStyle = LCD[2];
    for (let x = 0; x < W; x += 2){ const h = 8 + Math.sin((x + this.parallax * 0.45) * 0.045) * 5 + Math.sin((x + this.parallax * 0.45) * 0.11) * 2; ctx.fillRect(x, GROUND - h, 2, h); }
    // ground
    ctx.fillStyle = LCD[0]; ctx.fillRect(0, GROUND, W, 2);
    ctx.fillStyle = LCD[1];
    for (let x = -((this.parallax) % 12); x < W; x += 12) ctx.fillRect(x, GROUND + 5, 6, 1);
    // obstacles
    for (const o of this.obs){
      const top = GROUND - o.y - o.h;
      if (o.air){
        ctx.fillStyle = LCD[0]; ctx.fillRect(o.x, top + 2, o.w, o.h - 3);
        ctx.fillStyle = LCD[1]; ctx.fillRect(o.x - 2, top, 5, 1); ctx.fillRect(o.x + o.w - 3, top, 5, 1);
        if (Math.floor(this.t * 8) % 2) { ctx.fillStyle = LCD[3]; ctx.fillRect(o.x + 4, top + 4, 2, 1); }
      } else {
        ctx.fillStyle = LCD[0]; ctx.fillRect(o.x, top, o.w, o.h);
        ctx.fillStyle = LCD[1]; for (let y = top + 3; y < GROUND - 1; y += 4) ctx.fillRect(o.x + 1, y, o.w - 2, 1);
      }
    }
    // runner
    const ducking = this.duck > 0 && this.y === 0;
    const frame = this.state === 'run' && this.y === 0 && Math.floor(this.t * 12) % 2 ? RUNNER_B : RUNNER;
    sprite(ctx, ducking ? DUCK : frame, 24, GROUND - 10 - Math.round(this.y));
    // HUD
    ctx.fillStyle = LCD[0];
    ctx.font = '8px press-start, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(String(this.score).padStart(5, '0'), 4, 4);
    ctx.fillText('HI ' + String(this.hi).padStart(5, '0'), 76, 4);
    if (this.state !== 'run'){
      ctx.fillStyle = LCD[3]; ctx.fillRect(18, 40, 124, 44);
      ctx.fillStyle = LCD[0]; ctx.fillRect(18, 40, 124, 2); ctx.fillRect(18, 82, 124, 2);
      ctx.textAlign = 'center';
      ctx.fillText(this.state === 'over' ? 'SIGNAL LOST' : 'RELAY RUN', 80, 48);
      if (Math.floor(this.t * 2) % 2 === 0) ctx.fillText('PRESS A', 80, 66);
      ctx.textAlign = 'left';
    }
  }
}
