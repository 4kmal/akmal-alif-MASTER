import type { Component } from 'vue'
import { Activity, ChartArea, FolderSync, Link, ScanSearch } from '@lucide/vue'
import { computed } from 'vue'
import { useRoute } from '#imports'

export interface DashboardRouteConfig {
  readonly paths: readonly string[]
  readonly titleKey: string
  readonly icon: Component
}

export const DASHBOARD_ROUTES = {
  links: {
    paths: ['/admin/links'],
    titleKey: 'nav.links',
    icon: Link,
  },
  briefing: {
    paths: ['/admin', '/admin/briefing'],
    titleKey: 'Briefing',
    icon: ChartArea,
  },
  traffic: {
    paths: ['/admin/traffic'],
    titleKey: 'Traffic',
    icon: ChartArea,
  },
  content: {
    paths: ['/admin/content'],
    titleKey: 'Content',
    icon: Link,
  },
  engagement: {
    paths: ['/admin/engagement'],
    titleKey: 'Engagement',
    icon: Activity,
  },
  goals: {
    paths: ['/admin/goals'],
    titleKey: 'Goals',
    icon: ScanSearch,
  },
  performance: {
    paths: ['/admin/performance'],
    titleKey: 'Performance',
    icon: Activity,
  },
  link: {
    paths: ['/admin/link'],
    titleKey: 'nav.links',
    icon: Link,
  },
  analysis: {
    paths: ['/admin/analysis'],
    titleKey: 'nav.analysis',
    icon: ChartArea,
  },
  realtime: {
    paths: ['/admin/realtime'],
    titleKey: 'nav.realtime',
    icon: Activity,
  },
  check: {
    paths: ['/admin/check'],
    titleKey: 'nav.check',
    icon: ScanSearch,
  },
  migrate: {
    paths: ['/admin/migrate'],
    titleKey: 'nav.migrate',
    icon: FolderSync,
  },
} as const satisfies Record<string, DashboardRouteConfig>

export type DashboardRouteName = keyof typeof DASHBOARD_ROUTES

export function useDashboardRoute() {
  const route = useRoute()

  const currentPage = computed<DashboardRouteName | ''>(() => {
    for (const [page, config] of Object.entries(DASHBOARD_ROUTES)) {
      if ((config.paths as readonly string[]).includes(route.path))
        return page as DashboardRouteName
    }
    return ''
  })

  const pageTitle = computed(() => {
    const page = currentPage.value
    return page ? DASHBOARD_ROUTES[page].titleKey : 'dashboard.title'
  })

  const isActive = (page: DashboardRouteName) => {
    return currentPage.value === page
  }

  return { currentPage, pageTitle, isActive }
}
