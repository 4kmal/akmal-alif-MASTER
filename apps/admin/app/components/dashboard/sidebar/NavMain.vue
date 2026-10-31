<script setup lang="ts">
import { useSidebar } from '@/components/ui/sidebar'

defineProps<{
  groups: {
    label: string
    items: {
      title: string
      url: string
      icon: Component
      isActive?: boolean
    }[]
  }[]
}>()

const { t } = useI18n()
const { isMobile, setOpenMobile } = useSidebar()
const route = useRoute()

function label(value: string) {
  return value.includes('.') ? t(value) : value
}

function closeMobile() {
  if (isMobile.value)
    setOpenMobile(false)
}

watch(() => route.path, () => {
  closeMobile()
})
</script>

<template>
  <SidebarGroup v-for="group in groups" :key="group.label">
    <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
    <SidebarMenu>
      <SidebarMenuItem v-for="item in group.items" :key="item.url">
        <SidebarMenuButton
          as-child
          :tooltip="label(item.title)"
          :is-active="item.isActive"
          class="
            hover:rounded-4xl
            data-active:rounded-4xl
          "
        >
          <NuxtLink :to="item.url" :aria-current="item.isActive ? 'page' : undefined" @click="closeMobile">
            <component :is="item.icon" aria-hidden="true" />
            <span>{{ label(item.title) }}</span>
          </NuxtLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarGroup>
</template>
