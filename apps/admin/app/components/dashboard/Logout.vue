<script setup lang="ts">
import { AlertCircle, Loader2, LogOut } from '@lucide/vue'

withDefaults(defineProps<{
  showTrigger?: boolean
}>(), {
  showTrigger: true,
})

const emit = defineEmits<{
  closeAutoFocus: [event: Event]
}>()

const slots = defineSlots<{
  trigger?: () => any
}>()

const authClient = useBetterAuth()
const open = defineModel<boolean>('open', { default: false })
const { authMethod, clearAuthSession } = useAuthSession()
const isLoggingOut = shallowRef(false)
const logoutError = shallowRef('')

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const response = error as { message?: unknown, error?: { message?: unknown } }
    if (typeof response.message === 'string')
      return response.message
    if (typeof response.error?.message === 'string')
      return response.error.message
  }
  return 'We could not end the session. Try again.'
}

async function logOut() {
  if (isLoggingOut.value)
    return

  logoutError.value = ''
  const method = authMethod.value
  if (method === 'access-user' || method === 'access-service') {
    removeAuthToken()
    clearAuthSession()
    open.value = false
    window.location.assign('/cdn-cgi/access/logout')
    return
  }

  isLoggingOut.value = true
  try {
    const response = await authClient.signOut()
    if (response.error)
      throw response.error

    removeAuthToken()
    clearAuthSession()
    open.value = false
    await navigateTo('/admin/login')
  }
  catch (error) {
    logoutError.value = errorMessage(error)
  }
  finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogTrigger v-if="slots.trigger || showTrigger" as-child>
      <slot v-if="slots.trigger" name="trigger" />
      <Button
        v-else
        type="button"
        variant="ghost"
        size="icon-lg"
        :aria-label="$t('logout.action')"
      >
        <LogOut aria-hidden="true" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent @close-auto-focus="emit('closeAutoFocus', $event)">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t('logout.title') }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t('logout.confirm') }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Alert v-if="logoutError" variant="destructive" role="alert">
        <AlertCircle aria-hidden="true" class="size-4" />
        <AlertTitle>{{ logoutError }}</AlertTitle>
      </Alert>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isLoggingOut">
          {{ $t('common.cancel') }}
        </AlertDialogCancel>
        <Button
          type="button"
          variant="destructive"
          :disabled="isLoggingOut"
          :aria-busy="isLoggingOut"
          @click="logOut"
        >
          <Loader2
            v-if="isLoggingOut"
            aria-hidden="true"
            class="
              size-4
              motion-safe:animate-spin
            "
          />
          {{ isLoggingOut ? 'Signing out…' : $t('logout.action') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
