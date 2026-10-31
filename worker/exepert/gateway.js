/* /api/exepert/* routes: status, quick play, private rooms and the WebSocket upgrade into a room. */
import { MODE_IDS, getMode } from '../../video-games/exepert/sim/modes/index.js';
import { CODE_RE, json, lobbyStub, roomStub } from './shared.js';

const ALLOWED_HOSTS = new Set(['www.akmalalif.com', 'localhost', '127.0.0.1', '[::1]']);

function originAllowed(request){
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser clients (tests, curl)
  try { return ALLOWED_HOSTS.has(new URL(origin).hostname); } catch { return false; }
}

async function limited(request, env){
  if (!env.EXEPERT_RATE_LIMITER) return false;
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const r = await env.EXEPERT_RATE_LIMITER.limit({key});
  return !r.success;
}

async function readJson(request){
  const text = await request.text();
  if (text.length > 2048) return {};
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function cleanSector(mode, sector){
  const m = getMode(mode), allowed = m.sectors || [m.sector];
  return allowed.includes(sector) ? sector : m.sector;
}

async function initRoom(env, code, cfg){
  const r = await roomStub(env, code).fetch('https://room/init', {method:'POST', body:JSON.stringify({code, ...cfg})});
  if (!r.ok) throw new Error('Room init failed');
}

export async function handleExepert(request, env, url){
  if (!env.EXEPERT_ROOMS || !env.EXEPERT_LOBBY) return json({error:'Online play is not configured on this server.'}, 503);
  if (!originAllowed(request)) return json({error:'Forbidden origin'}, 403);
  const path = url.pathname.replace(/^\/api\/exepert/, '') || '/';

  if (path === '/status'){
    if (request.method !== 'GET') return json({error:'Method Not Allowed'}, 405, {Allow:'GET'});
    const r = await lobbyStub(env).fetch('https://lobby/status');
    return json(await r.json(), 200, {'Cache-Control':'public, max-age=15'});
  }

  if (path === '/quickplay' || path === '/rooms'){
    if (request.method !== 'POST') return json({error:'Method Not Allowed'}, 405, {Allow:'POST'});
    if (await limited(request, env)) return json({error:'Too many rooms requested. Try again in a minute.'}, 429);
    const body = await readJson(request);
    const mode = MODE_IDS.includes(body.mode) ? body.mode : 'tdm';
    const sector = cleanSector(mode, body.sector);
    if (path === '/quickplay'){
      const r = await (await lobbyStub(env).fetch('https://lobby/quickplay', {method:'POST', body:JSON.stringify({mode})})).json();
      if (r.create) await initRoom(env, r.code, {mode, sector:getMode(mode).sector, priv:false});
      return json({code:r.code});
    }
    const r = await (await lobbyStub(env).fetch('https://lobby/reserve', {method:'POST', body:JSON.stringify({mode})})).json();
    await initRoom(env, r.code, {mode, sector, priv:true});
    return json({code:r.code}, 201);
  }

  const m = path.match(/^\/rooms\/([^/]+)(\/ws)?$/);
  if (m){
    const code = m[1].toUpperCase();
    if (!CODE_RE.test(code)) return json({error:'Room codes are five letters or numbers.'}, 400);
    if (m[2]){
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({error:'Expected a WebSocket upgrade'}, 426);
      return roomStub(env, code).fetch(request);
    }
    if (request.method !== 'GET') return json({error:'Method Not Allowed'}, 405, {Allow:'GET'});
    return roomStub(env, code).fetch(`https://room/status`);
  }

  return json({error:'Not Found'}, 404);
}
