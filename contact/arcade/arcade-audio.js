/* Arcade sound: tiny WebAudio chiptune blips. The context is created on the first user gesture. */
const MUTE_KEY = 'arcade-muted';

export class ArcadeAudio {
  constructor(){
    this.ctx = null;
    this.master = null;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { this.muted = false; }
  }

  unlock(){
    if (this.ctx || this.muted) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.14;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted){
    this.muted = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.value = muted ? 0 : 0.14;
    if (!muted) this.unlock();
  }

  tone(freq, dur = 0.08, {type = 'square', at = 0, to = null, vol = 1} = {}){
    if (!this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur = 0.12, vol = 0.6, at = 0){
    if (!this.ctx || this.muted) return;
    const len = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = buf; g.gain.value = vol;
    s.connect(g).connect(this.master);
    s.start(this.ctx.currentTime + at);
  }

  move(){ this.tone(660, 0.04); }
  select(){ this.tone(880, 0.05); this.tone(1320, 0.06, {at:0.05}); }
  back(){ this.tone(520, 0.06, {to:330}); }
  press(){ this.tone(220, 0.03, {type:'triangle'}); }
  coin(){ this.tone(988, 0.07); this.tone(1319, 0.28, {at:0.07}); }
  boot(){ this.tone(1047, 0.09, {at:0.0}); this.tone(2093, 0.5, {at:0.09, type:'square', vol:0.8}); }
  jump(){ this.tone(330, 0.12, {to:880, type:'square', vol:0.6}); }
  hit(){ this.noise(0.25, 0.7); this.tone(160, 0.3, {to:50, type:'sawtooth', vol:0.6}); }
  score(){ this.tone(1568, 0.05, {vol:0.5}); }
  launch(){ this.tone(110, 0.9, {to:1760, type:'sawtooth', vol:0.7}); this.noise(0.9, 0.25, 0.1); }
}
