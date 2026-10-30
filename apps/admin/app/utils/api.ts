import type { NitroFetchOptions, NitroFetchRequest } from 'nitropack'
import { getAdminApiPath, isWebAdminHostname } from '@/utils/api-path'
import { adminLoginURL } from '@/utils/auth-redirect'
import { getAuthToken, removeAuthToken } from '@/utils/auth-token'

type APIOptions = Omit<NitroFetchOptions<NitroFetchRequest>, 'headers'> & {
  headers?: Record<string, string>
}

export function useAPI<T = unknown>(api: string, options?: APIOptions): Promise<T>
export async function useAPI(api: string, options?: APIOptions): Promise<unknown> {
  const { headers, ...fetchOptions } = options ?? {}
  const publicConfig = useRuntimeConfig().public
  const browserHostname = import.meta.client ? window.location.hostname : ''
  const browserOrigin = import.meta.client ? window.location.origin : ''
  const isWebAdmin = import.meta.client && isWebAdminHostname(browserHostname, publicConfig.adminOrigin)
  const requestPath = getAdminApiPath(api, browserHostname, publicConfig.adminOrigin, publicConfig.adminGateway, browserOrigin)
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
    const authToken = getAuthToken()
    if (authToken) {
      requestOptions.headers = {
        ...requestOptions.headers,
        Authorization: `Bearer ${authToken}`,
      }
    }
  }

  try {
    return await $fetch(requestPath, requestOptions)
  }
  catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 401) {
      removeAuthToken()
      if (import.meta.client && window.location.pathname !== '/admin/login')
        window.location.assign(adminLoginURL(`${window.location.pathname}${window.location.search}${window.location.hash}`))
    }
    throw error
  }
}
