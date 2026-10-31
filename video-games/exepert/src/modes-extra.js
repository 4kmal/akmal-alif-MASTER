/* Client side of the objective modes: Uplink relays (beacons, capture HUD, deploy picker) and
   Extraction (loot markers, interaction prompts, lifts and the dropship). */
import * as THREE from 'three';
import { TEAMS, teamInfo } from '../sim/constants.js';
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

/* ------------------------------------------------------------ Extraction */
const LOOT_ICON = {cache:'◆', log:'▲', crate:'■', pack:'✚'};
const LOOT_NAME = {cache:'SUPPLY CACHE', log:'DATA LOG', crate:'CRATE', pack:'DROPPED PACK'};
const LIFT_STATE = ['IDLE', 'INBOUND', 'BOARDING', 'DEPARTED'];
const money = v => '$' + Math.round(v).toLocaleString('en-US');

registerModeUI('extraction', {
  objective(g, m, tl){
    const b = m.b || [], mine = g.myTeam, lead = Math.max(0, ...b);
    return `<span class="team" style="color:${teamInfo(mine, g.mode).color}">◆ ${money(b[mine] || 0)}</span><span class="time">${mmss(tl)} · RELAY COLLAPSE</span><span class="team">LEAD ${money(lead)}</span>`;
  },

  loot(g){
    const taken = new Set(g.modeHud?.taken || []);
    return (g.modeData?.loot || []).filter(l => !taken.has(l[0]));
  },
  exfils(g){ return g.modeData?.ex || []; },

  mapObjectives(g){
    const st = g.modeHud?.x || [];
    return this.exfils(g).map(([code, name, x, y, z], i) => ({x, z, r:9, color:st[i]?.[0] === 2 ? '#d4ff3a' : st[i]?.[0] === 1 ? '#ffb340' : '#a9d4ff'}));
  },

  markers(g, add){
    const st = g.modeHud?.x || [];
    for (const [i, [code, name, x, y, z]] of this.exfils(g).entries()){
      const d = Math.round(Math.hypot(x - g.me.x, z - g.me.z)), [s, t] = st[i] || [0, 0];
      const label = s === 1 ? ` · LIFT ${t}s` : s === 2 ? ` · BOARD ${t}s` : s === 3 ? ' · GONE' : '';
      add('x' + i, x, y + 6, z, `<i></i>${esc(code.split('/')[1] || code)} · ${d}m${label}`, `marker ${s === 2 ? 'obj' : s === 1 ? 'ping' : 'ally'}`);
    }
    for (const [id, kind, x, y, z, value] of this.loot(g)){
      const d = Math.hypot(x - g.me.x, z - g.me.z);
      if (d > (kind === 'crate' ? 35 : 80)) continue;
      add('l' + id, x, y + 1.6, z, `${LOOT_ICON[kind]} ${money(value)} · ${Math.round(d)}m`, `marker ${kind === 'pack' ? 'enemy' : kind === 'log' ? 'obj' : 'ping'}`);
    }
  },

  extra(g){
    const pd = g.personalData; if (!pd) return '';
    const [items, value, slots] = pd.pk || [0, 0, 8];
    let html = `<div class="chip">PACK <b>${items}/${slots}</b> · ${money(value)} · BANKED <b>${money(pd.bk || 0)}</b></div>`;
    if (pd.it){
      const [kind, name, pct] = pd.it;
      const verb = kind === 'lift' ? 'CALL LIFT' : kind === 'cache' ? 'OPEN' : 'TAKE';
      html += `<div class="chip">HOLD <b>E</b> · ${verb} ${esc(kind === 'lift' ? name : LOOT_NAME[kind])} · ${pct}%</div>`;
    }
    const st = g.modeHud?.x || [];
    this.exfils(g).forEach(([code], i) => { const [s, t] = st[i] || [0, 0]; if (s === 1 || s === 2) html += `<div class="chip">${esc(code.split('/')[1] || code)} · ${LIFT_STATE[s]} <b>${t}s</b></div>`; });
    return html;
  },

  /* Lift beams and a hovering dropship at active exfils; spinning holo loot nearby. */
  update(g, dt){
    const ex = this.exfils(g);
    if (ex.length && !g.lifts){
      g.lifts = ex.map(([, , x, y, z]) => {
        const grp = new THREE.Group(); grp.position.set(x, y, z);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 200, 16, 1, true), new THREE.MeshBasicMaterial({color:0xffb340, transparent:true, opacity:0.18, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, toneMapped:false}));
        beam.position.y = 100;
        const ring = new THREE.Mesh(new THREE.RingGeometry(8.6, 9, 64), new THREE.MeshBasicMaterial({color:0xa9d4ff, transparent:true, opacity:0.5, side:THREE.DoubleSide, depthWrite:false, toneMapped:false}));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
        const ship = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 11), new THREE.MeshStandardMaterial({color:0x1b2130, metalness:0.6, roughness:0.4}));
        const lights = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 11.2), new THREE.MeshBasicMaterial({color:0xffb340, toneMapped:false}));
        lights.position.y = -0.8; ship.add(hull, lights);
        for (const sx of [-3.2, 3.2]){ const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 2.4, 12), hull.material); pod.position.set(sx, 0, 2.5); pod.rotation.x = Math.PI / 2; ship.add(pod); }
        grp.add(beam, ring, ship); g.scene.add(grp);
        return {grp, beam, ring, ship};
      });
      g.lootMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({color:0xffffff, toneMapped:false}), 128);
      g.lootMesh.frustumCulled = false; g.scene.add(g.lootMesh);
    }
    const st = g.modeHud?.x || [];
    g.lifts?.forEach((l, i) => {
      const [s, t] = st[i] || [0, 0];
      l.beam.visible = s === 1 || s === 2;
      l.beam.material.color.setHex(s === 2 ? 0xd4ff3a : 0xffb340);
      const want = s === 2 ? 7 : s === 1 ? 60 + t * 2 : 260;
      l.ship.visible = s === 1 || s === 2;
      l.ship.position.y += (want - l.ship.position.y) * Math.min(1, dt * 1.5);
      l.ring.material.color.setHex(s === 2 ? 0xd4ff3a : 0xa9d4ff);
    });
    if (g.lootMesh){
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      let n = 0;
      for (const [id, kind, x, y, z] of this.loot(g)){
        if (n >= 128 || Math.hypot(x - g.me.x, z - g.me.z) > 90) continue;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.time * 1.5 + id);
        m4.compose(new THREE.Vector3(x, y + 0.9 + Math.sin(g.time * 2 + id) * 0.12, z), q, new THREE.Vector3(1, kind === 'cache' ? 1.6 : 1, 1));
        g.lootMesh.setMatrixAt(n, m4);
        g.lootMesh.setColorAt(n, c.set(kind === 'cache' ? '#ffb340' : kind === 'log' ? '#d4ff3a' : kind === 'pack' ? '#ff2a8a' : '#a9d4ff'));
        n++;
      }
      g.lootMesh.count = n; g.lootMesh.instanceMatrix.needsUpdate = true; if (g.lootMesh.instanceColor) g.lootMesh.instanceColor.needsUpdate = true;
    }
  },

  dispose(g){
    for (const l of g.lifts || []) l.grp.removeFromParent();
    g.lootMesh?.removeFromParent();
    g.lifts = null; g.lootMesh = null;
  },

  event(g, e){
    if (e.e === 'loot' && e.p === g.myId){ g.hud.toast(`+${money(e.v)} ${LOOT_NAME[e.k]}`); g.audio.capture(true); }
    if (e.e === 'extract'){
      const who = g.roster.get(e.p);
      g.hud.feed(`<b style="color:${teamInfo(who?.team, g.mode).color}">${esc(who?.name || '???')}</b><span class="w">EXTRACTED</span><b>${money(e.v)}</b>`, e.p === g.myId);
      if (e.p === g.myId){ g.hud.toast(`EXTRACTED · ${money(e.v)} BANKED`, 3); g.audio.capture(true); }
    }
    if (e.e === 'lift'){
      const code = (this.exfils(g)[e.i]?.[0] || '').split('/')[1] || 'EX';
      if (e.s === 'called'){ g.hud.toast(`LIFT CALLED AT ${code} · ${e.t}s`); g.audio.alarm(); }
      if (e.s === 'here'){ g.hud.toast(`LIFT AT ${code} · BOARD NOW`); g.audio.alarm(); }
    }
    if (e.e === 'drop' && e.p === g.myId) g.hud.toast(`PACK DROPPED · ${money(e.v)} LOST`);
  }
});
