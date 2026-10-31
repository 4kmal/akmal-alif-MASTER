/* EXEPERT boot: builds Kessler IV, runs the menus and starts solo or online matches. */
import { buildWorld } from '../../kessler-world/world.js';
import { MODES, MODE_IDS } from '../sim/modes/index.js';
import { WEAPONS, WEAPON_IDS } from '../sim/weapons.js';
import { TEAMS, sanitizeName, teamInfo } from '../sim/constants.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { LocalTransport } from './net/local-transport.js';
import { settings, saveSettings } from './settings.js';
import { esc } from './hud.js';
import './modes-extra.js';
import { createGamingMatchTracker } from '../../../js/gaming-analytics.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1' && window.parent !== window;
const SECTOR_INFO = {
  bastion:{name:'BASTION', blurb:'Refinery plateau. Dense buildings, short sightlines.'},
  ridgeback:{name:'RIDGEBACK', blurb:'Shale ridges and a blasted cut. Long lanes, high ground.'},
  silt:{name:'SILT BASIN', blurb:'Drowned flats and a causeway. Slow water, exposed decks.'},
  full:{name:'ALL OF KESSLER IV', blurb:'Bastion, Ridgeback and Silt Basin stitched into one map.'}
};
const TIPS = [
  'Sprint, then press C to slide. Jump out of a slide to keep the speed.',
  'Run alongside a wall in the air to wall-run. Jump again to kick off it.',
  'Q is a phase dash: eight metres in a quarter second. It recharges in seven.',
  'Enemies show on your minimap while they are shooting.',
  'Z pings whatever you are aiming at for your squad.',
  'The LONGWIRE fires when it is fully charged. Hold the trigger.',
  'Hold TAB for scores. V swaps to a third-person view.',
  'Step outside the sector and the relay storm starts burning you after five seconds.'
];

const audio = new Audio();
let world = null, input = null, game = null, view = 'home', backView = 'home', online = null, gamingRun = null;

function show(id, on){ $(id).hidden = !on; }
function go(v){
  if (v === 'back') v = backView;
  if (v === 'settings' || v === 'loadout') backView = game ? 'pause' : 'home';
  view = v;
  document.querySelectorAll('[data-view]').forEach(s => { s.hidden = s.dataset.view !== v; });
  const first = document.querySelector(`[data-view="${v}"] button, [data-view="${v}"] input`);
  first?.focus({preventScroll:true});
  if (v === 'lobby') renderLobby();
}
function note(text){ $('menuNote').textContent = text || ''; }

/* ------------------------------------------------------------ boot */
async function boot(){
  $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  await new Promise(r => setTimeout(r, 40)); // let the loading screen paint (rAF would stall in a background tab)
  const t0 = performance.now();
  try {
    world = buildWorld({visual:true, progress:p => { $('loadBar').style.width = `${Math.round(p * 100)}%`; }});
  } catch (e){
    console.error(e); $('loadStatus').textContent = 'THE MAP FAILED TO GENERATE. RELOAD TO TRY AGAIN.'; return;
  }
  $('loadBar').style.width = '100%';
  $('loadStatus').textContent = `SURFACE READY · ${Math.round(performance.now() - t0)} MS`;
  if (!hasWebGL()){ $('loadStatus').textContent = 'EXEPERT NEEDS WEBGL. TRY A RECENT DESKTOP BROWSER.'; return; }
  input = new Input($('gl'));
  input.onLockChange = locked => onLock(locked);
  setupMenu();
  show('loading', false); show('menu', true); go('home');
  if (EMBED) parent.postMessage({type:'exepert:ready'}, location.origin);
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) go('controls-touch');
  const room = (params.get('room') || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 5);
  if (room){ $('joinCode').value = room; startOnline('join', room); }
  else if (params.get('squad') === '1') startOnline('create');
}

function hasWebGL(){ try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; } }

