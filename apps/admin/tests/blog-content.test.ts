import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { blogActor } from '../server/services/blog-studio'
import { renderTiptapDocument, sanitizeLegacyBlogHtml } from '../server/utils/blog-content'

beforeAll(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({ adminEmail: 'iamaleep@gmail.com' }))
  vi.stubGlobal('createError', ({ statusCode, statusMessage }: { statusCode: number, statusMessage: string }) => {
    const error = new Error(statusMessage) as Error & { statusCode: number, statusMessage: string }
    error.statusCode = statusCode
    error.statusMessage = statusMessage
    return error
  })
})

afterAll(() => vi.unstubAllGlobals())

describe('blog content boundaries', () => {
  it('resolves blog media by asset id and ignores forged source URLs', async () => {
    const html = await renderTiptapDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }] },
        {
          type: 'blogMedia',
          attrs: {
            assetId: 'asset-owner',
            kind: 'image',
            src: 'https://attacker.invalid/steal.gif',
            alt: 'A safe image',
            caption: 'Caption',
            width: 80,
            align: 'center',
          },
        },
      ],
    }, {
      resolveMedia: async assetId => assetId === 'asset-owner'
        ? {
            id: assetId,
            kind: 'image',
            name: 'owner.png',
            publicUrl: '/media/blog/asset-owner',
            sourceUrl: '/api/admin/blog/media/asset-owner/source',
          }
        : null,
    })

    expect(html).toContain('<strong>Hello</strong>')
    expect(html).toContain('src="/media/blog/asset-owner"')
    expect(html).not.toContain('attacker.invalid')
  })

  it('rejects unsupported nodes and unsafe formatting attributes', async () => {
    await expect(renderTiptapDocument({ type: 'doc', content: [{ type: 'script', content: [] }] })).rejects.toMatchObject({ statusCode: 400 })
    await expect(renderTiptapDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'var(--secret)' } }] }] }],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('renders Tiptap defaults, authored heading ids, and task lists', async () => {
    const html = await renderTiptapDocument({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'chapter-1', textAlign: null, lineHeight: null, indent: 0 },
          content: [{ type: 'text', text: 'Chapter one', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }] }],
        },
        {
          type: 'taskList',
          content: [{
            type: 'taskItem',
            attrs: { checked: true },
            content: [{
              type: 'paragraph',
              attrs: { textAlign: null, lineHeight: null, indent: 0 },
              content: [{ type: 'text', text: 'Ship it' }],
            }],
          }],
        },
      ],
    })

    expect(html).toContain('<h2 id="chapter-1">')
    expect(html).toContain('Chapter one')
    expect(html).toContain('font-family:Arial')
    expect(html).toContain('<ul class="task-list" data-type="taskList">')
    expect(html).toContain('<li class="task-item" data-type="taskItem" data-checked="true"><input type="checkbox" disabled checked><p>Ship it</p></li>')
  })

  it('allows the finite UI font families used by the editor ribbon', async () => {
    const html = await renderTiptapDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Editorial',
          marks: [{ type: 'textStyle', attrs: { fontFamily: 'Georgia' } }],
        }],
      }],
    })
    expect(html).toContain('font-family:Georgia')
  })

  it('sanitizes legacy HTML and removes external media sources', () => {
    const html = sanitizeLegacyBlogHtml('<p onclick="alert(1)">ok</p><script>alert(1)</script><img src="/assets/legacy.png" onerror="alert(2)"><video src="https://attacker.invalid/a.mp4" poster="https://attacker.invalid/p.png"></video>')
    expect(html).toContain('<p>ok</p>')
    expect(html).toContain('src="/assets/legacy.png"')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('attacker.invalid')
  })

  it('preserves safe legacy heading ids and task-list controls', () => {
    const html = sanitizeLegacyBlogHtml('<h2 id="chapter-1">Chapter one</h2><h2 id="bad id">Bad id</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><input type="checkbox" checked disabled>Done</li></ul>')
    expect(html).toContain('<h2 id="chapter-1">Chapter one</h2>')
    expect(html).toContain('<h2>Bad id</h2>')
    expect(html).toContain('<input type="checkbox" disabled="disabled" checked="checked" />')
  })
})

describe('blog author authorization', () => {
  it('accepts owner sessions and denies site and service tokens', () => {
    expect(blogActor({ context: { authMethod: 'access-user', userID: 'owner' } } as never)).toBe('owner')
    expect(blogActor({ context: { authMethod: 'local-admin', userID: '' } } as never)).toBe('root')
    expect(blogActor({ context: {
      authMethod: 'portfolio-gateway',
      userID: 'root',
      userEmail: 'iamaleep@gmail.com',
    } } as never)).toBe('root')
    for (const authMethod of ['site-token', 'access-service', 'portfolio-gateway', '']) {
      expect(() => blogActor({ context: { authMethod, userID: 'forged' } } as never)).toThrowError(/Owner sign-in/)
    }
  })
})
