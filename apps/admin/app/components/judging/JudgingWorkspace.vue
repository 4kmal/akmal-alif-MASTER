<script setup lang="ts">
import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Link as LinkIcon,
  Moon,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sun,
  Video,
  Wifi,
  WifiOff,
  X,
} from '@lucide/vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import {
  ASSIGNMENT as SHARED_ASSIGNMENT,
  calculateReviews as calculateReviewsFromModel,
  readiness as readinessFromModel,
  validateRecord,
} from '../../../shared/judging/model.mjs'

interface JudgingWorkspaceProps {
  apiBase?: string
  local?: boolean
}

const props = withDefaults(defineProps<JudgingWorkspaceProps>(), {
  apiBase: '/api/admin/judging/sdc-2026',
  local: false,
})

type FeatureStatus = 'unverified' | 'present' | 'missing'
type RepoCheck = '' | 'Yes' | 'No – private/broken' | "No – doesn't match demo"
type WorkspaceTab = 'queue' | 'evidence' | 'scoring'
type ReviewFilter = 'all' | 'unreviewed' | 'incomplete' | 'issues'
type SortKey = 'team' | 'score' | 'status' | 'updated'

interface FeatureReview {
  proposal: FeatureStatus
  demo: FeatureStatus
  note: string
}

interface ReviewData {
  scores: Array<number | null>
  repoCheck: RepoCheck
  notes: string
  reviewedAt: string | null
  features: FeatureReview[]
  warningsAcknowledged: boolean
}

interface JudgeData {
  name: string
  date: string
  domain: string
  generalNotes: string
  warningsAcknowledged: boolean
}

interface RecordEnvelope {
  key: string
  version: number
  data: Record<string, any>
  updatedAt?: string
}

interface Team {
  id: string
  name: string
  shortName: string
}

interface AssignmentData {
  id: string
  domain: string
  title: string
  deadline: string
  timezone: string
  weights: Array<{ id: string; label: string; weight: number }>
  features: string[]
  teams: Team[]
}

interface ConflictState {
  key: string
  local: RecordEnvelope
  current: RecordEnvelope
  source?: 'record' | 'sync'
}

interface EvidenceItem {
  id: string
  teamId: string
  title: string
  kind: 'source' | 'document' | 'transcript' | 'link' | 'video' | 'other'
  path?: string
  url?: string
  text?: string
  lines?: Array<{ line: number; text: string }>
  pages?: Array<{ page: number; text: string }>
  hash?: string
  observed?: boolean
  updatedAt?: string
}

interface AssessmentJob {
  id: string
  teamId: string
  status: string
  progress?: number
  message?: string
  updatedAt?: string
}

const FALLBACK_TEAMS: Team[] = [
  { id: '01-console', name: 'Team Console', shortName: 'Console' },
  { id: '02-ctrl-ai', name: 'ctrl + ai', shortName: 'ctrl + ai' },
  { id: '03-ctrl-cv', name: 'Ctrl CV', shortName: 'Ctrl CV' },
  { id: '04-ctrl-alt-three', name: 'Ctrl+Alt+Three', shortName: 'Ctrl+Alt+Three' },
  { id: '05-ctrl-s', name: 'Ctrl+S', shortName: 'Ctrl+S' },
  { id: '06-decisive', name: 'Decisive', shortName: 'Decisive' },
  { id: '07-dovun', name: 'DOVUN', shortName: 'DOVUN' },
  { id: '08-dsaise', name: 'Dsaise', shortName: 'Dsaise' },
  { id: '09-duologic', name: 'DuoLogic', shortName: 'DuoLogic' },
]

const FALLBACK_FEATURES = [
  'Problem framing',
  'Human centred design',
  'AI use and judgement',
  'Working prototype',
  'Evidence and clarity',
  'Future readiness',
]

const FALLBACK_WEIGHTS = [
  { id: 'human', label: 'Human judgement', weight: 30 },
  { id: 'ai', label: 'AI use and judgement', weight: 25 },
  { id: 'impact', label: 'Impact and feasibility', weight: 25 },
  { id: 'presentation', label: 'Presentation', weight: 20 },
]

const fallbackAssignment: AssignmentData = {
  id: 'Domain1D1-J04',
  domain: 'SDC 2026',
  title: 'SDC 2026 judging workspace',
  deadline: '2026-10-28T08:00:00+08:00',
  timezone: 'MYT',
  weights: FALLBACK_WEIGHTS,
  features: FALLBACK_FEATURES,
  teams: FALLBACK_TEAMS,
}

const assignment = ref<AssignmentData>(normalizeAssignment(SHARED_ASSIGNMENT))
const records = reactive<Record<string, RecordEnvelope>>({})
const reviewDrafts = reactive<Record<string, ReviewData>>({})
const versions = reactive<Record<string, number>>({})
const dirtyKeys = reactive(new Set<string>())
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const hydrating = ref(false)
const loading = ref(false)
const saving = ref(false)
const initialLoadDone = ref(false)
const errorMessage = ref('')
const lastSyncAt = ref('')
const serverTime = ref('')
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const isVisible = ref(true)
const syncState = ref<'idle' | 'pending' | 'offline' | 'error' | 'conflict'>('idle')
const syncPendingCount = ref(0)
const syncConflicts = ref<ConflictState[]>([])
const selectedTeamId = ref(FALLBACK_TEAMS[0].id)
const selectedEvidenceId = ref('')
const activeTab = ref<WorkspaceTab>('queue')
const filter = ref<ReviewFilter>('all')
const searchTerm = ref('')
const sortKey = ref<SortKey>('team')
const sortDescending = ref(false)
const theme = ref<'system' | 'light' | 'dark'>('system')
const conflict = ref<ConflictState | null>(null)
const conflictDialog = ref<HTMLDivElement | null>(null)
const evidenceLoading = ref(false)
const evidenceError = ref('')
const evidencePayload = ref<EvidenceItem | null>(null)
const pairCode = ref('')
const pairMessage = ref('')
const pairLoading = ref(false)
const pairedDevices = ref<Array<Record<string, any>>>([])
const intakeLoading = ref(false)
const intakeMessage = ref('')
const intakeProgress = ref<Record<string, any> | null>(null)
const submissionUrl = ref('')
const submissionMessage = ref('')
const newNote = ref('')
const assessmentJobs = ref<AssessmentJob[]>([])
const assessmentMessage = ref('')
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
const deadlineNow = ref(Date.now())
const filterOptions: Array<[ReviewFilter, string]> = [
  ['all', 'All'],
  ['unreviewed', 'Unreviewed'],
  ['incomplete', 'Incomplete'],
  ['issues', 'Issues'],
]

const judgeDraft = reactive<JudgeData>(defaultJudge())

const features = computed(() => assignment.value.features?.length ? assignment.value.features : FALLBACK_FEATURES)
const teams = computed(() => assignment.value.teams?.length ? assignment.value.teams : FALLBACK_TEAMS)
const weights = computed(() => assignment.value.weights?.length ? assignment.value.weights : FALLBACK_WEIGHTS)

const selectedTeam = computed(() => teams.value.find(team => team.id === selectedTeamId.value) ?? teams.value[0])
const selectedReview = computed(() => reviewDrafts[selectedTeamId.value] ?? defaultReview())
const evidenceRecords = computed(() => Object.values(records)
  .filter(record => record.key.startsWith('evidence:'))
  .map(record => ({ ...normalizeEvidence({ ...record.data, id: record.data?.id ?? record.key.slice('evidence:'.length) }), updatedAt: record.updatedAt }))
  .filter(item => item.id))
const selectedTeamEvidence = computed(() => evidenceRecords.value.filter(item => item.teamId === selectedTeamId.value))
const selectedEvidence = computed(() => evidencePayload.value
  ?? selectedTeamEvidence.value.find(item => item.id === selectedEvidenceId.value)
  ?? selectedTeamEvidence.value[0]
  ?? null)

const reviewCount = computed(() => teams.value.filter(team => Boolean(reviewDrafts[team.id]?.reviewedAt)).length)
const evidenceCount = computed(() => evidenceRecords.value.length)
const incompleteCount = computed(() => teams.value.filter(team => isIncomplete(reviewDrafts[team.id])).length)
const issueCount = computed(() => teams.value.filter(team => hasIssues(reviewDrafts[team.id])).length)
const readinessCount = computed(() => teams.value.filter(team => isReady(reviewDrafts[team.id])).length)
const deadlineText = computed(() => formatCountdown(assignment.value.deadline, deadlineNow.value))
const deadlineDate = computed(() => formatDateTime(assignment.value.deadline))
const overallReadiness = computed(() => `${readinessCount.value}/${teams.value.length} ready`)
const syncLabel = computed(() => {
  if (!isOnline.value || syncState.value === 'offline') return 'Offline · edits stay local'
  if (syncState.value === 'conflict') return `${syncConflicts.value.length || 1} conflict${syncConflicts.value.length === 1 ? '' : 's'} needs a choice`
  if (syncState.value === 'error') return 'Sync error · retry available'
  if (syncState.value === 'pending' || dirtyKeys.size > 0 || syncPendingCount.value > 0) return syncPendingCount.value ? `Sync pending · ${syncPendingCount.value}` : 'Saving changes…'
  return lastSyncAt.value ? `Synced ${formatTime(lastSyncAt.value)}` : 'Ready to sync'
})
const syncTone = computed(() => {
  if (!isOnline.value || syncState.value === 'offline') return 'offline'
  if (syncState.value === 'conflict' || syncState.value === 'error') return 'danger'
  if (syncState.value === 'pending' || dirtyKeys.size > 0) return 'pending'
  return 'online'
})

