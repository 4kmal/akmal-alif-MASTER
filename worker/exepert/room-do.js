/* EXEPERT match room: one Durable Object per room code. Hosts the shared authoritative Room
   (video-games/exepert/sim) over hibernatable WebSockets and ticks it while anyone is connected.
   Plain class (no cloudflare:workers import) so the Worker module still loads under Node tests. */
import { buildWorld } from '../../video-games/kessler-world/world.js';
import { Room, DT } from '../../video-games/exepert/sim/room-core.js';
import { reportToLobby, json } from './shared.js';

let WORLD = null;
const world = () => (WORLD ||= buildWorld());
const MAX_MESSAGE = 16 * 1024;
const MAX_PER_SECOND = 150;
const IDLE_STOP_MS = 60_000;
const META_TTL_MS = 6 * 3600_000;

export class ExepertRoom {
  constructor(ctx, env){
    this.ctx = ctx; this.env = env;
    this.meta = null; this.room = null;
    this.sockets = new Map(); this.rate = new Map();
    this.timer = null; this.acc = 0; this.last = 0; this.emptyAt = null; this.reportAt = 0;
  }

  async loadMeta(){
    if (!this.meta) this.meta = (await this.ctx.storage.get('meta')) || null;
    return this.meta;
  }

  ensureRoom(){
    if (this.room) return this.room;
    const m = this.meta;
    this.room = new Room({
      world:world(), code:m.code, mode:m.mode, sector:m.sector, isPrivate:!!m.priv, lobby:!!m.priv,
      bots:'auto', difficulty:'normal', seed:(Math.random() * 4294967296) >>> 0,
      send:(pid, text) => this.deliver(pid, text)
    });
    return this.room;
  }

  deliver(pid, text){
    const ws = this.sockets.get(pid);
    if (!ws) return;
    try { ws.send(text); } catch { this.sockets.delete(pid); }
  }

  async fetch(request){
    const url = new URL(request.url);
    if (url.pathname.endsWith('/init') && request.method === 'POST'){
      const body = await request.json().catch(() => ({}));
      if (await this.loadMeta()) return json({ok:true, code:this.meta.code, existed:true});
      this.meta = {code:String(body.code || ''), mode:body.mode || 'tdm', sector:body.sector || null, priv:!!body.priv, created:Date.now()};
      await this.ctx.storage.put('meta', this.meta);
      await this.ctx.storage.setAlarm(Date.now() + META_TTL_MS);
      return json({ok:true, code:this.meta.code});
    }
    if (url.pathname.endsWith('/status')){
      if (!(await this.loadMeta())) return json({error:'Room not found'}, 404);
      return json(this.room ? this.room.stats() : {code:this.meta.code, mode:this.meta.mode, humans:0, bots:0, phase:'idle', priv:this.meta.priv});
    }
    if (url.pathname.endsWith('/ws')) return this.connect(request, url);
    return json({error:'Not Found'}, 404);
  }

  async connect(request, url){
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({error:'Expected a WebSocket upgrade'}, 426);
    if (!(await this.loadMeta())) return json({error:'Room not found'}, 404);
    const room = this.ensureRoom();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const loadout = (url.searchParams.get('loadout') || '').split(',').slice(0, 2);
    const p = room.join({name:url.searchParams.get('name') || '', token:url.searchParams.get('token') || null, loadout});
    if (!p){
      server.send(JSON.stringify({t:'error', message:'This room is full.'}));
      server.close(4001, 'Room full');
      return new Response(null, {status:101, webSocket:client});
    }
    const old = this.sockets.get(p.id);
    if (old && old !== server){ try { old.close(4000, 'Replaced by a new connection'); } catch {} }
    server.serializeAttachment({pid:p.id});
    this.sockets.set(p.id, server);
    room.welcome(p); // join() welcomed before the socket was mapped
    this.startLoop();
    return new Response(null, {status:101, webSocket:client});
  }

  webSocketMessage(ws, data){
    const pid = ws.deserializeAttachment()?.pid;
    if (pid == null) return;
    if (!this.room){ try { ws.close(4002, 'Room restarted, rejoin'); } catch {} return; }
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    const now = Date.now(), r = this.rate.get(pid) || {t:now, n:0};
    if (now - r.t > 1000){ r.t = now; r.n = 0; }
    if (++r.n > MAX_PER_SECOND) return;
    this.rate.set(pid, r);
    let msg; try { msg = JSON.parse(data); } catch { return; }
    this.room.handle(pid, msg);
  }

  webSocketClose(ws){ this.dropSocket(ws); }
  webSocketError(ws){ this.dropSocket(ws); }

  dropSocket(ws){
    const pid = ws.deserializeAttachment()?.pid;
    if (pid == null || this.sockets.get(pid) !== ws) return;
    this.sockets.delete(pid); this.rate.delete(pid);
    this.room?.drop(pid);
  }

  startLoop(){
    if (this.timer) return;
    this.last = Date.now(); this.acc = 0; this.emptyAt = null;
    this.timer = setInterval(() => this.loop(), 25);
    this.report();
  }

  loop(){
    const now = Date.now();
    this.acc += Math.min((now - this.last) / 1000, 0.25); this.last = now;
    let n = 0;
    while (this.room && this.acc >= DT && n++ < 4){ this.room.tick(DT); this.acc -= DT; }
    if (this.sockets.size === 0){
      this.emptyAt ??= now;
      if (now - this.emptyAt > IDLE_STOP_MS){ this.stopLoop(); return; }
    } else this.emptyAt = null;
    if (now - this.reportAt > 10_000) this.report();
  }

  stopLoop(){
    clearInterval(this.timer); this.timer = null;
    this.report(true);
    this.room = null;
  }

  report(closed = false){
    this.reportAt = Date.now();
    if (!this.meta) return;
    const s = this.room ? this.room.stats() : {code:this.meta.code, mode:this.meta.mode, humans:0, phase:'idle', priv:this.meta.priv, max:12};
    reportToLobby(this.env, {...s, closed});
  }

  async alarm(){
    if (this.sockets.size === 0 && !this.timer){ await this.ctx.storage.deleteAll(); this.meta = null; return; }
    await this.ctx.storage.setAlarm(Date.now() + META_TTL_MS);
  }
}
