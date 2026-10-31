import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const mockRoute = vi.hoisted(() => ({ path: '/admin/briefing' }))
vi.mock('#imports', () => ({ useRoute: () => mockRoute }))

const { DASHBOARD_NAV, DASHBOARD_ROUTES, useDashboardRoute } = await import('@/composables/dashboard')

const pagesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../app/pages/admin')
const navItems = DASHBOARD_NAV.flatMap(group => group.items)

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pageFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

// File route -> a concrete URL; dynamic segments get a sample value.
function pagePath(file: string) {
  const route = relative(pagesRoot, file).replaceAll('\\', '/').replace(/\.vue$/, '').replace(/(^|\/)index$/, '').replace(/\[[^\]]+\]/g, 'sample')
  return route ? `/admin/${route}` : '/admin'
}

function activeItems(path: string) {
  mockRoute.path = path
  const { isActive } = useDashboardRoute()
  return navItems.filter(item => isActive(item.route)).map(item => item.route)
}

describe('admin sidebar navigation', () => {
  it('lists every nav route once, with a known route, a matching URL and its own icon', () => {
    const routes = navItems.map(item => item.route)
    expect(new Set(routes).size).toBe(routes.length)
    for (const item of navItems)
      expect(DASHBOARD_ROUTES[item.route].paths).toContain(item.url)
    const icons = navItems.map(item => DASHBOARD_ROUTES[item.route].icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('keeps group labels unique and non-empty', () => {
    const labels = DASHBOARD_NAV.map(group => group.label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const group of DASHBOARD_NAV)
      expect(group.items.length).toBeGreaterThan(0)
  })

  it('highlights exactly one sidebar entry for every admin page', () => {
    const paths = pageFiles(pagesRoot).map(pagePath).filter(path => path !== '/admin/login')
    expect(paths).toContain('/admin/link')
    for (const path of paths)
      expect(activeItems(path), path).toHaveLength(1)
  })

  it('maps detail pages to their parent entry', () => {
    expect(activeItems('/admin/link')).toEqual(['links'])
    expect(activeItems('/admin/blog/posts/sample')).toEqual(['blogPosts'])
    expect(activeItems('/admin/blog/galleries/new')).toEqual(['galleries'])
    expect(activeItems('/admin')).toEqual(['briefing'])
    expect(activeItems('/admin/unknown')).toEqual([])
  })
})
