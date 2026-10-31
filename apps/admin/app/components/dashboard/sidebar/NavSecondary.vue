<script setup lang="ts">
import { ExternalLink, Languages, Laptop, Moon, Sun } from '@lucide/vue'
import { useSidebar } from '@/components/ui/sidebar'

const { siteUrl } = useAppConfig()
const colorMode = useColorMode()
const { setLocale, locales } = useI18n()
const { isMobile, state } = useSidebar()

const secondaryMenuClass = computed(() => isMobile.value || state.value === 'expanded'
  ? 'flex-row items-center'
  : 'items-center')
</script>

<template>
  <SidebarGroup>
    <SidebarGroupContent>
      <SidebarMenu :class="secondaryMenuClass">
        <SidebarMenuItem>
          <SidebarMenuButton
            as-child
            :tooltip="$t('sidebar.open_site')"
            class="w-9 justify-center px-0"
          >
            <a
              :href="siteUrl"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="$t('sidebar.open_site')"
            >
              <ExternalLink aria-hidden="true" />
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem :class="{ 'ml-auto': isMobile || state === 'expanded' }">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                :tooltip="$t('layouts.header.select_language')"
                :aria-label="$t('layouts.header.select_language')"
                class="w-9 justify-center px-0"
              >
                <Languages aria-hidden="true" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              :align="isMobile ? 'end' : (state === 'collapsed' ? 'start' : 'end')"
              :side="isMobile ? 'top' : (state === 'collapsed' ? 'right' : 'top')"
            >
              <DropdownMenuItem
                v-for="locale in locales"
                :key="locale.code"
                @click="setLocale(locale.code)"
              >
                <span>{{ locale.emoji }}</span>
                {{ locale.name }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton
                :tooltip="$t('theme.toggle')"
                :aria-label="$t('theme.toggle')"
                class="w-9 justify-center px-0"
              >
                <Sun aria-hidden="true" class="dark:hidden" />
                <Moon
                  aria-hidden="true" class="
                    hidden
                    dark:block
                  "
                />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              :align="isMobile ? 'end' : (state === 'collapsed' ? 'start' : 'end')"
              :side="isMobile ? 'top' : (state === 'collapsed' ? 'right' : 'top')"
            >
              <DropdownMenuItem @click="colorMode.preference = 'light'">
                <Sun aria-hidden="true" />
                {{ $t('theme.light') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="colorMode.preference = 'dark'">
                <Moon aria-hidden="true" />
                {{ $t('theme.dark') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="colorMode.preference = 'system'">
                <Laptop aria-hidden="true" />
                {{ $t('theme.system') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
