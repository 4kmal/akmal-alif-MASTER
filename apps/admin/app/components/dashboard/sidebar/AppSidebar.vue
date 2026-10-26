<script setup lang="ts">
import { adminAssetURL } from '@/utils/admin-asset'

interface NavItem {
  title: string
  url: string
  icon: Component
  isActive: boolean
}

const { title } = useAppConfig()
const { isActive } = useDashboardRoute()

const platformItems = computed<NavItem[]>(() => [
  {
    title: 'Briefing',
    url: '/admin/briefing',
    icon: DASHBOARD_ROUTES.briefing.icon,
    isActive: isActive('briefing'),
  },
  {
    title: 'Traffic',
    url: '/admin/traffic',
    icon: DASHBOARD_ROUTES.traffic.icon,
    isActive: isActive('traffic'),
  },
  {
    title: 'Live activity',
    url: '/admin/activity',
    icon: DASHBOARD_ROUTES.activity.icon,
    isActive: isActive('activity'),
  },
  {
    title: 'Event history',
    url: '/admin/history',
    icon: DASHBOARD_ROUTES.history.icon,
    isActive: isActive('history'),
  },
  {
    title: 'Content',
    url: '/admin/content',
    icon: DASHBOARD_ROUTES.content.icon,
    isActive: isActive('content'),
  },
  {
    title: 'Blog posts',
    url: '/admin/blog/posts',
    icon: DASHBOARD_ROUTES.blogPosts.icon,
    isActive: isActive('blogPosts'),
  },
  {
    title: 'Blog media',
    url: '/admin/blog/media',
    icon: DASHBOARD_ROUTES.blogMedia.icon,
    isActive: isActive('blogMedia'),
  },
  {
    title: 'Engagement',
    url: '/admin/engagement',
    icon: DASHBOARD_ROUTES.engagement.icon,
    isActive: isActive('engagement'),
  },
  {
    title: 'Goals',
    url: '/admin/goals',
    icon: DASHBOARD_ROUTES.goals.icon,
    isActive: isActive('goals'),
  },
  {
    title: 'Performance',
    url: '/admin/performance',
    icon: DASHBOARD_ROUTES.performance.icon,
    isActive: isActive('performance'),
  },
  {
    title: 'Shortlinks',
    url: '/admin/links',
    icon: DASHBOARD_ROUTES.links.icon,
    isActive: isActive('links'),
  },
])

const settingsItems = computed<NavItem[]>(() => [
  {
    title: 'Health check',
    url: '/admin/check',
    icon: DASHBOARD_ROUTES.check.icon,
    isActive: isActive('check'),
  },
  {
    title: 'Import / export',
    url: '/admin/migrate',
    icon: DASHBOARD_ROUTES.migrate.icon,
    isActive: isActive('migrate'),
  },
  {
    title: 'Analysis',
    url: '/admin/analysis',
    icon: DASHBOARD_ROUTES.analysis.icon,
    isActive: isActive('analysis'),
  },
  {
    title: 'Shortlink realtime',
    url: '/admin/realtime',
    icon: DASHBOARD_ROUTES.realtime.icon,
    isActive: isActive('realtime'),
  },
  {
    title: 'Blog settings',
    url: '/admin/blog/settings',
    icon: DASHBOARD_ROUTES.blogSettings.icon,
    isActive: isActive('blogSettings'),
  },
])
</script>

<template>
  <Sidebar collapsible="icon" variant="inset">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child>
            <NuxtLink
              to="/" :title="title"
            >
              <div
                class="
                  flex aspect-square size-8 items-center justify-center
                  rounded-full
                "
              >
                <img
                  :src="adminAssetURL('portfolio-mark.svg')"
                  alt=""
                  width="32"
                  height="32"
                  class="size-8 rounded-full"
                >
              </div>
              <div class="grid flex-1 text-left text-sm/tight">
                <span class="truncate font-medium">{{ title }}</span>
                <span class="truncate text-xs">Portfolio operations</span>
              </div>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      <DashboardSidebarNavMain :platform-items="platformItems" :settings-items="settingsItems" />
      <DashboardSidebarNavSecondary class="mt-auto" />
    </SidebarContent>
    <SidebarFooter>
      <DashboardSidebarNavUser />
    </SidebarFooter>
  </Sidebar>
</template>
