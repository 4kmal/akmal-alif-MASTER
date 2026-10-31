import { createServer } from 'node:http'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { expect, it, vi } from 'vitest'

const readData = vi.hoisted(() => vi.fn())
vi.mock('@portfolio-analytics', () => ({ readGamingData: readData }))

it('exposes retained history without presenting player-days as unique identities', async () => {
  readData.mockResolvedValue({
    historicalAggregates: true,
    playersCount: 80,
    aggregate: { starts: 120, completions: 100, returningPlayers: 25, playSeconds: 6000 },
    daily: [{ date: '2026-01-01', starts: 120, players: 80, completions: 100, playSeconds: 6000 }],
  })
  const { readGamingReport } = await import('../server/services/gaming-observability')
  const app = createApp().use(eventHandler(readGamingReport))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing test listener address')
    const response = await fetch(`http://127.0.0.1:${address.port}/?range=13m`)
    expect(response.status).toBe(200)
    const report = await response.json()
    expect(readData).toHaveBeenCalledWith({}, expect.objectContaining({ rangeDays: 396 }))
    expect(report.coverage[0].status).toBe('partial')
    expect(report.overview.find((row: { key: string }) => row.key === 'starts').value).toBe(120)
    expect(report.overview.find((row: { key: string }) => row.key === 'players').value).toBeNull()
    expect(report.overview.find((row: { key: string }) => row.key === 'returning_players').value).toBeNull()
    expect(report.daily[0].players).toBe(80)
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
