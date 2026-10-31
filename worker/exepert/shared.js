/* Helpers shared by the EXEPERT gateway and Durable Objects. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{5}$/;

export function newCode(){
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, b => CODE_ALPHABET[b % 32]).join('');
}

export function json(value, status = 200, headers = {}){
  return new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers}});
}

export function lobbyStub(env){
  return env.EXEPERT_LOBBY.get(env.EXEPERT_LOBBY.idFromName('lobby'));
}

export function roomStub(env, code){
  return env.EXEPERT_ROOMS.get(env.EXEPERT_ROOMS.idFromName(code));
}

/* Fire-and-forget room heartbeat to the lobby. */
export function reportToLobby(env, stats){
  if (!env?.EXEPERT_LOBBY) return;
  try {
    lobbyStub(env).fetch('https://lobby/report', {method:'POST', body:JSON.stringify(stats)}).catch(() => {});
  } catch {}
}
