import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { deleteStoredLinks, fetch, postJson, setLinkStoreD1Mode } from './utils'

const createdSlugs: string[] = []

beforeAll(async () => {
  await setLinkStoreD1Mode()
})

afterEach(async () => {
  env.NUXT_PUBLIC_LINK_PROXY_ENABLED = 'false'
  env.NUXT_PUBLIC_HOME_URL = ''
  await deleteStoredLinks(createdSlugs.splice(0))
})

describe('public runtime config overrides', () => {
  it('redirects the public root into the private admin shell and stores the proxy flag', async () => {
    env.NUXT_PUBLIC_LINK_PROXY_ENABLED = 'false'
    env.NUXT_PUBLIC_HOME_URL = ''

    const home = await fetch('/', { redirect: 'manual' })
    expect(home.status).toBe(302)
    expect(home.headers.get('location')).toBe('/admin')

    // The flag only governs request-time delivery; writes always store it.
    const slug = `cfg-default-${crypto.randomUUID()}`
    createdSlugs.push(slug)
    const created = await postJson('/api/link/create', {
      url: 'https://example.com/proxy-default',
      slug,
      proxy: true,
    })
    expect(created.status).toBe(201)
    const data = await created.json() as { link: { proxy?: boolean } }
    expect(data.link.proxy).toBe(true)
  })
})
