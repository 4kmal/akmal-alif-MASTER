import type { Component } from 'vue'
import { Activity, CalendarDays, ChartArea, ClipboardCheck, Cloud, FolderSync, Gamepad2, Image, Link, PenLine, ScanSearch, Settings2 } from '@lucide/vue'
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
  cloudflare: {
    paths: ['/admin/cloudflare'],
    titleKey: 'Cloudflare',
    icon: Cloud,
  },
  gaming: {
    paths: ['/admin/gaming'],
    titleKey: 'Gaming',
    icon: Gamepad2,
  },
  traffic: {
    paths: ['/admin/traffic'],
    titleKey: 'Traffic',
    icon: ChartArea,
  },
  activity: {
    paths: ['/admin/activity'],
    titleKey: 'Live activity',
    icon: Activity,
  },
  history: {
    paths: ['/admin/history'],
    titleKey: 'Event history',
    icon: ChartArea,
  },
  content: {
    paths: ['/admin/content'],
    titleKey: 'Content',
    icon: Link,
  },
  blogPosts: {
    paths: ['/admin/blog', '/admin/blog/posts'],
    titleKey: 'Blog posts',
    icon: PenLine,
  },
  blogMedia: {
    paths: ['/admin/blog/media'],
    titleKey: 'Media library',
    icon: Image,
  },
  galleries: {
    paths: ['/admin/blog/galleries'],
    titleKey: 'Galleries',
    icon: Image,
  },
  calendar: {
    paths: ['/admin/calendar'],
    titleKey: 'Calendar',
    icon: CalendarDays,
  },
  blogSettings: {
    paths: ['/admin/blog/settings'],
    titleKey: 'Site settings',
    icon: Settings2,
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
    titleKey: 'Shortlink realtime',
    icon: Activity,
  },
  judging: {
    paths: ['/admin/judging/sdc-2026'],
    titleKey: 'SDC judging',
    icon: ClipboardCheck,
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
      if ((config.paths as readonly string[]).includes(route.path)
        || (page === 'blogPosts' && route.path.startsWith('/admin/blog/posts/'))
        || (page === 'galleries' && route.path.startsWith('/admin/blog/galleries/'))) {
        return page as DashboardRouteName
      }
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
