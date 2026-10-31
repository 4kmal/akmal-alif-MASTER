/* Arcade screens drawn to 2D canvases and used as textures:
   CabinetScreen  the EXEPERT cabinet CRT (attract mode, menu, controls)
   HandheldScreen the 4K-BOY LCD (boot logo, cartridge menu, RELAY RUN) */
import { makeNoise, fbm } from '../../video-games/kessler-world/kessler-util.js';
import { RelayRun, LCD } from './relay-run.js';

const FONT = 'press-start, monospace';
const STATUS_URL = '/api/exepert/status';

export class CabinetScreen {
  constructor({audio, onLaunch, accent = '#00ff41'}){
    this.audio = audio; this.onLaunch = onLaunch; this.accent = accent;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d');
    this.state = 'attract'; this.sel = 0; this.t = 0; this.idle = 0; this.credits = 0;
    this.items = [
      {label:'DEPLOY', hint:'QUICK PLAY · SOLO OR ONLINE', run:() => this.launch({})},
      {label:'SQUAD UP', hint:'MAKE A ROOM · SHARE THE CODE', run:() => this.launch({squad:true})},
      {label:'CONTROLS', hint:'HOW TO MOVE AND SHOOT', run:() => { this.state = 'controls'; }}
    ];
    this.noise = makeNoise(4127);
    this.grid = new Float32Array(65 * 49);
    this.status = null; this.statusAt = -1e9;
    this.frame = 0;
  }

  async refreshStatus(){
    if (performance.now() - this.statusAt < 30000) return;
    this.statusAt = performance.now();
    try {
      const res = await fetch(STATUS_URL, {headers:{accept:'application/json'}});
      this.status = res.ok ? await res.json() : null;
    } catch { this.status = null; }
  }

  launch(opts){
    this.state = 'launch'; this.launchT = 0;
    this.audio?.launch();
    this.onLaunch?.(opts);
  }

  reset(){ this.state = 'attract'; this.idle = 0; }

  input(btn){
    this.idle = 0;
    if (btn === 'COIN'){ this.credits = Math.min(99, this.credits + 1); this.audio?.coin(); return; }
    if (this.state === 'attract'){ this.state = 'menu'; this.sel = 0; this.audio?.select(); return; }
    if (this.state === 'menu'){
      if (btn === 'up' || btn === 'left'){ this.sel = (this.sel + this.items.length - 1) % this.items.length; this.audio?.move(); }
      else if (btn === 'down' || btn === 'right'){ this.sel = (this.sel + 1) % this.items.length; this.audio?.move(); }
      else if (btn === 'A' || btn === 'START'){ this.audio?.select(); this.items[this.sel].run(); }
      else if (btn === 'B'){ this.state = 'attract'; this.audio?.back(); }
      return;
    }
    if (this.state === 'controls' && (btn === 'B' || btn === 'A' || btn === 'START')){ this.state = 'menu'; this.audio?.back(); }
  }

  update(dt){
    this.t += dt; this.idle += dt; this.frame++;
    if (this.state === 'launch'){ this.launchT += dt; if (this.launchT > 4) this.state = 'menu'; }
    if (this.state !== 'attract' && this.state !== 'launch' && this.idle > 30) this.state = 'attract';
    this.draw();
    return true;
  }

