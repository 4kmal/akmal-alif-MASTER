import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

function ownerRequest(path: string, method: string, body: Record<string, unknown>) {
  return exports.default.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'Origin': 'http://localhost',
    },
    body: JSON.stringify(body),
  }))
}

function sinkRequest(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(new Request(`https://go.example.test${path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'Authorization': 'Bearer test-site-token',
      'Origin': 'https://go.example.test',
    },
    body: JSON.stringify(body),
  }))
}

describe('portfolio taxonomy CAS on a real D1 worker', () => {
  it('creates, updates twice, rejects stale versions, and preserves owner-only writes', async () => {
    const trigger = await env.PORTFOLIO_DB.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'blog_categories_updated_at'
    `).first<{ name: string }>()
    expect(trigger?.name).toBe('blog_categories_updated_at')

    const slug = `worker-category-${crypto.randomUUID().slice(0, 12)}`
    const createResponse = await ownerRequest('/api/admin/blog/taxonomy', 'POST', {
      kind: 'category',
      name: 'Worker Category',
      slug,
      description: 'Initial description',
      icon_key: 'civic-tech',
      sort_order: 901,
    })
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json() as { categories: Array<Record<string, unknown>> }
    const category = created.categories.find(item => item.slug === slug) as { id: string, version: number } | undefined
    expect(category).toMatchObject({ name: 'Worker Category', version: 1, icon_key: 'civic-tech' })
    if (!category)
      throw new Error('Created category was not returned by taxonomy')

    const triggerProbe = await env.PORTFOLIO_DB.prepare(
      'UPDATE blog_categories SET name = ? WHERE id = ?',
    ).bind('Trigger Probe', category.id).run()
    expect(Number(triggerProbe.meta.changes)).toBe(2)

    const firstResponse = await ownerRequest(`/api/admin/blog/taxonomy/categories/${category.id}`, 'PUT', {
      version: category.version,
      name: 'Worker Category One',
      description: 'First update',
      sort_order: 902,
      is_active: true,
      icon_key: 'cybersecurity',
    })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as { categories: Array<Record<string, unknown>> }
    const firstCategory = first.categories.find(item => item.id === category.id)
    expect(firstCategory).toMatchObject({ name: 'Worker Category One', version: 2, description: 'First update', icon_key: 'cybersecurity' })

    const secondResponse = await ownerRequest(`/api/admin/blog/taxonomy/categories/${category.id}`, 'PUT', {
      version: 2,
      name: 'Worker Category Two',
      description: 'Second update',
      sort_order: 903,
      is_active: true,
      icon_key: 'anthem',
    })
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json() as { categories: Array<Record<string, unknown>> }
    const secondCategory = second.categories.find(item => item.id === category.id)
    expect(secondCategory).toMatchObject({ name: 'Worker Category Two', version: 3, description: 'Second update', icon_key: 'anthem' })

    const staleResponse = await ownerRequest(`/api/admin/blog/taxonomy/categories/${category.id}`, 'PUT', {
      version: 1,
      name: 'Stale Category',
      description: 'Must not persist',
      sort_order: 904,
      is_active: true,
      icon_key: 'robotics',
    })
    expect(staleResponse.status).toBe(409)

    const sinkResponse = await sinkRequest(`/api/admin/blog/taxonomy/categories/${category.id}`, {
      version: 3,
      name: 'Sink Category',
      description: 'Must not persist',
      sort_order: 905,
      is_active: true,
      icon_key: 'robotics',
    })
    expect(sinkResponse.status).toBe(401)

    const row = await env.PORTFOLIO_DB.prepare(`
      SELECT slug, name, description, sort_order, is_active, icon_key, version
      FROM blog_categories WHERE id = ?
    `).bind(category.id).first<Record<string, unknown>>()
    expect(row).toMatchObject({
      slug,
      name: 'Worker Category Two',
      description: 'Second update',
      sort_order: 903,
      is_active: 1,
      icon_key: 'anthem',
      version: 3,
    })

    const audit = await env.PORTFOLIO_DB.prepare(`
      SELECT COUNT(*) AS count FROM blog_audit_records
      WHERE actor = ? AND action = 'taxonomy.category.update' AND entity_id = ?
    `).bind('root', category.id).first<{ count: number }>()
    expect(Number(audit?.count)).toBe(2)
  })
})