const filteredTeams = computed(() => {
  const query = searchTerm.value.trim().toLowerCase()
  const filtered = teams.value.filter((team) => {
    const review = reviewDrafts[team.id]
    const matchesQuery = !query || `${team.name} ${team.id}`.toLowerCase().includes(query)
    const matchesFilter = filter.value === 'all'
      || (filter.value === 'unreviewed' && !review?.reviewedAt)
      || (filter.value === 'incomplete' && isIncomplete(review))
      || (filter.value === 'issues' && hasIssues(review))
    return matchesQuery && matchesFilter
  })
  return filtered.sort((left, right) => {
    let comparison = 0
    if (sortKey.value === 'team') comparison = left.name.localeCompare(right.name)
    if (sortKey.value === 'score') comparison = scoreFor(reviewDrafts[left.id]) - scoreFor(reviewDrafts[right.id])
    if (sortKey.value === 'status') comparison = statusLabel(reviewDrafts[left.id]).localeCompare(statusLabel(reviewDrafts[right.id]))
    if (sortKey.value === 'updated') comparison = updatedAtFor(left.id).localeCompare(updatedAtFor(right.id))
    return sortDescending.value ? -comparison : comparison
  })
})

const currentReviewStatus = computed(() => statusLabel(selectedReview.value))
const selectedScore = computed(() => scoreFor(selectedReview.value))
const selectedReviewReady = computed(() => isReady(selectedReview.value))
const selectedEvidenceLines = computed(() => {
  const item = selectedEvidence.value
  if (!item) return []
  if (item.lines?.length) return item.lines.map(line => ({ number: line.line, text: line.text }))
  return String(item.text ?? '').split('\n').map((text, index) => ({ number: index + 1, text }))
})

function normalizeAssignment(source: any): AssignmentData {
  const value = source && typeof source === 'object' ? source : {}
  const sourceTeams = Array.isArray(value.teams) ? value.teams : FALLBACK_TEAMS
  return {
    ...fallbackAssignment,
    ...value,
    weights: Array.isArray(value.weights) && value.weights.length ? value.weights : FALLBACK_WEIGHTS,
    features: Array.isArray(value.features) && value.features.length ? value.features : FALLBACK_FEATURES,
    teams: sourceTeams.map((team: any, index: number) => ({
      id: String(team.id ?? team.teamId ?? FALLBACK_TEAMS[index]?.id ?? `team-${index + 1}`),
      name: String(team.name ?? team.label ?? FALLBACK_TEAMS[index]?.name ?? `Team ${index + 1}`),
      shortName: String(team.shortName ?? team.name ?? team.label ?? FALLBACK_TEAMS[index]?.shortName ?? `Team ${index + 1}`),
    })),
  }
}

function defaultJudge(): JudgeData {
  return {
    name: '',
    date: new Date().toISOString().slice(0, 10),
    domain: 'Domain 1 · Digital fluency',
    generalNotes: '',
    warningsAcknowledged: false,
  }
}

function defaultFeature(): FeatureReview {
  return { proposal: 'unverified', demo: 'unverified', note: '' }
}

function defaultReview(): ReviewData {
  return {
    scores: [null, null, null, null],
    repoCheck: '',
    notes: '',
    reviewedAt: null,
    features: Array.from({ length: 6 }, defaultFeature),
    warningsAcknowledged: false,
  }
}

function normalizeReview(source: any): ReviewData {
  const value = source && typeof source === 'object' ? source : {}
  const scores = Array.isArray(value.scores) ? value.scores.slice(0, 4).map((score: any) => {
    if (score === null || score === undefined || score === '') return null
    const number = Number(score)
    return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : null
  }) : []
  while (scores.length < 4) scores.push(null)
  const sourceFeatures = Array.isArray(value.features) ? value.features : []
  const normalizedFeatures = Array.from({ length: 6 }, (_, index) => {
    const feature = sourceFeatures[index] ?? {}
    return {
      proposal: normalizeFeatureStatus(feature.proposal),
      demo: normalizeFeatureStatus(feature.demo),
      note: String(feature.note ?? ''),
    }
  })
  return {
    scores,
    repoCheck: normalizeRepoCheck(value.repoCheck),
    notes: String(value.notes ?? ''),
    reviewedAt: value.reviewedAt ? String(value.reviewedAt) : null,
    features: normalizedFeatures,
    warningsAcknowledged: Boolean(value.warningsAcknowledged),
  }
}

function normalizeFeatureStatus(value: any): FeatureStatus {
  return value === 'present' || value === 'missing' ? value : 'unverified'
}

function normalizeRepoCheck(value: any): RepoCheck {
  if (value === 'Yes' || value === 'No – private/broken' || value === "No – doesn't match demo") return value
  return ''
}

function normalizeEvidence(source: any): EvidenceItem {
  const value = source && typeof source === 'object' ? source : {}
  return {
    id: String(value.id ?? value.uuid ?? value.evidenceId ?? ''),
    teamId: String(value.teamId ?? ''),
    title: String(value.title ?? value.name ?? value.path ?? 'Evidence item'),
    kind: value.kind === 'source' || value.kind === 'document' || value.kind === 'transcript' || value.kind === 'link' || value.kind === 'video' ? value.kind : 'other',
    path: value.path ? String(value.path) : undefined,
    url: value.url ? String(value.url) : undefined,
    text: value.text ? String(value.text) : '',
    lines: Array.isArray(value.lines) ? value.lines : undefined,
    pages: Array.isArray(value.pages) ? value.pages : undefined,
    hash: value.hash ? String(value.hash) : (value.sha256 ? String(value.sha256) : (value.snapshotSha ? String(value.snapshotSha) : undefined)),
    observed: Boolean(value.observed),
  }
}

function normalizeRecord(record: any): RecordEnvelope | null {
  if (!record || typeof record !== 'object' || typeof record.key !== 'string') return null
  return {
    key: record.key,
    version: Number(record.version ?? 0),
    data: record.data && typeof record.data === 'object' ? record.data : {},
    updatedAt: record.updatedAt ? String(record.updatedAt) : undefined,
  }
}

