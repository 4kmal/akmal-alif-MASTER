/* Client side of the objective modes: Uplink relays (beacons, capture HUD, deploy picker). */
import * as THREE from 'three';
import { TEAMS } from '../sim/constants.js';
import { FLAG } from '../sim/room-core.js';
import { registerModeUI } from './modes-ui.js';
import { esc, mmss } from './hud.js';

const ownerColor = o => o === 0 ? TEAMS[0].color : o === 1 ? TEAMS[1].color : '#d4ff3a';
const DEPLOY_KEYS = {w1:0, w2:1, n3:2, n4:3, n5:4, n6:5, n7:6};

registerModeUI('uplink', {
  objective(g, m, tl){
    const mine = g.myTeam, t = m.t || [0, 0];
    const bar = team => `<span class="team ${team === 0 ? 'van' : 'syn'}" style="min-width:96px">${team === mine ? '◆ ' : ''}${t[team]}</span>`;
    const pts = (m.p || []).map(([o, cap, contest], i) => `<span class="pt${contest ? ' contest' : ''}" data-o="${o}" title="${Math.abs(cap)}%">${'ABCDEFG'[i]}</span>`).join('');
    return `${bar(0)}<span class="pts">${pts}</span>${bar(1)}<span class="time">${mmss(tl)}</span>`;
  },

  points(g){ return g.modeData?.pts || []; },

  mapObjectives(g){
    const pts = this.points(g), st = g.modeHud?.p || [];
    return pts.map(([letter, , x, , z, r], i) => ({x, z, r, color:ownerColor(st[i]?.[0] ?? -1)}));
  },

  markers(g, add){
    const st = g.modeHud?.p || [];
    for (const [i, [letter, name, x, y, z]] of this.points(g).entries()){
      const d = Math.round(Math.hypot(x - g.me.x, z - g.me.z));
      const o = st[i]?.[0] ?? -1, cls = o === g.myTeam ? 'ally' : o === -1 ? 'obj' : 'enemy';
      add('u' + i, x, y + 7, z, `<i></i>${letter} · ${d}m`, `marker ${cls}`);
    }
  },

  extra(g){
    const st = g.modeHud?.p || [], pts = this.points(g);
    if (!g.meAlive){
      const sel = g.deployPick ?? 'auto';
      const rows = pts.map(([letter, name], i) => {
        const ok = st[i]?.[0] === g.myTeam && !st[i]?.[2];
        return `<div class="chip" style="opacity:${ok ? 1 : 0.35}">${i + 1} · ${letter} ${esc(name)}${sel === i ? ' <b>◆</b>' : ''}</div>`;
      }).join('');
      return `<div class="chip"><b>DEPLOY</b> · N AUTO${sel === 'auto' ? ' <b>◆</b>' : ''} · B BASE${sel === 'base' ? ' <b>◆</b>' : ''}</div>${rows}`;
    }
    for (const [i, [letter, name, x, y, z, r]] of pts.entries()){
      if (Math.hypot(x - g.me.x, z - g.me.z) > r) continue;
      const [o, cap, contest] = st[i] || [-1, 0, 0];
      const mineCap = g.myTeam === 0 ? -cap : cap;
      const label = contest ? 'CONTESTED' : o === g.myTeam && mineCap >= 100 ? 'SECURED' : mineCap > 0 ? 'CAPTURING' : 'NEUTRALISING';
      return `<div class="chip">${label} <b>${letter}</b> · ${esc(name)} · ${Math.round((mineCap + 100) / 2)}%</div>`;
    }
    return '';
  },

  input(g, inp){
    if (g.meAlive) return;
    let at = null;
    for (const [k, i] of Object.entries(DEPLOY_KEYS)) if (inp.edges.has(k)) at = i;
    if (inp.edges.has('base')) at = 'base';
    if (inp.edges.has('auto')) at = 'auto';
    if (at != null){ g.deployPick = at; g.send({t:'deploy', at}); g.audio.ui(); }
  },

  /* Light beams over every relay, coloured by owner. */
  update(g){
    const pts = this.points(g); if (!pts.length) return;
    if (!g.beacons){
      g.beacons = pts.map(([, , x, y, z, r]) => {
        const grp = new THREE.Group();
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 160, 12, 1, true), new THREE.MeshBasicMaterial({color:0xd4ff3a, transparent:true, opacity:0.22, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, toneMapped:false}));
        beam.position.set(x, y + 80, z);
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 72), new THREE.MeshBasicMaterial({color:0xd4ff3a, transparent:true, opacity:0.6, side:THREE.DoubleSide, depthWrite:false, toneMapped:false}));
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.3, z);
        grp.add(beam, ring); g.scene.add(grp);
        return {grp, beam, ring};
      });
    }
    const st = g.modeHud?.p || [];
    g.beacons.forEach((b, i) => {
      const [o, , contest] = st[i] || [-1, 0, 0];
      const c = new THREE.Color(ownerColor(o));
      b.beam.material.color.copy(c); b.ring.material.color.copy(c);
      b.beam.material.opacity = contest ? 0.12 + 0.15 * (Math.sin(g.time * 10) * 0.5 + 0.5) : 0.22;
    });
  },

  dispose(g){ for (const b of g.beacons || []){ b.grp.removeFromParent(); b.beam.geometry.dispose(); b.beam.material.dispose(); b.ring.geometry.dispose(); b.ring.material.dispose(); } g.beacons = null; },

  event(g, e){
    if (e.e === 'cap'){
      const letter = 'ABCDEFG'[e.i];
      if (e.o === g.myTeam){ g.hud.toast(`RELAY ${letter} SECURED`); g.audio.capture(true); }
      else if (e.was === g.myTeam){ g.hud.toast(`RELAY ${letter} LOST`); g.audio.capture(false); }
    }
  }
});

export { ownerColor, FLAG };