/* ------------------------------------------------------------ menu */
function setupMenu(){
  $('callsign').value = settings.callsign;
  $('callsign').addEventListener('change', () => { settings.callsign = sanitizeName($('callsign').value); $('callsign').value = settings.callsign; saveSettings(); });
  $('exitBtn').hidden = !EMBED; $('exitBtn2').hidden = !EMBED;

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-go],[data-act]'); if (!b) return;
    audio.unlock(); audio.ui();
    if (b.dataset.go) go(b.dataset.go);
    else act(b.dataset.act, b);
  });
  $('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') startOnline('join', $('joinCode').value); });

  // mode + sector
  const modeBox = $('modeChoice'), secBox = $('sectorChoice');
  const renderModes = () => {
    modeBox.innerHTML = MODE_IDS.map(id => `<button role="radio" aria-checked="${settings.mode === id}" data-mode="${id}"><b>${MODES[id].name}</b><span>${esc(MODES[id].blurb)}</span></button>`).join('');
    const m = MODES[settings.mode] || MODES.tdm, secs = m.sectors || [m.sector];
    if (!secs.includes(settings.sector)) settings.sector = m.sector;
    secBox.innerHTML = secs.map(s => `<button role="radio" aria-checked="${settings.sector === s}" data-sector="${s}"><b>${SECTOR_INFO[s].name}</b><span>${SECTOR_INFO[s].blurb}</span></button>`).join('');
  };
  modeBox.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b){ settings.mode = b.dataset.mode; saveSettings(); renderModes(); } });
  secBox.addEventListener('click', e => { const b = e.target.closest('[data-sector]'); if (b){ settings.sector = b.dataset.sector; saveSettings(); renderModes(); } });
  renderModes();
  $('difficulty').value = settings.difficulty; $('botCount').value = String(settings.bots);
  $('difficulty').addEventListener('change', () => { settings.difficulty = $('difficulty').value; saveSettings(); });
  $('botCount').addEventListener('change', () => { settings.bots = $('botCount').value; saveSettings(); });

  // loadout
  const renderLoadout = () => {
    $('loadoutList').innerHTML = WEAPON_IDS.map(id => {
      const w = WEAPONS[id], slot = settings.loadout.indexOf(id);
      const dps = w.dmg * (w.pellets || 1) * w.rpm / 60, stat = (k, v) => `<div class="stat">${k}<i style="--v:${Math.round(Math.min(1, v) * 100)}%"></i></div>`;
      return `<div class="gun" data-slot="${slot}"><em>${w.role}</em><b style="color:${w.color}">${w.name}</b>
        ${stat('DAMAGE', w.dmg * (w.pellets || 1) / 120)}${stat('RATE', w.rpm / 750)}${stat('RANGE', w.falloff[1] / 200)}${stat('DPS', dps / 300)}
        <div class="row"><button class="btn" data-pick="${id}" data-s="0">PRIMARY</button><button class="btn" data-pick="${id}" data-s="1">SECONDARY</button></div>
        <span class="pick">${slot === 0 ? '◆ PRIMARY' : slot === 1 ? '◆ SECONDARY' : ''}</span></div>`;
    }).join('');
  };
  $('loadoutList').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const id = b.dataset.pick, s = +b.dataset.s, l = [...settings.loadout];
    const other = l.indexOf(id); if (other >= 0 && other !== s) l[other] = l[s];
    l[s] = id; settings.loadout = l; saveSettings(); renderLoadout();
    game?.send({t:'loadout', l});
  });
  renderLoadout();

  // settings
  const bind = (id, key, fmt, apply) => {
    const el = $(id), out = $(id + 'Out');
    el.value = settings[key]; if (out) out.textContent = fmt(settings[key]);
    el.addEventListener('input', () => { settings[key] = +el.value; if (out) out.textContent = fmt(settings[key]); saveSettings(); apply?.(); });
  };
  bind('sens', 'sens', v => v.toFixed(2));
  bind('fov', 'fov', v => `${v}°`, () => game?.resize());
  bind('vol', 'vol', v => `${Math.round(v * 100)}%`, () => audio.setVolume(settings.vol));
  $('quality').value = settings.quality;
  $('quality').addEventListener('change', () => { settings.quality = $('quality').value; saveSettings(); note('Quality applies to your next match.'); });
  $('invertY').checked = settings.invertY; $('invertY').addEventListener('change', () => { settings.invertY = $('invertY').checked; saveSettings(); });
  $('toggleSprint').checked = settings.toggleSprint; $('toggleSprint').addEventListener('change', () => { settings.toggleSprint = $('toggleSprint').checked; saveSettings(); });

  // lobby (host controls)
  $('lobbyMode').innerHTML = MODE_IDS.map(id => `<option value="${id}">${MODES[id].name}</option>`).join('');
  const syncSectors = () => { const m = MODES[$('lobbyMode').value]; $('lobbySector').innerHTML = (m.sectors || [m.sector]).map(s => `<option value="${s}">${SECTOR_INFO[s].name}</option>`).join(''); };
  $('lobbyMode').addEventListener('change', () => { syncSectors(); sendConfig(); });
  ['lobbySector', 'lobbyBots', 'lobbyDiff'].forEach(id => $(id).addEventListener('change', sendConfig));
  syncSectors();

  $('deployBtn').addEventListener('click', () => { audio.unlock(); input.lock(); });
  document.addEventListener('keydown', e => {
    if (!game) return;
    if (e.key === 'Escape' && !input.locked && !$('menu').hidden && (view === 'pause' || view === 'lobby')) resume();
  });
}

