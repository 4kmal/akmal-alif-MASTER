/* Server-only bridge for authoritative EXEPERT summaries. The room sends one
   bounded summary at result/disconnect/idle boundaries; no WS input or frame
   payload is forwarded. */

function clean(value, limit = 128) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, limit) : null;
}

function id(value, limit = 96) {
  const text = clean(value, limit);
  return text && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text) ? text : null;
}

function secretFor(env) {
  return clean(env?.PORTFOLIO_GATEWAY_TOKEN ?? env?.PORTFOLIO_ANALYTICS_GATEWAY_TOKEN, 512);
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, value) {
  if (!secret || !globalThis.crypto?.subtle) return null;
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(sig));
}

function randomId(prefix = 'm') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function newGamingMatchId() {
  return randomId('match');
}

export async function issueCorrelationToken(env, matchId, participantId, expiresAt = Date.now() + 24 * 3600_000) {
  const mid = id(matchId), pid = id(participantId, 48);
  if (!mid || !pid) return null;
  const signature = await hmacHex(secretFor(env), `gaming-correlation-v1|${mid}|${pid}|${expiresAt}`);
  return signature ? `v1.gaming.${mid}.${pid}.${expiresAt}.${signature}` : null;
}

function resultDetails(room) {
  const result = room.result && typeof room.result === 'object' ? room.result : {};
  const counters = room.telemetryCounters || {};
  return {
    ...result,
    captures: Number(counters.captures || 0),
    contests: Number(counters.contests || 0),
    deploys: Number(counters.deploys || 0),
    loots: Number(counters.loots || 0),
    lifts: Number(counters.lifts || 0),
    extracted: Number(counters.extracted || 0),
    extracted_value: Number(counters.extractedValue || 0),
  };
}

export function buildGamingSummary(room, status = 'completed', endedAt = Date.now()) {
  const participants = [...room.players.values()].map(player => ({
    participant_id: String(player.id),
    correlation_token: player.correlationToken || null,
    bot: Boolean(player.bot),
    kills: Number(player.kills || 0),
    deaths: Number(player.deaths || 0),
    assists: Number(player.assists || 0),
    score: Number(player.score || 0),
    details: {
      team: Number.isFinite(player.team) ? player.team : null,
      spawns: Number(player.spawns || 0),
      bank: Number(player.banked || 0),
    },
  }));
  return {
    source: 'exepert-room',
    match_id: room.matchId,
    game_id: 'exepert',
    mode: room.modeId,
    sector: room.sector,
    started_at: Number(room.matchStartedAt || endedAt),
    ended_at: endedAt,
    status,
    result: resultDetails(room),
    participants,
  };
}

export async function sendGamingSummary(env, ctx, summary) {
  if (!env?.ADMIN || typeof env.ADMIN.fetch !== 'function' || !secretFor(env)) return { skipped: true, reason:'service binding unavailable' };
  const request = new Request('https://admin.internal/internal/gaming/summary', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Portfolio-Gateway': secretFor(env),
      'X-Gaming-Service': 'exepert-room',
    },
    body: JSON.stringify(summary),
  });
  const task = env.ADMIN.fetch(request).then(async response => ({ ok:response.ok, status:response.status, body:await response.text().catch(() => '') })).catch(() => ({ ok:false, status:503 }));
  if (ctx?.waitUntil) { ctx.waitUntil(task); return { scheduled:true }; }
  return task;
}
