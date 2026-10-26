import type { NitroFetchOptions, NitroFetchRequest } from 'nitropack'
import { getAuthToken, removeAuthToken } from '@/utils/auth-token'

function isWebAdminHost() {
  if (!import.meta.client)
    return false

  const { public: publicConfig } = useRuntimeConfig()
  try {
    return window.location.hostname === new URL(publicConfig.adminOrigin).hostname
  }
  catch {
    return window.location.hostname === 'www.akmalalif.com' || window.location.hostname === 'localhost'
  }
}

type APIOptions = Omit<NitroFetchOptions<NitroFetchRequest>, 'headers'> & {
  headers?: Record<string, string>
}

export function useAPI<T = unknown>(api: string, options?: APIOptions): Promise<T>
export async function useAPI(api: string, options?: APIOptions): Promise<unknown> {
  const { headers, ...fetchOptions } = options ?? {}
  const isWebAdmin = isWebAdminHost()
  const requestPath = isWebAdmin && api.startsWith('/api/') && !api.startsWith('/api/admin/')
    ? `/api/admin/sink${api.slice('/api'.length)}`
    : api
  const requestOptions: NitroFetchOptions<NitroFetchRequest> = {
    ...fetchOptions,
    // Keep API requests at the origin root; only browser assets and page
    // routes use the private `/admin/**` namespace.
    baseURL: '/',
    credentials: isWebAdmin ? 'include' : fetchOptions.credentials,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...headers,
    },
  }

  if (!isWebAdmin) {
    requestOptions.headers = {
      ...requestOptions.headers,
      Authorization: `Bearer ${getAuthToken() ?? ''}`,
    }
  }

  try {
    return await $fetch(requestPath, requestOptions)
  }
  catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 401) {
      removeAuthToken()
      if (import.meta.client && window.location.pathname !== '/admin/login')
        window.location.assign('/admin/login')
    }
    throw error
  }
}
