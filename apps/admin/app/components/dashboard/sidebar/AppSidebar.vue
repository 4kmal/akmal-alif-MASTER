<script setup lang="ts">
import { adminAssetURL } from '@/utils/admin-asset'

interface NavItem {
  title: string
  url: string
  icon: Component
  isActive: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const { title } = useAppConfig()
const { isActive } = useDashboardRoute()

const navGroups = computed<NavGroup[]>(() => DASHBOARD_NAV.map(group => ({
  label: group.label,
  items: group.items.map(({ route, url }) => ({
    title: DASHBOARD_ROUTES[route].titleKey,
    url,
    icon: DASHBOARD_ROUTES[route].icon,
    isActive: isActive(route),
  })),
})))
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
                  :src="adminAssetURL('profile.webp')"
                  :alt="`${title} profile`"
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
      <DashboardSidebarNavMain :groups="navGroups" />
      <DashboardSidebarNavSecondary class="mt-auto" />
    </SidebarContent>
    <SidebarFooter>
      <DashboardSidebarNavUser />
    </SidebarFooter>
  </Sidebar>
</template>