function sendConfig(){
  if (!game || game.myId !== game.host) return;
  game.send({t:'config', mode:$('lobbyMode').value, sector:$('lobbySector').value, bots:$('lobbyBots').value, difficulty:$('lobbyDiff').value});
}

function act(a, b){
  if (a === 'solo') return startSolo();
  if (a === 'quickplay') return startOnline('quickplay');
  if (a === 'create') return startOnline('create');
  if (a === 'join') return startOnline('join', $('joinCode').value);
  if (a === 'resume') return resume();
  if (a === 'leave') return leave();
  if (a === 'exit') return exitToArcade();
  if (a === 'start') return game?.send({t:'start'});
  if (a === 'swapTeam') return game?.send({t:'team', team:game.mode.teams ? (game.myTeam + 1) % game.mode.teams : 0});
  if (a === 'lobbyView') return go('lobby');
  if (a === 'copy'){
    const url = `${location.origin}/video-games/exepert/?room=${game?.code || ''}`;
    navigator.clipboard?.writeText(url).then(() => { $('copyNote').textContent = 'Link copied.'; }, () => { $('copyNote').textContent = url; });
    $('copyNote').textContent = url;
  }
}

function exitToArcade(){
  leave(true);
  if (EMBED) parent.postMessage({type:'exepert:exit'}, location.origin);
  else location.href = '/contact/';
}

/* ------------------------------------------------------------ matches */
function startSolo(){
  if (!settings.callsign){ settings.callsign = sanitizeName($('callsign').value); saveSettings(); }
  const t = new LocalTransport({name:settings.callsign || 'RUNNER', loadout:settings.loadout, mode:settings.mode, sector:settings.sector, bots:settings.bots === 'auto' ? 'auto' : +settings.bots, difficulty:settings.difficulty});
  begin(t);
}

async function startOnline(kind, code){
  note('');
  settings.callsign = sanitizeName($('callsign').value) || settings.callsign; saveSettings();
  try {
    online ||= await import('./net/online.js');
    $('onlineStatus').textContent = 'CONNECTING…';
    const t = await online.connect({kind, code, mode:settings.mode, sector:settings.sector, name:settings.callsign || 'RUNNER', loadout:settings.loadout});
    $('onlineStatus').textContent = '';
    begin(t);
  } catch (e){
    $('onlineStatus').textContent = '';
    note(e?.message || 'Could not reach the EXEPERT servers. Solo play still works.');
  }
}

