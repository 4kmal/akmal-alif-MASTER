import { createAuthClient } from 'better-auth/vue'

type BetterAuthClient = ReturnType<typeof createAuthClient>

let client: BetterAuthClient | undefined

export function useBetterAuth() {
  client ??= createAuthClient({
    fetchOptions: {
      credentials: 'include',
    },
  })

  return client
}
