// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeYouTubeEmbeds, initYouTubeEmbeds } from '../../../js/youtube-embed.js'

afterEach(() => {
  disposeYouTubeEmbeds(document.body)
  document.body.replaceChildren()
})

describe('public YouTube lifecycle', () => {
  it('uses the owner-supplied title from the server marker', () => {
    document.body.innerHTML = '<div class="blog-youtube" data-youtube-id="M0n6kiUxZgA" aria-label="Project Coda: Launch Bay"><button>Project Coda: Launch Bay</button></div>'
    initYouTubeEmbeds(document.body)
    expect(document.querySelector('.youtube-title')?.textContent).toBe('Project Coda: Launch Bay')
  })

  it('mounts one placeholder after repeated initialization and loads only on click', async () => {
    document.body.innerHTML = '<section data-youtube-id="hez2yR4GyTA"><a href="https://www.youtube.com/watch?v=hez2yR4GyTA">Watch enRAGE</a></section>'
    initYouTubeEmbeds(document.body)
    initYouTubeEmbeds(document.body)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.querySelectorAll('.youtube-click-to-load')).toHaveLength(1)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(document.querySelectorAll('img[src^="https:"]')).toHaveLength(0)
    document.querySelector<HTMLButtonElement>('.youtube-load-button')!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    const iframe = document.querySelector('iframe')!
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(iframe.src).toBe('https://www.youtube-nocookie.com/embed/hez2yR4GyTA?rel=0')
    expect(iframe.src).not.toContain('autoplay')
    expect(iframe.allow).not.toContain('autoplay')
    disposeYouTubeEmbeds(document.body)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('ignores invalid IDs and stops disposed controls from creating embeds', () => {
    const create = vi.spyOn(document, 'createElement')
    document.body.innerHTML = '<section data-youtube-id="invalid">Fallback</section>'
    initYouTubeEmbeds(document.body)
    expect(document.body.textContent).toBe('Fallback')
    expect(create).not.toHaveBeenCalledWith('iframe')
    document.body.innerHTML = '<section data-youtube-id="hez2yR4GyTA"></section>'
    initYouTubeEmbeds(document.body)
    const button = document.querySelector<HTMLButtonElement>('.youtube-load-button')!
    disposeYouTubeEmbeds(document.body)
    button.click()
    expect(document.querySelector('iframe')).toBeNull()
    create.mockRestore()
  })
})
