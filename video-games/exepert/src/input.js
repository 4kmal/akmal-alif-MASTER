/* Keyboard, mouse (pointer lock) and gamepad, turned into EXEPERT input frames. */
import { BTN } from '../sim/constants.js';
import { settings } from './settings.js';

const KEYS = {
  KeyW:'f', ArrowUp:'f', KeyS:'b', ArrowDown:'b', KeyA:'l', ArrowLeft:'l', KeyD:'r', ArrowRight:'r',
  Space:'jump', ShiftLeft:'sprint', ShiftRight:'sprint', KeyC:'crouch', ControlLeft:'crouch', KeyQ:'dash',
  KeyR:'reload', KeyG:'nade', KeyE:'use', KeyF:'use', Digit1:'w1', Digit2:'w2', KeyZ:'ping', KeyV:'view', Tab:'score', KeyM:'map'
};

export class Input {
  constructor(canvas){
    this.canvas = canvas;
    this.held = new Set();
    this.edges = new Set();
    this.mouse = {fire:false, ads:false};
    this.dyaw = 0; this.dpitch = 0;
    this.locked = false;
    this.sprintToggle = false;
    this.padPrev = [];
    this.wheel = 0;
    this.onLockChange = null;
    this.onKey = null;

    this.kd = e => {
      if (!this.locked && e.code !== 'Tab') return;
      const k = KEYS[e.code];
      if (!k) return;
      e.preventDefault();
      if (e.repeat) return;
      this.held.add(k); this.edges.add(k);
      if (k === 'sprint' && settings.toggleSprint) this.sprintToggle = !this.sprintToggle;
      this.onKey?.(k, true);
    };
    this.ku = e => { const k = KEYS[e.code]; if (!k) return; this.held.delete(k); this.onKey?.(k, false); };
    this.mm = e => {
      if (!this.locked) return;
      const s = 0.0022 * settings.sens * (this.mouse.ads ? this.adsScale || 0.6 : 1);
      this.dyaw -= e.movementX * s;
      this.dpitch -= e.movementY * s * (settings.invertY ? -1 : 1);
    };
    this.md = e => {
      if (!this.locked) return;
      if (e.button === 0){ this.mouse.fire = true; this.edges.add('fire'); }
      if (e.button === 2){ this.mouse.ads = true; }
    };
    this.mu = e => { if (e.button === 0) this.mouse.fire = false; if (e.button === 2) this.mouse.ads = false; };
    this.wh = e => { if (this.locked){ this.wheel += Math.sign(e.deltaY); } };
    this.lc = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked){ this.held.clear(); this.mouse.fire = false; this.mouse.ads = false; }
      this.onLockChange?.(this.locked);
    };
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
    window.addEventListener('mousemove', this.mm);
    window.addEventListener('mousedown', this.md);
    window.addEventListener('mouseup', this.mu);
    window.addEventListener('wheel', this.wh, {passive:true});
    window.addEventListener('contextmenu', e => { if (this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', this.lc);
    window.addEventListener('blur', () => { this.held.clear(); this.mouse.fire = false; this.mouse.ads = false; });
  }

  lock(){
    try {
      const r = this.canvas.requestPointerLock({unadjustedMovement:true});
      if (r?.catch) r.catch(() => this.canvas.requestPointerLock());
    } catch { this.canvas.requestPointerLock(); }
  }
  unlock(){ if (document.pointerLockElement) document.exitPointerLock(); }

  pad(){
    const pads = navigator.getGamepads?.() || [];
    return [...pads].find(p => p && p.connected) || null;
  }

  /* Build one input frame (movement axes, look deltas, held buttons, this-frame edges). */
  frame(dt){
    const h = this.held, pad = this.pad();
    let mx = (h.has('r') ? 1 : 0) - (h.has('l') ? 1 : 0), mz = (h.has('f') ? 1 : 0) - (h.has('b') ? 1 : 0);
    let b = 0, e = 0;
    const edge = k => this.edges.has(k);
    if (h.has('jump')) b |= BTN.JUMP; if (edge('jump')) e |= BTN.JUMP;
    if (h.has('crouch')) b |= BTN.CROUCH; if (edge('crouch')) e |= BTN.CROUCH;
    if (settings.toggleSprint ? this.sprintToggle : h.has('sprint')) b |= BTN.SPRINT;
    if (edge('dash')) e |= BTN.DASH;
    if (edge('reload')) e |= BTN.RELOAD;
    if (edge('nade')) e |= BTN.NADE;
    if (edge('use')) e |= BTN.USE;
    if (h.has('use')) b |= BTN.USE;
    if (this.mouse.fire) b |= BTN.FIRE;
    if (edge('fire')) e |= BTN.FIRE;
    if (this.mouse.ads) b |= BTN.ADS;
    let dyaw = this.dyaw, dpitch = this.dpitch;
    this.dyaw = 0; this.dpitch = 0;

    if (pad){
      const dz = v => Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85;
      const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0), rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      if (Math.abs(lx) + Math.abs(ly) > 0){ mx = lx; mz = -ly; }
      const look = 3.2 * settings.sens * dt * (pad.buttons[6]?.value > 0.4 ? 0.55 : 1);
      dyaw -= rx * Math.abs(rx) * look; dpitch -= ry * Math.abs(ry) * look * (settings.invertY ? -1 : 1);
      const btn = i => !!pad.buttons[i]?.pressed, was = i => !!this.padPrev[i];
      const pe = i => btn(i) && !was(i);
      if (btn(0)) b |= BTN.JUMP; if (pe(0)) e |= BTN.JUMP;
      if (btn(1)) b |= BTN.CROUCH; if (pe(1)) e |= BTN.CROUCH;
      if (btn(10)) b |= BTN.SPRINT;
      if (pe(5)) e |= BTN.DASH;
      if (pe(2)) e |= BTN.RELOAD;
      if (pe(4)) e |= BTN.NADE;
      if (pe(3)) this.edges.add('w-next');
      if ((pad.buttons[7]?.value || 0) > 0.35) b |= BTN.FIRE;
      if ((pad.buttons[7]?.value || 0) > 0.35 && !(this.padPrev[7])) e |= BTN.FIRE;
      if ((pad.buttons[6]?.value || 0) > 0.35) b |= BTN.ADS;
      if (pe(9)) this.edges.add('pause');
      if (pe(8)) this.edges.add('score');
      this.padHeldScore = btn(8);
      this.padPrev = pad.buttons.map((x, i) => i === 7 ? (x.value || 0) > 0.35 : x.pressed);
    }
    const len = Math.hypot(mx, mz); if (len > 1){ mx /= len; mz /= len; }
    const out = {mx, mz, b, e, dyaw, dpitch, wheel:this.wheel, edges:new Set(this.edges)};
    this.wheel = 0;
    this.edges.clear();
    return out;
  }

  dispose(){
    window.removeEventListener('keydown', this.kd); window.removeEventListener('keyup', this.ku);
    window.removeEventListener('mousemove', this.mm); window.removeEventListener('mousedown', this.md);
    window.removeEventListener('mouseup', this.mu); window.removeEventListener('wheel', this.wh);
    document.removeEventListener('pointerlockchange', this.lc);
  }
}
