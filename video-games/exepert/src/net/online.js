/* Online play: asks the Worker for a room (quick play, private squad or a code), then opens a WebSocket
   to that room's Durable Object. Messages are buffered until the game attaches, and a dropped socket
   reconnects with the same resume token so the player keeps their slot. */
import { resumeToken } from '../settings.js';

const API = '/api/exepert';
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{5}$/;

async function post(path, body){
  let res;
  try {
    res = await fetch(API + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  } catch { throw new Error('Could not reach the EXEPERT servers. Solo play still works.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server said no (${res.status}).`);
  return data;
}

export function normalizeCode(raw){
  return String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').slice(0, 5);
}

export async function connect({kind, code, mode, sector, name, loadout}){
  if (kind === 'quickplay') code = (await post('/quickplay', {mode, sector})).code;
  else if (kind === 'create') code = (await post('/rooms', {mode, sector})).code;
  else {
    code = normalizeCode(code);
    if (!CODE_RE.test(code)) throw new Error('Room codes are five letters or numbers.');
  }
  const t = new WsTransport({code, name, loadout});
  await t.ready;
  return t;
}

export class WsTransport {
  constructor({code, name, loadout}){
    this.kind = 'online'; this.code = code;
    this.query = new URLSearchParams({name:name || '', loadout:(loadout || []).join(','), token:resumeToken() || ''});
    this.queue = []; this._on = null; this.onclose = null; this.closed = false; this.retries = 0;
    this.ready = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
    this.open();
  }

  // flush on the next task so the game finishes constructing before it sees the buffered welcome
  set onmessage(fn){ this._on = fn; setTimeout(() => { const q = this.queue; this.queue = []; for (const m of q) this._on?.(m); }, 0); }
  get onmessage(){ return this._on; }

  open(){
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new WebSocket(`${proto}//${location.host}${API}/rooms/${this.code}/ws?${this.query}`);
    let welcomed = false;
    ws.onmessage = e => {
      if (!welcomed){
        welcomed = true; this.retries = 0;
        try { const m = JSON.parse(e.data); if (m.t === 'error'){ this._reject(new Error(m.message)); this.closed = true; return; } } catch {}
        this._resolve(this);
      }
      if (this._on) this._on(e.data); else this.queue.push(e.data);
    };
    ws.onclose = e => {
      if (this.closed) return;
      if (!welcomed && this.retries === 0){ this._reject(new Error(e.code === 4001 ? 'This room is full.' : e.reason || 'That room does not exist or has closed.')); this.closed = true; return; }
      // dropped mid-match: try to resume the same slot a few times
      if (this.retries < 4){ this.retries++; setTimeout(() => { if (!this.closed) this.open(); }, 600 * this.retries); return; }
      this.closed = true;
      this.onclose?.({reason:'Lost the connection to the room.'});
    };
  }

  send(msg){ if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close(){ this.closed = true; try { this.ws?.close(1000, 'leaving'); } catch {} }
}
