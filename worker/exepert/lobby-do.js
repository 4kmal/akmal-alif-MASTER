/* EXEPERT lobby: a single Durable Object that tracks live rooms from their heartbeats,
   hands out quick-play rooms and reports how many people are playing. In-memory only:
   if it restarts, rooms re-report within ten seconds. */
import { getMode, MODE_IDS } from '../../video-games/exepert/sim/modes/index.js';
import { newCode, json } from './shared.js';

const STALE_MS = 35_000;

export class ExepertLobby {
  constructor(ctx, env){ this.ctx = ctx; this.env = env; this.rooms = new Map(); this.startedAt = Date.now(); }

  prune(){
    const now = Date.now();
    for (const [code, r] of this.rooms) if (now - r.at > STALE_MS) this.rooms.delete(code);
  }

  freshCode(){
    for (let i = 0; i < 20; i++){ const c = newCode(); if (!this.rooms.has(c)) return c; }
    return newCode();
  }

  async fetch(request){
    const url = new URL(request.url);
    this.prune();
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const now = Date.now();

    if (url.pathname === '/report'){
      if (!body.code) return json({error:'Missing code'}, 400);
      if (body.closed) this.rooms.delete(body.code);
      else this.rooms.set(body.code, {
        code:body.code, mode:body.mode, priv:!!body.priv, humans:body.humans | 0,
        max:body.max | 0 || getMode(body.mode).maxPlayers, phase:body.phase, at:now,
        confirmedHumans:Math.max(0, body.humans | 0), confirmedBots:Math.max(0, body.bots | 0), confirmedAt:now,
      });
      return json({ok:true});
    }

    if (url.pathname === '/quickplay'){
      const mode = MODE_IDS.includes(body.mode) ? body.mode : 'tdm';
      const open = [...this.rooms.values()]
        .filter(r => !r.priv && r.mode === mode && r.humans < r.max && r.phase !== 'post')
        .sort((a, b) => b.humans - a.humans);
      if (open.length){
        const r = open[0]; r.humans++; // count the joiner until the room reports
        return json({code:r.code, create:false});
      }
      const code = this.freshCode();
      this.rooms.set(code, {code, mode, priv:false, humans:1, max:getMode(mode).maxPlayers, phase:'live', at:now});
      return json({code, create:true});
    }

    if (url.pathname === '/reserve'){
      const mode = MODE_IDS.includes(body.mode) ? body.mode : 'tdm';
      const code = this.freshCode();
      this.rooms.set(code, {code, mode, priv:true, humans:0, max:getMode(mode).maxPlayers, phase:'lobby', at:now});
      return json({code});
    }

    if (url.pathname === '/status'){
      const list = [...this.rooms.values()];
      const byMode = {};
      for (const r of list) byMode[r.mode] = (byMode[r.mode] || 0) + r.humans;
      const confirmed = list.filter(r => r.confirmedAt != null && now - r.confirmedAt <= STALE_MS);
      const heartbeatTimes = confirmed.map(r => r.confirmedAt);
      return json({
        players:list.reduce((s, r) => s + r.humans, 0), rooms:list.length, open:list.filter(r => !r.priv).length, byMode,
        confirmed: {
          players:confirmed.reduce((sum, r) => sum + r.confirmedHumans, 0),
          bots:confirmed.reduce((sum, r) => sum + r.confirmedBots, 0),
          rooms:confirmed.length,
          checkedAt:new Date(now).toISOString(),
          oldestHeartbeatAt:heartbeatTimes.length ? new Date(Math.min(...heartbeatTimes)).toISOString() : null,
          newestHeartbeatAt:heartbeatTimes.length ? new Date(Math.max(...heartbeatTimes)).toISOString() : null,
          freshnessSeconds:STALE_MS / 1000,
          status:now - this.startedAt < STALE_MS ? 'partial' : 'live',
        },
      });
    }

    return json({error:'Not Found'}, 404);
  }
}
