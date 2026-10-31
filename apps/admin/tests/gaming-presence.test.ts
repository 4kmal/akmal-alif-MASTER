import { beforeEach, describe, expect, it, vi } from 'vitest'

const now = Date.parse('2026-10-31T08:00:00.000Z')

beforeEach(() => vi.resetModules())

describe('confirmed gaming presence', () => {
  it('uses only the lobby confirmed heartbeat fields and one service request', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      players: 99,
      rooms: 50,
      confirmed: { players: 2, bots: 6, rooms: 1, checkedAt: new Date(now).toISOString(), evidenceAt: new Date(now).toISOString(), status: 'live' },
    }))
    const { readGamingPresence } = await import('../server/services/gaming-presence')
    const report = await readGamingPresence({ PORTFOLIO: { fetch } }, now)
    expect(report.live).toEqual({ players: 2, bots: 6, rooms: 1, checkedAt: new Date(now).toISOString(), status: 'live' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0].url).toBe('https://www.akmalalif.com/api/exepert/status')
  })

  it('retains a labeled stale result briefly after failure, then becomes unavailable', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({
      confirmed: { players: 1, bots: 7, rooms: 1, checkedAt: new Date(now).toISOString(), evidenceAt: new Date(now).toISOString(), status: 'live' },
    })).mockRejectedValue(new Error('Lobby unavailable'))
    const { readGamingPresence } = await import('../server/services/gaming-presence')
    await readGamingPresence({ PORTFOLIO: { fetch } }, now)
    const stale = await readGamingPresence({ PORTFOLIO: { fetch } }, now + 60_000)
    expect(stale.live.status).toBe('stale')
    expect(stale.live.players).toBe(1)
    expect(stale.coverage.checkedAt).toBe(new Date(now).toISOString())
    const unavailable = await readGamingPresence({ PORTFOLIO: { fetch } }, now + 301_000)
    expect(unavailable.live.status).toBe('unavailable')
    expect(unavailable.live.players).toBeNull()
  })

  it('does not infer zero players from a legacy or expired status response', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ players: 0, rooms: 0 })).mockResolvedValueOnce(Response.json({ confirmed: {
      players: 0,
      bots: 0,
      rooms: 0,
      checkedAt: new Date(now - 36_000).toISOString(),
      evidenceAt: new Date(now - 36_000).toISOString(),
      status: 'live',
    } })).mockResolvedValueOnce(Response.json({ confirmed: {
      players: 0, bots: 0, rooms: 0, checkedAt: new Date(now).toISOString(), status: 'live',
    } }))
    const { readGamingPresence } = await import('../server/services/gaming-presence')
    for (let i = 0; i < 3; i++) {
      const report = await readGamingPresence({ PORTFOLIO: { fetch } }, now)
      expect(report.live.status).toBe('unavailable')
      expect(report.live.players).toBeNull()
    }
  })

  it('accepts zero only with a fresh confirmed report', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ confirmed: {
      players: 0, bots: 0, rooms: 0, checkedAt: new Date(now).toISOString(), evidenceAt: new Date(now).toISOString(), status: 'live',
    } }))
    const { readGamingPresence } = await import('../server/services/gaming-presence')
    const report = await readGamingPresence({ PORTFOLIO: { fetch } }, now)
    expect(report.live.status).toBe('live')
    expect(report.live.players).toBe(0)
  })
})
