/* Solo transport: same interface as the WebSocket transport, backed by a module Web Worker. */
export class LocalTransport {
  constructor(opts){
    this.kind = 'solo';
    this.onmessage = null; this.onclose = null;
    this.worker = new Worker(new URL('./solo-worker.js', import.meta.url), {type:'module'});
    this.worker.onmessage = e => this.onmessage?.(e.data);
    this.worker.onerror = e => { console.error('Solo worker failed', e); this.onclose?.({reason:'The solo simulation crashed.'}); };
    this.worker.postMessage({t:'init', ...opts});
  }
  send(msg){ this.worker?.postMessage(msg); }
  close(){ this.worker?.terminate(); this.worker = null; }
}
