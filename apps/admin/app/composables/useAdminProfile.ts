import { computed, onMounted, ref } from 'vue'
import { adminAssetURL } from '@/utils/admin-asset'

interface SessionUser {
  name?: string | null
  email?: string | null
  image?: string | null
}

interface SessionPayload {
  user?: SessionUser | null
}

export function useAdminProfile() {
  const { userEmail } = useAuthSession()
  const sessionUser = ref<SessionUser | null>(null)
  const sessionLoaded = ref(false)
  const localAvatar = adminAssetURL('profile.webp')

  onMounted(async () => {
    try {
      const result = await useBetterAuth().getSession()
      const payload = result.data as SessionPayload | null
      sessionUser.value = payload?.user || null
    }
    catch {
      // The existing owner verification remains authoritative; avatar lookup is optional.
      sessionUser.value = null
    }
    finally {
      sessionLoaded.value = true
    }
  })

  const email = computed(() => sessionUser.value?.email || userEmail.value || '')
  const name = computed(() => sessionUser.value?.name || email.value.split('@')[0] || 'Admin')
  const avatar = computed(() => sessionUser.value?.image || localAvatar)
  const initials = computed(() => name.value.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'A')

  return { name, email, avatar, initials, sessionLoaded }
}