function normalizeConflicts(source: any): ConflictState[] {
  if (!Array.isArray(source)) return []
  return source.flatMap((item: any) => {
    const local = normalizeRecord(item?.local)
    const remote = normalizeRecord(item?.remote ?? item?.current)
    if (!local || !remote) return []
    return [{ key: String(item.key ?? local.key), local, current: remote, source: 'sync' as const }]
  })
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function recordKeyForTeam(teamId: string) {
  return `review:${teamId}`
}

function applyRecord(record: RecordEnvelope) {
  records[record.key] = record
  versions[record.key] = record.version
  if (record.key === 'judge') {
    const value = record.data ?? {}
    judgeDraft.name = String(value.name ?? '')
    judgeDraft.date = String(value.date ?? value.dateYYYYMMDD ?? judgeDraft.date)
    judgeDraft.domain = String(value.domain ?? judgeDraft.domain)
    judgeDraft.generalNotes = String(value.generalNotes ?? '')
    judgeDraft.warningsAcknowledged = Boolean(value.warningsAcknowledged)
    return
  }
  if (record.key.startsWith('review:') && !dirtyKeys.has(record.key)) {
    reviewDrafts[record.key.slice('review:'.length)] = normalizeReview(record.data)
  }
}

function applyState(payload: any) {
  hydrating.value = true
  const incomingAssignment = payload?.assignment
  if (incomingAssignment) assignment.value = normalizeAssignment(incomingAssignment)
  if (payload?.serverTime) serverTime.value = String(payload.serverTime)
  const incomingConflicts = normalizeConflicts(payload?.conflicts)
  if (incomingConflicts.length) {
    syncConflicts.value = incomingConflicts
    conflict.value = conflict.value ?? incomingConflicts[0]
    syncState.value = 'conflict'
  }
  else if (Array.isArray(payload?.conflicts)) {
    syncConflicts.value = []
    if (conflict.value?.source === 'sync') conflict.value = null
  }
  const incoming = Array.isArray(payload?.records) ? payload.records : []
  for (const raw of incoming) {
    const record = normalizeRecord(raw)
    if (!record) continue
    if (dirtyKeys.has(record.key)) continue
    applyRecord(record)
  }
  for (const team of teams.value) {
    if (!reviewDrafts[team.id]) reviewDrafts[team.id] = defaultReview()
  }
  hydrating.value = false
  initialLoadDone.value = true
  lastSyncAt.value = new Date().toISOString()
  syncState.value = syncConflicts.value.length ? 'conflict' : (dirtyKeys.size ? 'pending' : 'idle')
}

async function fetchState(options: { silent?: boolean } = {}) {
  if (!isOnline.value && options.silent) {
    syncState.value = 'offline'
    return
  }
  if (!options.silent) loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${props.apiBase}/state`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`State request failed (${response.status})`)
    applyState(await response.json())
    await fetchSyncStatus()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'The judging state could not be loaded.'
    syncState.value = isOnline.value ? 'error' : 'offline'
  } finally {
    loading.value = false
  }
}

async function fetchSyncStatus() {
  try {
    const response = await fetch(`${props.apiBase}/sync/status`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) return
    const payload = await response.json()
    syncPendingCount.value = Number(payload?.pending ?? 0)
    const incomingConflicts = normalizeConflicts(payload?.conflicts)
    if (incomingConflicts.length) {
      syncConflicts.value = incomingConflicts
      conflict.value = conflict.value ?? incomingConflicts[0]
      syncState.value = 'conflict'
    }
    else if (!conflict.value) {
      syncConflicts.value = []
    }
    else if (conflict.value?.source === 'sync') {
      syncConflicts.value = []
      conflict.value = null
    }
    if (payload?.lastSuccessfulAt) lastSyncAt.value = String(payload.lastSuccessfulAt)
    if (payload?.status === 'offline') syncState.value = 'offline'
    else if (payload?.status === 'conflict' || Number(payload?.conflicts ?? 0) > 0) syncState.value = 'conflict'
  } catch {
    // The local bridge may start before its sync endpoint; state remains usable.
  }
}

function markDirty(key: string) {
  if (hydrating.value) return
  dirtyKeys.add(key)
  syncState.value = isOnline.value ? 'pending' : 'offline'
  const previous = saveTimers.get(key)
  if (previous) clearTimeout(previous)
  saveTimers.set(key, setTimeout(() => { void saveRecord(key) }, 2000))
}

function markReviewDirty(teamId: string) {
  markDirty(recordKeyForTeam(teamId))
}

function markJudgeDirty() {
  markDirty('judge')
}

function recordDataForKey(key: string) {
  if (key === 'judge') return { ...judgeDraft }
  if (key.startsWith('review:')) return normalizeReview(reviewDrafts[key.slice('review:'.length)])
  return records[key]?.data ?? {}
}

async function saveRecord(key: string) {
  const timer = saveTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    saveTimers.delete(key)
  }
  if (!dirtyKeys.has(key)) return
  if (!isOnline.value) {
    syncState.value = 'offline'
    return
  }
  if (props.local && syncConflicts.value.length) {
    syncState.value = 'conflict'
    return
  }
  saving.value = true
  syncState.value = 'pending'
  try {
    const validation = validateRecord(key, recordDataForKey(key))
    if (validation === false) throw new Error(`Record ${key} failed validation.`)
    const response = await fetch(`${props.apiBase}/records`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        key,
        baseVersion: versions[key] ?? 0,
        data: recordDataForKey(key),
        mutationId: randomId(),
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 409) {
      const current = normalizeRecord(payload.current)
      if (current) {
        conflict.value = {
          key,
          current,
          local: {
            key,
            version: versions[key] ?? 0,
            data: recordDataForKey(key),
            updatedAt: new Date().toISOString(),
          },
        }
        syncState.value = 'conflict'
        await nextTick()
        conflictDialog.value?.focus()
        return
      }
    }
    if (!response.ok) throw new Error(payload?.message ?? `Save failed (${response.status})`)
    const saved = normalizeRecord(payload)
    if (saved) applyRecord(saved)
    dirtyKeys.delete(key)
    syncState.value = dirtyKeys.size ? 'pending' : 'idle'
    lastSyncAt.value = new Date().toISOString()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'The change could not be saved.'
    syncState.value = isOnline.value ? 'error' : 'offline'
  } finally {
    saving.value = false
  }
}

async function resolveConflict(choice: 'local' | 'server') {
  const currentConflict = conflict.value
  if (!currentConflict) return
  const { key, local, current } = currentConflict
  conflict.value = null
  if (currentConflict.source === 'sync' && props.local) {
    try {
      const response = await fetch('/api/local/sync/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ key, choice: choice === 'local' ? 'local' : 'remote' }),
      })
      if (!response.ok) throw new Error(`Conflict resolution failed (${response.status})`)
      syncConflicts.value = syncConflicts.value.filter(item => item.key !== key)
      syncState.value = syncConflicts.value.length ? 'conflict' : (dirtyKeys.size ? 'pending' : 'idle')
      await fetchState({ silent: true })
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Conflict could not be resolved.'
      syncState.value = 'conflict'
    }
    return
  }
  if (choice === 'server') {
    applyRecord(current)
    dirtyKeys.delete(key)
    syncState.value = dirtyKeys.size ? 'pending' : 'idle'
    return
  }
  versions[key] = current.version
  dirtyKeys.add(key)
  syncState.value = 'pending'
  await saveRecord(key)
  if (conflict.value) syncState.value = 'conflict'
  else if (local) lastSyncAt.value = new Date().toISOString()
}

function selectTeam(teamId: string) {
  selectedTeamId.value = teamId
  if (!reviewDrafts[teamId]) reviewDrafts[teamId] = defaultReview()
  if (activeTab.value === 'evidence') selectedEvidenceId.value = ''
}

function setScore(index: number, event: Event) {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  selectedReview.value.scores[index] = raw === '' ? null : clampScore(Number(raw))
  markReviewDirty(selectedTeamId.value)
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10))
}

function setFeatureStatus(index: number, field: 'proposal' | 'demo', event: Event) {
  const input = event.target as HTMLSelectElement
  selectedReview.value.features[index][field] = normalizeFeatureStatus(input.value)
  markReviewDirty(selectedTeamId.value)
}

function updateFeatureNote(index: number, event: Event) {
  selectedReview.value.features[index].note = (event.target as HTMLInputElement).value
  markReviewDirty(selectedTeamId.value)
}

function updateReviewField(field: 'repoCheck' | 'notes' | 'warningsAcknowledged', value: string | boolean) {
  if (field === 'repoCheck') selectedReview.value.repoCheck = normalizeRepoCheck(value)
  if (field === 'notes') selectedReview.value.notes = String(value)
  if (field === 'warningsAcknowledged') selectedReview.value.warningsAcknowledged = Boolean(value)
  markReviewDirty(selectedTeamId.value)
}

function handleRepoCheckChange(event: Event) {
  updateReviewField('repoCheck', (event.target as HTMLSelectElement).value)
}

function handleReviewNotesChange(event: Event) {
  updateReviewField('notes', (event.target as HTMLTextAreaElement).value)
}

function handleWarningsChange(event: Event) {
  updateReviewField('warningsAcknowledged', (event.target as HTMLInputElement).checked)
}

function approveReview() {
  if (!selectedReviewReady.value) return
  selectedReview.value.reviewedAt = new Date().toISOString()
  markReviewDirty(selectedTeamId.value)
}

function appendTimestampedNote() {
  const note = newNote.value.trim()
  if (!note) return
  const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const current = selectedReview.value.notes.trim()
  selectedReview.value.notes = `${current ? `${current}\n` : ''}[${stamp}] ${note}`
  newNote.value = ''
  markReviewDirty(selectedTeamId.value)
}

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDescending.value = !sortDescending.value
  else {
    sortKey.value = key
    sortDescending.value = false
  }
}

function scoreFor(review: ReviewData | undefined) {
  if (!review) return 0
  const scoreValues = review.scores.map(value => typeof value === 'number' ? value : 0)
  const hasModelValue = safeModelScore(review)
  if (hasModelValue !== null) return hasModelValue
  return scoreValues.reduce((total, score, index) => total + (score / 10) * Number(weights.value[index]?.weight ?? 0), 0)
}

function safeModelScore(review: ReviewData | undefined): number | null {
  if (!review) return 0
  try {
    const value = calculateReviewsFromModel(review)
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function safeReadiness(review: ReviewData | undefined): boolean | null {
  try {
    const value = readinessFromModel(review)
    if (typeof value === 'boolean') return value
    if (value && typeof value === 'object' && 'ready' in value) return Boolean(value.ready)
    return null
  } catch {
    return null
  }
}

function isReady(review: ReviewData | undefined) {
  if (!review) return false
  const modelValue = safeReadiness(review)
  if (modelValue !== null) return modelValue
  return Boolean(review.reviewedAt)
    && review.repoCheck !== ''
    && review.scores.every(value => typeof value === 'number')
    && review.features.every(feature => feature.proposal !== 'unverified' && feature.demo !== 'unverified')
}

function isIncomplete(review: ReviewData | undefined) {
  if (!review) return true
  return review.scores.some(value => value === null)
    || review.repoCheck === ''
    || review.features.some(feature => feature.proposal === 'unverified' || feature.demo === 'unverified')
    || !review.reviewedAt
}

function hasIssues(review: ReviewData | undefined) {
  if (!review) return true
  return review.repoCheck !== 'Yes'
    || review.features.some(feature => feature.proposal === 'missing' || feature.demo === 'missing')
    || (review.reviewedAt !== null && !review.warningsAcknowledged)
}

function statusLabel(review: ReviewData | undefined) {
  if (!review?.reviewedAt) return 'Unreviewed'
  if (hasIssues(review)) return 'Reviewed · issues'
  if (isIncomplete(review)) return 'Incomplete'
  return 'Reviewed'
}

function statusClass(review: ReviewData | undefined) {
  if (!review?.reviewedAt) return 'status-neutral'
  if (hasIssues(review)) return 'status-warning'
  return 'status-ready'
}

function updatedAtFor(teamId: string) {
  return records[recordKeyForTeam(teamId)]?.updatedAt ?? ''
}

function featureClass(status: FeatureStatus) {
  return `feature-${status}`
}

function formatCountdown(value: string, now: number) {
  const difference = new Date(value).getTime() - now
  if (!Number.isFinite(difference)) return 'Deadline unavailable'
  if (difference <= 0) return 'Deadline passed'
  const days = Math.floor(difference / 86_400_000)
  const hours = Math.floor((difference % 86_400_000) / 3_600_000)
  const minutes = Math.floor((difference % 3_600_000) / 60_000)
  return `${days}d ${hours}h ${minutes}m remaining`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(date)
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatScore(value: number) {
  return value === 0 ? '0.0' : value.toFixed(1)
}

async function loadEvidence(item: EvidenceItem) {
  selectedEvidenceId.value = item.id
  evidencePayload.value = null
  evidenceError.value = ''
  if (!item.id) return
  evidenceLoading.value = true
  try {
    const response = await fetch(`${props.apiBase}/evidence/${encodeURIComponent(item.id)}`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Evidence request failed (${response.status})`)
    evidencePayload.value = normalizeEvidence(await response.json())
  } catch (error) {
    evidenceError.value = error instanceof Error ? error.message : 'Evidence could not be loaded.'
  } finally {
    evidenceLoading.value = false
  }
}

function openEvidenceForTeam() {
  activeTab.value = 'evidence'
  const first = selectedTeamEvidence.value[0]
  if (first) void loadEvidence(first)
}

function evidenceIcon(kind: EvidenceItem['kind']) {
  if (kind === 'source') return GitBranch
  if (kind === 'document') return FileText
  if (kind === 'video' || kind === 'transcript') return Video
  if (kind === 'link') return LinkIcon
  return Database
}

