/* EXEPERT HUD: DOM instruments over the canvas (compass, minimap, feed, vitals, weapon, markers, scoreboard). */
import { WEAPONS } from '../sim/weapons.js';
import { TEAMS, FFA_COLORS } from '../sim/constants.js';
import { FLAG } from '../sim/room-core.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const CARD = {0:'N', 45:'NE', 90:'E', 135:'SE', 180:'S', 225:'SW', 270:'W', 315:'NW'};

export function playerColor(p, mode){
  if (!p) return '#e6edf7';
  if (mode && mode.teams === 0) return FFA_COLORS[p.id % FFA_COLORS.length];
  return p.team === 0 ? TEAMS[0].color : p.team === 1 ? TEAMS[1].color : '#e6edf7';
}

export class Hud {
  constructor(world){
    this.world = world;
    this.root = $('hud');
    this.el = {
      tape:$('compassTape'), deg:$('compassDeg'), obj:$('objective'), feed:$('feed'), cross:$('crosshair'), hit:$('hitmark'),
      ring:$('damageRing'), vig:$('vignette'), center:$('centerMsg'), toast:$('toast'), storm:$('storm'), stormT:$('stormT'),
      hp:$('hpFill'), shield:$('shieldFill'), hpNum:$('hpNum'), dashCd:$('dashCd'), abDash:$('abDash'), nadeN:$('nadeN'),
      slots:$('slots'), wName:$('wName'), ammo:$('ammo'), mag:$('mag'), heat:$('heat'), heatFill:$('heatFill'), wState:$('wState'),
      extra:$('extraHud'), sb:$('scoreboard'), sbIn:$('scoreboardInner'), mm:$('minimap')
    };
    this.markers = document.createElement('div'); this.markers.id = 'markers'; this.root.prepend(this.markers);
    this.markerEls = new Map();
    this.mmCtx = this.el.mm.getContext('2d');
    this.buildCompass();
    this.buildMapImage();
    this.toastT = 0; this.centerKey = '';
  }

  show(v){ this.root.hidden = !v; }

  buildCompass(){
    let html = '';
    for (let r = 0; r < 3; r++) for (let d = 0; d < 360; d += 5){
      const card = CARD[d], major = d % 15 === 0;
      html += `<span class="${major ? 'major' : ''} ${card ? 'card' : ''}">${card || (d % 45 === 0 ? d : '')}</span>`;
    }
    this.el.tape.innerHTML = html;
  }

  compass(yaw){
    // yaw 0 faces -z (north), positive yaw turns left (west)
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.el.tape.style.transform = `translateX(${-(360 + deg) / 5 * 20 - 10}px)`;
    this.el.deg.textContent = String(Math.round(deg) % 360).padStart(3, '0');
  }

