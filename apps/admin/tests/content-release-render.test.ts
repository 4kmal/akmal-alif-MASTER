import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseMarkdownPost, renderPostTiptap } from '../../../scripts/content-release.mjs'
import { renderTiptapDocument } from '../server/utils/blog-content'

// Vitest runs from apps/admin; release sources live in the portfolio's content folder.
const releaseDirectory = resolve(process.cwd(), '../../content/releases/2026-10-31')
const release = JSON.parse(readFileSync(resolve(releaseDirectory, 'release.json'), 'utf8')) as { posts: Array<{ slug: string }> }

beforeAll(() => {
  vi.stubGlobal('createError', ({ statusCode, statusMessage }: { statusCode: number, statusMessage: string }) => Object.assign(new Error(statusMessage), { statusCode, statusMessage }))
})

afterAll(() => vi.unstubAllGlobals())

describe('2026-10-31 release documents', () => {
  for (const { slug } of release.posts) {
    it(`${slug} renders through the studio renderer`, async () => {
      const post = parseMarkdownPost(readFileSync(resolve(releaseDirectory, `${slug}.md`), 'utf8'))
      const html = await renderTiptapDocument(renderPostTiptap(post))
      expect(html).toContain('<h2>Sources</h2>')
      expect(html).toMatch(/<ol><li><p>/)
      expect(html).not.toMatch(/<sup|href="#/)
      for (const [, href] of html.matchAll(/href="([^"]+)"/g))
        expect(href).toMatch(/^(?:https:\/\/|\/assets\/blog\/diagrams\/)/)
    })
  }

  it('places the video and diagram blocks where the sources ask for them', async () => {
    const render = async (slug: string) => renderTiptapDocument(renderPostTiptap(parseMarkdownPost(readFileSync(resolve(releaseDirectory, `${slug}.md`), 'utf8'))))
    expect(await render('wonders-of-creation-al-qazwini')).toContain('data-youtube-id="tniqI9CkwKI"')
    expect(await render('publictransport-my-live-data-deep-dive')).toContain('<figure class="blog-diagram" data-diagram-key="publictransport-live-data"')
  })
})