  drawContours(alpha){
    const {ctx} = this, n = this.noise, G = this.grid, NX = 64, NY = 48, sx = 512 / NX, sy = 384 / NY, t = this.t * 0.05;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) G[j * 65 + i] = fbm(n, i * 0.055 + t, j * 0.055 - t * 0.6, 3);
    ctx.lineWidth = 1;
    for (let l = -4; l <= 4; l++){
      const L = l * 0.09;
      ctx.strokeStyle = l === 0 ? `rgba(160,220,255,${0.55 * alpha})` : `rgba(60,140,255,${0.32 * alpha})`;
      ctx.beginPath();
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++){
        const a = G[j * 65 + i], b = G[j * 65 + i + 1], c = G[(j + 1) * 65 + i + 1], d = G[(j + 1) * 65 + i];
        const pts = [];
        const x0 = i * sx, y0 = j * sy;
        if ((a < L) !== (b < L)) pts.push(x0 + (L - a) / (b - a) * sx, y0);
        if ((b < L) !== (c < L)) pts.push(x0 + sx, y0 + (L - b) / (c - b) * sy);
        if ((c < L) !== (d < L)) pts.push(x0 + sx - (L - c) / (d - c) * sx, y0 + sy);
        if ((d < L) !== (a < L)) pts.push(x0, y0 + sy - (L - d) / (a - d) * sy);
        if (pts.length >= 4){ ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); }
        if (pts.length === 8){ ctx.moveTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]); }
      }
      ctx.stroke();
    }
  }

  logo(y, size = 58){
    const {ctx} = this;
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glitch = Math.sin(this.t * 7.3) > 0.97 ? 6 : 0;
    ctx.fillStyle = 'rgba(255,40,120,0.85)'; ctx.fillText('EXEPERT', 256 - 3 - glitch, y);
    ctx.fillStyle = 'rgba(40,220,255,0.85)'; ctx.fillText('EXEPERT', 256 + 3 + glitch, y);
    ctx.fillStyle = '#f4ffe0'; ctx.fillText('EXEPERT', 256, y);
  }

  text(s, x, y, size = 12, color = '#cfe8ff', align = 'center'){
    const {ctx} = this;
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  draw(){
    const {ctx} = this, blink = Math.floor(this.t * 2) % 2 === 0;
    const g = ctx.createLinearGradient(0, 0, 0, 384);
    g.addColorStop(0, '#02040c'); g.addColorStop(1, '#071430');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 384);
    this.drawContours(this.state === 'attract' ? 1 : 0.45);

    if (this.state === 'attract'){
      this.text('4KMAL4LIF PRESENTS', 256, 52, 11, '#8fb4ff');
      this.logo(118);
      this.text('MARATHON × CYBERPUNK × BATTLEFRONT', 256, 168, 9, '#9ec9ff');
      this.text('FIRST MAP: KESSLER IV', 256, 190, 10, this.accent);
      if (blink) this.text('PRESS START', 256, 252, 18, '#ffffff');
      const s = this.status;
      const line = s && typeof s.players === 'number' ? `RUNNERS ONLINE ${String(s.players).padStart(2, '0')} · ROOMS ${String(s.rooms || 0).padStart(2, '0')}` : 'SOLO VS BOTS READY';
      this.text(line, 256, 312, 10, '#7fa6d9');
      this.text(this.credits ? `CREDITS ${this.credits}` : 'FREE PLAY', 256, 350, 10, '#ffd34d');
    } else if (this.state === 'menu'){
      this.logo(64, 40);
      this.items.forEach((it, i) => {
        const y = 150 + i * 56, on = i === this.sel;
        if (on){ ctx.fillStyle = 'rgba(0,255,65,0.12)'; ctx.fillRect(72, y - 22, 368, 44); ctx.strokeStyle = this.accent; ctx.lineWidth = 2; ctx.strokeRect(72, y - 22, 368, 44); }
        this.text((on ? '▶ ' : '  ') + it.label, 96, y - 5, 16, on ? '#ffffff' : '#7fa6d9', 'left');
        this.text(it.hint, 120, y + 13, 8, on ? this.accent : '#4c6a99', 'left');
      });
      this.text('▲▼ CHOOSE   A / START  CONFIRM', 256, 352, 9, '#7fa6d9');
    } else if (this.state === 'controls'){
      this.text('CONTROLS', 256, 40, 18, '#ffffff');
      const rows = [['MOVE', 'W A S D'], ['AIM / FIRE', 'MOUSE · LMB'], ['ADS', 'RMB'], ['JUMP ×2', 'SPACE'], ['SLIDE', 'C / CTRL'], ['SPRINT', 'SHIFT'], ['PHASE DASH', 'Q'], ['GRENADE', 'G'], ['RELOAD', 'R'], ['SCORES', 'TAB']];
      rows.forEach(([a, b], i) => { const y = 82 + i * 26; this.text(a, 96, y, 10, '#9ec9ff', 'left'); this.text(b, 416, y, 10, '#ffffff', 'right'); });
      this.text('GAMEPAD WORKS TOO · B TO GO BACK', 256, 356, 9, this.accent);
    } else if (this.state === 'launch'){
      this.logo(150, 48);
      this.text('DEPLOYING TO KESSLER IV', 256, 216, 12, '#ffffff');
      const p = Math.min(1, this.launchT / 0.9);
      ctx.strokeStyle = this.accent; ctx.strokeRect(128, 244, 256, 14);
      ctx.fillStyle = this.accent; ctx.fillRect(131, 247, 250 * p, 8);
    }
  }
}

