// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeBlogDiagrams, initBlogDiagrams } from '../../../js/blog-diagram.js'

// Vitest runs from apps/admin; the diagram lives in the portfolio's assets folder.
const diagramSvg = readFileSync(resolve(process.cwd(), '../../assets/blog/diagrams/publictransport-live-data.svg'), 'utf8')
const marker = '<figure class="blog-diagram" data-diagram-key="publictransport-live-data" aria-label="How it works"><noscript><a href="/assets/blog/diagrams/publictransport-live-data.svg">How it works</a></noscript><figcaption>Figure 1</figcaption></figure>'

function respond(body: string, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 404, text: async () => body }))
}

afterEach(() => {
  disposeBlogDiagrams(document.body)
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('public diagram hydration', () => {
  it('inlines the approved SVG once with pause and expand controls', async () => {
    document.body.innerHTML = marker
    const fetchImpl = respond(diagramSvg)
    await initBlogDiagrams(document.body, { fetchImpl })
    await initBlogDiagrams(document.body, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('/assets/blog/diagrams/publictransport-live-data.svg', { credentials: 'same-origin' })
    const figure = document.querySelector('figure')!
    expect(figure.dataset.diagramState).toBe('ready')
    expect(figure.querySelectorAll('svg.ptm-diagram')).toHaveLength(1)
    expect(figure.querySelector('noscript')).toBeNull()
    expect(figure.querySelector('figcaption')?.textContent).toBe('Figure 1')
    expect([...figure.querySelectorAll('.blog-diagram__controls button')].map(button => button.textContent)).toEqual(['Pause animation', 'Expand diagram'])
    expect(figure.querySelector('dialog .blog-diagram-dialog__close')?.textContent).toBe('Close')

    figure.querySelector<HTMLButtonElement>('.blog-diagram__button')!.click()
    expect(figure.classList.contains('is-paused')).toBe(true)
    expect(figure.querySelector('.blog-diagram__button')?.textContent).toBe('Play animation')
  })

  it('starts paused when the reader prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    window.matchMedia = globalThis.matchMedia
    document.body.innerHTML = marker
    await initBlogDiagrams(document.body, { fetchImpl: respond(diagramSvg) })
    expect(document.querySelector('figure')!.classList.contains('is-paused')).toBe(true)
  })

  it('strips executable and external content before inlining', async () => {
    document.body.innerHTML = marker
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><style>@import url(https://evil.test/x.css);</style><a href="https://evil.test"><text onclick="alert(3)">x</text></a><use href="#ok"/><image href="https://evil.test/p.png"/></svg>'
    await initBlogDiagrams(document.body, { fetchImpl: respond(hostile) })
    const svg = document.querySelector('svg')!
    expect(svg.outerHTML).not.toMatch(/script|onload|onclick|evil\.test|@import/)
    expect(svg.querySelector('use')?.getAttribute('href')).toBe('#ok')
  })

  it('falls back to a plain link when the diagram cannot load', async () => {
    document.body.innerHTML = marker
    await initBlogDiagrams(document.body, { fetchImpl: respond('', false) })
    const figure = document.querySelector('figure')!
    expect(figure.dataset.diagramState).toBe('error')
    expect(figure.querySelector<HTMLAnchorElement>('.blog-diagram__fallback')?.getAttribute('href')).toBe('/assets/blog/diagrams/publictransport-live-data.svg')
  })
})