  /* Top-down map: contours and structure footprints rendered once (1 px = 1 m). */
  buildMapImage(){
    const W = this.world, B = W.bounds, w = Math.round(B.maxX - B.minX), h = Math.round(B.maxZ - B.minZ);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#03060d'; x.fillRect(0, 0, w, h);
    const st = 2, nx = Math.floor(w / st), nz = Math.floor(h / st), g = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) g[j * (nx + 1) + i] = W.maskAt(B.minX + i * st, B.minZ + j * st) > 0.3 ? W.ground(B.minX + i * st, B.minZ + j * st) : -1;
    for (let lv = 2; lv < W.maxH; lv += 2){
      x.strokeStyle = lv % 10 === 0 ? 'rgba(134,196,255,.55)' : 'rgba(44,111,224,.35)'; x.lineWidth = 1; x.beginPath();
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++){
        const a = g[j * (nx + 1) + i], b = g[j * (nx + 1) + i + 1], cc = g[(j + 1) * (nx + 1) + i + 1], d = g[(j + 1) * (nx + 1) + i];
        if (a < 0 || b < 0 || cc < 0 || d < 0) continue;
        const p = [], x0 = i * st, y0 = j * st;
        if ((a < lv) !== (b < lv)) p.push(x0 + (lv - a) / (b - a) * st, y0);
        if ((b < lv) !== (cc < lv)) p.push(x0 + st, y0 + (lv - b) / (cc - b) * st);
        if ((cc < lv) !== (d < lv)) p.push(x0 + st - (lv - cc) / (d - cc) * st, y0 + st);
        if ((d < lv) !== (a < lv)) p.push(x0, y0 + st - (lv - d) / (a - d) * st);
        if (p.length >= 4){ x.moveTo(p[0], p[1]); x.lineTo(p[2], p[3]); }
      }
      x.stroke();
    }
    x.fillStyle = 'rgba(58,155,255,.18)';
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++){ const wx = B.minX + i * st, wz = B.minZ + j * st; if (W.waterAt(wx, wz) > W.ground(wx, wz)) x.fillRect(i * st, j * st, st, st); }
    x.fillStyle = 'rgba(169,212,255,.55)';
    for (const it of W.collide.items){
      x.save(); x.translate(it.x - B.minX, it.z - B.minZ);
      if (it.kind === 'box'){ x.rotate(it.rot); x.fillRect(-it.w / 2, -it.d / 2, it.w, it.d); }
      else { x.beginPath(); x.arc(0, 0, Math.max(it.r, 0.6), 0, Math.PI * 2); x.fill(); }
      x.restore();
    }
    this.mapImg = c;
  }

  minimap(me, players, sector, opts = {}){
    const x = this.mmCtx, S = 200, B = this.world.bounds, zoom = opts.zoom || 1.15;
    x.save(); x.clearRect(0, 0, S, S);
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); x.clip();
    x.fillStyle = 'rgba(2,6,12,.85)'; x.fillRect(0, 0, S, S);
    x.translate(S / 2, S / 2); x.rotate(me.yaw); x.scale(zoom, zoom); x.translate(-(me.x - B.minX), -(me.z - B.minZ));
    x.drawImage(this.mapImg, 0, 0);
    if (sector && Number.isFinite(sector.r)){ x.strokeStyle = 'rgba(255,42,85,.8)'; x.lineWidth = 2 / zoom; x.beginPath(); x.arc(sector.x - B.minX, sector.z - B.minZ, sector.r, 0, Math.PI * 2); x.stroke(); }
    for (const o of opts.objectives || []){
      x.fillStyle = o.color; x.strokeStyle = o.color; x.lineWidth = 1.5 / zoom;
      x.beginPath(); x.arc(o.x - B.minX, o.z - B.minZ, o.r || 4, 0, Math.PI * 2); x.globalAlpha = 0.18; x.fill(); x.globalAlpha = 1; x.stroke();
    }
    for (const p of players){
      if (!(p.flags & FLAG.ALIVE) || p.id === me.id) continue;
      const enemy = p.enemy;
      if (enemy && !(p.flags & FLAG.FIRING) && !p.spotted) continue;
      x.save(); x.translate(p.x - B.minX, p.z - B.minZ);
      x.fillStyle = enemy ? '#ff4466' : p.color;
      if (enemy){ x.beginPath(); x.arc(0, 0, 3.2 / zoom * 1.4, 0, Math.PI * 2); x.fill(); }
      else { x.rotate(-p.yaw); x.beginPath(); x.moveTo(0, -4.5 / zoom * 1.4); x.lineTo(3 / zoom * 1.4, 3.5 / zoom * 1.4); x.lineTo(-3 / zoom * 1.4, 3.5 / zoom * 1.4); x.fill(); }
      x.restore();
    }
    x.restore();
    // me
    x.fillStyle = '#d4ff3a'; x.beginPath(); x.moveTo(S / 2, S / 2 - 7); x.lineTo(S / 2 + 5, S / 2 + 5); x.lineTo(S / 2, S / 2 + 2); x.lineTo(S / 2 - 5, S / 2 + 5); x.fill();
  }

  vitals(me){
    const hp = Math.max(0, me.hp);
    this.el.hp.style.width = `calc(${hp}% - 2px)`;
    this.el.hp.classList.toggle('low', hp < 35);
    this.el.hpNum.textContent = Math.ceil(hp);
    this.el.shield.style.width = `${Math.min(100, me.sh || 0)}%`;
    const cd = me.dashCd || 0;
    this.el.dashCd.style.transform = `scaleX(${Math.min(1, cd / 7)})`;
    this.el.abDash.classList.toggle('ready', cd <= 0);
    this.el.nadeN.textContent = me.n ?? 0;
    this.el.vig.style.boxShadow = `inset 0 0 ${120 + (100 - hp) * 1.4}px rgba(255,30,60,${Math.max(0, (60 - hp) / 90)})`;
  }

  weapon(me){
    const w = WEAPONS[me.w]; if (!w) return;
    const key = me.l.join(',') + me.w;
    if (this.slotKey !== key){
      this.slotKey = key;
      this.el.slots.innerHTML = me.l.map((id, i) => `<span class="${id === me.w ? 'on' : ''}">${i + 1} ${WEAPONS[id].name.split(' ')[0]}</span>`).join('');
      this.el.wName.textContent = w.name;
    }
    if (w.mag){
      this.el.ammo.textContent = me.a ?? 0; this.el.mag.textContent = `/ ${w.mag}`;
      this.el.ammo.parentElement.classList.toggle('low', (me.a ?? 0) <= Math.ceil(w.mag * 0.2));
      this.el.heat.hidden = true;
    } else {
      this.el.ammo.textContent = Math.round((me.ht || 0) * 100); this.el.mag.textContent = '% HEAT';
      this.el.ammo.parentElement.classList.toggle('low', !!me.oh);
      this.el.heat.hidden = false; this.el.heatFill.style.width = `${(me.ht || 0) * 100}%`; this.el.heat.classList.toggle('over', !!me.oh);
    }
    this.el.wState.textContent = me.rl > 0 ? 'RELOADING' : me.oh ? 'OVERHEATED' : me.sw > 0 ? 'SWAPPING' : (w.mag && me.a === 0) ? 'R TO RELOAD' : '';
    this.el.cross.classList.toggle('rail', w.id === 'longwire');
  }

  crosshair(spreadPx, ads){
    this.el.cross.style.setProperty('--g', `${Math.round(6 + spreadPx)}px`);
    this.el.cross.classList.toggle('ads', !!ads);
  }

  hitmarker(head, kill, dmg){
    const h = this.el.hit;
    h.className = 'hitmark'; void h.offsetWidth;
    h.className = `hitmark on${head ? ' head' : ''}${kill ? ' kill' : ''}`;
    if (dmg){
      const n = document.createElement('span'); n.className = `dmgnum${head ? ' head' : ''}`; n.textContent = dmg;
      n.style.left = `${14 + Math.random() * 16}px`; n.style.top = `${-24 - Math.random() * 10}px`;
      this.el.cross.appendChild(n); setTimeout(() => n.remove(), 700);
    }
  }

  hurt(angle){
    const i = document.createElement('i');
    i.style.transform = `rotate(${angle}rad)`;
    this.el.ring.appendChild(i); setTimeout(() => i.remove(), 1200);
  }

  feed(text, mine){
    const li = document.createElement('li'); if (mine) li.className = 'me'; li.innerHTML = text;
    this.el.feed.prepend(li);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => li.remove(), 6500);
  }

  killLine(k, v, wid, head, mode){
    const name = p => p ? `<b style="color:${playerColor(p, mode)}">${esc(p.name)}</b>` : '';
    const wn = wid === 'storm' ? 'RELAY STORM' : wid === 'frag' ? 'FRAG' : wid === 'fall' ? 'FALL' : WEAPONS[wid]?.name.split(' ')[0] || '';
    return `${k ? name(k) : ''}<span class="w">${esc(wn)}</span>${head ? '<span class="hs">◆</span>' : ''}${name(v)}`;
  }

  center(html, key){
    if (this.centerKey === key) return;
    this.centerKey = key; this.el.center.innerHTML = html || '';
  }

  toast(html, t = 1.6){ this.el.toast.innerHTML = `<b>${html}</b>`; this.toastT = t; }
  tick(dt){ if (this.toastT > 0){ this.toastT -= dt; if (this.toastT <= 0) this.el.toast.innerHTML = ''; } }

  storm(t){ this.el.storm.hidden = !(t > 0); if (t > 0) this.el.stormT.textContent = t > 5 ? '!' : Math.ceil(5 - t); }

  objective(html){ if (this.objHtml !== html){ this.objHtml = html; this.el.obj.innerHTML = html; } }
  extra(html){ if (this.extraHtml !== html){ this.extraHtml = html; this.el.extra.innerHTML = html; } }

  marker(key, sx, sy, html, cls){
    let el = this.markerEls.get(key);
    if (!el){ el = document.createElement('div'); this.markers.appendChild(el); this.markerEls.set(key, el); }
    el.className = cls; el.style.left = `${sx}px`; el.style.top = `${sy}px`;
    if (el.dataset.h !== html){ el.dataset.h = html; el.innerHTML = html; }
    el.dataset.seen = '1';
  }
  sweepMarkers(){
    for (const [k, el] of this.markerEls){ if (el.dataset.seen !== '1'){ el.remove(); this.markerEls.delete(k); } else el.dataset.seen = '0'; }
  }

  scoreboard(show, roster, mode, myId, head){
    this.el.sb.hidden = !show;
    if (!show) return;
    const rows = list => list.map(r => `<tr class="${r.id === myId ? 'me' : ''}${r.alive ? '' : ' dead'}"><td>${esc(r.name)}${r.bot ? '<span class="bot">BOT</span>' : ''}${r.host ? '<span class="bot">HOST</span>' : ''}</td><td class="n">${r.kills}</td><td class="n">${r.deaths}</td><td class="n">${r.assists}</td><td class="n">${r.score}</td><td class="n">${r.bot ? '' : r.ping}</td></tr>`).join('');
    const table = list => `<table class="sb"><thead><tr><th>RUNNER</th><th class="n">K</th><th class="n">D</th><th class="n">A</th><th class="n">SCORE</th><th class="n">PING</th></tr></thead><tbody>${rows(list)}</tbody></table>`;
    let body;
    if (mode.teams){
      body = [0, 1].map(t => `<div class="sb-team" style="color:${TEAMS[t].color}">${TEAMS[t].name}</div>${table(roster.filter(r => r.team === t).sort((a, b) => b.score - a.score))}`).join('');
    } else body = table([...roster].sort((a, b) => b.kills - a.kills || b.score - a.score));
    this.el.sbIn.innerHTML = `<div class="sb-head"><span>${esc(mode.name)}</span><span>${head || ''}</span></div>${body}`;
  }
}

export { esc, mmss };