async function refreshDevices() {
  if (props.local) return
  try {
    const response = await fetch(`${props.apiBase}/devices`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Device request failed (${response.status})`)
    const payload = await response.json()
    pairedDevices.value = Array.isArray(payload) ? payload : (payload.devices ?? [])
  } catch (error) {
    pairMessage.value = error instanceof Error ? error.message : 'Devices could not be loaded.'
  }
}

async function pairLocalDevice() {
  const code = pairCode.value.trim()
  if (!code) {
    pairMessage.value = 'Enter the 6-character pairing code.'
    return
  }
  pairLoading.value = true
  pairMessage.value = ''
  try {
    const response = await fetch('/api/local/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.message ?? `Pairing failed (${response.status})`)
    pairMessage.value = 'This judging station is paired and ready.'
    pairCode.value = ''
    await fetchState()
  } catch (error) {
    pairMessage.value = error instanceof Error ? error.message : 'Pairing failed.'
  } finally {
    pairLoading.value = false
  }
}

async function createAdminPairCode() {
  pairLoading.value = true
  pairMessage.value = ''
  try {
    const response = await fetch(`${props.apiBase}/devices/pair`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.message ?? `Pair code request failed (${response.status})`)
    pairCode.value = String(payload.code ?? payload.pairCode ?? '')
    pairMessage.value = payload.expiresAt ? `Code expires ${formatDateTime(payload.expiresAt)}.` : 'Code expires in 10 minutes.'
    await refreshDevices()
  } catch (error) {
    pairMessage.value = error instanceof Error ? error.message : 'Pair code could not be created.'
  } finally {
    pairLoading.value = false
  }
}

async function revokeDevice(device: Record<string, any>) {
  const id = String(device.id ?? device.deviceId ?? '')
  if (!id) return
  try {
    const response = await fetch(`${props.apiBase}/devices/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Revoke failed (${response.status})`)
    await refreshDevices()
  } catch (error) {
    pairMessage.value = error instanceof Error ? error.message : 'Device could not be revoked.'
  }
}

async function startIntake() {
  intakeLoading.value = true
  intakeMessage.value = ''
  try {
    const response = await fetch(`${props.apiBase}/intake`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh: true, teamId: selectedTeamId.value }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.message ?? `Intake failed (${response.status})`)
    intakeMessage.value = payload.jobId ? `Intake job ${payload.jobId} queued.` : 'Intake queued.'
    await loadIntakeProgress()
    await fetchState()
  } catch (error) {
    intakeMessage.value = error instanceof Error ? error.message : 'Intake could not be queued.'
  } finally {
    intakeLoading.value = false
  }
}

async function loadIntakeProgress() {
  if (!props.local) return
  try {
    const response = await fetch(`${props.apiBase}/intake`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) return
    const payload = await response.json()
    intakeProgress.value = payload && typeof payload === 'object' ? payload : null
  } catch {
    // Progress is advisory and should not block scoring.
  }
}

async function loadAssessmentJobs() {
  try {
    const endpoint = props.local ? `${props.apiBase}/assessments/jobs` : `${props.apiBase}/assessments`
    const response = await fetch(endpoint, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) return
    const payload = await response.json()
    assessmentJobs.value = Array.isArray(payload) ? payload : (payload.jobs ?? [])
  } catch {
    // Assessment jobs are supplementary to the judging state; keep the workspace usable.
  }
}

async function queueAssessment(teamId: string) {
  assessmentMessage.value = ''
  try {
    const endpoint = props.local ? `${props.apiBase}/assessments/jobs` : `${props.apiBase}/assessments`
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ teamId }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.message ?? `Assessment request failed (${response.status})`)
    assessmentMessage.value = `Assessment queued for ${teamName(teamId)}.`
    await loadAssessmentJobs()
  } catch (error) {
    assessmentMessage.value = error instanceof Error ? error.message : 'Assessment could not be queued.'
  }
}

async function queueAllAssessments() {
  const existing = new Set(assessmentJobs.value.filter(job => ['queued', 'running'].includes(job.status)).map(job => job.teamId))
  const pendingTeams = teams.value.filter(team => !existing.has(team.id)).slice(0, 9)
  for (const team of pendingTeams) await queueAssessment(team.id)
}

async function cancelAssessment(job: AssessmentJob) {
  try {
    await fetch(`${props.apiBase}/assessments/${encodeURIComponent(job.id)}/cancel`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
    await loadAssessmentJobs()
  } catch {
    assessmentMessage.value = 'Assessment could not be cancelled.'
  }
}

function teamName(teamId: string) {
  return teams.value.find(team => team.id === teamId)?.name ?? teamId
}

function handleOnline() {
  isOnline.value = true
  syncState.value = dirtyKeys.size ? 'pending' : 'idle'
  void fetchState({ silent: true })
  for (const key of dirtyKeys) void saveRecord(key)
}

function handleOffline() {
  isOnline.value = false
  syncState.value = 'offline'
}

function handleVisibility() {
  isVisible.value = document.visibilityState === 'visible'
  if (isVisible.value) void fetchState({ silent: true })
}

function beginPolling() {
  if (pollingTimer.value) clearInterval(pollingTimer.value)
  pollingTimer.value = setInterval(() => {
    deadlineNow.value = Date.now()
    if (isVisible.value) {
      void fetchState({ silent: true })
      void loadIntakeProgress()
    }
  }, 10_000)
}

function stopPolling() {
  if (pollingTimer.value) clearInterval(pollingTimer.value)
  pollingTimer.value = null
}

function setTheme(mode: 'system' | 'light' | 'dark') {
  theme.value = mode
  if (typeof localStorage !== 'undefined') localStorage.setItem('sdc-judging-theme', mode)
}

function openSubmissionLink() {
  const value = submissionUrl.value.trim()
  if (!value) {
    submissionMessage.value = 'Paste a repository or demo link first.'
    return
  }
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported')
    submissionMessage.value = 'Link captured for review. Nothing was submitted automatically.'
  } catch {
    submissionMessage.value = 'Use a full https:// link.'
  }
}

watch(() => props.apiBase, () => { void fetchState() })
watch(selectedTeamId, () => {
  evidencePayload.value = null
  evidenceError.value = ''
})

onMounted(() => {
  if (typeof localStorage !== 'undefined') {
    const storedTheme = localStorage.getItem('sdc-judging-theme')
    if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') theme.value = storedTheme
  }
  isVisible.value = document.visibilityState === 'visible'
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibility)
  deadlineNow.value = Date.now()
  beginPolling()
  void fetchState()
  void fetchSyncStatus()
  void loadIntakeProgress()
  void loadAssessmentJobs()
  void refreshDevices()
})

onBeforeUnmount(() => {
  stopPolling()
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  document.removeEventListener('visibilitychange', handleVisibility)
  for (const timer of saveTimers.values()) clearTimeout(timer)
})
</script>

<template>
  <main
    class="judging-workspace"
    :data-theme="theme"
    :data-local="local ? 'true' : 'false'"
    @keydown.esc="conflict && (conflict = null)"
  >
    <header class="workspace-header">
      <div class="header-title">
        <div class="eyebrow"><ClipboardCheck :size="15" aria-hidden="true" /> SDC 2026 · judging desk</div>
        <h1>{{ assignment.title }}</h1>
        <p>{{ assignment.id }} · {{ assignment.domain }} · {{ assignment.timezone }}</p>
      </div>
      <div class="header-actions">
        <span class="sync-pill" :class="`sync-${syncTone}`" role="status" aria-live="polite">
          <WifiOff v-if="syncTone === 'offline'" :size="14" aria-hidden="true" />
          <Wifi v-else :size="14" aria-hidden="true" />
          {{ syncLabel }}
        </span>
        <button class="icon-button" type="button" aria-label="Refresh judging state" :disabled="loading" @click="fetchState()">
          <RefreshCw :size="16" :class="{ spin: loading }" aria-hidden="true" />
        </button>
        <div class="theme-switcher" aria-label="Theme">
          <button type="button" :class="{ selected: theme === 'light' }" aria-label="Use light theme" @click="setTheme('light')"><Sun :size="15" aria-hidden="true" /></button>
          <button type="button" :class="{ selected: theme === 'dark' }" aria-label="Use dark theme" @click="setTheme('dark')"><Moon :size="15" aria-hidden="true" /></button>
          <button type="button" :class="{ selected: theme === 'system' }" aria-label="Use system theme" @click="setTheme('system')"><CircleHelp :size="15" aria-hidden="true" /></button>
        </div>
      </div>
    </header>

    <div v-if="errorMessage" class="workspace-alert alert-error" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ errorMessage }}</span>
      <button type="button" class="text-button" @click="fetchState()">Retry</button>
    </div>

    <section class="overview-grid" aria-label="Judging overview">
      <article class="overview-card overview-deadline">
        <div class="card-icon"><Clock3 :size="17" aria-hidden="true" /></div>
        <div><span class="card-label">Deadline</span><strong>{{ deadlineText }}</strong><small>{{ deadlineDate }} MYT</small></div>
      </article>
      <article class="overview-card">
        <div class="card-icon"><ShieldCheck :size="17" aria-hidden="true" /></div>
        <div><span class="card-label">Reviews</span><strong>{{ reviewCount }}/{{ teams.length }}</strong><small>{{ incompleteCount }} incomplete · {{ issueCount }} with issues</small></div>
      </article>
      <article class="overview-card">
        <div class="card-icon"><FileText :size="17" aria-hidden="true" /></div>
        <div><span class="card-label">Evidence</span><strong>{{ evidenceCount }}</strong><small>safe text, source and document records</small></div>
      </article>
      <article class="overview-card">
        <div class="card-icon"><Check :size="17" aria-hidden="true" /></div>
        <div><span class="card-label">Readiness</span><strong>{{ overallReadiness }}</strong><small>explicit reviewed approval required</small></div>
      </article>
    </section>

    <section class="judge-strip" aria-labelledby="judge-profile-heading">
      <div>
        <div class="eyebrow" id="judge-profile-heading">Judge profile</div>
        <p class="muted-copy">The review is durable only after the judge identity and acknowledgement are saved.</p>
      </div>
      <div class="judge-fields">
        <label>Judge name<input v-model="judgeDraft.name" autocomplete="name" placeholder="Name" @input="markJudgeDirty" /></label>
        <label>Review date<input v-model="judgeDraft.date" type="date" @change="markJudgeDirty" /></label>
        <label>Domain<select v-model="judgeDraft.domain" @change="markJudgeDirty"><option>Domain 1 · Digital fluency</option><option>Domain 2 · Future skills</option><option>Domain 3 · Community impact</option></select></label>
        <label class="judge-notes">General notes<textarea v-model="judgeDraft.generalNotes" rows="2" placeholder="Context for the review desk" @input="markJudgeDirty" /></label>
        <label class="check-label"><input v-model="judgeDraft.warningsAcknowledged" type="checkbox" @change="markJudgeDirty" /> I understand evidence is unverified until observed</label>
      </div>
    </section>

    <section class="review-table-section" aria-labelledby="review-overview-heading">
      <div class="section-heading">
        <div><div class="eyebrow">Review queue</div><h2 id="review-overview-heading">Nine teams, one source of truth</h2></div>
        <div class="section-actions">
          <a class="secondary-button" :href="`${apiBase}/exports?final=0`" download><Download :size="15" aria-hidden="true" /> Draft export</a>
          <a class="primary-button" :href="`${apiBase}/exports?final=1`" download><Download :size="15" aria-hidden="true" /> Final export</a>
        </div>
      </div>
      <div class="queue-toolbar">
        <label class="search-field"><Search :size="16" aria-hidden="true" /><span class="sr-only">Search teams</span><input v-model="searchTerm" type="search" placeholder="Search teams or IDs" /></label>
        <div class="filter-buttons" role="group" aria-label="Review filter">
          <button v-for="item in filterOptions" :key="item[0]" type="button" :class="{ active: filter === item[0] }" @click="filter = item[0]">{{ item[1] }}</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="review-table">
          <thead><tr>
            <th><button type="button" class="sort-button" @click="sortBy('team')">Team <ArrowDownUp :size="13" aria-hidden="true" /></button></th>
            <th><button type="button" class="sort-button" @click="sortBy('status')">Status <ArrowDownUp :size="13" aria-hidden="true" /></button></th>
            <th><button type="button" class="sort-button" @click="sortBy('score')">Weighted score <ArrowDownUp :size="13" aria-hidden="true" /></button></th>
            <th>Feature heatmap</th><th>Evidence</th><th><span class="sr-only">Open</span></th>
          </tr></thead>
          <tbody>
            <tr v-for="team in filteredTeams" :key="team.id" :class="{ selected: selectedTeamId === team.id }" @click="selectTeam(team.id)">
              <th scope="row"><button type="button" class="team-link" @click.stop="selectTeam(team.id)"><span>{{ team.name }}</span><small>{{ team.id }}</small></button></th>
              <td><span class="status-badge" :class="statusClass(reviewDrafts[team.id])">{{ statusLabel(reviewDrafts[team.id]) }}</span></td>
              <td><div class="score-cell"><strong>{{ formatScore(scoreFor(reviewDrafts[team.id])) }}</strong><span class="weighted-bar"><i :style="{ width: `${Math.min(100, scoreFor(reviewDrafts[team.id]))}%` }" /></span><small>/ 100</small></div></td>
              <td><div class="heatmap" :aria-label="`${team.name} feature status`"><span v-for="(feature, index) in (reviewDrafts[team.id]?.features ?? defaultReview().features)" :key="index" :class="featureClass(feature.demo)" :title="`${features[index]} · demo ${feature.demo}`" /></div></td>
              <td><button type="button" class="evidence-count" @click.stop="selectTeam(team.id); openEvidenceForTeam()"><FileText :size="14" aria-hidden="true" /> {{ evidenceRecords.filter(item => item.teamId === team.id).length }}</button></td>
              <td><ChevronRight :size="17" aria-hidden="true" /></td>
            </tr>
            <tr v-if="!filteredTeams.length"><td colspan="6" class="empty-cell">No teams match this view.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="workbench" aria-labelledby="workbench-heading">
      <div class="section-heading workbench-heading">
        <div><div class="eyebrow">Workbench</div><h2 id="workbench-heading">{{ selectedTeam?.name }}</h2><p class="muted-copy">{{ selectedTeam?.id }} · {{ currentReviewStatus }} · score {{ formatScore(selectedScore) }}/100</p></div>
        <div class="workbench-actions"><button class="secondary-button" type="button" @click="queueAssessment(selectedTeamId)"><Database :size="15" aria-hidden="true" /> Queue assessment</button><button class="primary-button" type="button" :disabled="!selectedReviewReady" @click="approveReview"><Check :size="15" aria-hidden="true" /> Approve reviewed</button></div>
      </div>
      <nav class="workbench-tabs" aria-label="Workbench sections">
        <button type="button" :class="{ active: activeTab === 'queue' }" @click="activeTab = 'queue'">Queue</button>
        <button type="button" :class="{ active: activeTab === 'evidence' }" @click="activeTab = 'evidence'">Evidence <span>{{ selectedTeamEvidence.length }}</span></button>
        <button type="button" :class="{ active: activeTab === 'scoring' }" @click="activeTab = 'scoring'">Scoring</button>
      </nav>

      <div v-if="activeTab === 'queue'" class="workbench-panel queue-panel">
        <div class="panel-copy"><h3>Queue control</h3><p>Assessments are bounded to the nine assigned teams and remain visible while they run.</p><button class="secondary-button" type="button" @click="queueAllAssessments"><Send :size="15" aria-hidden="true" /> Queue all nine</button><p v-if="assessmentMessage" class="feedback" role="status">{{ assessmentMessage }}</p></div>
        <div class="job-list"><div v-for="job in assessmentJobs" :key="job.id" class="job-row"><div><strong>{{ teamName(job.teamId) }}</strong><small>{{ job.message ?? job.status }}</small></div><div class="job-progress"><span>{{ job.progress ?? 0 }}%</span><span class="progress-track"><i :style="{ width: `${job.progress ?? 0}%` }" /></span></div><button v-if="['queued', 'running'].includes(job.status)" type="button" class="icon-button" aria-label="Cancel assessment" @click="cancelAssessment(job)"><X :size="15" aria-hidden="true" /></button></div><p v-if="!assessmentJobs.length" class="empty-copy">No assessment jobs queued.</p></div>
      </div>

      <div v-else-if="activeTab === 'evidence'" class="workbench-panel evidence-panel">
        <aside class="evidence-list" aria-label="Evidence list">
          <div class="panel-heading"><div><h3>Evidence</h3><p>Safe text only · source lines and PDF pages</p></div><button v-if="local" class="icon-button" type="button" aria-label="Run local intake" :disabled="intakeLoading" @click="startIntake"><RefreshCw :size="15" aria-hidden="true" /></button></div>
          <p v-if="intakeMessage" class="feedback" role="status">{{ intakeMessage }}</p>
          <p v-if="local && intakeProgress" class="feedback" role="status">Intake {{ intakeProgress.status ?? 'pending' }}<span v-if="intakeProgress.progress !== undefined"> · {{ intakeProgress.progress }}%</span></p>
          <button v-for="item in selectedTeamEvidence" :key="item.id" type="button" class="evidence-item" :class="{ active: selectedEvidence?.id === item.id }" @click="loadEvidence(item)"><component :is="evidenceIcon(item.kind)" :size="16" aria-hidden="true" /><span><strong>{{ item.title }}</strong><small>{{ item.kind }}<span v-if="item.hash"> · {{ item.hash.slice(0, 8) }}</span></small></span><ChevronRight :size="14" aria-hidden="true" /></button>
          <p v-if="!selectedTeamEvidence.length" class="empty-copy">No evidence records for this team yet.</p>
        </aside>
        <article class="evidence-reader" aria-live="polite">
          <div v-if="evidenceLoading" class="reader-state"><RefreshCw :size="18" class="spin" aria-hidden="true" /> Loading safe evidence…</div>
          <div v-else-if="evidenceError" class="reader-state reader-error"><AlertTriangle :size="18" aria-hidden="true" /> {{ evidenceError }}</div>
          <template v-else-if="selectedEvidence">
            <header class="reader-header"><div><div class="eyebrow">{{ selectedEvidence.kind }} · {{ selectedEvidence.observed ? 'observed' : 'not observed' }}</div><h3>{{ selectedEvidence.title }}</h3><p v-if="selectedEvidence.path">{{ selectedEvidence.path }}</p></div><a v-if="selectedEvidence.url" class="icon-button" :href="selectedEvidence.url" target="_blank" rel="noreferrer" aria-label="Open evidence link"><ExternalLink :size="16" aria-hidden="true" /></a></header>
            <div class="reader-meta"><span v-if="selectedEvidence.hash">Hash {{ selectedEvidence.hash }}</span><span>Rendered as text; participant HTML is never executed.</span></div>
            <div class="source-reader"><div v-for="line in selectedEvidenceLines" :key="line.number" class="source-line"><span>{{ line.number }}</span><code>{{ line.text }}</code></div><p v-if="!selectedEvidenceLines.length" class="empty-copy">This evidence record has no readable text.</p></div>
            <div v-if="selectedEvidence.pages?.length" class="pdf-pages"><h4>PDF pages</h4><div v-for="page in selectedEvidence.pages" :key="page.page"><strong>Page {{ page.page }}</strong><p>{{ page.text }}</p></div></div>
          </template>
          <div v-else class="reader-state"><FileText :size="20" aria-hidden="true" /> Select an evidence record.</div>
        </article>
      </div>

      <div v-else class="workbench-panel scoring-panel">
        <div class="score-form">
          <div class="panel-heading"><div><h3>Weighted scoring</h3><p>Scores stay decimal precise. Blank is different from zero.</p></div><strong class="large-score">{{ formatScore(selectedScore) }}<small>/100</small></strong></div>
          <div class="criteria-grid"><label v-for="(weight, index) in weights" :key="weight.id" class="score-field"><span>{{ weight.label }} <small>{{ weight.weight }}%</small></span><input :value="selectedReview.scores[index] === null ? '' : selectedReview.scores[index]" type="number" min="0" max="10" step="0.1" inputmode="decimal" :aria-label="`${weight.label} score out of 10`" placeholder="—" @input="setScore(index, $event)" /><em>/10</em></label></div>
          <div class="repo-check"><label>Repository check<select :value="selectedReview.repoCheck" @change="handleRepoCheckChange"><option value="">Choose an observation</option><option value="Yes">Yes</option><option value="No – private/broken">No – private/broken</option><option value="No – doesn't match demo">No – doesn't match demo</option></select></label><p class="micro-copy"><Video :size="14" aria-hidden="true" /> Video links remain unobserved until the judge opens them.</p></div>
          <div class="feature-review"><div class="panel-heading"><div><h3>Six feature checks</h3><p>Proposal covers all six; demo check records the main feature observed.</p></div><a class="text-button" href="#evidence-citations" @click.prevent="openEvidenceForTeam">Jump to evidence</a></div><div class="feature-table"><div class="feature-row feature-header"><span>Feature</span><span>Proposal</span><span>Demo</span><span>Note</span></div><div v-for="(feature, index) in selectedReview.features" :key="index" class="feature-row"><strong>{{ features[index] ?? `Feature ${index + 1}` }}</strong><select :value="feature.proposal" :class="featureClass(feature.proposal)" :aria-label="`${features[index]} proposal status`" @change="setFeatureStatus(index, 'proposal', $event)"><option value="unverified">Unverified</option><option value="present">Present</option><option value="missing">Missing</option></select><select :value="feature.demo" :class="featureClass(feature.demo)" :aria-label="`${features[index]} demo status`" @change="setFeatureStatus(index, 'demo', $event)"><option value="unverified">Unverified</option><option value="present">Present</option><option value="missing">Missing</option></select><input :value="feature.note" :aria-label="`${features[index]} note`" placeholder="Evidence note" @input="updateFeatureNote(index, $event)" /></div></div></div>
          <div class="review-approval"><label class="check-label"><input :checked="selectedReview.warningsAcknowledged" type="checkbox" @change="handleWarningsChange" /> I acknowledge the warnings on this review</label><button class="primary-button" type="button" :disabled="!selectedReviewReady" @click="approveReview"><Check :size="15" aria-hidden="true" /> Mark reviewed</button></div>
        </div>
        <aside class="notes-panel"><div class="panel-heading"><div><h3>Notes</h3><p>Every note is timestamped at entry.</p></div><LinkIcon :size="16" aria-hidden="true" /></div><textarea :value="selectedReview.notes" rows="9" placeholder="Write an observation or decision note…" @input="handleReviewNotesChange" /><div class="note-entry"><input v-model="newNote" placeholder="Add timestamped note" @keydown.enter.prevent="appendTimestampedNote" /><button class="icon-button" type="button" aria-label="Add timestamped note" @click="appendTimestampedNote"><Send :size="15" aria-hidden="true" /></button></div><form class="submission-form" @submit.prevent="openSubmissionLink"><label>Submission link<input v-model="submissionUrl" type="url" placeholder="https://…" /></label><button class="secondary-button" type="submit"><LinkIcon :size="14" aria-hidden="true" /> Capture link</button><p v-if="submissionMessage" class="feedback" role="status">{{ submissionMessage }}</p></form><div id="evidence-citations" class="citation-list"><h4>Evidence citations</h4><button v-for="item in selectedTeamEvidence" :key="item.id" type="button" @click="activeTab = 'evidence'; loadEvidence(item)"><FileText :size="14" aria-hidden="true" /> {{ item.title }}</button><p v-if="!selectedTeamEvidence.length" class="empty-copy">Citations appear after intake.</p></div></aside>
      </div>
    </section>

    <section class="operations-grid" aria-label="Operations">
      <article class="operations-card"><div class="panel-heading"><div><div class="eyebrow">Local station</div><h3>{{ local ? 'Pair this station' : 'Pair a judging station' }}</h3></div><GitBranch :size="17" aria-hidden="true" /></div><p class="muted-copy">Pairing grants a short-lived code. It never submits a participant link.</p><form class="pair-form" @submit.prevent="local ? pairLocalDevice() : createAdminPairCode()"><label v-if="local">Pairing code<input v-model="pairCode" autocomplete="one-time-code" inputmode="numeric" maxlength="8" placeholder="Enter code" /></label><output v-else-if="pairCode" class="pair-code" aria-label="Pairing code">{{ pairCode }}</output><button class="secondary-button" type="submit" :disabled="pairLoading">{{ local ? 'Pair station' : 'Create 10-minute code' }}</button></form><p v-if="pairMessage" class="feedback" role="status">{{ pairMessage }}</p><ul v-if="!local && pairedDevices.length" class="device-list"><li v-for="device in pairedDevices" :key="device.id ?? device.deviceId"><span><strong>{{ device.name ?? device.label ?? 'Judging station' }}</strong><small>{{ device.lastSeenAt ? `Last seen ${formatDateTime(device.lastSeenAt)}` : 'Pending' }}</small></span><button class="text-button danger-text" type="button" @click="revokeDevice(device)">Revoke</button></li></ul></article>
      <article class="operations-card"><div class="panel-heading"><div><div class="eyebrow">Export and intake</div><h3>Evidence remains reviewable</h3></div><Download :size="17" aria-hidden="true" /></div><p class="muted-copy">Intake adds selected evidence records; exports stay separate from link submission.</p><div class="operation-buttons"><button v-if="local" class="secondary-button" type="button" :disabled="intakeLoading" @click="startIntake"><RefreshCw :size="15" aria-hidden="true" /> {{ intakeLoading ? 'Intake running…' : 'Run local intake' }}</button><a class="secondary-button" :href="`${apiBase}/exports?final=0`" download><Download :size="15" aria-hidden="true" /> Draft XLSX</a><a class="primary-button" :href="`${apiBase}/exports?final=1`" download><Download :size="15" aria-hidden="true" /> Final XLSX</a></div><p class="micro-copy"><ShieldCheck :size="14" aria-hidden="true" /> Final export should be used only after explicit reviewed approval.</p></article>
    </section>

    <div v-if="conflict" ref="conflictDialog" class="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="conflict-title" tabindex="-1">
      <div class="conflict-dialog"><button class="icon-button close-modal" type="button" aria-label="Close conflict dialog" @click="conflict = null"><X :size="17" aria-hidden="true" /></button><div class="eyebrow">Version conflict</div><h2 id="conflict-title">Choose which review to keep</h2><p>The server changed <strong>{{ conflict.key }}</strong> while this station had edits pending. Compare the two snapshots before continuing.</p><div class="conflict-grid"><div><h3>This station</h3><pre>{{ JSON.stringify(conflict.local.data, null, 2) }}</pre></div><div><h3>Server</h3><pre>{{ JSON.stringify(conflict.current.data, null, 2) }}</pre></div></div><div class="dialog-actions"><button class="secondary-button" type="button" @click="resolveConflict('server')">Use server snapshot</button><button class="primary-button" type="button" @click="resolveConflict('local')">Keep my edits and retry</button></div></div>
    </div>
  </main>
</template>

<style scoped>
.judging-workspace {
  --judge-bg: #f0f0ed;
  --judge-surface: #fbfbf8;
  --judge-surface-raised: #fff;
  --judge-text: #22231f;
  --judge-muted: #66675f;
  --judge-border: #d8d8d0;
  --judge-border-strong: #a6a79d;
  --judge-yellow: #f5ce28;
  --judge-yellow-ink: #25220b;
  --judge-green: #2f6f50;
  --judge-red: #a84436;
  --judge-shadow: 0 8px 22px rgb(25 26 20 / 8%);
  width: 100%;
  min-height: 100%;
  padding: clamp(0.5rem, 1.8vw, 1.25rem);
  background: var(--judge-bg);
  color: var(--judge-text);
  font-family: Inter, Arial, sans-serif;
  font-size: 0.86rem;
  line-height: 1.45;
}

.judging-workspace[data-theme='dark'] {
  --judge-bg: #181916;
  --judge-surface: #22231f;
  --judge-surface-raised: #2a2b25;
  --judge-text: #f1f1e9;
  --judge-muted: #acae9f;
  --judge-border: #44463e;
  --judge-border-strong: #707267;
  --judge-yellow: #f5ce28;
  --judge-yellow-ink: #25220b;
  --judge-green: #72c48e;
  --judge-red: #f08475;
  --judge-shadow: 0 12px 30px rgb(0 0 0 / 18%);
}

@media (prefers-color-scheme: dark) {
  .judging-workspace[data-theme='system'] {
    --judge-bg: #181916;
    --judge-surface: #22231f;
    --judge-surface-raised: #2a2b25;
    --judge-text: #f1f1e9;
    --judge-muted: #acae9f;
    --judge-border: #44463e;
    --judge-border-strong: #707267;
    --judge-yellow: #f5ce28;
    --judge-yellow-ink: #25220b;
    --judge-green: #72c48e;
    --judge-red: #f08475;
    --judge-shadow: 0 12px 30px rgb(0 0 0 / 18%);
  }
}

* { box-sizing: border-box; }

button, input, select, textarea { font: inherit; }

button, a, input, select, textarea { -webkit-tap-highlight-color: transparent; }

button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex='-1']:focus-visible { outline: 3px solid var(--judge-yellow); outline-offset: 2px; }

a { color: inherit; }

.workspace-header, .section-heading, .panel-heading, .header-actions, .section-actions, .workbench-actions, .operation-buttons, .dialog-actions { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }

.workspace-header { align-items: flex-start; gap: 1rem; margin: 0 auto 1rem; max-width: 1440px; }

.header-title { min-width: 0; }

.eyebrow { display: flex; align-items: center; gap: 0.4rem; color: var(--judge-muted); font-size: 0.66rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }

h1, h2, h3, h4, p { margin: 0; }

h1 { margin-top: 0.28rem; font-size: clamp(1.35rem, 2.5vw, 2rem); letter-spacing: -0.03em; line-height: 1.1; }

h2 { margin-top: 0.2rem; font-size: clamp(1rem, 1.8vw, 1.3rem); letter-spacing: -0.02em; }

h3 { font-size: 0.98rem; letter-spacing: -0.01em; }

h4 { font-size: 0.78rem; }

.header-title p, .muted-copy, .panel-copy p, .operations-card > p { color: var(--judge-muted); }

.header-title p { margin-top: 0.35rem; font-size: 0.78rem; }

.header-actions { flex-wrap: wrap; justify-content: flex-end; }

.sync-pill, .status-badge { display: inline-flex; align-items: center; gap: 0.32rem; border: 1px solid var(--judge-border); border-radius: 99px; padding: 0.28rem 0.52rem; font-size: 0.68rem; font-weight: 750; white-space: nowrap; }

.sync-online { background: color-mix(in srgb, var(--judge-green) 12%, var(--judge-surface)); color: var(--judge-green); }
.sync-pending { background: color-mix(in srgb, var(--judge-yellow) 24%, var(--judge-surface)); color: var(--judge-yellow-ink); }
.sync-offline, .sync-danger { background: color-mix(in srgb, var(--judge-red) 12%, var(--judge-surface)); color: var(--judge-red); }

.icon-button, .theme-switcher button { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--judge-border); background: var(--judge-surface-raised); color: var(--judge-text); }
.icon-button { min-width: 2.15rem; min-height: 2.15rem; padding: 0.4rem; border-radius: 0.5rem; }
.icon-button:hover, .theme-switcher button:hover, .secondary-button:hover, .filter-buttons button:hover, .workbench-tabs button:hover { background: var(--judge-bg); }
.icon-button:disabled, button:disabled { cursor: not-allowed; opacity: 0.5; }

.theme-switcher { display: inline-flex; border: 1px solid var(--judge-border); border-radius: 0.5rem; overflow: hidden; }
.theme-switcher button { min-width: 2rem; min-height: 2.15rem; border: 0; border-right: 1px solid var(--judge-border); border-radius: 0; }
.theme-switcher button:last-child { border-right: 0; }
.theme-switcher button.selected { background: var(--judge-yellow); color: var(--judge-yellow-ink); }

.workspace-alert { display: flex; align-items: center; gap: 0.55rem; max-width: 1440px; margin: 0 auto 1rem; border: 1px solid var(--judge-border); padding: 0.65rem 0.8rem; }
.alert-error { background: color-mix(in srgb, var(--judge-red) 11%, var(--judge-surface)); color: var(--judge-red); }
.text-button { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 0.78rem; font-weight: 800; text-decoration: underline; text-underline-offset: 0.15em; }
.danger-text { color: var(--judge-red); }

.overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.7rem; max-width: 1440px; margin: 0 auto 0.75rem; }
.overview-card, .judge-strip, .review-table-section, .workbench, .operations-card { border: 1px solid var(--judge-border); background: var(--judge-surface); box-shadow: var(--judge-shadow); }
.overview-card { display: flex; min-height: 6.5rem; gap: 0.7rem; padding: 0.9rem; }
.card-icon { display: grid; place-items: center; width: 2rem; height: 2rem; flex: 0 0 auto; border: 1px solid var(--judge-border); background: var(--judge-yellow); color: var(--judge-yellow-ink); }
.card-label { display: block; color: var(--judge-muted); font-size: 0.65rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.overview-card strong { display: block; margin-top: 0.2rem; font-size: 1.08rem; }
.overview-card small { display: block; margin-top: 0.24rem; color: var(--judge-muted); font-size: 0.68rem; }

.judge-strip, .review-table-section, .workbench { max-width: 1440px; margin: 0 auto 0.75rem; }
.judge-strip { display: grid; grid-template-columns: minmax(11rem, 0.65fr) minmax(0, 1.35fr); gap: 1rem; padding: 0.9rem; }
.judge-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: end; gap: 0.65rem; }
.judge-fields label, .pair-form label, .submission-form label, .repo-check label { display: grid; gap: 0.28rem; color: var(--judge-muted); font-size: 0.69rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
.judge-fields input, .judge-fields select, .judge-fields textarea, .pair-form input, .submission-form input, .repo-check select, .notes-panel textarea, .note-entry input, .feature-row input, .feature-row select, .score-field input { width: 100%; min-height: 2.35rem; border: 1px solid var(--judge-border); border-radius: 0.35rem; background: var(--judge-surface-raised); color: var(--judge-text); padding: 0.48rem 0.55rem; font-size: 0.78rem; letter-spacing: normal; text-transform: none; }
.judge-fields textarea { resize: vertical; grid-column: 1 / -1; }
.judge-fields .judge-notes { grid-column: 1 / -1; }
.check-label { display: flex !important; align-items: flex-start; gap: 0.42rem; color: var(--judge-text) !important; font-size: 0.73rem !important; font-weight: 650 !important; letter-spacing: normal !important; text-transform: none !important; }
.check-label input { width: 1rem; min-height: 1rem; margin-top: 0.1rem; accent-color: var(--judge-yellow); }
.judge-fields .check-label { grid-column: 1 / -1; }

.review-table-section, .workbench { padding: 1rem; }
.section-heading { align-items: flex-start; }
.section-actions, .workbench-actions { flex-wrap: wrap; justify-content: flex-end; }
.primary-button, .secondary-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.38rem; min-height: 2.3rem; border: 1px solid var(--judge-border-strong); border-radius: 0.35rem; padding: 0.48rem 0.7rem; cursor: pointer; font-size: 0.74rem; font-weight: 800; text-decoration: none; }
.primary-button { border-color: var(--judge-yellow); background: var(--judge-yellow); color: var(--judge-yellow-ink); }
.primary-button:hover { filter: brightness(0.97); }
.secondary-button { background: var(--judge-surface-raised); color: var(--judge-text); }

.queue-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.65rem; margin: 1rem 0 0.7rem; }
.search-field { display: flex; align-items: center; gap: 0.45rem; min-width: min(100%, 16rem); flex: 1 1 16rem; border: 1px solid var(--judge-border); background: var(--judge-surface-raised); padding: 0 0.65rem; color: var(--judge-muted); }
.search-field input { width: 100%; min-height: 2.25rem; border: 0; outline: 0; background: transparent; color: var(--judge-text); }
.filter-buttons { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.filter-buttons button, .workbench-tabs button { border: 1px solid var(--judge-border); background: var(--judge-surface-raised); color: var(--judge-muted); padding: 0.45rem 0.6rem; cursor: pointer; font-size: 0.71rem; font-weight: 750; }
.filter-buttons button.active, .workbench-tabs button.active { background: var(--judge-yellow); color: var(--judge-yellow-ink); border-color: var(--judge-yellow); }
.table-scroll { overflow-x: auto; border: 1px solid var(--judge-border); }
.review-table { width: 100%; min-width: 48rem; border-collapse: collapse; }
.review-table th, .review-table td { padding: 0.65rem 0.7rem; border-bottom: 1px solid var(--judge-border); text-align: left; vertical-align: middle; }
.review-table tbody tr { cursor: pointer; }
.review-table tbody tr:hover, .review-table tbody tr.selected { background: color-mix(in srgb, var(--judge-yellow) 8%, var(--judge-surface)); }
.review-table tbody tr:last-child th, .review-table tbody tr:last-child td { border-bottom: 0; }
.review-table thead th { color: var(--judge-muted); font-size: 0.64rem; letter-spacing: 0.08em; text-transform: uppercase; }
.sort-button { display: inline-flex; align-items: center; gap: 0.28rem; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-transform: inherit; }
.team-link { display: grid; gap: 0.15rem; border: 0; background: transparent; color: var(--judge-text); text-align: left; cursor: pointer; font-weight: 800; }
.team-link small { color: var(--judge-muted); font-size: 0.65rem; font-weight: 500; }
.status-badge { padding: 0.22rem 0.45rem; border-radius: 0.25rem; font-size: 0.64rem; }
.status-neutral { background: color-mix(in srgb, var(--judge-muted) 10%, var(--judge-surface)); color: var(--judge-muted); }
.status-warning { background: color-mix(in srgb, var(--judge-red) 12%, var(--judge-surface)); color: var(--judge-red); }
.status-ready { background: color-mix(in srgb, var(--judge-green) 12%, var(--judge-surface)); color: var(--judge-green); }
.score-cell { display: flex; align-items: center; gap: 0.35rem; min-width: 9rem; }
.score-cell strong { min-width: 2.3rem; }
.score-cell small { color: var(--judge-muted); font-size: 0.65rem; }
.weighted-bar, .progress-track { display: block; overflow: hidden; height: 0.45rem; background: var(--judge-border); }
.weighted-bar { width: 4rem; }
.weighted-bar i, .progress-track i { display: block; height: 100%; background: var(--judge-yellow); }
.heatmap { display: grid; grid-template-columns: repeat(6, 0.85rem); gap: 0.18rem; }
.heatmap span { display: block; width: 0.85rem; height: 0.85rem; border: 1px solid var(--judge-border); }
.feature-unverified { background: var(--judge-border); }
.feature-present { background: var(--judge-green); border-color: var(--judge-green) !important; }
.feature-missing { background: var(--judge-red); border-color: var(--judge-red) !important; }
.evidence-count { display: inline-flex; align-items: center; gap: 0.25rem; border: 0; background: transparent; color: var(--judge-text); cursor: pointer; font-weight: 750; }
.empty-cell, .empty-copy { color: var(--judge-muted); text-align: center !important; }

.workbench-heading { margin-bottom: 0.7rem; }
.workbench-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--judge-border); margin: 0 -1rem 0.85rem; padding: 0 1rem; }
.workbench-panel { min-height: 18rem; }
.queue-panel { display: grid; grid-template-columns: minmax(15rem, 0.7fr) minmax(0, 1.3fr); gap: 1rem; }
.panel-copy { display: grid; align-content: start; gap: 0.65rem; }
.job-list { display: grid; align-content: start; gap: 0.3rem; }
.job-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(8rem, 0.45fr) auto; align-items: center; gap: 0.6rem; border: 1px solid var(--judge-border); background: var(--judge-surface-raised); padding: 0.55rem 0.65rem; }
.job-row strong, .job-row small { display: block; }
.job-row small { color: var(--judge-muted); font-size: 0.69rem; }
.job-progress { display: flex; align-items: center; gap: 0.45rem; color: var(--judge-muted); font-size: 0.67rem; }
.progress-track { flex: 1; height: 0.4rem; }
.feedback { color: var(--judge-muted); font-size: 0.72rem; }

.evidence-panel { display: grid; grid-template-columns: minmax(15rem, 0.4fr) minmax(0, 1.6fr); gap: 0.85rem; }
.evidence-list { min-width: 0; border-right: 1px solid var(--judge-border); padding-right: 0.85rem; }
.evidence-list .panel-heading { align-items: flex-start; margin-bottom: 0.55rem; }
.evidence-list .panel-heading p { margin-top: 0.2rem; color: var(--judge-muted); font-size: 0.68rem; }
.evidence-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.45rem; width: 100%; border: 1px solid transparent; background: transparent; color: var(--judge-text); padding: 0.55rem; text-align: left; cursor: pointer; }
.evidence-item:hover, .evidence-item.active { border-color: var(--judge-border); background: color-mix(in srgb, var(--judge-yellow) 10%, var(--judge-surface)); }
.evidence-item strong, .evidence-item small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evidence-item strong { font-size: 0.74rem; }
.evidence-item small { color: var(--judge-muted); font-size: 0.65rem; }
.evidence-reader { min-width: 0; }
.reader-state { display: flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 16rem; color: var(--judge-muted); }
.reader-error { color: var(--judge-red); }
.reader-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; border-bottom: 1px solid var(--judge-border); padding-bottom: 0.7rem; }
.reader-header p { margin-top: 0.25rem; color: var(--judge-muted); font-size: 0.7rem; overflow-wrap: anywhere; }
.reader-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.4rem; padding: 0.55rem 0; color: var(--judge-muted); font-size: 0.67rem; }
.source-reader { max-height: 25rem; overflow: auto; border: 1px solid var(--judge-border); background: var(--judge-surface-raised); }
.source-line { display: grid; grid-template-columns: 3rem minmax(0, 1fr); gap: 0.65rem; min-height: 1.45rem; border-bottom: 1px solid color-mix(in srgb, var(--judge-border) 60%, transparent); padding: 0.2rem 0.55rem; }
.source-line > span { color: var(--judge-muted); font-size: 0.68rem; text-align: right; user-select: none; }
.source-line code { white-space: pre-wrap; overflow-wrap: anywhere; font: 0.72rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
.pdf-pages { display: grid; gap: 0.4rem; margin-top: 0.7rem; }
.pdf-pages > div { border: 1px solid var(--judge-border); padding: 0.55rem; }
.pdf-pages p { margin-top: 0.25rem; color: var(--judge-muted); white-space: pre-wrap; }

.scoring-panel { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(16rem, 0.75fr); gap: 1rem; }
.score-form, .notes-panel { min-width: 0; }
.large-score { display: flex; align-items: baseline; gap: 0.18rem; font-size: 1.6rem; }
.large-score small { color: var(--judge-muted); font-size: 0.7rem; }
.criteria-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; margin-top: 0.75rem; }
.score-field { position: relative; display: grid; gap: 0.28rem; }
.score-field > span { color: var(--judge-muted); font-size: 0.68rem; font-weight: 750; }
.score-field > span small { color: var(--judge-text); }
.score-field em { position: absolute; right: 0.55rem; bottom: 0.62rem; color: var(--judge-muted); font-size: 0.66rem; font-style: normal; }
.score-field input { padding-right: 2rem; }
.repo-check { display: flex; align-items: end; justify-content: space-between; gap: 1rem; margin-top: 0.75rem; }
.repo-check label { flex: 1 1 16rem; }
.micro-copy { display: flex; align-items: center; gap: 0.35rem; color: var(--judge-muted); font-size: 0.68rem; }
.feature-review { margin-top: 1rem; }
.feature-review .panel-heading { align-items: flex-start; margin-bottom: 0.55rem; }
.feature-review .panel-heading p { margin-top: 0.18rem; color: var(--judge-muted); font-size: 0.68rem; }
.feature-table { overflow-x: auto; border: 1px solid var(--judge-border); }
.feature-row { display: grid; grid-template-columns: minmax(8rem, 1.1fr) 7rem 7rem minmax(10rem, 1.4fr); gap: 0.45rem; align-items: center; border-bottom: 1px solid var(--judge-border); padding: 0.45rem 0.55rem; }
.feature-row:last-child { border-bottom: 0; }
.feature-row strong { font-size: 0.72rem; }
.feature-row select { min-height: 2rem; padding: 0.25rem 0.35rem; font-size: 0.67rem; }
.feature-row input { min-height: 2rem; padding: 0.25rem 0.4rem; font-size: 0.67rem; }
.feature-header { color: var(--judge-muted); font-size: 0.63rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
.review-approval { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.65rem; margin-top: 0.85rem; }
.notes-panel { display: grid; align-content: start; gap: 0.55rem; border-left: 1px solid var(--judge-border); padding-left: 1rem; }
.notes-panel .panel-heading { align-items: flex-start; }
.notes-panel .panel-heading p { margin-top: 0.2rem; color: var(--judge-muted); font-size: 0.68rem; }
.notes-panel textarea { min-height: 10rem; resize: vertical; line-height: 1.55; }
.note-entry { display: flex; gap: 0.35rem; }
.note-entry input { flex: 1 1 auto; }
.submission-form { display: grid; gap: 0.45rem; border-top: 1px solid var(--judge-border); padding-top: 0.7rem; }
.citation-list { display: grid; gap: 0.3rem; border-top: 1px solid var(--judge-border); padding-top: 0.7rem; }
.citation-list button { display: flex; align-items: center; gap: 0.35rem; border: 0; background: transparent; color: var(--judge-text); cursor: pointer; padding: 0.2rem 0; text-align: left; font-size: 0.7rem; }
.citation-list button:hover { color: var(--judge-yellow-ink); text-decoration: underline; }

.operations-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; max-width: 1440px; margin: 0 auto; }
.operations-card { min-width: 0; padding: 0.9rem; }
.operations-card > p { margin: 0.55rem 0; font-size: 0.75rem; }
.pair-form { display: flex; align-items: end; flex-wrap: wrap; gap: 0.5rem; }
.pair-form label { flex: 1 1 12rem; }
.pair-code { display: inline-flex; align-items: center; min-height: 2.3rem; border: 1px dashed var(--judge-yellow); background: color-mix(in srgb, var(--judge-yellow) 14%, var(--judge-surface)); padding: 0.45rem 0.7rem; font: 800 1.1rem/1 ui-monospace, monospace; letter-spacing: 0.16em; }
.operation-buttons { justify-content: flex-start; flex-wrap: wrap; }
.device-list { display: grid; gap: 0.35rem; margin: 0.65rem 0 0; padding: 0; list-style: none; }
.device-list li { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; border-top: 1px solid var(--judge-border); padding-top: 0.4rem; }
.device-list strong, .device-list small { display: block; }
.device-list small { color: var(--judge-muted); font-size: 0.66rem; }

.modal-scrim { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; overflow: auto; background: rgb(15 16 13 / 62%); padding: 1rem; }
.conflict-dialog { position: relative; width: min(100%, 72rem); border: 1px solid var(--judge-border-strong); background: var(--judge-surface); color: var(--judge-text); box-shadow: 0 24px 60px rgb(0 0 0 / 28%); padding: clamp(1rem, 3vw, 1.6rem); }
.close-modal { position: absolute; top: 0.8rem; right: 0.8rem; }
.conflict-dialog > p { max-width: 50rem; margin-top: 0.5rem; color: var(--judge-muted); }
.conflict-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; margin: 1rem 0; }
.conflict-grid h3 { margin-bottom: 0.35rem; }
.conflict-grid pre { max-height: 15rem; overflow: auto; border: 1px solid var(--judge-border); background: var(--judge-surface-raised); padding: 0.65rem; white-space: pre-wrap; overflow-wrap: anywhere; font: 0.68rem/1.4 ui-monospace, monospace; }
.dialog-actions { justify-content: flex-end; flex-wrap: wrap; }
.spin { animation: judging-spin 0.9s linear infinite; }
@keyframes judging-spin { to { transform: rotate(360deg); } }

@media (max-width: 1000px) {
  .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .judge-strip { grid-template-columns: 1fr; }
  .scoring-panel { grid-template-columns: 1fr; }
  .notes-panel { border-top: 1px solid var(--judge-border); border-left: 0; padding-top: 1rem; padding-left: 0; }
}

@media (max-width: 720px) {
  .judging-workspace { padding: 0.65rem; }
  .workspace-header { flex-direction: column; }
  .header-actions { width: 100%; justify-content: flex-start; }
  .overview-grid { gap: 0.5rem; }
  .overview-card { min-height: 5.7rem; padding: 0.7rem; }
  .judge-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .judge-fields .check-label { grid-column: 1 / -1; }
  .section-heading, .workbench-heading { flex-direction: column; }
  .section-actions, .workbench-actions { width: 100%; justify-content: flex-start; }
  .workbench-tabs button { flex: 1 1 0; }
  .queue-panel, .evidence-panel { grid-template-columns: 1fr; }
  .evidence-list { border-right: 0; border-bottom: 1px solid var(--judge-border); padding: 0 0 0.75rem; }
  .criteria-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .repo-check { align-items: stretch; flex-direction: column; }
  .operations-grid { grid-template-columns: 1fr; }
}

@media (max-width: 430px) {
  .overview-grid { grid-template-columns: 1fr 1fr; }
  .overview-card { display: block; }
  .overview-card .card-icon { margin-bottom: 0.45rem; }
  .judge-fields { grid-template-columns: 1fr; }
  .judge-fields .check-label { grid-column: auto; }
  .criteria-grid { grid-template-columns: 1fr 1fr; gap: 0.35rem; }
  .score-field > span { min-height: 2rem; }
  .feature-row { grid-template-columns: minmax(7rem, 1fr) 5.7rem 5.7rem; }
  .feature-row input { grid-column: 1 / -1; }
  .feature-header input, .feature-header span:last-child { display: block; }
  .workbench, .review-table-section { padding: 0.75rem; }
  .workbench-tabs { margin-left: -0.75rem; margin-right: -0.75rem; padding-left: 0.75rem; padding-right: 0.75rem; }
  .dialog-actions { align-items: stretch; flex-direction: column-reverse; }
  .dialog-actions button { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}
</style>
