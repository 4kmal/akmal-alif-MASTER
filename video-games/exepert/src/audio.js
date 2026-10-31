/* EXEPERT sound: everything is synthesised in WebAudio (no files). Remote sounds are positioned in 3D. */
import { settings } from './settings.js';

export class Audio {
  constructor(){ this.ctx = null; this.noiseBuf = null; this.last = {}; }

  unlock(){
    if (this.ctx){ if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.comp.connect(this.master);
    this.setVolume(settings.vol);
    const len = ctx.sampleRate; this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambience();
  }

  setVolume(v){ if (this.master) this.master.gain.value = v * 0.8; }

  listener(x, y, z, yaw){
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX){ L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(fz, t); L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t); }
    else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  }

  /* Output node: straight to the mix, or through a 3D panner when a position is given. */
  out(pos, gain = 1){
    const g = this.ctx.createGain(); g.gain.value = gain;
    if (pos){
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 250; p.rolloffFactor = 1.2;
      if (p.positionX){ p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(...pos);
      g.connect(p).connect(this.comp);
    } else g.connect(this.comp);
    return g;
  }

  noise(dest, {dur = 0.1, vol = 1, type = 'lowpass', freq = 2000, q = 0.7, to = null, at = 0}){
    const t = this.ctx.currentTime + at, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; s.loop = true; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  tone(dest, {freq = 440, to = null, dur = 0.1, vol = 0.5, type = 'sine', at = 0}){
    const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  /* Rate-limit identical sounds so a burst of events does not stack into noise. */
  gate(key, ms){ const now = performance.now(); if (this.last[key] && now - this.last[key] < ms) return false; this.last[key] = now; return true; }

  shot(w, pos = null){
    if (!this.ctx) return;
    const d = this.out(pos, pos ? 1.4 : 0.9);
    if (w === 'breach'){ this.noise(d, {dur:0.11, vol:0.9, freq:3200, to:500}); this.tone(d, {freq:140, to:60, dur:0.09, vol:0.7, type:'triangle'}); }
    else if (w === 'kestrel'){ this.tone(d, {freq:1500, to:160, dur:0.16, vol:0.5, type:'sawtooth'}); this.tone(d, {freq:740, to:90, dur:0.14, vol:0.35, type:'square'}); }
    else if (w === 'longwire'){ this.noise(d, {dur:0.5, vol:1, freq:6000, to:300, type:'bandpass', q:0.6}); this.tone(d, {freq:2200, to:120, dur:0.45, vol:0.4, type:'sawtooth'}); this.tone(d, {freq:60, to:30, dur:0.4, vol:0.8}); }
    else if (w === 'scatter'){ this.noise(d, {dur:0.28, vol:1.1, freq:2400, to:200}); this.tone(d, {freq:90, to:40, dur:0.22, vol:0.9, type:'triangle'}); }
  }
  charge(){ if (!this.ctx) return; this.tone(this.out(null, 0.4), {freq:300, to:2400, dur:0.5, vol:0.25, type:'sawtooth'}); }
  dry(){ if (!this.ctx) return; this.tone(this.out(null, 0.5), {freq:1800, dur:0.03, vol:0.3, type:'square'}); }
  reload(pos){ if (!this.ctx) return; const d = this.out(pos, 0.6); this.tone(d, {freq:900, dur:0.04, vol:0.4, type:'square'}); this.tone(d, {freq:600, dur:0.05, vol:0.4, type:'square', at:0.25}); this.noise(d, {dur:0.06, vol:0.4, freq:3000, at:0.5}); }
  swap(){ if (!this.ctx) return; this.noise(this.out(null, 0.4), {dur:0.08, vol:0.5, freq:4000, type:'highpass'}); }
  overheat(){ if (!this.ctx) return; this.noise(this.out(null, 0.6), {dur:0.8, vol:0.6, freq:5000, to:800, type:'highpass'}); }
  step(pos, wet){ if (!this.ctx || !this.gate(pos ? 'stepR' : 'step', 120)) return; this.noise(this.out(pos, pos ? 0.5 : 0.25), {dur:wet ? 0.12 : 0.05, vol:0.6, freq:wet ? 900 : 1600, type:'bandpass', q:1.2}); }
  jump(pos, double){ if (!this.ctx) return; const d = this.out(pos, 0.5); if (double){ this.noise(d, {dur:0.25, vol:0.7, freq:600, to:2400, type:'bandpass'}); } else this.noise(d, {dur:0.08, vol:0.5, freq:1200}); }
  dash(pos){ if (!this.ctx) return; const d = this.out(pos, 0.8); this.noise(d, {dur:0.3, vol:0.9, freq:300, to:6000, type:'bandpass', q:2}); this.tone(d, {freq:180, to:900, dur:0.25, vol:0.3, type:'sawtooth'}); }
  land(v){ if (!this.ctx || v < 6) return; this.noise(this.out(null, 0.5), {dur:0.1, vol:Math.min(1, v / 14), freq:500}); }
  hit(head, kill){
    if (!this.ctx) return; const d = this.out(null, 0.7);
    if (kill){ this.tone(d, {freq:880, dur:0.08, vol:0.5, type:'square'}); this.tone(d, {freq:1320, dur:0.18, vol:0.5, type:'square', at:0.07}); }
    else if (head){ this.tone(d, {freq:2600, dur:0.09, vol:0.4, type:'triangle'}); }
    else if (this.gate('hit', 40)) this.tone(d, {freq:1900, dur:0.04, vol:0.3, type:'square'});
  }
  hurt(){ if (!this.ctx || !this.gate('hurt', 90)) return; const d = this.out(null, 0.8); this.tone(d, {freq:110, to:55, dur:0.18, vol:0.8, type:'triangle'}); this.noise(d, {dur:0.12, vol:0.4, freq:700}); }
  death(){ if (!this.ctx) return; const d = this.out(null, 0.8); this.tone(d, {freq:400, to:40, dur:1.2, vol:0.6, type:'sawtooth'}); }
  boom(pos){ if (!this.ctx) return; const d = this.out(pos, 2.2); this.noise(d, {dur:1.1, vol:1.2, freq:1800, to:80}); this.tone(d, {freq:70, to:25, dur:0.9, vol:1}); }
  impact(pos){ if (!this.ctx || !this.gate('imp', 30)) return; this.noise(this.out(pos, 0.35), {dur:0.05, vol:0.5, freq:4000, type:'highpass'}); }
  ui(){ if (!this.ctx) return; this.tone(this.out(null, 0.3), {freq:1200, dur:0.04, vol:0.3, type:'square'}); }
  alarm(){ if (!this.ctx || !this.gate('alarm', 900)) return; const d = this.out(null, 0.5); this.tone(d, {freq:620, dur:0.18, vol:0.4, type:'square'}); this.tone(d, {freq:520, dur:0.18, vol:0.4, type:'square', at:0.2}); }
  capture(good){ if (!this.ctx) return; const d = this.out(null, 0.6); const a = good ? [660, 880, 1320] : [660, 440, 330]; a.forEach((f, i) => this.tone(d, {freq:f, dur:0.14, vol:0.4, type:'square', at:i * 0.12})); }

  ambience(){
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0.06; g.connect(this.comp);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); s.buffer = this.noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = 380;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 160; lfo.connect(lg).connect(f.frequency); lfo.start();
    s.connect(f).connect(g); s.start();
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = 46; og.gain.value = 0.25; o.connect(og).connect(g); o.start();
  }
}
