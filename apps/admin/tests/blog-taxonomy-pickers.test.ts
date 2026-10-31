// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import BlogCategoryPicker from '../app/components/blog/BlogCategoryPicker.vue'
import BlogTagPicker from '../app/components/blog/BlogTagPicker.vue'
import { filterTagOptions, tagPickerEnterAction } from '../app/utils/blog-tag-picker'

const categories = [
  { id: 'cat-civic', name: 'Civic Tech', slug: 'civic-tech', description: 'Public digital services', icon_key: 'civic-tech' },
  { id: 'cat-heritage', name: 'Islamic Heritage', slug: 'islamic-heritage', description: null, icon_key: 'islamic-heritage' },
]
const tags = [
  { id: 'tag-gtfs', name: 'GTFS', slug: 'gtfs' },
  { id: 'tag-my', name: 'Malaysia', slug: 'malaysia' },
  { id: 'tag-od', name: 'Open data', slug: 'open-data' },
]

beforeAll(() => {
  // Floating UI and reka list navigation expect these browser APIs.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

afterEach(() => document.body.replaceChildren())

function mount<T extends object>(component: object, props: T) {
  const host = document.createElement('div')
  document.body.append(host)
  const state = reactive({ ...props }) as T & { modelValue: unknown }
  const events: Array<[string, unknown]> = []
  createApp({
    render: () => h(component as never, {
      ...state,
      'onUpdate:modelValue': (value: unknown) => {
        events.push(['update', value])
        state.modelValue = value
      },
      'onCreate': (name: string) => events.push(['create', name]),
    }),
  }).mount(host)
  return { host, state, events }
}

async function settle() {
  for (let index = 0; index < 4; index += 1)
    await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('category picker', () => {
  it('shows the selected category with its sprite and description', () => {
    const { host } = mount(BlogCategoryPicker, { categories, modelValue: 'cat-civic' })
    const trigger = host.querySelector<HTMLElement>('[data-slot="select-trigger"]')!
    expect(trigger.textContent).toContain('Civic Tech')
    expect(trigger.textContent).toContain('Public digital services')
    expect(trigger.querySelector<HTMLElement>('.blog-sprite-tile')?.dataset.motion).toBe('bob')
  })

  it('falls back to Uncategorised and the slug when there is no description', () => {
    const empty = mount(BlogCategoryPicker, { categories, modelValue: null })
    expect(empty.host.textContent).toContain('Uncategorised')
    const heritage = mount(BlogCategoryPicker, { categories, modelValue: 'cat-heritage' })
    expect(heritage.host.textContent).toContain('/islamic-heritage')
  })

  it('emits null when Uncategorised is chosen from the open list', async () => {
    const { host, events } = mount(BlogCategoryPicker, { categories, modelValue: 'cat-civic' })
    const trigger = host.querySelector<HTMLElement>('[data-slot="select-trigger"]')!
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    const items = [...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')]
    expect(items.map(item => item.textContent?.trim().split(/\s{2,}|\n/)[0])).toEqual(expect.arrayContaining([expect.stringContaining('Uncategorised')]))
    expect(items).toHaveLength(3)
    items[0]!.focus()
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(events).toContainEqual(['update', null])
  })
})

describe('tag picker', () => {
  it('renders selected tags as chips and removes one from its × button', async () => {
    const { host, events } = mount(BlogTagPicker, { tags, modelValue: ['tag-gtfs', 'tag-my'] })
    expect([...host.querySelectorAll('.blog-tag-chip span')].map(node => node.textContent)).toEqual(['GTFS', 'Malaysia'])
    expect(host.textContent).toContain('2 selected')
    host.querySelector<HTMLButtonElement>('button[aria-label="Remove GTFS"]')!.click()
    await settle()
    expect(events).toContainEqual(['update', ['tag-my']])
  })

  it('removes the last chip on Backspace in an empty search box', async () => {
    const { host, events } = mount(BlogTagPicker, { tags, modelValue: ['tag-gtfs', 'tag-od'] })
    host.querySelector<HTMLInputElement>('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    await settle()
    expect(events).toContainEqual(['update', ['tag-gtfs']])
  })

  it('decides what Enter does when no row is highlighted', () => {
    expect(tagPickerEnterAction(tags, '  open ')).toEqual({ kind: 'toggle', id: 'tag-od' })
    expect(tagPickerEnterAction(tags, 'Klang Valley')).toEqual({ kind: 'create', name: 'Klang Valley' })
    expect(tagPickerEnterAction(tags, 'a')).toBeNull()
    expect(tagPickerEnterAction(tags, '   ')).toBeNull()
    expect(filterTagOptions(tags, 'MAL').map(tag => tag.id)).toEqual(['tag-my'])
  })

  it('filters options as you type and offers to create a missing tag', async () => {
    const { host, events } = mount(BlogTagPicker, { tags, modelValue: [] })
    const input = host.querySelector<HTMLInputElement>('input')!
    input.focus()
    input.value = 'mal'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    let options = [...document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]')].map(item => item.textContent?.trim())
    expect(options.some(text => text?.includes('Malaysia'))).toBe(true)
    expect(options.some(text => text?.includes('GTFS'))).toBe(false)

    input.value = 'Rail realtime'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    options = [...document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]')].map(item => item.textContent?.trim())
    expect(options.at(-1)).toContain('Create tag “Rail realtime”')

    input.value = 'malay'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    options = [...document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]')].map(item => item.textContent?.trim())
    expect(options[0]).toContain('Malaysia')
    expect(options.at(-1)).toContain('Create tag “malay”')

    input.value = 'Rail realtime'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    const create = document.querySelector<HTMLElement>('.blog-tag-picker__item--create')!
    create.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    create.click()
    await settle()
    expect(events).toContainEqual(['create', 'Rail realtime'])
    expect(events.some(([kind, value]) => kind === 'update' && Array.isArray(value) && value.includes('__create__'))).toBe(false)
  })
})
