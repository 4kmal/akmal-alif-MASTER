<script setup lang="ts">
import { AlertCircle, Loader2 } from '@lucide/vue'

const { previewMode } = useRuntimeConfig().public

const submitError = shallowRef('')
const isSubmitting = shallowRef(false)

async function handleSubmit() {
  if (isSubmitting.value)
    return

  submitError.value = ''
  try {
    isSubmitting.value = true
    if (import.meta.client)
      window.location.reload()
  }
  catch {
    submitError.value = 'The owner sign-in could not be retried. Check the Access application and try again.'
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <form class="space-y-6" :aria-busy="isSubmitting" @submit.prevent="handleSubmit">
    <Alert role="status">
      <AlertCircle aria-hidden="true" class="size-4" />
      <AlertTitle>Owner sign-in required</AlertTitle>
      <AlertDescription>
        Continue through the configured Cloudflare Access application. This page never accepts or stores a site token.
      </AlertDescription>
    </Alert>

    <Alert v-if="submitError" variant="destructive" role="alert">
      <AlertCircle aria-hidden="true" class="size-4" />
      <AlertTitle>{{ submitError }}</AlertTitle>
    </Alert>

    <Alert v-if="previewMode">
      <AlertCircle aria-hidden="true" class="size-4" />
      <AlertTitle>Local owner mode</AlertTitle>
      <AlertDescription>
        Use the explicitly configured local owner bypass. Production Access credentials are never exposed here.
      </AlertDescription>
    </Alert>

    <Button
      class="w-full"
      type="submit"
      :disabled="isSubmitting"
      :aria-busy="isSubmitting"
    >
      <Loader2
        v-if="isSubmitting" aria-hidden="true" class="motion-safe:animate-spin"
      />
      {{ isSubmitting ? 'Retrying owner sign-in…' : 'Retry Cloudflare Access' }}
    </Button>
  </form>
</template>
