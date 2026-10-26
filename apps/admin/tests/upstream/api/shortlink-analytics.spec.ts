import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteStoredLinks, fetch, postJson, setLinkStoreD1Mode } from '../utils'

const createdSlugs = new Set<string>()

beforeEach(async () => {
  await setLinkStoreD1Mode()
})

afterEach(async () => {
  const slugs = [...createdSlugs]
  if (slugs.length) {
    const placeholders = slugs.map(() => '?').join(', ')
    await env.DB.prepare(`DELETE FROM portfolio_analytics_events WHERE shortlink_slug IN (${placeholders})`)
      .bind(...slugs)
      .run()
    await deleteStoredLinks(slugs)
  }
  createdSlugs.clear()
})

async function waitForEvent(slug: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const row = await env.DB.prepare([
      'SELECT event_id, event_type, source_event_type, path, target, campaign_json, shortlink_slug, source, latitude, longitude',
      'FROM portfolio_analytics_events WHERE shortlink_slug = ? ORDER BY received_at DESC LIMIT 1',
    ].join(' ')).bind(slug).first<{
      event_id: string
      event_type: string
      source_event_type: string | null
      path: string
      target: string | null
      campaign_json: string | null
      shortlink_slug: string
      source: string
      latitude: number | null
      longitude: number | null
    }>()
    if (row)
      return row
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return null
}

describe('shortlink analytics mirroring against the built Worker', () => {
  it('stores an actual click with safe campaign precedence and null missing coordinates', async () => {
    const slug = `analytics-${crypto.randomUUID()}`
    createdSlugs.add(slug)
    const target = 'https://destination.example/landing?utm_source=configured&utm_medium=email&utm_content=hero&api_key=target-secret'
    const create = await postJson('/api/link/create', { slug, url: target })
    expect(create.status).toBe(201)

    const response = await fetch(`/${slug}?utm_source=incoming&utm_campaign=launch&email=private@example.test&token=secret`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'PortfolioAnalyticsTest/1.0' },
    })
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe(target)

    const row = await waitForEvent(slug)
    expect(row).toMatchObject({
      event_type: 'outbound_click',
      source_event_type: 'shortlink_click',
      path: `/s/${slug}`,
      target: 'https://destination.example/landing',
      shortlink_slug: slug,
      source: 'sink',
      latitude: null,
      longitude: null,
    })
    expect(row?.event_id).toContain(`sink:`)
    expect(JSON.parse(row?.campaign_json || 'null')).toEqual({
      utm_source: 'incoming',
      utm_medium: 'email',
      utm_campaign: 'launch',
      utm_content: 'hero',
    })
    expect(JSON.stringify(row)).not.toContain('private@example.test')
    expect(JSON.stringify(row)).not.toContain('target-secret')
    expect(JSON.stringify(row)).not.toContain('token=secret')
  })
})
