<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

withDefaults(defineProps<{
  title: string
  description?: string
  modalClass?: string
}>(), {
  description: '',
  modalClass: '',
})

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="blog-modal max-w-none" :class="[modalClass]" :show-close-button="false">
      <DialogTitle class="sr-only">
        {{ title }}
      </DialogTitle>
      <DialogDescription v-if="description" class="sr-only">
        {{ description }}
      </DialogDescription>
      <slot />
    </DialogContent>
  </Dialog>
</template>
