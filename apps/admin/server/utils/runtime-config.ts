import type { H3Event } from 'h3'

type RuntimeValue = string | boolean | number | undefined

function workerEnvironment(event: H3Event): Record<string, unknown> {
  return (event.context.cloudflare?.env ?? {}) as unknown as Record<string, unknown>
}

function workerValue(event: H3Event, key: string): string | undefined {
  const env = workerEnvironment(event)
  const value = env[key] ?? env[`NUXT_${key}`]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function getRuntimeValue(event: H3Event, configKey: string, envKey: string): RuntimeValue {
  const fromWorker = workerValue(event, envKey)
  if (fromWorker)
    return fromWorker

  const runtimeConfig = useRuntimeConfig(event) as Record<string, unknown>
  return runtimeConfig[configKey] as RuntimeValue
}

export function getRuntimeString(event: H3Event, configKey: string, envKey: string): string {
  const value = getRuntimeValue(event, configKey, envKey)
  return typeof value === 'string' ? value : ''
}

export function getRuntimeBoolean(event: H3Event, configKey: string, envKey: string): boolean {
  const value = getRuntimeValue(event, configKey, envKey)
  if (typeof value === 'boolean')
    return value
  return value === 'true'
}
