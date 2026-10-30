<script setup lang="ts">
import { AlertCircle, Loader2 } from '@lucide/vue'
import { GitHubIcon, GoogleIcon } from 'vue3-simple-icons'
import { adminLoginURL, safeAdminReturnPath, safeAuthErrorMessage } from '@/utils/auth-redirect'

type Provider = 'google' | 'github'

const route = useRoute()
const authClient = useBetterAuth()
const isSubmitting = shallowRef<Provider | null>(null)
const submitError = shallowRef('')

const returnPath = computed(() => safeAdminReturnPath(route.query.redirect))
const callbackError = computed(() => safeAuthErrorMessage(route.query.error || route.query.error_description))

watch(callbackError, (message) => {
  if (message)
    submitError.value = message
}, { immediate: true })

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const response = error as { message?: unknown, error?: { message?: unknown, code?: unknown } }
    const nested = response.error
    const message = typeof response.message === 'string'
      ? response.message
      : typeof nested?.message === 'string'
        ? nested.message
        : typeof nested?.code === 'string'
          ? nested.code
          : ''
    return safeAuthErrorMessage(message) || 'We could not sign you in. Check the provider account and try again.'
  }
  return safeAuthErrorMessage(String(error)) || 'We could not sign you in. Check the provider account and try again.'
}

async function handleSignIn(provider: Provider) {
  if (isSubmitting.value)
    return

  submitError.value = ''
  isSubmitting.value = provider
  try {
    const response = await authClient.signIn.social({
      provider,
      callbackURL: returnPath.value,
      errorCallbackURL: adminLoginURL(returnPath.value),
    })
    if (response.error)
      submitError.value = errorMessage(response.error)
  }
  catch (error) {
    submitError.value = errorMessage(error)
  }
  finally {
    isSubmitting.value = null
  }
}
</script>

<template>
  <div class="space-y-6" :aria-busy="!!isSubmitting">
    <Alert role="status">
      <AlertCircle aria-hidden="true" class="size-4" />
      <AlertTitle>Owner sign-in required</AlertTitle>
      <AlertDescription>
        Sign in with the approved Google or GitHub account to continue to the private workspace.
      </AlertDescription>
    </Alert>

    <Alert v-if="submitError" variant="destructive" role="alert">
      <AlertCircle aria-hidden="true" class="size-4" />
      <AlertTitle>{{ submitError }}</AlertTitle>
    </Alert>

    <div class="grid gap-3">
      <Button
        class="w-full justify-start gap-3"
        type="button"
        :disabled="!!isSubmitting"
        :aria-busy="isSubmitting === 'google'"
        @click="handleSignIn('google')"
      >
        <Loader2
          v-if="isSubmitting === 'google'"
          aria-hidden="true"
          class="
            size-4
            motion-safe:animate-spin
          "
        />
        <GoogleIcon v-else aria-hidden="true" class="size-4" />
        <span>{{ isSubmitting === 'google' ? 'Connecting to Google…' : 'Sign in with Google' }}</span>
      </Button>

      <Button
        class="w-full justify-start gap-3"
        type="button"
        variant="outline"
        :disabled="!!isSubmitting"
        :aria-busy="isSubmitting === 'github'"
        @click="handleSignIn('github')"
      >
        <Loader2
          v-if="isSubmitting === 'github'"
          aria-hidden="true"
          class="
            size-4
            motion-safe:animate-spin
          "
        />
        <GitHubIcon v-else aria-hidden="true" class="size-4" />
        <span>{{ isSubmitting === 'github' ? 'Connecting to GitHub…' : 'Sign in with GitHub' }}</span>
      </Button>
    </div>
  </div>
</template>