function begin(transport){
  leave(true);
  audio.unlock();
  gamingRun = createGamingMatchTracker({
    gameId:'exepert',
    heartbeatFields:() => ({ rtt_ms:game?.rtt }),
    startFields: {
    transport: transport instanceof LocalTransport ? 'solo' : 'websocket',
    entrypoint: EMBED ? 'contact-arcade' : 'standalone', mode:settings.mode, sector:settings.sector,
    },
  });
  try {
    game = new Game({
      canvas:$('gl'), world, input, audio, transport, onEvent:onGameEvent,
      onFrame: t => gamingRun?.sampleFrame(t),
      onRenderFailure: failure => gamingRun?.interaction('render_failure', { details: failure }),
    });
  } catch (error){
    gamingRun?.fail({
      reason: 'renderer_init_failed',
      details: { source: 'init', error: error?.name || 'renderer_error' },
    });
    transport.close?.(); gamingRun = null; game = null;
    show('menu', true); go('home'); note(error?.message || 'The EXEPERT renderer could not start.');
    return;
  }
  game.hud.show(true);
  transport.onclose = info => { if (game?.transport === transport){ leave(true); show('menu', true); go('home'); note(info?.reason || 'Disconnected from the room.'); } };
  show('menu', false); show('post', true); $('postInner').innerHTML = ''; show('post', false);
  show('clickToPlay', true);
}

function onGameEvent(e){
  if (e.type === 'welcome'){
    if (gamingRun && e.msg.phase === 'live' && e.msg.match_id) {
      gamingRun.ensure({
        match_id:e.msg.match_id, mode:e.msg.mode, sector:e.msg.sector,
        correlation_token:e.msg.correlation_token, load_ms:game?.bootLoadMs,
      });
      gamingRun.interaction('welcome', { match_id:e.msg.match_id, mode:e.msg.mode, sector:e.msg.sector });
    }
    $('pauseCode').textContent = game.code === 'SOLO' ? '' : game.code;
    $('lobbyBtn').hidden = !!game.solo; $('pauseInvite').hidden = !!game.solo;
    if (game.phase === 'lobby'){ show('clickToPlay', false); show('menu', true); go('lobby'); }
    history.replaceState(null, '', game.solo ? location.pathname + (EMBED ? '?embed=1' : '') : `${location.pathname}?room=${game.code}${EMBED ? '&embed=1' : ''}`);
  } else if (e.type === 'roster' && view === 'lobby' && !$('menu').hidden) renderLobby();
  else if (e.type === 'end') {
    const mine = game?.roster?.get(game?.myId);
    gamingRun?.result({
      match_id:game?.matchId, mode:game?.mode?.id, sector:game?.sector?.id,
      outcome:game?.mode?.teams ? (e.result?.winner === game?.myTeam ? 'win' : e.result?.winner === -1 ? 'draw' : 'loss') : e.result?.winner === game?.myId ? 'win' : 'loss',
      reason:e.result?.reason, score:mine?.score, kills:mine?.kills, deaths:mine?.deaths,
      assists:mine?.assists, details:{ bank_total:Array.isArray(e.result?.bank) ? e.result.bank[game?.myTeam] : undefined },
    });
    gamingRun?.end({ status:'completed', reason:e.result?.reason || 'match_complete' });
    showPost(e.result);
  }
  else if (e.type === 'match' || e.type === 'phase'){
    show('post', false);
    if (e.type === 'match' && game?.phase === 'live' && e.matchId) {
      gamingRun?.ensure({ match_id:e.matchId, mode:game.mode?.id, sector:game.sector?.id, load_ms:game.bootLoadMs });
    }
    // the host started the match: leave the squad room and drop everyone into the game
    if (e.type === 'phase' && e.phase === 'live' && !$('menu').hidden && view === 'lobby'){ show('menu', false); show('clickToPlay', true); }
    else if (view === 'lobby') renderLobby();
  }
  else if (e.type === 'pause' && input.locked) input.unlock();
  else if (e.type === 'version'){ leave(true); show('menu', true); go('home'); note('A new version of EXEPERT is out. Reload the page to play online.'); }
  else if (e.type === 'error'){ note(e.msg?.message || 'The room refused the connection.'); }
}

