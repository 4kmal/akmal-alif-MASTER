import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = readFileSync(resolve(adminRoot, 'app/components/judging/JudgingWorkspace.vue'), 'utf8')
const localEntry = readFileSync(resolve(adminRoot, '../judging-local/client/main.ts'), 'utf8')
const adminPage = readFileSync(resolve(adminRoot, 'app/pages/admin/judging/sdc-2026.vue'), 'utf8')
const navigation = readFileSync(resolve(adminRoot, 'app/components/dashboard/sidebar/AppSidebar.vue'), 'utf8')
const routeConfig = readFileSync(resolve(adminRoot, 'app/composables/dashboard.ts'), 'utf8')

describe('SDC judging workspace UI contract', () => {
  it('keeps the shared workspace on the durable record and evidence APIs', () => {
    expect(workspace).toContain("apiBase: '/api/admin/judging/sdc-2026'")
    expect(workspace).toContain("fetch(`${props.apiBase}/state`")
    expect(workspace).toContain("fetch(`${props.apiBase}/records`")
    expect(workspace).toContain("fetch(`${props.apiBase}/evidence/${encodeURIComponent(item.id)}`")
    expect(workspace).toContain("fetch(`${props.apiBase}/sync/status`")
    expect(workspace).toContain("fetch('/api/local/sync/resolve'")
  })

  it('keeps participant material in a safe text viewer', () => {
    expect(workspace).not.toContain('v-html')
    expect(workspace).not.toContain('<iframe')
    expect(workspace).toContain('Rendered as text; participant HTML is never executed.')
    expect(workspace).toContain('source-line')
  })

  it('mounts the same workspace for the local station and admin route', () => {
    expect(localEntry).toContain("apiBase: '/api/local'")
    expect(localEntry).toContain('local: true')
    expect(adminPage).toContain("import JudgingWorkspace from '@/components/judging/JudgingWorkspace.vue'")
    expect(adminPage).toContain("layout: 'dashboard'")
    expect(navigation).toContain("url: '/admin/judging/sdc-2026'")
    expect(routeConfig).toContain("paths: ['/admin/judging/sdc-2026']")
  })

  it('requires explicit reviewed approval before the final review state', () => {
    expect(workspace).toContain('Approve reviewed')
    expect(workspace).toContain('selectedReviewReady')
    expect(workspace).toContain('reviewedAt = new Date().toISOString()')
    expect(workspace).toContain('Blank is different from zero.')
  })
})
