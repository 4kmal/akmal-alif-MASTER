<script setup lang="ts">
import { adminAssetURL } from '@/utils/admin-asset'
import 'vue-sonner/style.css'

const { title, description, image } = useAppConfig()
const route = useRoute()
const localeHead = useLocaleHead()
const colorMode = useColorMode()

useSeoMeta({
  title: `${title} - Private portfolio operations`,
  description,
  ogType: 'website',
  ogTitle: title,
  ogSiteName: title,
  ogDescription: description,
  ogImage: image,
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: image,
  twitterCard: 'summary_large_image',
})

useHead(() => ({
  htmlAttrs: localeHead.value.htmlAttrs,
  meta: [
    {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1, viewport-fit=cover',
    },
    {
      name: 'theme-color',
      content: colorMode.value === 'dark' ? '#09090b' : '#ffffff',
    },
  ],
  link: [
    {
      rel: 'canonical',
      href: computed(() => `https://www.akmalalif.com${route.path}`),
    },
    {
      rel: 'icon',
      type: 'image/png',
      href: adminAssetURL('icon-192.png'),
    },
    {
      rel: 'apple-touch-icon',
      href: adminAssetURL('apple-touch-icon.png'),
    },
  ],
}))
</script>

<template>
  <NuxtLayout>
    <NuxtLoadingIndicator color="var(--primary)" />
    <NuxtPage />
    <Toaster position="top-center" rich-colors />
  </NuxtLayout>
</template>