function showPost(r){
  if (!game) return;
  const mode = game.mode, mine = game.myTeam;
  let title, sub;
  if (mode.teams){
    title = r.winner === -1 ? 'DRAW' : r.winner === mine ? 'VICTORY' : 'DEFEAT';
    sub = r.winner >= 0 ? `${teamInfo(r.winner, mode).name} WINS · ${r.reason}` : r.reason;
    if (r.bank) sub += ` · ${r.bank.map((v, i) => `${teamInfo(i, mode).name.replace('CREW ', '')} $${v.toLocaleString('en-US')}`).join(' · ')}`;
  } else {
    const w = game.roster.get(r.winner);
    title = r.winner === game.myId ? 'YOU WIN' : `${esc(w?.name || 'NOBODY')} WINS`;
    sub = r.reason;
  }
  const color = title === 'VICTORY' || title === 'YOU WIN' ? 'var(--signal)' : title === 'DEFEAT' ? 'var(--alert)' : 'var(--text)';
  $('postInner').innerHTML = `<p class="eyebrow">// MATCH COMPLETE · ${esc(mode.name)}</p><h2 style="color:${color}">${title}</h2><p>${esc(sub)}</p><p class="hint">Next match in a few seconds. Scores are on the board.</p>`;
  show('post', true);
}

function renderLobby(){
  if (!game) return;
  $('lobbyCode').textContent = game.code;
  const isHost = game.myId === game.host;
  $('hostRow').querySelectorAll('select').forEach(s => { s.disabled = !isHost; });
  // reflect the room's real settings (unless the host is mid-edit)
  if (!$('hostRow').contains(document.activeElement)){
    $('lobbyMode').value = game.mode.id;
    const m = game.mode; $('lobbySector').innerHTML = (m.sectors || [m.sector]).map(s => `<option value="${s}">${SECTOR_INFO[s].name}</option>`).join('');
    $('lobbySector').value = game.sector?.id || m.sector;
    $('lobbyBots').value = String(game.config?.bots ?? 'auto');
    $('lobbyDiff').value = game.config?.diff || 'normal';
  }
  $('startBtn').hidden = !isHost || game.phase !== 'lobby';
  $('lobbyHint').textContent = game.phase === 'lobby' ? (isHost ? 'You are the host. Set it up and start when your squad is in.' : 'Warm up while you wait. The host starts the match.') : 'The match is live. Close this to jump back in.';
  const list = [...game.roster.values()];
  const li = r => `<li class="${r.id === game.myId ? 'me' : ''}"><span>${esc(r.name)}${r.bot ? ' · BOT' : ''}${r.host ? ' · HOST' : ''}</span><span>${r.bot ? '' : r.ping + 'ms'}</span></li>`;
  $('lobbyList').innerHTML = game.mode.teams
    ? Array.from({length:game.mode.teams}, (_, t) => t).map(t => { const info = teamInfo(t, game.mode); return `<div><h3 style="color:${info.color}">${info.name}</h3><ul>${list.filter(r => r.team === t).map(li).join('')}</ul></div>`; }).join('')
    : `<div><h3>RUNNERS</h3><ul>${list.filter(r => r.team !== 90).map(li).join('')}</ul></div>`;
}

function onLock(locked){
  if (!game) return;
  if (locked){ show('clickToPlay', false); show('menu', false); }
  else if (!$('menu').hidden) return;
  else { show('menu', true); go(game.phase === 'lobby' && !game.solo ? 'lobby' : 'pause'); }
}

function resume(){ show('menu', false); show('clickToPlay', true); input.lock(); }

function leave(silent){
  gamingRun?.end({ status:'abandoned', reason:silent ? 'disconnect' : 'leave' });
  gamingRun = null;
  if (game){ game.dispose(); game = null; }
  input?.unlock();
  show('clickToPlay', false); show('post', false);
  if (!silent){ show('menu', true); go('home'); history.replaceState(null, '', location.pathname + (EMBED ? '?embed=1' : '')); }
}

// Dev-only handle for automated play-testing (stripped from production builds).
if (import.meta.env?.DEV) window.__exepert = { get game(){ return game; }, get input(){ return input; }, get world(){ return world; } };

boot();
