<script setup lang="ts">
import { ChevronsUpDown, LogOut } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useSidebar } from '@/components/ui/sidebar'
import { adminAssetURL } from '@/utils/admin-asset'

const { isMobile } = useSidebar()
const { name, email, avatar, initials } = useAdminProfile()
const localAvatar = adminAssetURL('profile.webp')
const fallbackToLocal = ref(false)
const fallbackFailed = ref(false)
const avatarSource = computed(() => {
  if (fallbackFailed.value)
    return ''
  if (fallbackToLocal.value)
    return localAvatar
  return avatar.value
})

function handleAvatarError() {
  if (avatarSource.value === localAvatar)
    fallbackFailed.value = true
  else
    fallbackToLocal.value = true
}

function handleAvatarStatus(status: unknown) {
  if (status === 'error')
    handleAvatarError()
}
const menuButton = useTemplateRef<{ $el: HTMLElement }>('menuButton')
const menuOpen = shallowRef(false)
const logoutOpen = shallowRef(false)

async function openLogoutDialog() {
  menuOpen.value = false
  await nextTick()
  logoutOpen.value = true
}

function restoreMenuFocus(event: Event) {
  event.preventDefault()
  menuButton.value?.$el.focus()
}
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu v-model:open="menuOpen">
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            ref="menuButton"
            size="lg"
            :aria-label="name"
            class="
              data-[state=open]:bg-sidebar-accent
              data-[state=open]:text-sidebar-accent-foreground
            "
          >
            <Avatar class="size-8 rounded-full">
              <AvatarImage v-if="avatarSource" :src="avatarSource" :alt="name" @error="handleAvatarError" @loading-status-change="handleAvatarStatus" />
              <AvatarFallback class="rounded-full">
                {{ initials }}
              </AvatarFallback>
            </Avatar>
            <div class="grid min-w-0 flex-1 text-left text-sm/tight">
              <span class="truncate font-medium capitalize">{{ name }}</span>
              <span class="truncate text-xs">{{ email }}</span>
            </div>
            <ChevronsUpDown aria-hidden="true" class="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-[--reka-dropdown-menu-trigger-width] min-w-56"
          :side="isMobile ? 'bottom' : 'right'"
          align="end"
          :side-offset="4"
        >
          <DropdownMenuLabel class="p-0">
            <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar class="size-8 rounded-full">
                <AvatarImage v-if="avatarSource" :src="avatarSource" :alt="name" @error="handleAvatarError" @loading-status-change="handleAvatarStatus" />
                <AvatarFallback class="rounded-full">
                  {{ initials }}
                </AvatarFallback>
              </Avatar>
              <div class="grid min-w-0 flex-1 text-left text-sm/tight">
                <span class="truncate font-semibold capitalize">{{ name }}</span>
                <span class="truncate text-xs">{{ email }}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            @select.prevent="openLogoutDialog"
          >
            <LogOut aria-hidden="true" />
            {{ $t('logout.action') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DashboardLogout
        v-model:open="logoutOpen"
        :show-trigger="false"
        @close-auto-focus="restoreMenuFocus"
      />
    </SidebarMenuItem>
  </SidebarMenu>
</template>
