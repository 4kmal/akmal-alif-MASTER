import type { Component } from 'vue'
import { CalendarDays, ChartArea, ChartColumn, ClipboardCheck, Cloud, FileText, FolderSync, Gamepad2, Gauge, Globe, History, Image, Images, LayoutDashboard, Link, MousePointerClick, PenLine, Radio, ScanSearch, Settings2, Target } from '@lucide/vue'
import { computed } from 'vue'
import { useRoute } from '#imports'

export interface DashboardRouteConfig {
  readonly paths: readonly string[]
  readonly titleKey: string
  readonly icon: Component
}

export const DASHBOARD_ROUTES = {
  briefing: {
    paths: ['/admin', '/admin/briefing'],
    titleKey: 'Briefing',
    icon: LayoutDashboard,
  },
  activity: {
    paths: ['/admin/activity'],
    titleKey: 'Live activity',
    icon: Radio,
  },
  traffic: {
    paths: ['/admin/traffic'],
    titleKey: 'Traffic',
    icon: ChartArea,
  },
  engagement: {
    paths: ['/admin/engagement'],
    titleKey: 'Engagement',
    icon: MousePointerClick,
  },
  goals: {
    paths: ['/admin/goals'],
    titleKey: 'Goals',
    icon: Target,
  },
  content: {
    paths: ['/admin/content'],
    titleKey: 'Content reach',
    icon: FileText,
  },
  performance: {
    paths: ['/admin/performance'],
    titleKey: 'Performance',
    icon: Gauge,
  },
  history: {
    paths: ['/admin/history'],
    titleKey: 'Event history',
    icon: History,
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
  links: {
    paths: ['/admin/links'],
    titleKey: 'Links',
    icon: Link,
  },
  link: {
    paths: ['/admin/link'],
    titleKey: 'Links',
    icon: Link,
  },
  analysis: {
    paths: ['/admin/analysis'],
    titleKey: 'Link analytics',
    icon: ChartColumn,
  },
  realtime: {
    paths: ['/admin/realtime'],
    titleKey: 'Link realtime',
    icon: Globe,
  },
  check: {
    paths: ['/admin/check'],
    titleKey: 'Link check',
    icon: ScanSearch,
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
    icon: Images,
  },
  calendar: {
    paths: ['/admin/calendar'],
    titleKey: 'Calendar',
    icon: CalendarDays,
  },
  judging: {
    paths: ['/admin/judging/sdc-2026'],
    titleKey: 'SDC judging',
    icon: ClipboardCheck,
  },
  migrate: {
    paths: ['/admin/migrate'],
    titleKey: 'Import / export',
    icon: FolderSync,
  },
  blogSettings: {
    paths: ['/admin/blog/settings'],
    titleKey: 'Site settings',
    icon: Settings2,
  },
} as const satisfies Record<string, DashboardRouteConfig>

export type DashboardRouteName = keyof typeof DASHBOARD_ROUTES

export interface DashboardNavItem {
  readonly route: DashboardRouteName
  readonly url: string
}

export interface DashboardNavGroup {
  readonly label: string
  readonly items: readonly DashboardNavItem[]
}

// Sidebar order. Overview, Website and Platform only observe; Shortlinks mixes
// management with its reports; Publish edits content; Admin holds tools and settings.
export const DASHBOARD_NAV: readonly DashboardNavGroup[] = [
  {
    label: 'Overview',
    items: [
      { route: 'briefing', url: '/admin/briefing' },
      { route: 'activity', url: '/admin/activity' },
    ],
  },
  {
    label: 'Website',
    items: [
      { route: 'traffic', url: '/admin/traffic' },
      { route: 'engagement', url: '/admin/engagement' },
      { route: 'goals', url: '/admin/goals' },
      { route: 'content', url: '/admin/content' },
      { route: 'performance', url: '/admin/performance' },
      { route: 'history', url: '/admin/history' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { route: 'cloudflare', url: '/admin/cloudflare' },
      { route: 'gaming', url: '/admin/gaming' },
    ],
  },
  {
    label: 'Shortlinks',
    items: [
      { route: 'links', url: '/admin/links' },
      { route: 'analysis', url: '/admin/analysis' },
      { route: 'realtime', url: '/admin/realtime' },
      { route: 'check', url: '/admin/check' },
    ],
  },
  {
    label: 'Publish',
    items: [
      { route: 'blogPosts', url: '/admin/blog/posts' },
      { route: 'blogMedia', url: '/admin/blog/media' },
      { route: 'galleries', url: '/admin/blog/galleries' },
      { route: 'calendar', url: '/admin/calendar' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { route: 'judging', url: '/admin/judging/sdc-2026' },
      { route: 'migrate', url: '/admin/migrate' },
      { route: 'blogSettings', url: '/admin/blog/settings' },
    ],
  },
]

// Pages reached from another page highlight that page's sidebar entry.
const NAV_PARENT: Partial<Record<DashboardRouteName, DashboardRouteName>> = {
  link: 'links',
}

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
    const current = currentPage.value
    return current !== '' && (current === page || NAV_PARENT[current] === page)
  }

  return { currentPage, pageTitle, isActive }
}