export class HandheldScreen {
  constructor({audio, onLaunch}){
    this.audio = audio; this.onLaunch = onLaunch;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 160; this.canvas.height = 144;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.state = 'off'; this.t = 0; this.sel = 0; this.msg = '';
    this.game = new RelayRun(audio);
    this.carts = [
      {label:'RELAY RUN', run:() => { this.state = 'run'; this.game.reset(); this.game.state = 'ready'; }},
      {label:'EXEPERT', run:() => { this.msg = 'BOOTING ON THE\nCABINET...'; this.state = 'info'; this.t = 0; this.onLaunch?.({}); }},
      {label:'?????', run:() => { this.msg = 'CARTRIDGE\nCOMING SOON'; this.state = 'info'; this.t = 0; }},
      {label:'?????', run:() => { this.msg = 'CARTRIDGE\nCOMING SOON'; this.state = 'info'; this.t = 0; }}
    ];
    this.draw();
  }

  get running(){ return this.state === 'run' && this.game.state === 'run'; }

  powerOn(){
    if (this.state !== 'off') return;
    this.state = 'boot'; this.t = 0; this.dinged = false;
  }

  input(btn, down = true){
    if (this.state === 'off'){ if (down) this.powerOn(); return; }
    if (this.state === 'boot') return;
    if (this.state === 'run'){
      if (down && (btn === 'B' || btn === 'SELECT') && this.game.state !== 'run'){ this.state = 'menu'; this.audio?.back(); return; }
      if (down && btn === 'SELECT'){ this.state = 'menu'; this.game.state = 'ready'; this.audio?.back(); return; }
      this.game.input(btn, down);
      return;
    }
    if (!down) return;
    if (this.state === 'info'){ if (btn === 'B' || btn === 'A' || btn === 'START'){ this.state = 'menu'; this.audio?.back(); } return; }
    if (btn === 'up'){ this.sel = (this.sel + this.carts.length - 1) % this.carts.length; this.audio?.move(); }
    else if (btn === 'down'){ this.sel = (this.sel + 1) % this.carts.length; this.audio?.move(); }
    else if (btn === 'A' || btn === 'START'){ this.audio?.select(); this.carts[this.sel].run(); }
  }

  update(dt){
    this.t += dt;
    if (this.state === 'boot'){
      if (!this.dinged && this.t > 1.4){ this.dinged = true; this.audio?.boot(); }
      if (this.t > 2.6){ this.state = 'menu'; this.sel = 0; }
    }
    if (this.state === 'run') this.game.update(Math.min(dt, 0.05));
    this.draw();
    return true;
  }

  draw(){
    const {ctx} = this;
    if (this.state === 'off'){ ctx.fillStyle = '#5a6b2a'; ctx.fillRect(0, 0, 160, 144); return; }
    if (this.state === 'run'){ this.game.draw(ctx); return; }
    ctx.fillStyle = LCD[3]; ctx.fillRect(0, 0, 160, 144);
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    if (this.state === 'boot'){
      const y = Math.min(58, -12 + this.t * 55);
      ctx.fillStyle = LCD[0]; ctx.font = `10px ${FONT}`;
      ctx.fillText('4KMAL4LIF', 80, y);
      if (this.t > 1.4){ ctx.font = `6px ${FONT}`; ctx.fillStyle = LCD[1]; ctx.fillText('®', 128, y - 2); }
      return;
    }
    ctx.fillStyle = LCD[0]; ctx.font = `8px ${FONT}`;
    if (this.state === 'info'){
      this.msg.split('\n').forEach((l, i) => ctx.fillText(l, 80, 52 + i * 14));
      ctx.fillStyle = LCD[1]; ctx.fillText('B BACK', 80, 116);
      return;
    }
    ctx.fillText('SELECT GAME', 80, 10);
    ctx.fillStyle = LCD[1]; ctx.fillRect(10, 24, 140, 1);
    this.carts.forEach((c, i) => {
      const y = 36 + i * 20, on = i === this.sel;
      if (on){ ctx.fillStyle = LCD[0]; ctx.fillRect(12, y - 4, 136, 16); }
      ctx.fillStyle = on ? LCD[3] : LCD[0];
      ctx.textAlign = 'left'; ctx.fillText((on ? '>' : ' ') + c.label, 18, y);
    });
    ctx.textAlign = 'center'; ctx.fillStyle = LCD[1];
    ctx.font = `6px ${FONT}`; ctx.fillText('A START  B BACK', 80, 128);
  }
}
