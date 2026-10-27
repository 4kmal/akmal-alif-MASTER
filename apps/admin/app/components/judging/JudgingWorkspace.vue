<script setup lang="ts">
import type { TeamId } from '../../../shared/judging/model.mjs'
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
  calculateReviews,
  CRITERIA,
  DOMAIN,
  emptyReview,
  FEATURE_COUNT,
  FEATURES,
  isTeamId,
  JUDGE_NAME,
  normalizeReview as normalizeReviewFromModel,
  readiness,
  ASSIGNMENT as SHARED_ASSIGNMENT,
  TEAMS,
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
type RepoCheck = '' | 'Yes' | 'No – private/broken' | 'No – doesn\'t match demo'
type WorkspaceTab = 'queue' | 'evidence' | 'scoring'
const WORKSPACE_TAB_ORDER: WorkspaceTab[] = ['queue', 'evidence', 'scoring']
type ReviewFilter = 'all' | 'unreviewed' | 'incomplete' | 'issues'
type SortKey = 'rank' | 'team' | 'score' | 'status' | 'updated'

interface FeatureReview {
  proposal: FeatureStatus
  demo: FeatureStatus
  note: string
}

interface ReviewData {
  teamId: string
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
  repoUrl?: string
}

interface AssignmentData {
  id: string
  judgeId: string
  domain: string
  title: string
  deadline: string
  timezone: string
  criteria: Array<{ id: string, label: string, weight: number }>
  features: string[]
  teams: Team[]
}

interface ConflictState {
  key: string
  local: RecordEnvelope
  current: RecordEnvelope
  source?: 'record' | 'sync' | 'recovery'
}

interface EvidenceItem {
  id: string
  teamId: string
  title: string
  kind: 'source' | 'document' | 'transcript' | 'link'
  path?: string
  url?: string
  text?: string
  lines?: number
  pages?: Array<{ page: number, text: string }>
  snapshotSha?: string
  sha256?: string
  observed?: boolean
  updatedAt?: string
}

interface AssessmentJob {
  id: string
  teamId: string
  status: string
  stale: boolean
  progress?: number
  message?: string
  suggestedScores?: Array<number | null>
  strengths: string[]
  concerns: string[]
  citations: AssessmentCitation[]
  features: AssessmentFeature[]
  updatedAt?: string
}

interface AssessmentCitation {
  id?: string
  evidenceId?: string
  title: string
  detail?: string
  url?: string
}

interface AssessmentFeature {
  label: string
  status: FeatureStatus
  proposal: FeatureStatus
  demo: FeatureStatus
  note: string
}

interface IntakeLink {
  url: string
  kind?: string
  status?: number | null
  accessible?: boolean
  parity?: 'unverified' | 'match' | 'mismatch'
  error?: string
  finalUrl?: string
  checkedAt?: string
}

interface IntakeData {
  teamId: string
  repoSha: string
  branch: string
  retrievedAt: string
  snapshotPath: string
  verified: boolean | null
  links: IntakeLink[]
  demoParity: 'unverified' | 'match' | 'mismatch'
}

interface BrowserDraft {
  key: string
  baseVersion: number
  data: Record<string, any>
  updatedAt: string
  pendingMutationId?: string
  pendingBaseVersion?: number
  pendingData?: Record<string, any>
  pendingGeneration?: number
}

interface PendingSaveSnapshot {
  mutationId: string
  baseVersion: number
  data: Record<string, any>
  generation: number
}

interface CanonicalFeature {
  id: string
  label: string
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  }
  catch {
    return {}
  }
}

function readJsonRecord(value: unknown): JsonRecord {
  return isJsonRecord(value) ? value : {}
}

function payloadMessage(payload: unknown, fallback: string) {
  const record = readJsonRecord(payload)
  const data = readJsonRecord(record.data)
  const candidates = [
    record.message,
    record.error,
    record.statusMessage,
    data.message,
    data.error,
    data.statusMessage,
  ]
  const message = candidates.find(value => typeof value === 'string' && value.trim())
  return typeof message === 'string' ? message : fallback
}

const DEADLINE_ISO = '2026-10-28T08:00:00+08:00'
const ORGANIZER_SUBMISSION_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSchtEzMiMPAM0wtodg1GL5UeJI0ufEkwQzHssprSlAUqXYcBg/viewform'
const canonicalFeatureDefinitions = Object.freeze(FEATURES
  .slice(0, FEATURE_COUNT)
  .map((feature: any, index: number) => typeof feature === 'string'
    ? { id: feature, label: feature }
    : { id: String(feature.id ?? feature.name ?? `feature-${index + 1}`), label: String(feature.label ?? feature.name ?? feature.id ?? `Feature ${index + 1}`) })) as readonly CanonicalFeature[]
const canonicalFeatureLabels = Object.freeze(canonicalFeatureDefinitions.map((feature: CanonicalFeature) => feature.label))

const canonicalTeams = TEAMS as unknown as Team[]
const canonicalCriteria = CRITERIA.map(criterion => ({ ...criterion }))
const canonicalAssignment = {
  ...SHARED_ASSIGNMENT,
  deadline: DEADLINE_ISO,
  criteria: canonicalCriteria,
  teams: canonicalTeams,
}

const assignment = ref<AssignmentData>(normalizeAssignment(canonicalAssignment))
const records = reactive<Record<string, RecordEnvelope>>({})
const reviewDrafts = reactive<Record<string, ReviewData>>({})
const versions = reactive<Record<string, number>>({})
const dirtyKeys = reactive(new Set<string>())
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const inflightSaves = new Map<string, Promise<void>>()
const mutationIds = new Map<string, string>()
const pendingSnapshots = new Map<string, PendingSaveSnapshot>()
const draftGenerations = reactive<Record<string, number>>({})
const browserDrafts = reactive<Record<string, BrowserDraft>>({})
const recoveredDraftKeys = new Set<string>()
const appliedStateVersions = new Map<string, { apiBase: string, version: number }>()
const DRAFT_STORAGE_KEY = 'sdc-judging-drafts-v1'
const MAX_DRAFT_BYTES = 256 * 1024
const hydrating = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const lastSyncAt = ref('')
const serverTime = ref('')
const stateCursor = ref<number | null>(null)
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const isVisible = ref(true)
type SyncStatus = 'unpaired' | 'pending' | 'syncing' | 'synced' | 'offline' | 'expired' | 'conflict' | 'failed'
const syncState = ref<SyncStatus>(props.local ? 'unpaired' : 'pending')
const syncPendingCount = ref(0)
const syncConflicts = ref<ConflictState[]>([])
const syncError = ref('')
const selectedTeamId = ref(canonicalTeams[0]?.id ?? '')
const selectedEvidenceId = ref('')
const activeTab = ref<WorkspaceTab>('queue')
const filter = ref<ReviewFilter>('all')
const searchTerm = ref('')
const sortKey = ref<SortKey>('team')
const sortDescending = ref(false)
const theme = ref<'system' | 'light' | 'dark'>('system')
const conflict = ref<ConflictState | null>(null)
const conflictDialog = ref<HTMLDivElement | null>(null)
const previousConflictFocus = ref<HTMLElement | null>(null)
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
const evidenceLink = ref('')
const evidenceLinkMessage = ref('')
const newNote = ref('')
const assessmentJobs = ref<AssessmentJob[]>([])
const latestAssessmentJobs = computed(() => {
  const teamsSeen = new Set<string>()
  return assessmentJobs.value.filter((job) => {
    if (teamsSeen.has(job.teamId))
      return false
    teamsSeen.add(job.teamId)
    return true
  })
})
const priorAssessmentJobs = computed(() => assessmentJobs.value.filter(job => !latestAssessmentJobs.value.some(latest => latest.id === job.id)))
const assessmentMessage = ref('')
const exportMessage = ref('')
const exporting = ref(false)
const exportUrls = new Set<string>()
const recoveryMessage = ref('')
const pollingTimer = ref<ReturnType<typeof setInterval> | null>(null)
let stateFetchPromise: Promise<void> | null = null
let stateFetchPromiseGeneration = -1
let stateFetchGeneration = 0
let stateFetchDisposed = false
const deadlineNow = ref(Date.now())
const filterOptions: Array<[ReviewFilter, string]> = [
  ['all', 'All'],
  ['unreviewed', 'Unreviewed'],
  ['incomplete', 'Incomplete'],
  ['issues', 'Issues'],
]

const judgeDraft = reactive<JudgeData>(defaultJudge())

const features = computed(() => assignment.value.features.slice(0, FEATURE_COUNT))
const teams = computed(() => assignment.value.teams)
const criteria = computed(() => assignment.value.criteria)

const selectedTeam = computed(() => teams.value.find(team => team.id === selectedTeamId.value) ?? teams.value[0])
const selectedReview = computed(() => reviewDrafts[selectedTeamId.value] ?? defaultReview(selectedTeamId.value))
const evidenceRecords = computed(() => Object.values(records)
  .filter(record => record.key.startsWith('evidence:'))
  .map(record => ({ ...normalizeEvidence({ ...record.data, id: record.data?.id ?? record.key.slice('evidence:'.length) }), updatedAt: record.updatedAt }))
  .filter(item => item.id))
const selectedTeamEvidence = computed(() => evidenceRecords.value
  .filter(item => item.teamId === selectedTeamId.value)
  .sort(compareEvidence))
const evidenceSearch = ref('')
const filteredSelectedTeamEvidence = computed(() => {
  const query = evidenceSearch.value.trim().toLowerCase()
  if (!query)
    return selectedTeamEvidence.value
  return selectedTeamEvidence.value.filter(item => evidenceSearchText(item).includes(query))
})
const visibleSelectedTeamEvidence = computed(() => {
  const visible = filteredSelectedTeamEvidence.value
  const selectedId = selectedEvidenceId.value
  const readSelected = selectedId && evidencePayload.value?.id === selectedId
  if (!readSelected || visible.some(item => item.id === selectedId))
    return visible
  const selected = selectedTeamEvidence.value.find(item => item.id === selectedId)
  return selected ? [...visible, selected] : visible
})
const selectedEvidence = computed(() => evidencePayload.value
  ?? selectedTeamEvidence.value.find(item => item.id === selectedEvidenceId.value)
  ?? selectedTeamEvidence.value[0]
  ?? null)
const selectedIntake = computed(() => normalizeIntake(records[`intake:${selectedTeamId.value}`]?.data))
const selectedIntakePrimaryLinks = computed(() => selectedIntake.value?.links.filter(isPrimaryIntakeLink) ?? [])
const selectedIntakeAncillaryLinks = computed(() => selectedIntake.value?.links.filter(link => !isPrimaryIntakeLink(link)) ?? [])

const reviewInputMap = computed(() => Object.fromEntries(teams.value.map(team => [team.id, { ...reviewDrafts[team.id], teamId: team.id }])))
const intakeInputMap = computed(() => {
  const entries = Object.values(records)
    .filter(record => record.key.startsWith('intake:'))
    .map(record => [record.key.slice('intake:'.length), record.data])
  return Object.fromEntries(entries)
})
const reviewRows = computed(() => calculateReviews(reviewInputMap.value))
const readinessResult = computed(() => readiness(judgeDraft, reviewInputMap.value, intakeInputMap.value))
const reviewCount = computed(() => readinessResult.value.reviewedCount)
const evidenceCount = computed(() => evidenceRecords.value.length)
const incompleteCount = computed(() => reviewRows.value.filter(row => row.status !== 'Complete').length)
const issueCount = computed(() => teams.value.filter(team => hasIssues(reviewDrafts[team.id])).length)
const deadlineText = computed(() => formatCountdown(assignment.value.deadline, deadlineNow.value))
const deadlineDate = computed(() => formatDateTime(assignment.value.deadline))
const overallReadiness = computed(() => readinessResult.value.ready ? 'Ready for export' : 'Review required')
const syncLabel = computed(() => {
  if (syncState.value === 'unpaired')
    return 'Unpaired · pair station'
  if (syncState.value === 'offline' || !isOnline.value)
    return 'Offline · edits stay local'
  if (syncState.value === 'expired')
    return 'Pairing expired · reconnect required'
  if (syncState.value === 'failed')
    return syncError.value ? `Sync error · ${syncError.value}` : 'Sync error · reconnect required'
  if (syncState.value === 'conflict')
    return `${syncConflicts.value.length || 1} conflict${syncConflicts.value.length === 1 ? '' : 's'} needs a choice`
  if (syncState.value === 'syncing' || syncState.value === 'pending' || dirtyKeys.size > 0 || syncPendingCount.value > 0)
    return syncPendingCount.value ? `Sync pending · ${syncPendingCount.value}` : 'Syncing changes…'
  return lastSyncAt.value ? `Synced ${formatTime(lastSyncAt.value)}` : 'Ready to sync'
})
const syncTone = computed(() => {
  if (!isOnline.value || syncState.value === 'offline' || syncState.value === 'unpaired')
    return 'offline'
  if (syncState.value === 'conflict' || syncState.value === 'expired' || syncState.value === 'failed')
    return 'danger'
  if (syncState.value === 'pending' || syncState.value === 'syncing' || dirtyKeys.size > 0)
    return 'pending'
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
    if (sortKey.value === 'rank')
      comparison = (rankFor(reviewDrafts[left.id]) ?? Number.POSITIVE_INFINITY) - (rankFor(reviewDrafts[right.id]) ?? Number.POSITIVE_INFINITY)
    if (sortKey.value === 'team')
      comparison = left.name.localeCompare(right.name)
    if (sortKey.value === 'score')
      comparison = (scoreFor(reviewDrafts[left.id]) ?? 0) - (scoreFor(reviewDrafts[right.id]) ?? 0)
    if (sortKey.value === 'status')
      comparison = statusLabel(reviewDrafts[left.id]).localeCompare(statusLabel(reviewDrafts[right.id]))
    if (sortKey.value === 'updated')
      comparison = updatedAtFor(left.id).localeCompare(updatedAtFor(right.id))
    return sortDescending.value ? -comparison : comparison
  })
})

const currentReviewStatus = computed(() => statusLabel(selectedReview.value))
const selectedScore = computed(() => scoreFor(selectedReview.value))
const selectedReviewReady = computed(() => canApproveReview(selectedReview.value))
const selectedAssessment = computed(() => assessmentJobs.value
  .filter(job => job.teamId === selectedTeamId.value && hasAssessmentContent(job))
  .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))[0])
const selectedEvidenceLines = computed(() => {
  const item = selectedEvidence.value
  if (!item)
    return []
  return String(item.text ?? '').split('\n').map((text, index) => ({ number: index + 1, text }))
})

function normalizeAssignment(source: any): AssignmentData {
  const value = source && typeof source === 'object' ? source : {}
  return {
    id: SHARED_ASSIGNMENT.id,
    judgeId: SHARED_ASSIGNMENT.judgeId,
    domain: DOMAIN,
    title: String(value.title ?? 'SDC 2026 judging workspace'),
    deadline: DEADLINE_ISO,
    timezone: 'MYT',
    criteria: canonicalCriteria.map((criterion, index) => ({
      id: String(criterion.id ?? canonicalCriteria[index]?.id ?? `criterion-${index + 1}`),
      label: String(criterion.label ?? canonicalCriteria[index]?.label ?? `Criterion ${index + 1}`),
      weight: criterion.weight,
    })),
    features: [...canonicalFeatureLabels],
    teams: canonicalTeams.map(team => ({
      id: String(team.id),
      name: String(team.name),
      shortName: String(team.shortName ?? team.name),
      repoUrl: team.repoUrl ? String(team.repoUrl) : undefined,
    })),
  }
}

function defaultJudge(): JudgeData {
  return {
    name: JUDGE_NAME,
    date: todayInTimezone('Asia/Kuala_Lumpur'),
    domain: DOMAIN,
    generalNotes: '',
    warningsAcknowledged: false,
  }
}

function todayInTimezone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function requireTeamId(value: string): TeamId {
  if (!isTeamId(value))
    throw new Error(`Unknown judging team: ${value}`)
  return value
}

function defaultReview(teamId: string): ReviewData {
  return emptyReview(requireTeamId(teamId)) as ReviewData
}

for (const team of canonicalTeams) reviewDrafts[team.id] = defaultReview(team.id)

function normalizeReview(source: any, teamId: string): ReviewData {
  const value = source && typeof source === 'object' ? source : {}
  const canonicalTeamId = requireTeamId(teamId)
  return normalizeReviewFromModel({ ...value, teamId: canonicalTeamId }, canonicalTeamId, { allowDefaults: true }) as ReviewData
}

function normalizeFeatureStatus(value: any): FeatureStatus {
  const candidate = value && typeof value === 'object'
    ? value.status ?? value.value ?? value.state
    : value
  return candidate === 'present' || candidate === 'missing' ? candidate : 'unverified'
}

function normalizeRepoCheck(value: any): RepoCheck {
  if (value === 'Yes' || value === 'No – private/broken' || value === 'No – doesn\'t match demo')
    return value
  return ''
}

function assessmentResult(source: any): Record<string, any> {
  const candidates = [source?.draft, source?.result, source?.assessment, source?.output, source]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate))
      return candidate
    if (typeof candidate === 'string') {
      try {
        const parsed = JSON.parse(candidate)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          return parsed
      }
      catch {
        // A completed job without structured output still remains visible by status.
      }
    }
  }
  return {}
}

function normalizeStringList(value: any): string[] {
  if (!Array.isArray(value))
    return []
  return value.map(item => typeof item === 'string' ? item.trim() : String(item?.text ?? item?.label ?? '')).filter(Boolean).slice(0, 20)
}

function normalizeAssessmentCitations(value: any): AssessmentCitation[] {
  if (!Array.isArray(value))
    return []
  const flattened: any[] = value.flatMap((item: any): any[] => {
    if (item && typeof item === 'object' && Array.isArray(item.citations))
      return [item, ...item.citations]
    return [item]
  })
  return flattened.flatMap((item: any): AssessmentCitation[] => {
    if (typeof item === 'string')
      return [{ title: item, url: item }]
    if (!item || typeof item !== 'object')
      return []
    const url = item.url ? String(item.url) : undefined
    const title = String(item.title ?? item.name ?? item.path ?? item.evidenceId ?? item.id ?? url ?? 'Evidence citation')
    const detail = item.detail
      ?? (item.page !== undefined ? `page ${item.page}` : undefined)
      ?? (item.lineStart !== undefined
        ? `lines ${item.lineStart}${item.lineEnd !== undefined && item.lineEnd !== item.lineStart ? `–${item.lineEnd}` : ''}`
        : item.line !== undefined ? `line ${item.line}` : undefined)
    return [{
      id: item.id ? String(item.id) : undefined,
      evidenceId: item.evidenceId ? String(item.evidenceId) : undefined,
      title,
      detail: detail === undefined ? undefined : String(detail),
      url,
    }]
  }).slice(0, 30)
}

function assessmentNestedCitations(source: any, result: Record<string, any>) {
  const groups = [source?.citations, result.citations]
  for (const field of ['strengths', 'concerns', 'features', 'proposedScores']) {
    const values = result[field]
    if (Array.isArray(values))
      groups.push(...values.map((item: any) => item?.citations))
  }
  return normalizeAssessmentCitations(groups.flatMap(group => Array.isArray(group) ? group : []))
}

function normalizeAssessmentFeatures(value: any): AssessmentFeature[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([feature, finding]) => ({ feature, ...(finding && typeof finding === 'object' ? finding : { note: finding }) }))
      : []
  return canonicalFeatureDefinitions.map(({ id, label }, index) => {
    const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const normalizedId = id.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const item = source.find((candidate: any) => {
      const candidateLabel = String(candidate?.label ?? candidate?.feature ?? candidate?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
      return candidateLabel === normalizedLabel
        || candidateLabel === normalizedId
        || candidateLabel.includes(normalizedLabel)
        || normalizedLabel.includes(candidateLabel)
    }) ?? source[index]
    if (typeof item === 'string')
      return { label, status: 'unverified', proposal: 'unverified', demo: 'unverified', note: item }
    const statusValue = item?.status
    const status = normalizeFeatureStatus(typeof statusValue === 'string' ? statusValue : item?.findingStatus ?? item?.evidenceStatus)
    const proposal = item?.proposal
      ?? item?.proposalStatus
      ?? (statusValue && typeof statusValue === 'object' ? statusValue.proposal : undefined)
      ?? (typeof statusValue === 'string' ? statusValue : undefined)
    const demo = item?.demo
      ?? item?.demoStatus
      ?? (statusValue && typeof statusValue === 'object' ? statusValue.demo : undefined)
    return {
      label,
      status,
      proposal: normalizeFeatureStatus(proposal),
      demo: normalizeFeatureStatus(demo),
      note: String(item?.note ?? item?.finding ?? (proposal && typeof proposal === 'object' ? proposal.note : '') ?? (demo && typeof demo === 'object' ? demo.note : '')),
    }
  })
}

function normalizeSuggestedScores(source: any): Array<number | null> | undefined {
  const result = assessmentResult(source)
  const candidates = [source?.suggestedScores, source?.scores, source?.draft?.proposedScores, result.suggestedScores, result.scores, result.proposedScores]
  const rawScores = candidates.find(value => Array.isArray(value))
  if (!Array.isArray(rawScores) || rawScores.length !== criteria.value.length)
    return undefined
  const normalized = Array<number | null>(criteria.value.length).fill(null)
  rawScores.forEach((score: any, index: number) => {
    const value = score && typeof score === 'object' ? score.score : score
    const criterionText = score && typeof score === 'object' ? String(score.criterion ?? '') : ''
    const normalizedCriterion = criterionText.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const criterionIndex = normalizedCriterion
      ? criteria.value.findIndex((criterion) => {
          const candidate = `${criterion.id}${criterion.label}`.toLowerCase().replace(/[^a-z0-9]+/g, '')
          return candidate.includes(normalizedCriterion) || normalizedCriterion.includes(candidate)
        })
      : index
    if (criterionIndex >= 0)
      normalized[criterionIndex] = value === null || value === undefined || value === '' ? null : clampScore(Number(value))
  })
  return normalized
}

function normalizeAssessmentJob(source: any): AssessmentJob {
  const value = source && typeof source === 'object' ? source : {}
  const result = assessmentResult(value)
  const citations = assessmentNestedCitations(value, result)
  const uniqueCitations = [...new Map(citations.map(citation => [
    `${citation.evidenceId ?? citation.id ?? citation.title}|${citation.detail ?? ''}`,
    citation,
  ])).values()]
  return {
    id: String(value.id ?? value.jobId ?? randomId()),
    teamId: String(value.teamId ?? ''),
    status: String(value.status ?? 'queued'),
    stale: value.stale === true || value.stale === 1 || value.stale === 'true' || result.stale === true || result.stale === 1 || result.stale === 'true',
    progress: Number.isFinite(Number(value.progress)) ? Number(value.progress) : undefined,
    message: value.message ? String(value.message) : value.error ? String(value.error) : undefined,
    suggestedScores: normalizeSuggestedScores(value),
    strengths: normalizeStringList(value.strengths ?? result.strengths),
    concerns: normalizeStringList(value.concerns ?? result.concerns),
    citations: uniqueCitations,
    features: normalizeAssessmentFeatures(value.features ?? result.features ?? result.featureFindings),
    updatedAt: value.updatedAt ? String(value.updatedAt) : undefined,
  }
}

function normalizeEvidence(source: any): EvidenceItem {
  const value = source && typeof source === 'object' ? source : {}
  const nested = value.evidence && typeof value.evidence === 'object' && !Array.isArray(value.evidence) ? value.evidence : value
  const text = value.text ?? nested.text
  const pages = value.pages ?? nested.pages
  return {
    id: String(nested.id ?? nested.uuid ?? nested.evidenceId ?? value.id ?? value.uuid ?? value.evidenceId ?? ''),
    teamId: String(nested.teamId ?? value.teamId ?? ''),
    title: String(nested.title ?? nested.name ?? nested.path ?? value.title ?? value.name ?? value.path ?? 'Evidence item'),
    kind: nested.kind === 'source' || nested.kind === 'document' || nested.kind === 'transcript' || nested.kind === 'link' ? nested.kind : 'link',
    path: nested.path ? String(nested.path) : undefined,
    url: nested.url ? String(nested.url) : undefined,
    text: text ? String(text) : '',
    lines: Number.isFinite(Number(value.lines ?? nested.lines)) ? Number(value.lines ?? nested.lines) : undefined,
    pages: Array.isArray(pages) ? pages : undefined,
    snapshotSha: nested.snapshotSha ? String(nested.snapshotSha) : undefined,
    sha256: nested.sha256 ? String(nested.sha256) : (nested.hash ? String(nested.hash) : undefined),
    observed: nested.kind === 'link' ? false : Boolean(nested.observed),
  }
}

function evidenceSearchText(item: EvidenceItem) {
  return [item.title, item.path, item.kind, item.url, item.snapshotSha, item.sha256]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function evidencePriority(item: EvidenceItem) {
  const pathOrTitle = `${item.path ?? ''} ${item.title}`.trim()
  const basename = (item.path ?? item.title).split(/[\\/]/).pop() ?? item.title
  if (/^readme(?:[._ -]|$)/i.test(basename) || /(?:^|[\\/])readme(?:[._ -]|$)/i.test(pathOrTitle))
    return 0
  if (item.kind === 'document' || /proposal|pitch|deck|slide|document/i.test(pathOrTitle) || /\.(?:pdf|docx?|pptx?)$/i.test(basename))
    return 1
  return 2
}

function compareEvidence(left: EvidenceItem, right: EvidenceItem) {
  const priorityDifference = evidencePriority(left) - evidencePriority(right)
  if (priorityDifference)
    return priorityDifference
  const pathDifference = String(left.path ?? left.title).localeCompare(String(right.path ?? right.title), undefined, { numeric: true, sensitivity: 'base' })
  return pathDifference || left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' }) || left.id.localeCompare(right.id)
}

function normalizeIntake(source: any): IntakeData | null {
  if (!source || typeof source !== 'object')
    return null
  const value = source as Record<string, any>
  const rawVerified = value.verified
  const verified = typeof rawVerified === 'boolean'
    ? rawVerified
    : rawVerified === 'true' ? true : rawVerified === 'false' ? false : null
  const demoParity = value.demoParity === 'match' || value.demoParity === 'mismatch' ? value.demoParity : 'unverified'
  const links = Array.isArray(value.links)
    ? value.links.flatMap((link: any) => {
        if (typeof link === 'string')
          return [{ url: link }]
        if (!link || typeof link !== 'object' || !link.url)
          return []
        return [{
          url: String(link.url),
          kind: link.kind ? String(link.kind) : undefined,
          status: typeof link.status === 'number' && Number.isFinite(link.status) ? link.status : null,
          accessible: typeof link.accessible === 'boolean' ? link.accessible : undefined,
          parity: link.parity === 'match' || link.parity === 'mismatch' ? link.parity : 'unverified',
          error: link.error ? String(link.error) : undefined,
          finalUrl: link.finalUrl ? String(link.finalUrl) : undefined,
          checkedAt: link.checkedAt ? String(link.checkedAt) : undefined,
        }]
      })
    : []
  return {
    teamId: String(value.teamId ?? ''),
    repoSha: String(value.repoSHA ?? value.repoSha ?? value.sha ?? value.snapshotSha ?? ''),
    branch: String(value.branch ?? ''),
    retrievedAt: String(value.retrievedAt ?? ''),
    snapshotPath: String(value.snapshotPath ?? ''),
    verified,
    links,
    demoParity,
  }
}

function isPrimaryIntakeLink(link: IntakeLink) {
  const description = `${link.kind ?? ''} ${link.url}`.toLowerCase()
  return /deploy|demo|video|live|production|preview|website|app|youtube|youtu\.be|vimeo|\.mp4(?:$|[?#])|\.webm(?:$|[?#])/.test(description)
}

function intakeLinkState(link: IntakeLink) {
  const access = link.accessible === true ? 'Accessible' : link.accessible === false ? 'Blocked' : 'Not checked'
  const status = typeof link.status === 'number' ? `HTTP ${link.status}` : 'No HTTP status'
  const parity = link.parity && link.parity !== 'unverified' ? ` · demo ${link.parity}` : ''
  const error = link.error ? ` · ${link.error}` : ''
  return `${access} · ${status}${parity}${error}`
}

function hasAssessmentContent(job: AssessmentJob) {
  return Boolean(job.suggestedScores?.some(score => score !== null)
    || job.strengths.length
    || job.concerns.length
    || job.citations.length
    || job.features.some(feature => feature.note || feature.status !== 'unverified' || feature.proposal !== 'unverified' || feature.demo !== 'unverified'))
}

function normalizeRecord(record: any): RecordEnvelope | null {
  if (!record || typeof record !== 'object' || typeof record.key !== 'string')
    return null
  return {
    key: record.key,
    version: Number(record.version ?? 0),
    data: record.data && typeof record.data === 'object' ? record.data : {},
    updatedAt: record.updatedAt ? String(record.updatedAt) : undefined,
  }
}

function normalizeSyncStatus(value: any): SyncStatus | null {
  return value === 'unpaired' || value === 'pending' || value === 'syncing' || value === 'synced'
    || value === 'offline' || value === 'expired' || value === 'conflict' || value === 'failed'
    ? value
    : null
}

function normalizeConflicts(source: any): ConflictState[] {
  if (!Array.isArray(source))
    return []
  return source.flatMap((item: any) => {
    const local = normalizeRecord(item?.local)
    const remote = normalizeRecord(item?.remote ?? item?.current)
    if (!local || !remote)
      return []
    return [{ key: String(item.key ?? local.key), local, current: remote, source: 'sync' as const }]
  })
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
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
    judgeDraft.name = String(value.name ?? JUDGE_NAME)
    judgeDraft.date = String(value.date ?? value.dateYYYYMMDD ?? judgeDraft.date)
    judgeDraft.domain = DOMAIN
    judgeDraft.generalNotes = String(value.generalNotes ?? '')
    judgeDraft.warningsAcknowledged = Boolean(value.warningsAcknowledged)
    return
  }
  if (record.key.startsWith('review:') && !dirtyKeys.has(record.key)) {
    reviewDrafts[record.key.slice('review:'.length)] = normalizeReview(record.data, record.key.slice('review:'.length))
  }
}

function applyState(payload: any) {
  hydrating.value = true
  const incomingAssignment = payload?.assignment
  if (incomingAssignment)
    assignment.value = normalizeAssignment(incomingAssignment)
  if (payload?.serverTime)
    serverTime.value = String(payload.serverTime)
  const incomingCursor = Number(payload?.cursor)
  if (Number.isSafeInteger(incomingCursor) && incomingCursor >= 0
    && (stateCursor.value === null || incomingCursor >= stateCursor.value)) {
    stateCursor.value = incomingCursor
  }
  const incomingConflicts = normalizeConflicts(payload?.conflicts)
  if (incomingConflicts.length) {
    syncConflicts.value = incomingConflicts
    const firstConflict = incomingConflicts[0]
    if (firstConflict)
      conflict.value = conflict.value ?? firstConflict
    syncState.value = 'conflict'
  }
  else if (Array.isArray(payload?.conflicts)) {
    syncConflicts.value = []
    if (conflict.value?.source === 'sync')
      conflict.value = null
  }
  const incoming = Array.isArray(payload?.records) ? payload.records : []
  for (const raw of incoming) {
    const record = normalizeRecord(raw)
    if (!record)
      continue
    if (dirtyKeys.has(record.key))
      continue
    const applied = appliedStateVersions.get(record.key)
    if (applied && applied.apiBase === props.apiBase && record.version < applied.version)
      continue
    applyRecord(record)
    appliedStateVersions.set(record.key, { apiBase: props.apiBase, version: record.version })
  }
  for (const team of teams.value) {
    if (!reviewDrafts[team.id])
      reviewDrafts[team.id] = defaultReview(team.id)
  }
  hydrating.value = false
  lastSyncAt.value = new Date().toISOString()
  syncState.value = syncConflicts.value.length ? 'conflict' : (dirtyKeys.size ? 'pending' : 'synced')
}

function isCurrentStateRequest(generation: number, apiBase: string) {
  return !stateFetchDisposed && generation === stateFetchGeneration && props.apiBase === apiBase
}

async function performStateFetch(generation: number, apiBase: string, options: { silent?: boolean, fullRetry?: boolean }) {
  if (!isCurrentStateRequest(generation, apiBase))
    return
  if (!isOnline.value && options.silent && !props.local) {
    syncState.value = 'offline'
    return
  }
  if (!options.silent)
    loading.value = true
  errorMessage.value = ''
  let fullRetry = Boolean(options.fullRetry)
  try {
    while (isCurrentStateRequest(generation, apiBase)) {
      const requestedCursor = stateCursor.value
      const stateEndpoint = `${apiBase}/state${requestedCursor === null ? '' : `?cursor=${requestedCursor}`}`
      const response = await fetch(stateEndpoint, { credentials: 'include', headers: { Accept: 'application/json' } })
      const payload = await readJson(response)
      if (!isCurrentStateRequest(generation, apiBase))
        return
      if (!response.ok) {
        if (response.status === 400 && requestedCursor !== null && !fullRetry) {
          stateCursor.value = null
          fullRetry = true
          continue
        }
        throw new Error(payloadMessage(payload, `State request failed (${response.status})`))
      }
      applyState(payload)
      recoverBrowserDrafts()
      await fetchSyncStatus(generation, apiBase)
      return
    }
  }
  catch (error) {
    if (!isCurrentStateRequest(generation, apiBase))
      return
    recoverBrowserDrafts()
    errorMessage.value = error instanceof Error ? error.message : 'The judging state could not be loaded.'
    syncState.value = isOnline.value ? 'pending' : 'offline'
  }
  finally {
    if (isCurrentStateRequest(generation, apiBase))
      loading.value = false
  }
}

function fetchState(options: { silent?: boolean, fullRetry?: boolean } = {}) {
  const generation = stateFetchGeneration
  const apiBase = props.apiBase
  if (stateFetchPromise && stateFetchPromiseGeneration === generation) {
    if (!options.silent)
      loading.value = true
    return stateFetchPromise
  }
  const request = performStateFetch(generation, apiBase, options)
  stateFetchPromise = request
  stateFetchPromiseGeneration = generation
  request.then(() => {
    if (stateFetchPromise === request) {
      stateFetchPromise = null
      stateFetchPromiseGeneration = -1
    }
  }, () => {
    if (stateFetchPromise === request) {
      stateFetchPromise = null
      stateFetchPromiseGeneration = -1
    }
  })
  return request
}

async function fetchSyncStatus(generation: number, apiBase: string) {
  if (!props.local) {
    syncError.value = ''
    return
  }
  if (!isCurrentStateRequest(generation, apiBase))
    return
  try {
    const response = await fetch(`${props.apiBase}/sync/status`, { credentials: 'include', headers: { Accept: 'application/json' } })
    const payload = readJsonRecord(await readJson(response))
    if (!isCurrentStateRequest(generation, apiBase))
      return
    if (!response.ok) {
      syncError.value = payloadMessage(payload, `Sync status failed (${response.status})`)
      syncState.value = 'failed'
      return
    }
    const remoteStatus = normalizeSyncStatus(payload.status)
    syncError.value = remoteStatus === 'failed' || payload.error
      ? payloadMessage(payload, 'The local sync service reported an error.')
      : ''
    syncPendingCount.value = Number(payload.pending ?? 0)
    const incomingConflicts = normalizeConflicts(payload?.conflicts)
    if (incomingConflicts.length) {
      syncConflicts.value = incomingConflicts
      const firstConflict = incomingConflicts[0]
      if (firstConflict)
        conflict.value = conflict.value ?? firstConflict
      syncState.value = 'conflict'
    }
    else if (!conflict.value) {
      syncConflicts.value = []
    }
    else if (conflict.value?.source === 'sync') {
      syncConflicts.value = []
      conflict.value = null
    }
    if (payload.lastSuccessfulAt)
      lastSyncAt.value = String(payload.lastSuccessfulAt)
    const conflictCount = Array.isArray(payload.conflicts) ? payload.conflicts.length : Number(payload.conflicts ?? 0)
    if (incomingConflicts.length || remoteStatus === 'conflict' || conflictCount > 0 || conflict.value)
      syncState.value = 'conflict'
    else if (dirtyKeys.size)
      syncState.value = 'pending'
    else if (remoteStatus)
      syncState.value = remoteStatus
  }
  catch {
    // The local bridge may start before its sync endpoint; state remains usable.
  }
}

function cloneRecordData(value: any): Record<string, any> {
  return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {}))
}

function isBrowserDraftKey(key: string) {
  return key === 'judge' || (key.startsWith('review:') && teams.value.some(team => recordKeyForTeam(team.id) === key))
}

function readBrowserDraftStore() {
  if (typeof localStorage === 'undefined')
    return {} as Record<string, BrowserDraft>
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw || raw.length > MAX_DRAFT_BYTES)
    return {} as Record<string, BrowserDraft>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object')
      return {} as Record<string, BrowserDraft>
    const drafts: Record<string, BrowserDraft> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const item = value as Partial<BrowserDraft>
      const baseVersion = typeof item.baseVersion === 'number' && Number.isSafeInteger(item.baseVersion) && item.baseVersion >= 0 ? item.baseVersion : null
      const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data as Record<string, any> : null
      if (!isBrowserDraftKey(key) || baseVersion === null || !data)
        continue
      const pendingMutationId = typeof item.pendingMutationId === 'string' && item.pendingMutationId ? item.pendingMutationId : undefined
      const pendingBaseVersion = typeof item.pendingBaseVersion === 'number' && Number.isSafeInteger(item.pendingBaseVersion) && item.pendingBaseVersion >= 0 ? item.pendingBaseVersion : undefined
      const pendingData = item.pendingData && typeof item.pendingData === 'object' && !Array.isArray(item.pendingData) ? item.pendingData as Record<string, any> : undefined
      const pendingGeneration = typeof item.pendingGeneration === 'number' && Number.isSafeInteger(item.pendingGeneration) && item.pendingGeneration >= 0 ? item.pendingGeneration : undefined
      drafts[key] = {
        key,
        baseVersion,
        data,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
        ...(pendingMutationId && pendingBaseVersion !== undefined && pendingData
          ? { pendingMutationId, pendingBaseVersion, pendingData, pendingGeneration }
          : {}),
      }
    }
    return drafts
  }
  catch {
    return {} as Record<string, BrowserDraft>
  }
}

function writeBrowserDraftStore() {
  if (typeof localStorage === 'undefined')
    return
  try {
    const entries = Object.fromEntries(Object.entries(browserDrafts).map(([key, draft]) => [key, {
      key: draft.key,
      baseVersion: draft.baseVersion,
      data: draft.data,
      updatedAt: draft.updatedAt,
      pendingMutationId: draft.pendingMutationId,
      pendingBaseVersion: draft.pendingBaseVersion,
      pendingData: draft.pendingData,
      pendingGeneration: draft.pendingGeneration,
    }])) as Record<string, BrowserDraft>
    let serialized = JSON.stringify(entries)
    if (serialized.length > MAX_DRAFT_BYTES) {
      const ordered = Object.entries(entries).sort((left, right) => String(left[1].updatedAt).localeCompare(String(right[1].updatedAt)))
      while (ordered.length && serialized.length > MAX_DRAFT_BYTES) {
        delete entries[ordered.shift()![0]]
        serialized = JSON.stringify(entries)
      }
    }
    localStorage.setItem(DRAFT_STORAGE_KEY, serialized)
  }
  catch {
    recoveryMessage.value = 'Browser draft recovery storage is unavailable; keep this station open until sync completes.'
  }
}

function persistBrowserDraft(key: string) {
  if (!isBrowserDraftKey(key))
    return
  try {
    const pending = pendingSnapshots.get(key)
    browserDrafts[key] = {
      key,
      baseVersion: versions[key] ?? 0,
      data: cloneRecordData(recordDataForKey(key)),
      updatedAt: new Date().toISOString(),
      ...(pending
        ? {
            pendingMutationId: pending.mutationId,
            pendingBaseVersion: pending.baseVersion,
            pendingData: cloneRecordData(pending.data),
            pendingGeneration: pending.generation,
          }
        : {}),
    }
    writeBrowserDraftStore()
  }
  catch {
    recoveryMessage.value = 'This edit could not be copied to browser recovery storage.'
  }
}

function clearBrowserDraft(key: string) {
  pendingSnapshots.delete(key)
  delete browserDrafts[key]
  writeBrowserDraftStore()
}

function loadBrowserDrafts() {
  for (const [key, draft] of Object.entries(readBrowserDraftStore())) {
    browserDrafts[key] = draft
    if (draft.pendingMutationId && draft.pendingBaseVersion !== undefined && draft.pendingData) {
      // Generations are session-local. Recovering the visible draft below will
      // create a new generation, so this snapshot is treated as older.
      pendingSnapshots.set(key, {
        mutationId: draft.pendingMutationId,
        baseVersion: draft.pendingBaseVersion,
        data: cloneRecordData(draft.pendingData),
        generation: 0,
      })
      mutationIds.set(key, draft.pendingMutationId)
    }
  }
  const count = Object.keys(browserDrafts).length
  if (count)
    recoveryMessage.value = `${count} unsaved browser draft${count === 1 ? '' : 's'} found. They will be recovered against the current record.`
}

function applyBrowserDraft(draft: BrowserDraft) {
  if (draft.key === 'judge') {
    const value = draft.data
    judgeDraft.name = String(value.name ?? judgeDraft.name)
    judgeDraft.date = String(value.date ?? judgeDraft.date)
    judgeDraft.domain = DOMAIN
    judgeDraft.generalNotes = String(value.generalNotes ?? '')
    judgeDraft.warningsAcknowledged = Boolean(value.warningsAcknowledged)
    return
  }
  const teamId = draft.key.slice('review:'.length)
  reviewDrafts[teamId] = normalizeReview(draft.data, teamId)
}

function recoverBrowserDrafts() {
  for (const draft of Object.values(browserDrafts)) {
    if (recoveredDraftKeys.has(draft.key))
      continue
    const current = records[draft.key]
    const currentVersion = current?.version ?? versions[draft.key] ?? 0
    if (current && currentVersion !== draft.baseVersion) {
      conflict.value = {
        key: draft.key,
        local: { key: draft.key, version: draft.baseVersion, data: cloneRecordData(draft.data), updatedAt: draft.updatedAt },
        current,
        source: 'recovery',
      }
      syncState.value = 'conflict'
      recoveredDraftKeys.add(draft.key)
      continue
    }
    try {
      applyBrowserDraft(draft)
      recoveredDraftKeys.add(draft.key)
      markDirty(draft.key)
    }
    catch {
      recoveryMessage.value = `A saved draft for ${draft.key} could not be recovered.`
      recoveredDraftKeys.add(draft.key)
    }
  }
}

function scheduleSave(key: string, delay = 2000) {
  const previous = saveTimers.get(key)
  if (previous)
    clearTimeout(previous)
  saveTimers.set(key, setTimeout(() => {
    void saveRecord(key)
  }, delay))
}

function markDirty(key: string) {
  if (hydrating.value)
    return
  dirtyKeys.add(key)
  draftGenerations[key] = (draftGenerations[key] ?? 0) + 1
  persistBrowserDraft(key)
  syncState.value = isOnline.value || props.local ? 'pending' : 'offline'
  scheduleSave(key)
}

function markReviewDirty(teamId: string) {
  markDirty(recordKeyForTeam(teamId))
}

function markJudgeDirty() {
  markDirty('judge')
}

function recordDataForKey(key: string) {
  if (key === 'judge')
    return { ...judgeDraft }
  if (key.startsWith('review:'))
    return normalizeReview(reviewDrafts[key.slice('review:'.length)], key.slice('review:'.length))
  return records[key]?.data ?? {}
}

function saveRecord(key: string): Promise<void> {
  const currentRequest = inflightSaves.get(key)
  if (currentRequest)
    return currentRequest
  const request = saveRecordOnce(key)
  inflightSaves.set(key, request)
  request.then(() => {
    if (inflightSaves.get(key) === request)
      inflightSaves.delete(key)
  }, () => {
    if (inflightSaves.get(key) === request)
      inflightSaves.delete(key)
  })
  return request
}

async function saveRecordOnce(key: string) {
  const timer = saveTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    saveTimers.delete(key)
  }
  if (!dirtyKeys.has(key))
    return
  if (!isOnline.value && !props.local) {
    syncState.value = 'offline'
    return
  }
  if (props.local && (syncConflicts.value.length || conflict.value)) {
    syncState.value = 'conflict'
    return
  }
  syncState.value = 'pending'
  const pending = pendingSnapshots.get(key)
  const generation = pending?.generation ?? draftGenerations[key] ?? 0
  const baseVersion = pending?.baseVersion ?? versions[key] ?? 0
  const data = pending ? cloneRecordData(pending.data) : cloneRecordData(recordDataForKey(key))
  const mutationId = pending?.mutationId ?? mutationIds.get(key) ?? randomId()
  const requestApiBase = props.apiBase
  try {
    if (validateRecord(key, data) === false)
      throw new Error(`Record ${key} failed validation.`)
    if (!pending) {
      pendingSnapshots.set(key, { mutationId, baseVersion, data: cloneRecordData(data), generation })
      persistBrowserDraft(key)
    }
    mutationIds.set(key, mutationId)
    const response = await fetch(`${props.apiBase}/records`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        key,
        baseVersion,
        data,
        mutationId,
      }),
    })
    const payload = readJsonRecord(await readJson(response))
    if (response.status === 409) {
      const current = normalizeRecord(payload.current ?? readJsonRecord(payload.data).current)
      if (current) {
        conflict.value = {
          key,
          current,
          local: {
            key,
            version: baseVersion,
            data,
            updatedAt: new Date().toISOString(),
          },
        }
        syncState.value = 'conflict'
        await nextTick()
        conflictDialog.value?.focus()
        return
      }
    }
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Save failed (${response.status})`))
    const saved = normalizeRecord(payload)
    if (!saved)
      throw new Error('Save response did not contain a record.')
    const newerEdits = (draftGenerations[key] ?? 0) !== generation
    pendingSnapshots.delete(key)
    records[key] = saved
    versions[key] = saved.version
    appliedStateVersions.set(key, { apiBase: requestApiBase, version: saved.version })
    if (!newerEdits)
      applyRecord(saved)
    if (newerEdits) {
      dirtyKeys.add(key)
      // The acknowledged snapshot consumed this mutation id. A later payload
      // must get a new id; only unknown outcomes keep the id for retry.
      mutationIds.delete(key)
      persistBrowserDraft(key)
      if (!saveTimers.has(key))
        scheduleSave(key)
    }
    else {
      dirtyKeys.delete(key)
      mutationIds.delete(key)
      clearBrowserDraft(key)
    }
    syncState.value = dirtyKeys.size ? 'pending' : 'synced'
    lastSyncAt.value = new Date().toISOString()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'The change could not be saved.'
    syncState.value = isOnline.value || props.local ? 'pending' : 'offline'
  }
}

async function resolveConflict(choice: 'local' | 'remote') {
  const currentConflict = conflict.value
  if (!currentConflict)
    return
  const { key, local, current } = currentConflict
  if (currentConflict.source === 'sync' && props.local) {
    try {
      const response = await fetch('/api/local/sync/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ key, choice: choice === 'local' ? 'local' : 'remote' }),
      })
      const payload = await readJson(response)
      if (!response.ok)
        throw new Error(payloadMessage(payload, `Conflict resolution failed (${response.status})`))
      syncConflicts.value = syncConflicts.value.filter(item => item.key !== key)
      if (choice === 'remote')
        clearBrowserDraft(key)
      syncState.value = syncConflicts.value.length ? 'conflict' : (dirtyKeys.size ? 'pending' : 'synced')
      conflict.value = null
      await fetchState({ silent: true })
    }
    catch (error) {
      conflict.value = currentConflict
      errorMessage.value = error instanceof Error ? error.message : 'Conflict could not be resolved.'
      syncState.value = 'conflict'
    }
    return
  }
  if (choice === 'remote') {
    applyRecord(current)
    conflict.value = null
    dirtyKeys.delete(key)
    pendingSnapshots.delete(key)
    mutationIds.delete(key)
    clearBrowserDraft(key)
    syncState.value = dirtyKeys.size ? 'pending' : 'synced'
    return
  }
  if (currentConflict.source === 'recovery') {
    applyBrowserDraft({ key, baseVersion: local.version, data: cloneRecordData(local.data), updatedAt: local.updatedAt ?? new Date().toISOString() })
    draftGenerations[key] = (draftGenerations[key] ?? 0) + 1
    persistBrowserDraft(key)
  }
  versions[key] = current.version
  conflict.value = null
  pendingSnapshots.delete(key)
  mutationIds.delete(key)
  dirtyKeys.add(key)
  syncState.value = 'pending'
  await saveRecord(key)
  if (conflict.value)
    syncState.value = 'conflict'
  else if (local)
    lastSyncAt.value = new Date().toISOString()
}

function selectTeam(teamId: string) {
  selectedTeamId.value = teamId
  if (!reviewDrafts[teamId])
    reviewDrafts[teamId] = defaultReview(teamId)
  if (activeTab.value === 'evidence')
    selectedEvidenceId.value = ''
}

function handleTabKeydown(event: KeyboardEvent, currentTab: WorkspaceTab) {
  const currentIndex = WORKSPACE_TAB_ORDER.indexOf(currentTab)
  if (currentIndex < 0)
    return
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
    nextIndex = (currentIndex + 1) % WORKSPACE_TAB_ORDER.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    nextIndex = (currentIndex - 1 + WORKSPACE_TAB_ORDER.length) % WORKSPACE_TAB_ORDER.length
  else if (event.key === 'Home')
    nextIndex = 0
  else if (event.key === 'End')
    nextIndex = WORKSPACE_TAB_ORDER.length - 1
  else
    return
  const nextTab = WORKSPACE_TAB_ORDER[nextIndex]
  if (!nextTab)
    return
  event.preventDefault()
  activeTab.value = nextTab
  const tabList = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest('[role="tablist"]') : null
  void nextTick(() => tabList?.querySelector<HTMLElement>(`[data-workbench-tab="${nextTab}"]`)?.focus())
}

function handleConflictKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab')
    return
  const dialog = conflictDialog.value
  if (!dialog)
    return
  const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
  event.preventDefault()
  const nextIndex = event.shiftKey
    ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
    : currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1
  focusable[nextIndex]?.focus()
}

function setScore(index: number, event: Event) {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  invalidateReviewApproval()
  selectedReview.value.scores[index] = raw === '' ? null : clampScore(Number(raw))
  markReviewDirty(selectedTeamId.value)
}

function clampScore(value: number) {
  if (!Number.isFinite(value))
    return null
  return Math.max(0, Math.min(100, value))
}

function setFeatureStatus(index: number, field: 'proposal' | 'demo', event: Event) {
  const input = event.target as HTMLSelectElement
  const feature = selectedReview.value.features[index]
  if (!feature)
    return
  invalidateReviewApproval()
  feature[field] = normalizeFeatureStatus(input.value)
  markReviewDirty(selectedTeamId.value)
}

function updateFeatureNote(index: number, event: Event) {
  const feature = selectedReview.value.features[index]
  if (!feature)
    return
  invalidateReviewApproval()
  feature.note = (event.target as HTMLInputElement).value
  markReviewDirty(selectedTeamId.value)
}

function updateReviewField(field: 'repoCheck' | 'notes' | 'warningsAcknowledged', value: string | boolean) {
  invalidateReviewApproval()
  if (field === 'repoCheck')
    selectedReview.value.repoCheck = normalizeRepoCheck(value)
  if (field === 'notes')
    selectedReview.value.notes = String(value)
  if (field === 'warningsAcknowledged')
    selectedReview.value.warningsAcknowledged = Boolean(value)
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
  if (!selectedReviewReady.value)
    return
  selectedReview.value.reviewedAt = new Date().toISOString()
  markReviewDirty(selectedTeamId.value)
}

function invalidateReviewApproval() {
  if (selectedReview.value.reviewedAt !== null)
    selectedReview.value.reviewedAt = null
}

function acceptAssessmentScores() {
  if (selectedAssessment.value?.stale) {
    assessmentMessage.value = 'This assessment is stale. Regenerate it before using its scores as a draft.'
    return
  }
  const suggestedScores = selectedAssessment.value?.suggestedScores
  if (!suggestedScores)
    return
  selectedReview.value.scores = suggestedScores.map(score => score === null ? null : clampScore(score))
  invalidateReviewApproval()
  markReviewDirty(selectedTeamId.value)
  assessmentMessage.value = 'AI scores copied as a draft. Check evidence, then approve reviewed explicitly.'
}

function appendTimestampedNote() {
  const note = newNote.value.trim()
  if (!note)
    return
  appendReviewNote(note)
  newNote.value = ''
}

function appendReviewNote(note: string) {
  const stamp = formatDateTime(new Date().toISOString())
  const current = selectedReview.value.notes.trim()
  selectedReview.value.notes = `${current ? `${current}\n` : ''}[${stamp}] ${note}`
  invalidateReviewApproval()
  markReviewDirty(selectedTeamId.value)
}

function sortBy(key: SortKey) {
  if (sortKey.value === key) {
    sortDescending.value = !sortDescending.value
  }
  else {
    sortKey.value = key
    sortDescending.value = false
  }
}

function rowFor(review: ReviewData | undefined) {
  return review ? reviewRows.value.find(row => row.id === review.teamId) : undefined
}

function scoreFor(review: ReviewData | undefined): number | null {
  const total = rowFor(review)?.total
  return typeof total === 'number' ? total : null
}

function rankFor(review: ReviewData | undefined) {
  const rank = rowFor(review)?.rank
  return typeof rank === 'number' ? rank : null
}

function contributionFor(review: ReviewData | undefined, index: number) {
  const contribution = rowFor(review)?.contribution?.[index]
  return typeof contribution === 'number' ? contribution : null
}

function weightedSegmentStyle(review: ReviewData | undefined, index: number) {
  const criterion = criteria.value[index]
  const score = review?.scores[index]
  if (!criterion)
    return {}
  return {
    width: `${criterion.weight * 100}%`,
    background: score === null || score === undefined
      ? 'var(--judge-border)'
      : `linear-gradient(90deg, var(--judge-yellow) ${score}%, color-mix(in srgb, var(--judge-yellow) 16%, var(--judge-surface-raised)) ${score}%)`,
  }
}

function rubricHeatmapClass(review: ReviewData | undefined, index: number) {
  const score = review?.scores[index]
  if (score === null || score === undefined)
    return 'rubric-unscored'
  if (score >= 80)
    return 'rubric-high'
  if (score >= 50)
    return 'rubric-mid'
  return 'rubric-low'
}

function canApproveReview(review: ReviewData | undefined) {
  return rowFor(review)?.status === 'Complete'
}

function isIncomplete(review: ReviewData | undefined) {
  return !review || rowFor(review)?.status !== 'Complete' || !review.reviewedAt
}

function hasIssues(review: ReviewData | undefined) {
  if (!review)
    return true
  return review.repoCheck !== 'Yes'
    || review.features.some(feature => feature.proposal === 'missing' || feature.demo === 'missing')
    || (review.reviewedAt !== null && !review.warningsAcknowledged)
}

function statusLabel(review: ReviewData | undefined) {
  if (!review?.reviewedAt)
    return 'Unreviewed'
  if (rowFor(review)?.status !== 'Complete')
    return `Reviewed · ${rowFor(review)?.status?.toLowerCase() ?? 'incomplete'}`
  if (hasIssues(review))
    return 'Reviewed · issues'
  return 'Reviewed'
}

function statusClass(review: ReviewData | undefined) {
  if (!review?.reviewedAt)
    return 'status-neutral'
  if (hasIssues(review) || isIncomplete(review))
    return 'status-warning'
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
  if (!Number.isFinite(difference))
    return 'Deadline unavailable'
  if (difference <= 0)
    return 'Deadline passed'
  const days = Math.floor(difference / 86_400_000)
  const hours = Math.floor((difference % 86_400_000) / 3_600_000)
  const minutes = Math.floor((difference % 3_600_000) / 60_000)
  return `${days}d ${hours}h ${minutes}m remaining`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()))
    return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(date)
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()))
    return value
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatScore(value: number | null) {
  if (value === null)
    return '—'
  return value.toFixed(1)
}

function weightedChartLabel(team: Team, review: ReviewData | undefined) {
  const values = criteria.value.map((criterion, index) => `${criterion.label} ${formatScore(review?.scores[index] ?? null)}/100 (${Math.round(criterion.weight * 100)}%)`)
  return `${team.name} weighted criteria: ${values.join('; ')}`
}

function rubricChartLabel(team: Team, review: ReviewData | undefined) {
  const values = criteria.value.map((criterion, index) => `${criterion.label} ${formatScore(review?.scores[index] ?? null)}/100`)
  return `${team.name} rubric criteria: ${values.join('; ')}`
}

function featureChartLabel(team: Team, review: ReviewData | undefined) {
  const values = features.value.map((feature, index) => `${feature} demo ${review?.features[index]?.demo ?? 'unverified'}`)
  return `${team.name} feature checks: ${values.join('; ')}`
}

async function loadEvidence(item: EvidenceItem) {
  const requestEvidenceId = item.id
  selectedEvidenceId.value = requestEvidenceId
  evidencePayload.value = normalizeEvidence(item)
  evidenceError.value = ''
  if (!item.id)
    return
  evidenceLoading.value = !item.text && !item.pages?.length
  try {
    const response = await fetch(`${props.apiBase}/evidence/${encodeURIComponent(item.id)}`, { credentials: 'include', headers: { Accept: 'application/json' } })
    const payload = await readJson(response)
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Evidence request failed (${response.status})`))
    if (selectedEvidenceId.value !== requestEvidenceId)
      return
    evidencePayload.value = normalizeEvidence(payload)
  }
  catch (error) {
    if (selectedEvidenceId.value !== requestEvidenceId)
      return
    if (!evidencePayload.value?.text && !evidencePayload.value?.pages?.length)
      evidenceError.value = error instanceof Error ? error.message : 'Evidence could not be loaded.'
  }
  finally {
    if (selectedEvidenceId.value === requestEvidenceId)
      evidenceLoading.value = false
  }
}

function openEvidenceForTeam() {
  activeTab.value = 'evidence'
  const first = selectedTeamEvidence.value[0]
  if (first)
    void loadEvidence(first)
}

function jumpToAssessmentCitation(citation: AssessmentCitation) {
  const target = selectedTeamEvidence.value.find(item => item.id === citation.evidenceId
    || item.id === citation.id
    || item.title === citation.title
    || item.path === citation.title)
  if (!target) {
    activeTab.value = 'evidence'
    evidenceError.value = `Citation unavailable in intake: ${citation.title}`
    assessmentMessage.value = 'This citation is recorded by the assessment but is not in the selected evidence records.'
    return
  }
  activeTab.value = 'evidence'
  void loadEvidence(target)
}

function evidenceIcon(kind: EvidenceItem['kind']) {
  if (kind === 'source')
    return GitBranch
  if (kind === 'document')
    return FileText
  if (kind === 'transcript')
    return FileText
  if (kind === 'link')
    return LinkIcon
  return Database
}

async function refreshDevices() {
  if (props.local)
    return
  try {
    const response = await fetch(`${props.apiBase}/devices`, { credentials: 'include', headers: { Accept: 'application/json' } })
    const payload = await readJson(response)
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Device request failed (${response.status})`))
    const devices = Array.isArray(payload) ? payload : readJsonRecord(payload).devices
    pairedDevices.value = Array.isArray(devices) ? devices.filter(isJsonRecord) : []
  }
  catch (error) {
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
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const payload = readJsonRecord(await readJson(response))
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Pairing failed (${response.status})`))
    pairMessage.value = 'This judging station is paired and ready.'
    pairCode.value = ''
    await fetchState()
  }
  catch (error) {
    pairMessage.value = error instanceof Error ? error.message : 'Pairing failed.'
  }
  finally {
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
    const payload = readJsonRecord(await readJson(response))
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Pair code request failed (${response.status})`))
    pairCode.value = String(payload.code ?? payload.pairCode ?? '')
    pairMessage.value = payload.expiresAt ? `Code expires ${formatDateTime(String(payload.expiresAt))}.` : 'Code expires in 10 minutes.'
    await refreshDevices()
  }
  catch (error) {
    pairMessage.value = error instanceof Error ? error.message : 'Pair code could not be created.'
  }
  finally {
    pairLoading.value = false
  }
}

async function revokeDevice(device: Record<string, any>) {
  const id = String(device.id ?? device.deviceId ?? '')
  if (!id)
    return
  try {
    const response = await fetch(`${props.apiBase}/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    const payload = await readJson(response)
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Revoke failed (${response.status})`))
    await refreshDevices()
  }
  catch (error) {
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
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ refresh: true, teamId: selectedTeamId.value }),
    })
    const payload = readJsonRecord(await readJson(response))
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Intake failed (${response.status})`))
    intakeMessage.value = payload.jobId ? `Intake job ${payload.jobId} queued.` : 'Intake queued.'
    await loadIntakeProgress()
    await fetchState()
  }
  catch (error) {
    intakeMessage.value = error instanceof Error ? error.message : 'Intake could not be queued.'
  }
  finally {
    intakeLoading.value = false
  }
}

async function loadIntakeProgress() {
  if (!props.local)
    return
  try {
    const response = await fetch(`${props.apiBase}/intake`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok)
      return
    const payload = await readJson(response)
    intakeProgress.value = isJsonRecord(payload) ? payload : null
  }
  catch {
    // Progress is advisory and should not block scoring.
  }
}

let assessmentJobsLoading = false
async function loadAssessmentJobs() {
  if (assessmentJobsLoading || !isOnline.value)
    return
  assessmentJobsLoading = true
  try {
    const endpoint = `${props.apiBase}/jobs`
    const response = await fetch(endpoint, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok)
      return
    const payload = await readJson(response)
    const jobs = Array.isArray(payload) ? payload : readJsonRecord(payload).jobs
    assessmentJobs.value = (Array.isArray(jobs) ? jobs : []).map(normalizeAssessmentJob)
  }
  catch {
    // Assessment jobs are supplementary to the judging state; keep the workspace usable.
  }
  finally {
    assessmentJobsLoading = false
  }
}

async function queueAssessment(teamId: string, retryJobId?: string) {
  assessmentMessage.value = ''
  try {
    const endpoint = `${props.apiBase}/assessments`
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ teamId, ...(retryJobId ? { retryJobId } : {}) }),
    })
    const payload = readJsonRecord(await readJson(response))
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Assessment request failed (${response.status})`))
    assessmentMessage.value = `Assessment queued for ${teamName(teamId)}.`
    await loadAssessmentJobs()
  }
  catch (error) {
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
    const response = await fetch(`${props.apiBase}/assessments/${encodeURIComponent(job.id)}/cancel`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
    const payload = await readJson(response)
    if (!response.ok)
      throw new Error(payloadMessage(payload, `Cancellation failed (${response.status})`))
    await loadAssessmentJobs()
  }
  catch (error) {
    assessmentMessage.value = error instanceof Error ? error.message : 'Assessment could not be cancelled.'
  }
}

function teamName(teamId: string) {
  return teams.value.find(team => team.id === teamId)?.name ?? teamId
}

function handleOnline() {
  isOnline.value = true
  syncState.value = dirtyKeys.size ? 'pending' : 'synced'
  void fetchState({ silent: true })
  if (isVisible.value)
    void loadAssessmentJobs()
  for (const key of dirtyKeys) void saveRecord(key)
}

function handleOffline() {
  isOnline.value = false
  syncState.value = 'offline'
}

function handleVisibility() {
  isVisible.value = document.visibilityState === 'visible'
  if (isVisible.value && isOnline.value) {
    void fetchState({ silent: true })
    void loadAssessmentJobs()
  }
}

function beginPolling() {
  if (pollingTimer.value)
    clearInterval(pollingTimer.value)
  pollingTimer.value = setInterval(() => {
    deadlineNow.value = Date.now()
    if (isVisible.value && isOnline.value) {
      void fetchState({ silent: true })
      void loadIntakeProgress()
      void loadAssessmentJobs()
    }
  }, 10_000)
}

function stopPolling() {
  if (pollingTimer.value)
    clearInterval(pollingTimer.value)
  pollingTimer.value = null
}

function setTheme(mode: 'system' | 'light' | 'dark') {
  theme.value = mode
  if (typeof localStorage !== 'undefined')
    localStorage.setItem('sdc-judging-theme', mode)
}

function captureEvidenceLink() {
  const value = evidenceLink.value.trim()
  if (!value) {
    evidenceLinkMessage.value = 'Paste a repository or demo link first.'
    return
  }
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('unsupported')
    appendReviewNote(`Evidence: ${url.href}`)
    evidenceLink.value = ''
    evidenceLinkMessage.value = 'Link added to the review notes.'
  }
  catch {
    evidenceLinkMessage.value = 'Use a full https:// link.'
  }
}

async function flushDirtyRecords() {
  for (let attempt = 0; attempt < 4 && dirtyKeys.size; attempt += 1) {
    const keys = [...dirtyKeys]
    await Promise.all(keys.map(key => saveRecord(key)))
    if (conflict.value)
      return false
  }
  return dirtyKeys.size === 0
}

async function downloadExport(finalExport: boolean) {
  if (exporting.value)
    return
  exportMessage.value = ''
  if (finalExport && !readinessResult.value.ready) {
    exportMessage.value = 'Final export is locked until all nine reviews and judge details are ready.'
    return
  }
  if (typeof document === 'undefined')
    return
  exporting.value = true
  try {
    if (finalExport && !records.judge)
      markJudgeDirty()
    if (!await flushDirtyRecords() || conflict.value || syncConflicts.value.length) {
      exportMessage.value = 'Export is waiting for local edits or a conflict to finish syncing.'
      return
    }
    exportMessage.value = 'Preparing workbook…'
    const response = await fetch(`${props.apiBase}/exports?final=${finalExport ? '1' : '0'}`, { credentials: 'include' })
    if (!response.ok)
      throw new Error(payloadMessage(await readJson(response), `Workbook export failed (${response.status}).`))
    if (!response.headers.get('content-type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
      throw new Error('The export did not return an Excel workbook. Refresh your owner session and try again.')
    const url = URL.createObjectURL(await response.blob())
    exportUrls.add(url)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `SDC-D1-J04-${finalExport ? 'final' : 'draft'}.xlsx`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      exportUrls.delete(url)
    }, 1_000)
    exportMessage.value = 'Workbook download started.'
  }
  catch (error) {
    exportMessage.value = error instanceof Error ? error.message : 'The workbook could not be exported.'
  }
  finally {
    exporting.value = false
  }
}

watch(() => props.apiBase, () => {
  stateFetchGeneration += 1
  appliedStateVersions.clear()
  stateCursor.value = null
  void fetchState()
})
watch(conflict, (nextConflict, previousConflict) => {
  if (nextConflict) {
    if (!previousConflict && typeof document !== 'undefined') {
      const active = document.activeElement
      previousConflictFocus.value = active instanceof HTMLElement && active !== document.body ? active : null
    }
    void nextTick(() => conflictDialog.value?.focus())
    return
  }
  if (!previousConflict)
    return
  const target = previousConflictFocus.value
  previousConflictFocus.value = null
  void nextTick(() => {
    if (target?.isConnected)
      target.focus()
  })
})
watch(selectedTeamId, () => {
  evidencePayload.value = null
  evidenceError.value = ''
  evidenceSearch.value = ''
})

onMounted(() => {
  loadBrowserDrafts()
  if (typeof localStorage !== 'undefined') {
    const storedTheme = localStorage.getItem('sdc-judging-theme')
    if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system')
      theme.value = storedTheme
  }
  isVisible.value = document.visibilityState === 'visible'
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibility)
  deadlineNow.value = Date.now()
  beginPolling()
  void fetchState()
  void loadIntakeProgress()
  void loadAssessmentJobs()
  void refreshDevices()
})

onBeforeUnmount(() => {
  stateFetchDisposed = true
  stateFetchGeneration += 1
  appliedStateVersions.clear()
  for (const url of exportUrls)
    URL.revokeObjectURL(url)
  exportUrls.clear()
  stopPolling()
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  document.removeEventListener('visibilitychange', handleVisibility)
  for (const timer of saveTimers.values()) clearTimeout(timer)
  pendingSnapshots.clear()
  mutationIds.clear()
})
</script>

<template>
  <main
    class="judging-workspace"
    :data-theme="theme"
    :data-local="local ? 'true' : 'false'"
  >
    <header class="workspace-header">
      <div class="header-title">
        <div class="eyebrow">
          <ClipboardCheck :size="15" aria-hidden="true" /> SDC 2026 · judging desk
        </div>
        <h1>{{ assignment.title }}</h1>
        <p>{{ assignment.id }} · {{ assignment.judgeId }} · {{ assignment.domain }} · {{ assignment.timezone }}</p>
      </div>
      <div class="header-actions">
        <span
          class="sync-pill" :class="`
            sync-${syncTone}
          `" role="status" aria-live="polite"
        >
          <WifiOff v-if="syncTone === 'offline'" :size="14" aria-hidden="true" />
          <Wifi v-else :size="14" aria-hidden="true" />
          {{ syncLabel }}
        </span>
        <button class="icon-button" type="button" aria-label="Refresh judging state" :disabled="loading" @click="fetchState()">
          <RefreshCw :size="16" :class="{ spin: loading }" aria-hidden="true" />
        </button>
        <div class="theme-switcher" aria-label="Theme">
          <button type="button" :class="{ selected: theme === 'light' }" aria-label="Use light theme" @click="setTheme('light')">
            <Sun :size="15" aria-hidden="true" />
          </button>
          <button type="button" :class="{ selected: theme === 'dark' }" aria-label="Use dark theme" @click="setTheme('dark')">
            <Moon :size="15" aria-hidden="true" />
          </button>
          <button type="button" :class="{ selected: theme === 'system' }" aria-label="Use system theme" @click="setTheme('system')">
            <CircleHelp :size="15" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>

    <div v-if="errorMessage" class="workspace-alert alert-error" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ errorMessage }}</span>
      <button type="button" class="text-button" @click="fetchState()">
        Retry
      </button>
    </div>
    <div v-if="recoveryMessage" class="workspace-alert alert-recovery" role="status" aria-live="polite">
      <ShieldCheck :size="16" aria-hidden="true" />
      <span>{{ recoveryMessage }}</span>
    </div>

    <section class="overview-grid" aria-label="Judging overview">
      <article class="overview-card overview-deadline">
        <div class="card-icon">
          <Clock3 :size="17" aria-hidden="true" />
        </div>
        <div><span class="card-label">Deadline</span><strong>{{ deadlineText }}</strong><small>{{ deadlineDate }} MYT</small></div>
      </article>
      <article class="overview-card">
        <div class="card-icon">
          <ShieldCheck :size="17" aria-hidden="true" />
        </div>
        <div><span class="card-label">Reviews</span><strong>{{ reviewCount }}/{{ teams.length }}</strong><small>{{ incompleteCount }} incomplete · {{ issueCount }} with issues</small></div>
      </article>
      <article class="overview-card">
        <div class="card-icon">
          <FileText :size="17" aria-hidden="true" />
        </div>
        <div><span class="card-label">Evidence</span><strong>{{ evidenceCount }}</strong><small>safe text, source and document records</small></div>
      </article>
      <article class="overview-card">
        <div class="card-icon">
          <Check :size="17" aria-hidden="true" />
        </div>
        <div><span class="card-label">Readiness</span><strong>{{ overallReadiness }}</strong><small>explicit reviewed approval required</small></div>
      </article>
    </section>

    <section class="judge-strip" aria-labelledby="judge-profile-heading">
      <div>
        <div id="judge-profile-heading" class="eyebrow">
          Judge profile
        </div>
        <p class="muted-copy">
          Edits save to the judging record automatically; keep this station synced before leaving.
        </p>
      </div>
      <div class="judge-fields">
        <label>Judge name<input v-model="judgeDraft.name" autocomplete="name" placeholder="Name" @input="markJudgeDirty"></label>
        <label>Review date<input v-model="judgeDraft.date" type="date" @change="markJudgeDirty"></label>
        <label>Assigned domain<output class="field-output">{{ assignment.domain }}</output></label>
        <label class="judge-notes">General notes<textarea v-model="judgeDraft.generalNotes" rows="2" placeholder="Context for the review desk" @input="markJudgeDirty" /></label>
        <label class="check-label"><input v-model="judgeDraft.warningsAcknowledged" type="checkbox" @change="markJudgeDirty"> I understand evidence is unverified until observed</label>
      </div>
    </section>

    <section class="review-table-section" aria-labelledby="review-overview-heading">
      <div class="section-heading">
        <div>
          <div class="eyebrow">
            Review queue
          </div><h2 id="review-overview-heading">
            Nine teams, one source of truth
          </h2>
        </div>
        <div class="section-actions">
          <button class="secondary-button" type="button" :disabled="exporting" @click="downloadExport(false)">
            <Download :size="15" aria-hidden="true" /> Draft export
          </button>
          <button class="primary-button" type="button" :disabled="exporting || !readinessResult.ready" :title="readinessResult.ready ? 'Download the final workbook' : 'Complete the export checks below first'" @click="downloadExport(true)">
            <Download :size="15" aria-hidden="true" /> Final export
          </button>
        </div>
      </div>
      <div class="queue-toolbar">
        <label class="search-field"><Search :size="16" aria-hidden="true" /><span
          class="sr-only"
        >Search teams</span><input v-model="searchTerm" type="search" placeholder="Search teams or IDs"></label>
        <div class="filter-buttons" role="group" aria-label="Review filter">
          <button v-for="item in filterOptions" :key="item[0]" type="button" :class="{ active: filter === item[0] }" :aria-pressed="filter === item[0]" @click="filter = item[0]">
            {{ item[1] }}
          </button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="review-table">
          <thead>
            <tr>
              <th>
                <button type="button" class="sort-button" @click="sortBy('rank')">
                  Rank <ArrowDownUp :size="13" aria-hidden="true" />
                </button>
              </th>
              <th>
                <button type="button" class="sort-button" @click="sortBy('team')">
                  Team <ArrowDownUp :size="13" aria-hidden="true" />
                </button>
              </th>
              <th>
                <button type="button" class="sort-button" @click="sortBy('status')">
                  Status <ArrowDownUp :size="13" aria-hidden="true" />
                </button>
              </th>
              <th>
                <button type="button" class="sort-button" @click="sortBy('score')">
                  Weighted score <ArrowDownUp :size="13" aria-hidden="true" />
                </button>
              </th><th>Rubric heatmap</th><th>Feature checks</th><th>Evidence</th><th>
                <span
                  class="sr-only"
                >Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="team in filteredTeams" :key="team.id" :class="{ selected: selectedTeamId === team.id }" @click="selectTeam(team.id)">
              <td><strong class="rank-value">{{ rankFor(reviewDrafts[team.id]) ?? '—' }}</strong></td>
              <th scope="row">
                <button type="button" class="team-link" @click.stop="selectTeam(team.id)">
                  <span>{{ team.name }}</span><small>{{ team.id }}</small>
                </button>
              </th>
              <td><span class="status-badge" :class="statusClass(reviewDrafts[team.id])">{{ statusLabel(reviewDrafts[team.id]) }}</span></td>
              <td>
                <div class="score-cell">
                  <strong>{{ formatScore(scoreFor(reviewDrafts[team.id])) }}</strong><span
                    class="weighted-stack" role="img" :aria-label="weightedChartLabel(team, reviewDrafts[team.id])"
                  ><i v-for="(criterion, index) in criteria" :key="criterion.id" :style="weightedSegmentStyle(reviewDrafts[team.id], index)" :title="`${criterion.label}: ${formatScore(reviewDrafts[team.id]?.scores[index] ?? null)}/100 · ${formatScore(contributionFor(reviewDrafts[team.id], index))} weighted points`" /></span><small>/ 100</small>
                </div>
              </td>
              <td>
                <div class="rubric-heatmap" role="img" :aria-label="rubricChartLabel(team, reviewDrafts[team.id])">
                  <span v-for="(criterion, index) in criteria" :key="criterion.id" :class="rubricHeatmapClass(reviewDrafts[team.id], index)" :title="`${criterion.label} · ${formatScore(reviewDrafts[team.id]?.scores[index] ?? null)}/100`" />
                </div>
              </td>
              <td>
                <div class="feature-heatmap" role="img" :aria-label="featureChartLabel(team, reviewDrafts[team.id])">
                  <span v-for="(feature, index) in (reviewDrafts[team.id]?.features ?? defaultReview(team.id).features)" :key="index" :class="featureClass(feature.demo)" :title="`${features[index]} · demo ${feature.demo}`" />
                </div>
              </td>
              <td>
                <button type="button" class="evidence-count" @click.stop="selectTeam(team.id); openEvidenceForTeam()">
                  <FileText :size="14" aria-hidden="true" /> {{ evidenceRecords.filter(item => item.teamId === team.id).length }}
                </button>
              </td>
              <td><ChevronRight :size="17" aria-hidden="true" /></td>
            </tr>
            <tr v-if="!filteredTeams.length">
              <td colspan="8" class="empty-cell">
                No teams match this view.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="workbench" aria-labelledby="workbench-heading">
      <div class="section-heading workbench-heading">
        <div>
          <div class="eyebrow">
            Workbench
          </div><h2 id="workbench-heading">
            {{ selectedTeam?.name }}
          </h2><p
            class="muted-copy"
          >
            {{ selectedTeam?.id }} · {{ currentReviewStatus }} · score {{ formatScore(selectedScore) }}/100
          </p>
        </div>
        <div class="workbench-actions">
          <button class="secondary-button" type="button" @click="queueAssessment(selectedTeamId)">
            <Database :size="15" aria-hidden="true" /> Queue assessment
          </button><button
            class="primary-button" type="button" :disabled="!selectedReviewReady" @click="approveReview"
          >
            <Check :size="15" aria-hidden="true" /> Approve reviewed
          </button>
        </div>
      </div>
      <nav class="workbench-tabs" role="tablist" aria-label="Workbench sections">
        <button id="workbench-tab-queue" type="button" role="tab" data-workbench-tab="queue" :aria-selected="activeTab === 'queue'" aria-controls="workbench-panel-queue" :tabindex="activeTab === 'queue' ? 0 : -1" :class="{ active: activeTab === 'queue' }" @click="activeTab = 'queue'" @keydown="handleTabKeydown($event, 'queue')">
          Queue
        </button>
        <button id="workbench-tab-evidence" type="button" role="tab" data-workbench-tab="evidence" :aria-selected="activeTab === 'evidence'" aria-controls="workbench-panel-evidence" :tabindex="activeTab === 'evidence' ? 0 : -1" :class="{ active: activeTab === 'evidence' }" @click="activeTab = 'evidence'" @keydown="handleTabKeydown($event, 'evidence')">
          Evidence <span>{{ selectedTeamEvidence.length }}</span>
        </button>
        <button id="workbench-tab-scoring" type="button" role="tab" data-workbench-tab="scoring" :aria-selected="activeTab === 'scoring'" aria-controls="workbench-panel-scoring" :tabindex="activeTab === 'scoring' ? 0 : -1" :class="{ active: activeTab === 'scoring' }" @click="activeTab = 'scoring'" @keydown="handleTabKeydown($event, 'scoring')">
          Scoring
        </button>
      </nav>

      <div class="workbench-layout">
        <div id="workbench-panel-queue" class="workbench-pane" role="tabpanel" aria-labelledby="workbench-tab-queue" aria-label="Team queue panel" tabindex="0" :class="{ 'pane-active': activeTab === 'queue' }">
          <div class="workbench-panel queue-panel">
            <section class="team-queue-mini" aria-labelledby="team-queue-mini-heading">
              <div class="panel-heading">
                <div>
                  <h3 id="team-queue-mini-heading">
                    Team queue
                  </h3><p>Choose a team to open its evidence and score.</p>
                </div><span
                  class="queue-count"
                >{{ reviewCount }}/{{ teams.length }}</span>
              </div>
              <div class="team-queue-list">
                <button v-for="team in filteredTeams" :key="team.id" type="button" :class="{ selected: selectedTeamId === team.id }" @click="selectTeam(team.id)">
                  <span><strong>{{ team.name }}</strong><small>{{ team.id }}</small></span><span
                    class="mini-score"
                  ><b>{{ formatScore(scoreFor(reviewDrafts[team.id])) }}</b><small>{{ statusLabel(reviewDrafts[team.id]) }}</small></span>
                </button><p
                  v-if="!filteredTeams.length" class="empty-copy"
                >
                  No teams match this view.
                </p>
              </div>
            </section>
            <div class="panel-copy">
              <h3>Queue control</h3><p>Assessments are bounded to the nine assigned teams and remain visible while they run.</p><button
                class="secondary-button" type="button" @click="queueAllAssessments"
              >
                <Send :size="15" aria-hidden="true" /> Queue all nine
              </button><p
                v-if="assessmentMessage" class="feedback" role="status"
              >
                {{ assessmentMessage }}
              </p>
            </div>
            <div class="job-list">
              <div
                v-for="job in latestAssessmentJobs" :key="job.id" class="
                  job-row
                "
              >
                <div>
                  <strong>{{ teamName(job.teamId) }}</strong><small>{{ job.message ?? job.status }}</small><span
                    v-if="job.stale" class="stale-job-label"
                  >Stale draft · regenerate before use</span>
                </div><div
                  class="job-progress"
                >
                  <span>{{ job.progress ?? 0 }}%</span><span
                    class="progress-track"
                  ><i :style="{ width: `${job.progress ?? 0}%` }" /></span>
                </div><div
                  class="job-actions"
                >
                  <button
                    v-if="job.stale" type="button" class="
                      secondary-button compact-button
                    " @click="queueAssessment(job.teamId)"
                  >
                    Regenerate
                  </button><button
                    v-if="['failed', 'cancelled'].includes(job.status)" type="button" class="
                      secondary-button compact-button
                    " @click="queueAssessment(job.teamId, job.id)"
                  >
                    Retry
                  </button><button
                    v-if="['queued', 'running'].includes(job.status)" type="button" class="
                      icon-button
                    " aria-label="Cancel assessment" @click="cancelAssessment(job)"
                  >
                    <X :size="15" aria-hidden="true" />
                  </button>
                </div>
              </div><p
                v-if="!assessmentJobs.length" class="empty-copy"
              >
                No assessment jobs queued.
              </p>
            </div>
            <details
              v-if="priorAssessmentJobs.length" class="assessment-history"
            >
              <summary>Earlier attempts ({{ priorAssessmentJobs.length }})</summary>
              <ol>
                <li v-for="job in priorAssessmentJobs" :key="job.id">
                  <strong>{{ teamName(job.teamId) }}</strong>
                  <span>{{ job.message ?? job.status }}</span>
                  <time v-if="job.updatedAt" :datetime="job.updatedAt">{{ formatDateTime(job.updatedAt) }}</time>
                </li>
              </ol>
            </details>
          </div>
        </div>

        <div id="workbench-panel-evidence" class="workbench-pane" role="tabpanel" aria-labelledby="workbench-tab-evidence" aria-label="Evidence panel" tabindex="0" :class="{ 'pane-active': activeTab === 'evidence' }">
          <div class="workbench-panel evidence-panel">
            <aside class="evidence-list" aria-label="Evidence list">
              <div class="panel-heading">
                <div><h3>Evidence</h3><p>Safe text only · source lines and PDF pages</p></div><button
                  v-if="local" class="icon-button" type="button" aria-label="Run local intake" :disabled="intakeLoading" @click="startIntake"
                >
                  <RefreshCw :size="15" aria-hidden="true" />
                </button>
              </div>
              <p v-if="intakeMessage" class="feedback" role="status">
                {{ intakeMessage }}
              </p>
              <p v-if="local && intakeProgress" class="feedback" role="status">
                Intake {{ intakeProgress.status ?? 'pending' }}<span v-if="intakeProgress.progress !== undefined"> · {{ intakeProgress.progress }}%</span>
              </p>
              <div class="evidence-toolbar">
                <label class="evidence-search"><Search :size="14" aria-hidden="true" /><span
                  class="sr-only"
                >Search current team evidence</span><input v-model="evidenceSearch" type="search" placeholder="Search this team’s evidence" aria-label="Search current team evidence"></label><button
                  v-if="evidenceSearch" class="icon-button" type="button" aria-label="Clear evidence search" @click="evidenceSearch = ''"
                >
                  <X :size="15" aria-hidden="true" />
                </button>
              </div>
              <p class="evidence-count" role="status">
                {{ filteredSelectedTeamEvidence.length }} of {{ selectedTeamEvidence.length }} evidence records
              </p>
              <button
                v-for="item in visibleSelectedTeamEvidence" :key="item.id" type="button" class="
                  evidence-item
                " :class="{ active: selectedEvidence?.id === item.id }" @click="loadEvidence(item)"
              >
                <component :is="evidenceIcon(item.kind)" :size="16" aria-hidden="true" /><span><strong>{{ item.title }}</strong><small>{{ item.kind }}<span v-if="item.sha256 || item.snapshotSha"> · {{ (item.sha256 || item.snapshotSha)?.slice(0, 8) }}</span><span v-if="item.id === selectedEvidenceId && evidencePayload"> · selected</span></small></span><ChevronRight :size="14" aria-hidden="true" />
              </button>
              <p v-if="!selectedTeamEvidence.length" class="empty-copy">
                No evidence records for this team yet.
              </p><p
                v-else-if="!visibleSelectedTeamEvidence.length" class="
                  empty-copy
                "
              >
                No evidence records match this search.
              </p>
            </aside>
            <article class="evidence-reader" aria-live="polite">
              <section v-if="selectedIntake" class="intake-summary" aria-labelledby="intake-summary-heading">
                <div class="panel-heading">
                  <div>
                    <h3 id="intake-summary-heading">
                      Intake snapshot
                    </h3><p>Repository metadata is shown separately from observed demo parity.</p>
                  </div><span
                    class="parity-badge" :class="`
                      parity-${selectedIntake.demoParity}
                    `"
                  >Demo parity · {{ selectedIntake.demoParity }}</span>
                </div>
                <dl class="intake-meta">
                  <div><dt>Repository SHA</dt><dd>{{ selectedIntake.repoSha || 'Not recorded' }}</dd></div><div><dt>Retrieved</dt><dd>{{ selectedIntake.retrievedAt ? formatDateTime(selectedIntake.retrievedAt) : 'Not recorded' }}</dd></div><div><dt>Verified</dt><dd>{{ selectedIntake.verified === true ? 'Verified' : selectedIntake.verified === false ? 'Not verified' : 'Unknown' }}</dd></div><div v-if="selectedIntake.branch">
                    <dt>Branch</dt><dd>{{ selectedIntake.branch }}</dd>
                  </div>
                </dl>
                <div class="deployment-links">
                  <h4>Deployment and demo links</h4><ul v-if="selectedIntakePrimaryLinks.length">
                    <li v-for="link in selectedIntakePrimaryLinks" :key="`${link.url}-${link.checkedAt ?? ''}`">
                      <a :href="link.url" target="_blank" rel="noreferrer" :aria-label="`${link.kind ?? 'Deployment or demo link'}: ${link.url}`">{{ link.url }}</a><span>{{ intakeLinkState(link) }}<span v-if="link.finalUrl && link.finalUrl !== link.url"> · resolved {{ link.finalUrl }}</span><span v-if="link.checkedAt"> · {{ formatDateTime(link.checkedAt) }}</span></span>
                    </li>
                  </ul><p
                    v-else class="empty-copy"
                  >
                    No deployment or video links recorded.
                  </p><details
                    v-if="selectedIntakeAncillaryLinks.length" class="
                      ancillary-links
                    "
                  >
                    <summary>Ancillary references ({{ selectedIntakeAncillaryLinks.length }})</summary><ul>
                      <li v-for="link in selectedIntakeAncillaryLinks" :key="`${link.url}-${link.checkedAt ?? ''}`">
                        <a :href="link.url" target="_blank" rel="noreferrer" :aria-label="`${link.kind ?? 'Reference link'}: ${link.url}`">{{ link.url }}</a><span>{{ intakeLinkState(link) }}<span v-if="link.finalUrl && link.finalUrl !== link.url"> · resolved {{ link.finalUrl }}</span><span v-if="link.checkedAt"> · {{ formatDateTime(link.checkedAt) }}</span></span>
                      </li>
                    </ul>
                  </details>
                </div>
              </section>
              <div v-if="evidenceLoading" class="reader-state">
                <RefreshCw
                  :size="18" class="spin" aria-hidden="true"
                /> Loading safe evidence…
              </div>
              <div v-else-if="evidenceError" class="reader-state reader-error">
                <AlertTriangle :size="18" aria-hidden="true" /> {{ evidenceError }}
              </div>
              <template v-else-if="selectedEvidence">
                <header class="reader-header">
                  <div>
                    <div class="eyebrow">
                      {{ selectedEvidence.kind }} · {{ selectedEvidence.observed ? 'observed' : 'not observed' }}
                    </div><h3>{{ selectedEvidence.title }}</h3><p v-if="selectedEvidence.path">
                      {{ selectedEvidence.path }}
                    </p>
                  </div><a
                    v-if="selectedEvidence.url" class="icon-button" :href="selectedEvidence.url" target="_blank" rel="noreferrer" aria-label="Open evidence link"
                  ><ExternalLink :size="16" aria-hidden="true" /></a>
                </header>
                <div class="reader-meta">
                  <span v-if="selectedEvidence.sha256">SHA-256 {{ selectedEvidence.sha256 }}</span><span v-else-if="selectedEvidence.snapshotSha">Snapshot {{ selectedEvidence.snapshotSha }}</span><span v-if="selectedEvidence.lines !== undefined">{{ selectedEvidence.lines }} source lines</span><span>Rendered as text; participant HTML is never executed.</span>
                </div>
                <div class="source-reader">
                  <div
                    v-for="line in selectedEvidenceLines" :key="line.number" class="
                      source-line
                    "
                  >
                    <span>{{ line.number }}</span><code>{{ line.text }}</code>
                  </div><p
                    v-if="!selectedEvidenceLines.length" class="empty-copy"
                  >
                    This evidence record has no readable text.
                  </p>
                </div>
                <div v-if="selectedEvidence.pages?.length" class="pdf-pages">
                  <h4>PDF pages</h4><div v-for="page in selectedEvidence.pages" :key="page.page">
                    <strong>Page {{ page.page }}</strong><p>{{ page.text }}</p>
                  </div>
                </div>
              </template>
              <div v-else class="reader-state">
                <FileText :size="20" aria-hidden="true" /> Select an evidence record.
              </div>
            </article>
          </div>
        </div>

        <div id="workbench-panel-scoring" class="workbench-pane" role="tabpanel" aria-labelledby="workbench-tab-scoring" aria-label="Scoring panel" tabindex="0" :class="{ 'pane-active': activeTab === 'scoring' }">
          <div class="workbench-panel scoring-panel">
            <div class="score-form">
              <div class="panel-heading">
                <div><h3>Weighted scoring</h3><p>Scores stay decimal precise. Blank is different from zero.</p></div><strong
                  class="large-score"
                >{{ formatScore(selectedScore) }}<small>/100</small></strong>
              </div>
              <div class="criteria-grid">
                <label
                  v-for="(criterion, index) in criteria" :key="criterion.id" class="
                    score-field
                  "
                ><span>{{ criterion.label }} <small>{{ Math.round(criterion.weight * 100) }}%</small></span><input :value="selectedReview.scores[index] === null ? '' : selectedReview.scores[index]" type="number" min="0" max="100" step="any" inputmode="decimal" :aria-label="`${criterion.label} score out of 100`" placeholder="—" @input="setScore(index, $event)"><em>/100</em></label>
              </div>
              <section v-if="selectedAssessment" class="ai-suggestion" aria-labelledby="ai-suggestion-heading">
                <div class="panel-heading">
                  <div>
                    <h4 id="ai-suggestion-heading">
                      AI assessment suggestion
                    </h4><p>Suggestions stay separate from the judge’s scores until explicitly copied as a draft.</p><p
                      v-if="selectedAssessment.stale" class="stale-copy"
                    >
                      This result is stale. Regenerate the assessment before using it as a draft.
                    </p>
                  </div><button
                    class="secondary-button" type="button" :disabled="selectedAssessment.stale" :title="selectedAssessment.stale ? 'Regenerate this stale assessment before using its scores' : undefined" @click="acceptAssessmentScores"
                  >
                    {{ selectedAssessment.stale ? 'Stale · regenerate' : 'Use as draft' }}
                  </button>
                </div>
                <div
                  v-if="selectedAssessment.suggestedScores?.length" class="
                    ai-score-list
                  "
                >
                  <span v-for="(score, index) in selectedAssessment.suggestedScores" :key="criteria[index]?.id ?? `criterion-${index}`"><strong>{{ criteria[index]?.label ?? `Criterion ${index + 1}` }}</strong><em>{{ formatScore(score ?? null) }}/100</em></span>
                </div>
                <div class="ai-detail-grid">
                  <div>
                    <h4>Strengths</h4><ul v-if="selectedAssessment.strengths.length">
                      <li v-for="strength in selectedAssessment.strengths" :key="strength">
                        {{ strength }}
                      </li>
                    </ul><p
                      v-else class="empty-copy"
                    >
                      No strengths recorded.
                    </p>
                  </div>
                  <div>
                    <h4>Concerns</h4><ul v-if="selectedAssessment.concerns.length">
                      <li v-for="concern in selectedAssessment.concerns" :key="concern">
                        {{ concern }}
                      </li>
                    </ul><p
                      v-else class="empty-copy"
                    >
                      No concerns recorded.
                    </p>
                  </div>
                </div>
                <div class="ai-feature-findings">
                  <h4>Six feature findings</h4><div
                    class="ai-feature-grid"
                  >
                    <span v-for="feature in selectedAssessment.features" :key="feature.label"><strong>{{ feature.label }}</strong><small>Finding {{ feature.status }} · proposal {{ feature.proposal }} · demo {{ feature.demo }}</small><em v-if="feature.note">{{ feature.note }}</em></span>
                  </div>
                </div>
                <div class="ai-citations">
                  <h4>Assessment citations</h4><div
                    v-if="selectedAssessment.citations.length" class="
                      citation-buttons
                    "
                  >
                    <button v-for="citation in selectedAssessment.citations" :key="`${citation.evidenceId ?? citation.id ?? citation.title}-${citation.detail ?? ''}`" type="button" @click="jumpToAssessmentCitation(citation)">
                      <FileText :size="14" aria-hidden="true" /><span>{{ citation.title }}<small v-if="citation.detail">{{ citation.detail }}</small></span>
                    </button>
                  </div><p
                    v-else class="empty-copy"
                  >
                    No citations recorded.
                  </p>
                </div>
              </section>
              <div class="repo-check">
                <label>Repository check<select :value="selectedReview.repoCheck" @change="handleRepoCheckChange"><option value="">Choose an observation</option><option value="Yes">Yes</option><option value="No – private/broken">No – private/broken</option><option value="No – doesn't match demo">No – doesn't match demo</option></select></label><p
                  class="micro-copy"
                >
                  <Video :size="14" aria-hidden="true" /> Video links remain unobserved until the judge opens them.
                </p>
              </div>
              <div class="feature-review">
                <div class="panel-heading">
                  <div><h3>Six feature checks</h3><p>Proposal covers all six; demo check records the main feature observed.</p></div><a
                    class="text-button" href="#evidence-citations" @click.prevent="openEvidenceForTeam"
                  >Jump to evidence</a>
                </div><div
                  class="feature-table"
                >
                  <div
                    class="feature-row feature-header"
                  >
                    <span>Feature</span><span>Proposal</span><span>Demo</span><span>Note</span>
                  </div><div
                    v-for="(feature, index) in selectedReview.features" :key="index" class="
                      feature-row
                    "
                  >
                    <strong>{{ features[index] ?? `Feature ${index + 1}` }}</strong><select :value="feature.proposal" :class="featureClass(feature.proposal)" :aria-label="`${features[index]} proposal status`" @change="setFeatureStatus(index, 'proposal', $event)">
                      <option value="unverified">
                        Unverified
                      </option><option value="present">
                        Present
                      </option><option value="missing">
                        Missing
                      </option>
                    </select><select :value="feature.demo" :class="featureClass(feature.demo)" :aria-label="`${features[index]} demo status`" @change="setFeatureStatus(index, 'demo', $event)">
                      <option value="unverified">
                        Unverified
                      </option><option value="present">
                        Present
                      </option><option value="missing">
                        Missing
                      </option>
                    </select><input :value="feature.note" :aria-label="`${features[index]} note`" placeholder="Evidence note" @input="updateFeatureNote(index, $event)">
                  </div>
                </div>
              </div>
              <div class="review-approval">
                <label class="check-label"><input :checked="selectedReview.warningsAcknowledged" type="checkbox" @change="handleWarningsChange"> I acknowledge the warnings on this review</label><button
                  class="primary-button" type="button" :disabled="!selectedReviewReady" @click="approveReview"
                >
                  <Check :size="15" aria-hidden="true" /> Mark reviewed
                </button>
              </div>
            </div>
            <aside class="notes-panel">
              <div class="panel-heading">
                <div><h3>Notes</h3><p>Freeform notes; use the button below to append a timestamped entry.</p></div><LinkIcon :size="16" aria-hidden="true" />
              </div><textarea :value="selectedReview.notes" rows="9" placeholder="Write an observation or decision note…" @input="handleReviewNotesChange" /><div
                class="note-entry"
              >
                <input v-model="newNote" placeholder="Add timestamped note" @keydown.enter.prevent="appendTimestampedNote"><button
                  class="icon-button" type="button" aria-label="Add timestamped note" @click="appendTimestampedNote"
                >
                  <Send :size="15" aria-hidden="true" />
                </button>
              </div><form
                class="submission-form" @submit.prevent="captureEvidenceLink"
              >
                <label>Evidence link<input v-model="evidenceLink" type="url" placeholder="https://…"></label><button
                  class="secondary-button" type="submit"
                >
                  <LinkIcon :size="14" aria-hidden="true" /> Capture evidence link
                </button><p
                  v-if="evidenceLinkMessage" class="feedback" role="status"
                >
                  {{ evidenceLinkMessage }}
                </p>
              </form><div
                id="evidence-citations" class="citation-list"
              >
                <h4>Evidence citations</h4><button v-for="item in selectedTeamEvidence" :key="item.id" type="button" @click="activeTab = 'evidence'; loadEvidence(item)">
                  <FileText :size="14" aria-hidden="true" /> {{ item.title }}
                </button><p
                  v-if="!selectedTeamEvidence.length" class="empty-copy"
                >
                  Citations appear after intake.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>

    <section class="operations-grid" aria-label="Operations">
      <article class="operations-card">
        <div class="panel-heading">
          <div>
            <div
              class="eyebrow"
            >
              Local station
            </div><h3>{{ local ? 'Pair this station' : 'Pair a judging station' }}</h3>
          </div><GitBranch :size="17" aria-hidden="true" />
        </div><p
          class="muted-copy"
        >
          Pairing connects this station to the seven-day event scope and keeps the credential out of the browser.
        </p><form
          class="pair-form" @submit.prevent="local ? pairLocalDevice() : createAdminPairCode()"
        >
          <label v-if="local">Pairing code<input v-model="pairCode" autocomplete="one-time-code" inputmode="numeric" maxlength="8" placeholder="Enter code"></label><output
            v-else-if="pairCode" class="pair-code" aria-label="Pairing code"
          >{{ pairCode }}</output><button
            class="secondary-button" type="submit" :disabled="pairLoading"
          >
            {{ local ? 'Pair station' : 'Create 10-minute code' }}
          </button>
        </form><p
          v-if="pairMessage" class="feedback" role="status"
        >
          {{ pairMessage }}
        </p><ul
          v-if="!local && pairedDevices.length" class="device-list"
        >
          <li v-for="device in pairedDevices" :key="device.id ?? device.deviceId">
            <span><strong>{{ device.name ?? device.label ?? 'Judging station' }}</strong><small>{{ device.lastSeenAt ? `Last seen ${formatDateTime(device.lastSeenAt)}` : 'Pending' }}</small></span><button
              class="text-button danger-text" type="button" @click="revokeDevice(device)"
            >
              Revoke
            </button>
          </li>
        </ul>
      </article>
      <article class="operations-card">
        <div class="panel-heading">
          <div>
            <div
              class="eyebrow"
            >
              Export and intake
            </div><h3>Evidence remains reviewable</h3>
          </div><Download :size="17" aria-hidden="true" />
        </div><p
          class="muted-copy"
        >
          Intake adds selected evidence records; exports stay separate from link submission.
        </p><div
          class="operation-buttons"
        >
          <button
            v-if="local" class="secondary-button" type="button" :disabled="intakeLoading" @click="startIntake"
          >
            <RefreshCw :size="15" aria-hidden="true" /> {{ intakeLoading ? 'Intake running…' : 'Run local intake' }}
          </button><button
            class="secondary-button" type="button" :disabled="exporting" @click="downloadExport(false)"
          >
            <Download :size="15" aria-hidden="true" /> Draft XLSX
          </button><button
            class="primary-button" type="button" :disabled="exporting || !readinessResult.ready" @click="downloadExport(true)"
          >
            <Download :size="15" aria-hidden="true" /> Final XLSX
          </button>
        </div><a
          class="secondary-button organizer-link" :href="ORGANIZER_SUBMISSION_FORM_URL" target="_blank" rel="noreferrer"
        ><ExternalLink :size="14" aria-hidden="true" /> Open organizer submission form</a><p
          v-if="exportMessage" class="feedback" role="status"
        >
          {{ exportMessage }}
        </p><details
          v-if="readinessResult.warnings.length" class="assessment-history"
        >
          <summary>Export checks ({{ readinessResult.warnings.length }})</summary>
          <ul>
            <li v-for="warning in readinessResult.warnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </details><p
          class="micro-copy"
        >
          Upload the XLSX yourself after final review.
        </p>
      </article>
    </section>

    <div v-if="conflict" ref="conflictDialog" class="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="conflict-title" tabindex="-1" @keydown="handleConflictKeydown">
      <div class="conflict-dialog">
        <div class="eyebrow">
          Version conflict
        </div><h2 id="conflict-title">
          Choose which review to keep
        </h2><p>The server changed <strong>{{ conflict.key }}</strong> while this station had edits pending. Compare the two snapshots before continuing.</p><div
          class="conflict-grid"
        >
          <div><h3>This station</h3><pre>{{ JSON.stringify(conflict.local.data, null, 2) }}</pre></div><div><h3>Server</h3><pre>{{ JSON.stringify(conflict.current.data, null, 2) }}</pre></div>
        </div><div
          class="dialog-actions"
        >
          <button
            class="secondary-button" type="button" @click="resolveConflict('remote')"
          >
            Use server snapshot
          </button><button
            class="primary-button" type="button" @click="resolveConflict('local')"
          >
            Keep my edits and retry
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.judging-workspace {
  container-type: inline-size;
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

* {
  box-sizing: border-box;
}

button,
input,
select,
textarea {
  font: inherit;
}

button,
a,
input,
select,
textarea {
  -webkit-tap-highlight-color: transparent;
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex='-1']:focus-visible {
  outline: 3px solid var(--judge-yellow);
  outline-offset: 2px;
}

a {
  color: inherit;
}

.workspace-header,
.section-heading,
.panel-heading,
.header-actions,
.section-actions,
.workbench-actions,
.operation-buttons,
.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.workspace-header {
  align-items: flex-start;
  gap: 1rem;
  margin: 0 auto 1rem;
  max-width: 1440px;
}

.header-title {
  min-width: 0;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--judge-muted);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1,
h2,
h3,
h4,
p {
  margin: 0;
}

h1 {
  margin-top: 0.28rem;
  font-size: clamp(1.35rem, 2.5vw, 2rem);
  letter-spacing: -0.03em;
  line-height: 1.1;
}

h2 {
  margin-top: 0.2rem;
  font-size: clamp(1rem, 1.8vw, 1.3rem);
  letter-spacing: -0.02em;
}

h3 {
  font-size: 0.98rem;
  letter-spacing: -0.01em;
}

h4 {
  font-size: 0.78rem;
}

.header-title p,
.muted-copy,
.panel-copy p,
.operations-card > p {
  color: var(--judge-muted);
}

.header-title p {
  margin-top: 0.35rem;
  font-size: 0.78rem;
}

.header-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.sync-pill,
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  border: 1px solid var(--judge-border);
  border-radius: 99px;
  padding: 0.28rem 0.52rem;
  font-size: 0.68rem;
  font-weight: 750;
  white-space: nowrap;
}

.sync-online {
  background: color-mix(in srgb, var(--judge-green) 12%, var(--judge-surface));
  color: var(--judge-green);
}
.sync-pending {
  background: color-mix(in srgb, var(--judge-yellow) 24%, var(--judge-surface));
  color: var(--judge-yellow-ink);
}
.sync-offline,
.sync-danger {
  background: color-mix(in srgb, var(--judge-red) 12%, var(--judge-surface));
  color: var(--judge-red);
}

.icon-button,
.theme-switcher button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  color: var(--judge-text);
}
.icon-button {
  min-width: 2.15rem;
  min-height: 2.15rem;
  padding: 0.4rem;
  border-radius: 0.5rem;
}
.icon-button:hover,
.theme-switcher button:hover,
.secondary-button:hover,
.filter-buttons button:hover,
.workbench-tabs button:hover {
  background: var(--judge-bg);
}
.icon-button:disabled,
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.theme-switcher {
  display: inline-flex;
  border: 1px solid var(--judge-border);
  border-radius: 0.5rem;
  overflow: hidden;
}
.theme-switcher button {
  min-width: 2rem;
  min-height: 2.15rem;
  border: 0;
  border-right: 1px solid var(--judge-border);
  border-radius: 0;
}
.theme-switcher button:last-child {
  border-right: 0;
}
.theme-switcher button.selected {
  background: var(--judge-yellow);
  color: var(--judge-yellow-ink);
}

.workspace-alert {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  max-width: 1440px;
  margin: 0 auto 1rem;
  border: 1px solid var(--judge-border);
  padding: 0.65rem 0.8rem;
}
.alert-error {
  background: color-mix(in srgb, var(--judge-red) 11%, var(--judge-surface));
  color: var(--judge-red);
}
.alert-recovery {
  background: color-mix(in srgb, var(--judge-yellow) 12%, var(--judge-surface));
  color: var(--judge-text);
}
.text-button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 800;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
.danger-text {
  color: var(--judge-red);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.7rem;
  max-width: 1440px;
  margin: 0 auto 0.75rem;
}
.overview-card,
.judge-strip,
.review-table-section,
.workbench,
.operations-card {
  border: 1px solid var(--judge-border);
  background: var(--judge-surface);
  box-shadow: var(--judge-shadow);
}
.overview-card {
  display: flex;
  min-height: 6.5rem;
  gap: 0.7rem;
  padding: 0.9rem;
}
.card-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  border: 1px solid var(--judge-border);
  background: var(--judge-yellow);
  color: var(--judge-yellow-ink);
}
.card-label {
  display: block;
  color: var(--judge-muted);
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.overview-card strong {
  display: block;
  margin-top: 0.2rem;
  font-size: 1.08rem;
}
.overview-card small {
  display: block;
  margin-top: 0.24rem;
  color: var(--judge-muted);
  font-size: 0.68rem;
}

.judge-strip,
.review-table-section,
.workbench {
  max-width: 1440px;
  margin: 0 auto 0.75rem;
}
.judge-strip {
  display: grid;
  grid-template-columns: minmax(11rem, 0.65fr) minmax(0, 1.35fr);
  gap: 1rem;
  padding: 0.9rem;
}
.judge-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 0.65rem;
}
.judge-fields label,
.pair-form label,
.submission-form label,
.repo-check label {
  display: grid;
  gap: 0.28rem;
  color: var(--judge-muted);
  font-size: 0.69rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.judge-fields input,
.judge-fields select,
.judge-fields textarea,
.field-output,
.pair-form input,
.submission-form input,
.repo-check select,
.notes-panel textarea,
.note-entry input,
.feature-row input,
.feature-row select,
.score-field input {
  width: 100%;
  min-height: 2.35rem;
  border: 1px solid var(--judge-border);
  border-radius: 0.35rem;
  background: var(--judge-surface-raised);
  color: var(--judge-text);
  padding: 0.48rem 0.55rem;
  font-size: 0.78rem;
  letter-spacing: normal;
  text-transform: none;
}
.field-output {
  display: flex;
  align-items: center;
}
.judge-fields textarea {
  resize: vertical;
  grid-column: 1 / -1;
}
.judge-fields .judge-notes {
  grid-column: 1 / -1;
}
.check-label {
  display: flex !important;
  align-items: flex-start;
  gap: 0.42rem;
  color: var(--judge-text) !important;
  font-size: 0.73rem !important;
  font-weight: 650 !important;
  letter-spacing: normal !important;
  text-transform: none !important;
}
.check-label input {
  width: 1rem;
  min-height: 1rem;
  margin-top: 0.1rem;
  accent-color: var(--judge-yellow);
}
.judge-fields .check-label {
  grid-column: 1 / -1;
}

.review-table-section,
.workbench {
  padding: 1rem;
}
.section-heading {
  align-items: flex-start;
}
.section-actions,
.workbench-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.38rem;
  min-height: 2.3rem;
  border: 1px solid var(--judge-border-strong);
  border-radius: 0.35rem;
  padding: 0.48rem 0.7rem;
  cursor: pointer;
  font-size: 0.74rem;
  font-weight: 800;
  text-decoration: none;
}
.primary-button {
  border-color: var(--judge-yellow);
  background: var(--judge-yellow);
  color: var(--judge-yellow-ink);
}
.primary-button:hover {
  filter: brightness(0.97);
}
.secondary-button {
  background: var(--judge-surface-raised);
  color: var(--judge-text);
}

.queue-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin: 1rem 0 0.7rem;
}
.search-field {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: min(100%, 16rem);
  flex: 1 1 16rem;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  padding: 0 0.65rem;
  color: var(--judge-muted);
}
.search-field input {
  width: 100%;
  min-height: 2.25rem;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--judge-text);
}
.filter-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.filter-buttons button,
.workbench-tabs button {
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  color: var(--judge-muted);
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  font-size: 0.71rem;
  font-weight: 750;
}
.filter-buttons button.active,
.workbench-tabs button.active {
  background: var(--judge-yellow);
  color: var(--judge-yellow-ink);
  border-color: var(--judge-yellow);
}
.table-scroll {
  overflow-x: auto;
  border: 1px solid var(--judge-border);
}
.review-table {
  width: 100%;
  min-width: 48rem;
  border-collapse: collapse;
}
.review-table th,
.review-table td {
  padding: 0.65rem 0.7rem;
  border-bottom: 1px solid var(--judge-border);
  text-align: left;
  vertical-align: middle;
}
.review-table tbody tr {
  cursor: pointer;
}
.review-table tbody tr:hover {
  background: var(--judge-surface-raised);
}
.review-table tbody tr.selected {
  background: color-mix(in srgb, var(--judge-yellow) 8%, var(--judge-surface));
}
.review-table tbody tr:last-child th,
.review-table tbody tr:last-child td {
  border-bottom: 0;
}
.review-table thead th {
  color: var(--judge-muted);
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-transform: inherit;
}
.team-link {
  display: grid;
  gap: 0.15rem;
  border: 0;
  background: transparent;
  color: var(--judge-text);
  text-align: left;
  cursor: pointer;
  font-weight: 800;
}
.team-link small {
  color: var(--judge-muted);
  font-size: 0.65rem;
  font-weight: 500;
}
.status-badge {
  padding: 0.22rem 0.45rem;
  border-radius: 0.25rem;
  font-size: 0.64rem;
}
.status-neutral {
  background: color-mix(in srgb, var(--judge-muted) 10%, var(--judge-surface));
  color: var(--judge-muted);
}
.status-warning {
  background: color-mix(in srgb, var(--judge-red) 12%, var(--judge-surface));
  color: var(--judge-red);
}
.status-ready {
  background: color-mix(in srgb, var(--judge-green) 12%, var(--judge-surface));
  color: var(--judge-green);
}
.score-cell {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 9rem;
}
.score-cell strong {
  min-width: 2.3rem;
}
.score-cell small {
  color: var(--judge-muted);
  font-size: 0.65rem;
}
.weighted-bar,
.progress-track {
  display: block;
  overflow: hidden;
  height: 0.45rem;
  background: var(--judge-border);
}
.weighted-bar {
  width: 4rem;
}
.weighted-bar i,
.progress-track i {
  display: block;
  height: 100%;
  background: var(--judge-yellow);
}
.weighted-stack {
  display: flex;
  width: 6rem;
  height: 0.58rem;
  overflow: hidden;
  border: 1px solid var(--judge-border);
  background: var(--judge-border);
}
.weighted-stack i {
  display: block;
  min-width: 0;
  height: 100%;
  border-right: 1px solid color-mix(in srgb, var(--judge-surface-raised) 80%, transparent);
}
.weighted-stack i:last-child {
  border-right: 0;
}
.rubric-heatmap,
.feature-heatmap {
  display: grid;
  gap: 0.18rem;
}
.rubric-heatmap {
  grid-template-columns: repeat(4, 0.85rem);
}
.feature-heatmap {
  grid-template-columns: repeat(6, 0.85rem);
}
.rubric-heatmap span,
.feature-heatmap span {
  display: block;
  width: 0.85rem;
  height: 0.85rem;
  border: 1px solid var(--judge-border);
}
.rubric-unscored {
  background: var(--judge-border);
}
.rubric-high {
  background: var(--judge-green);
  border-color: var(--judge-green) !important;
}
.rubric-mid {
  background: var(--judge-yellow);
  border-color: var(--judge-yellow) !important;
}
.rubric-low {
  background: var(--judge-red);
  border-color: var(--judge-red) !important;
}
.feature-unverified {
  background: var(--judge-border);
}
.feature-present {
  background: var(--judge-green);
  border-color: var(--judge-green) !important;
}
.feature-missing {
  background: var(--judge-red);
  border-color: var(--judge-red) !important;
}
.evidence-count {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 0;
  background: transparent;
  color: var(--judge-text);
  cursor: pointer;
  font-weight: 750;
}
.empty-cell,
.empty-copy {
  color: var(--judge-muted);
  text-align: center !important;
}

.workbench-heading {
  margin-bottom: 0.7rem;
}
.workbench-tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--judge-border);
  margin: 0 -1rem 0.85rem;
  padding: 0 1rem;
}
.workbench {
  min-width: 0;
  overflow: hidden;
}
.workbench-layout {
  display: grid;
  min-width: 0;
}
.workbench-pane {
  display: none;
  min-width: 0;
}
.workbench-pane.pane-active {
  display: block;
}
.workbench-panel {
  min-width: 0;
  min-height: 18rem;
}
.queue-panel {
  display: grid;
  grid-template-columns: minmax(15rem, 0.7fr) minmax(0, 1.3fr);
  gap: 1rem;
}
.team-queue-mini {
  display: grid;
  align-content: start;
  gap: 0.55rem;
  min-width: 0;
}
.team-queue-list {
  display: grid;
  gap: 0.25rem;
  max-height: 16rem;
  overflow: auto;
  padding-right: 0.2rem;
}
.team-queue-list button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  width: 100%;
  min-width: 0;
  border: 1px solid transparent;
  background: transparent;
  color: var(--judge-text);
  padding: 0.45rem 0.5rem;
  cursor: pointer;
  text-align: left;
}
.team-queue-list button:hover {
  border-color: var(--judge-border);
  background: var(--judge-surface-raised);
}
.team-queue-list button.selected {
  border-color: var(--judge-border);
  background: color-mix(in srgb, var(--judge-yellow) 10%, var(--judge-surface));
}
.team-queue-list button > span:first-child {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
}
.team-queue-list strong,
.team-queue-list small,
.mini-score b,
.mini-score small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-queue-list strong {
  font-size: 0.72rem;
}
.team-queue-list small,
.mini-score small {
  color: var(--judge-muted);
  font-size: 0.63rem;
}
.mini-score {
  flex: 0 0 auto;
  text-align: right;
}
.mini-score b {
  font-size: 0.7rem;
}
.panel-copy {
  display: grid;
  align-content: start;
  gap: 0.65rem;
}
.job-list {
  display: grid;
  align-content: start;
  gap: 0.3rem;
}
.assessment-history {
  border-top: 1px solid var(--judge-border);
  padding-top: 0.6rem;
  font-size: 0.72rem;
}
.assessment-history summary {
  cursor: pointer;
}
.assessment-history summary:focus-visible {
  outline: 2px solid var(--judge-yellow);
  outline-offset: 2px;
}
.assessment-history ol {
  display: grid;
  gap: 0.6rem;
  margin-top: 0.6rem;
}
.assessment-history li {
  display: grid;
  gap: 0.2rem;
  overflow-wrap: anywhere;
}
.assessment-history li span,
.assessment-history time {
  color: var(--judge-muted);
}
.job-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(8rem, 0.45fr) auto;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  padding: 0.55rem 0.65rem;
}
.job-row strong,
.job-row small {
  display: block;
}
.job-row small {
  color: var(--judge-muted);
  font-size: 0.69rem;
}
.job-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
}
.compact-button {
  min-height: 2rem;
  padding: 0.3rem 0.55rem;
  font-size: 0.67rem;
}
.stale-job-label,
.stale-copy {
  display: block;
  color: var(--judge-yellow-ink);
  font-size: 0.67rem;
  font-weight: 750;
}
.ai-suggestion .stale-copy {
  color: var(--judge-yellow-ink);
}
.job-progress {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--judge-muted);
  font-size: 0.67rem;
}
.progress-track {
  flex: 1;
  height: 0.4rem;
}
.feedback {
  color: var(--judge-muted);
  font-size: 0.72rem;
}

.evidence-panel {
  display: grid;
  grid-template-columns: minmax(15rem, 0.4fr) minmax(0, 1.6fr);
  gap: 0.85rem;
}
.evidence-list {
  min-width: 0;
  border-right: 1px solid var(--judge-border);
  padding-right: 0.85rem;
}
.evidence-list .panel-heading {
  align-items: flex-start;
  margin-bottom: 0.55rem;
}
.evidence-list .panel-heading p {
  margin-top: 0.2rem;
  color: var(--judge-muted);
  font-size: 0.68rem;
}
.evidence-toolbar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.25rem;
}
.evidence-search {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
  flex: 1 1 auto;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  padding: 0 0.45rem;
  color: var(--judge-muted);
}
.evidence-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0.45rem 0.1rem;
}
.evidence-search input:focus {
  outline: 0;
}
.evidence-count {
  margin: 0 0 0.35rem;
  color: var(--judge-muted);
  font-size: 0.64rem;
}
.evidence-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--judge-text);
  padding: 0.55rem;
  text-align: left;
  cursor: pointer;
}
.evidence-item:hover {
  border-color: var(--judge-border);
  background: var(--judge-surface-raised);
}
.evidence-item.active {
  border-color: var(--judge-border);
  background: color-mix(in srgb, var(--judge-yellow) 10%, var(--judge-surface));
}
.evidence-item strong,
.evidence-item small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evidence-item strong {
  font-size: 0.74rem;
}
.evidence-item small {
  color: var(--judge-muted);
  font-size: 0.65rem;
}
.evidence-reader {
  min-width: 0;
}
.reader-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 16rem;
  color: var(--judge-muted);
}
.reader-error {
  color: var(--judge-red);
}
.reader-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid var(--judge-border);
  padding-bottom: 0.7rem;
}
.reader-header p {
  margin-top: 0.25rem;
  color: var(--judge-muted);
  font-size: 0.7rem;
  overflow-wrap: anywhere;
}
.reader-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.55rem 0;
  color: var(--judge-muted);
  font-size: 0.67rem;
}
.source-reader {
  max-height: 25rem;
  overflow: auto;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
}
.source-line {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr);
  gap: 0.65rem;
  min-height: 1.45rem;
  border-bottom: 1px solid color-mix(in srgb, var(--judge-border) 60%, transparent);
  padding: 0.2rem 0.55rem;
}
.source-line > span {
  color: var(--judge-muted);
  font-size: 0.68rem;
  text-align: right;
  user-select: none;
}
.source-line code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font:
    0.72rem/1.45 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
}
.pdf-pages {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.7rem;
}
.pdf-pages > div {
  border: 1px solid var(--judge-border);
  padding: 0.55rem;
}
.pdf-pages p {
  margin-top: 0.25rem;
  color: var(--judge-muted);
  white-space: pre-wrap;
}

.intake-summary {
  display: grid;
  gap: 0.55rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface);
  padding: 0.65rem;
}
.intake-summary .panel-heading {
  align-items: flex-start;
}
.intake-summary .panel-heading p {
  margin-top: 0.18rem;
  color: var(--judge-muted);
  font-size: 0.68rem;
}
.parity-badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--judge-border);
  padding: 0.25rem 0.45rem;
  color: var(--judge-muted);
  font-size: 0.63rem;
  font-weight: 800;
  white-space: nowrap;
}
.parity-present {
  border-color: var(--judge-green);
  color: var(--judge-green);
}
.parity-missing {
  border-color: var(--judge-red);
  color: var(--judge-red);
}
.parity-match {
  border-color: var(--judge-green);
  color: var(--judge-green);
}
.parity-mismatch {
  border-color: var(--judge-red);
  color: var(--judge-red);
}
.intake-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
  margin: 0;
}
.intake-meta div {
  min-width: 0;
  border-top: 1px solid var(--judge-border);
  padding-top: 0.35rem;
}
.intake-meta dt {
  color: var(--judge-muted);
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
}
.intake-meta dd {
  margin: 0.12rem 0 0;
  overflow-wrap: anywhere;
  font-size: 0.7rem;
}
.deployment-links {
  display: grid;
  gap: 0.35rem;
  border-top: 1px solid var(--judge-border);
  padding-top: 0.45rem;
}
.deployment-links h4 {
  color: var(--judge-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.deployment-links ul {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.deployment-links li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
}
.deployment-links a {
  overflow-wrap: anywhere;
  color: var(--judge-text);
  font-size: 0.7rem;
  text-decoration: underline;
  text-underline-offset: 0.12em;
}
.deployment-links li span {
  flex: 0 0 auto;
  color: var(--judge-muted);
  font-size: 0.63rem;
}
.ancillary-links {
  border-top: 1px solid var(--judge-border);
  padding-top: 0.4rem;
}
.ancillary-links summary {
  cursor: pointer;
  color: var(--judge-text);
  font-size: 0.68rem;
  font-weight: 750;
}
.ancillary-links summary:focus-visible {
  outline: 2px solid var(--judge-yellow);
  outline-offset: 2px;
}
.ancillary-links ul {
  margin-top: 0.4rem;
}

.scoring-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(16rem, 0.75fr);
  gap: 1rem;
}
.score-form,
.notes-panel {
  min-width: 0;
}
.large-score {
  display: flex;
  align-items: baseline;
  gap: 0.18rem;
  font-size: 1.6rem;
}
.large-score small {
  color: var(--judge-muted);
  font-size: 0.7rem;
}
.criteria-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.score-field {
  position: relative;
  display: grid;
  gap: 0.28rem;
}
.score-field > span {
  color: var(--judge-muted);
  font-size: 0.68rem;
  font-weight: 750;
}
.score-field > span small {
  color: var(--judge-text);
}
.score-field em {
  position: absolute;
  right: 0.55rem;
  bottom: 0.62rem;
  color: var(--judge-muted);
  font-size: 0.66rem;
  font-style: normal;
}
.score-field input {
  padding-right: 2rem;
}
.ai-suggestion {
  display: grid;
  gap: 0.6rem;
  margin-top: 0.8rem;
  border: 1px dashed var(--judge-yellow);
  background: color-mix(in srgb, var(--judge-yellow) 8%, var(--judge-surface));
  padding: 0.7rem;
}
.ai-suggestion p {
  margin-top: 0.18rem;
  color: var(--judge-muted);
  font-size: 0.68rem;
}
.ai-score-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.4rem;
}
.ai-score-list span {
  display: grid;
  gap: 0.18rem;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  padding: 0.4rem 0.5rem;
}
.ai-score-list strong {
  color: var(--judge-muted);
  font-size: 0.64rem;
}
.ai-score-list em {
  font-size: 0.82rem;
  font-style: normal;
  font-weight: 800;
}
.ai-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}
.ai-detail-grid > div,
.ai-feature-findings,
.ai-citations {
  min-width: 0;
  border-top: 1px solid var(--judge-border);
  padding-top: 0.45rem;
}
.ai-detail-grid ul {
  display: grid;
  gap: 0.25rem;
  margin: 0.35rem 0 0;
  padding-left: 1rem;
  color: var(--judge-text);
  font-size: 0.7rem;
}
.ai-feature-findings,
.ai-citations {
  display: grid;
  gap: 0.35rem;
}
.ai-feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
}
.ai-feature-grid span {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  padding: 0.38rem 0.45rem;
}
.ai-feature-grid strong {
  font-size: 0.68rem;
}
.ai-feature-grid small,
.ai-feature-grid em {
  color: var(--judge-muted);
  font-size: 0.63rem;
  font-style: normal;
  overflow-wrap: anywhere;
}
.citation-buttons {
  display: grid;
  gap: 0.25rem;
}
.citation-buttons button {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  color: var(--judge-text);
  padding: 0.4rem 0.45rem;
  cursor: pointer;
  text-align: left;
}
.citation-buttons button:hover {
  border-color: var(--judge-border-strong);
  background: var(--judge-bg);
}
.citation-buttons button > span {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
  font-size: 0.68rem;
}
.citation-buttons small {
  color: var(--judge-muted);
  font-size: 0.62rem;
}
.repo-check {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.75rem;
}
.repo-check label {
  flex: 1 1 16rem;
}
.micro-copy {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--judge-muted);
  font-size: 0.68rem;
}
.feature-review {
  margin-top: 1rem;
}
.feature-review .panel-heading {
  align-items: flex-start;
  margin-bottom: 0.55rem;
}
.feature-review .panel-heading p {
  margin-top: 0.18rem;
  color: var(--judge-muted);
  font-size: 0.68rem;
}
.feature-table {
  overflow-x: auto;
  border: 1px solid var(--judge-border);
}
.feature-row {
  display: grid;
  grid-template-columns: minmax(8rem, 1.1fr) 7rem 7rem minmax(10rem, 1.4fr);
  gap: 0.45rem;
  align-items: center;
  border-bottom: 1px solid var(--judge-border);
  padding: 0.45rem 0.55rem;
}
.feature-row:last-child {
  border-bottom: 0;
}
.feature-row strong {
  font-size: 0.72rem;
}
.feature-row select {
  min-height: 2rem;
  padding: 0.25rem 0.35rem;
  font-size: 0.67rem;
}
.feature-row input {
  min-height: 2rem;
  padding: 0.25rem 0.4rem;
  font-size: 0.67rem;
}
.feature-header {
  color: var(--judge-muted);
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.review-approval {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.85rem;
}
.notes-panel {
  display: grid;
  align-content: start;
  gap: 0.55rem;
  border-left: 1px solid var(--judge-border);
  padding-left: 1rem;
}
.notes-panel .panel-heading {
  align-items: flex-start;
}
.notes-panel .panel-heading p {
  margin-top: 0.2rem;
  color: var(--judge-muted);
  font-size: 0.68rem;
}
.notes-panel textarea {
  min-height: 10rem;
  resize: vertical;
  line-height: 1.55;
}
.note-entry {
  display: flex;
  gap: 0.35rem;
}
.note-entry input {
  flex: 1 1 auto;
}
.submission-form {
  display: grid;
  gap: 0.45rem;
  border-top: 1px solid var(--judge-border);
  padding-top: 0.7rem;
}
.citation-list {
  display: grid;
  gap: 0.3rem;
  border-top: 1px solid var(--judge-border);
  padding-top: 0.7rem;
}
.citation-list button {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  border: 0;
  background: transparent;
  color: var(--judge-text);
  cursor: pointer;
  padding: 0.2rem 0;
  text-align: left;
  font-size: 0.7rem;
}
.citation-list button:hover {
  color: var(--judge-text);
  text-decoration: underline;
}

.operations-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  max-width: 1440px;
  margin: 0 auto;
}
.operations-card {
  min-width: 0;
  padding: 0.9rem;
}
.operations-card > p {
  margin: 0.55rem 0;
  font-size: 0.75rem;
}
.pair-form {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.pair-form label {
  flex: 1 1 12rem;
}
.pair-code {
  display: inline-flex;
  align-items: center;
  min-height: 2.3rem;
  border: 1px dashed var(--judge-yellow);
  background: color-mix(in srgb, var(--judge-yellow) 14%, var(--judge-surface));
  padding: 0.45rem 0.7rem;
  font:
    800 1.1rem/1 ui-monospace,
    monospace;
  letter-spacing: 0.16em;
}
.operation-buttons {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.device-list {
  display: grid;
  gap: 0.35rem;
  margin: 0.65rem 0 0;
  padding: 0;
  list-style: none;
}
.device-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-top: 1px solid var(--judge-border);
  padding-top: 0.4rem;
}
.device-list strong,
.device-list small {
  display: block;
}
.device-list small {
  color: var(--judge-muted);
  font-size: 0.66rem;
}

.modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  overflow: auto;
  background: rgb(15 16 13 / 62%);
  padding: 1rem;
}
.conflict-dialog {
  position: relative;
  width: min(100%, 72rem);
  border: 1px solid var(--judge-border-strong);
  background: var(--judge-surface);
  color: var(--judge-text);
  box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
  padding: clamp(1rem, 3vw, 1.6rem);
}
.close-modal {
  position: absolute;
  top: 0.8rem;
  right: 0.8rem;
}
.conflict-dialog > p {
  max-width: 50rem;
  margin-top: 0.5rem;
  color: var(--judge-muted);
}
.conflict-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  margin: 1rem 0;
}
.conflict-grid h3 {
  margin-bottom: 0.35rem;
}
.conflict-grid pre {
  max-height: 15rem;
  overflow: auto;
  border: 1px solid var(--judge-border);
  background: var(--judge-surface-raised);
  padding: 0.65rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font:
    0.68rem/1.4 ui-monospace,
    monospace;
}
.dialog-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}
.spin {
  animation: judging-spin 0.9s linear infinite;
}
@keyframes judging-spin {
  to {
    transform: rotate(360deg);
  }
}

@container (min-width: 1000px) {
  .workbench-tabs {
    display: none;
  }
  .workbench-layout {
    grid-template-columns: minmax(12rem, 0.72fr) minmax(27rem, 1.65fr) minmax(21rem, 1.15fr);
    align-items: start;
    gap: 0.75rem;
  }
  .workbench-pane,
  .workbench-pane.pane-active {
    display: block;
  }
  .queue-panel {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .evidence-panel {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .evidence-list {
    max-height: 18rem;
    overflow: auto;
    border-right: 0;
    border-bottom: 1px solid var(--judge-border);
    padding: 0 0 0.75rem;
  }
  .scoring-panel {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .criteria-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .notes-panel {
    border-top: 1px solid var(--judge-border);
    border-left: 0;
    padding-top: 0.75rem;
    padding-left: 0;
  }
  .team-queue-list {
    max-height: 18rem;
  }
  .job-row {
    grid-template-columns: minmax(0, 1fr) minmax(4rem, 0.55fr) auto;
  }
}

@media (max-width: 1000px) {
  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .judge-strip {
    grid-template-columns: 1fr;
  }
  .scoring-panel {
    grid-template-columns: 1fr;
  }
  .notes-panel {
    border-top: 1px solid var(--judge-border);
    border-left: 0;
    padding-top: 1rem;
    padding-left: 0;
  }
}

@media (max-width: 720px) {
  .judging-workspace {
    padding: 0.65rem;
  }
  .workspace-header {
    flex-direction: column;
  }
  .header-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .overview-grid {
    gap: 0.5rem;
  }
  .overview-card {
    min-height: 5.7rem;
    padding: 0.7rem;
  }
  .judge-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .judge-fields .check-label {
    grid-column: 1 / -1;
  }
  .section-heading,
  .workbench-heading {
    flex-direction: column;
  }
  .section-actions,
  .workbench-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .workbench-tabs button {
    flex: 1 1 0;
  }
  .queue-panel,
  .evidence-panel {
    grid-template-columns: 1fr;
  }
  .evidence-list {
    border-right: 0;
    border-bottom: 1px solid var(--judge-border);
    padding: 0 0 0.75rem;
  }
  .criteria-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .repo-check {
    align-items: stretch;
    flex-direction: column;
  }
  .repo-check label {
    flex: 0 1 auto;
  }
  .deployment-links li {
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
  }
  .deployment-links li span {
    flex: 0 1 auto;
    overflow-wrap: anywhere;
  }
  .ai-score-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ai-feature-grid,
  .ai-detail-grid {
    grid-template-columns: 1fr;
  }
  .intake-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .operations-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 430px) {
  .overview-grid {
    grid-template-columns: 1fr 1fr;
  }
  .overview-card {
    display: block;
  }
  .overview-card .card-icon {
    margin-bottom: 0.45rem;
  }
  .judge-fields {
    grid-template-columns: 1fr;
  }
  .judge-fields .check-label {
    grid-column: auto;
  }
  .criteria-grid {
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }
  .intake-meta {
    grid-template-columns: 1fr;
  }
  .score-field > span {
    min-height: 2rem;
  }
  .feature-row {
    grid-template-columns: minmax(7rem, 1fr) 5.7rem 5.7rem;
  }
  .feature-row input {
    grid-column: 1 / -1;
  }
  .feature-header input,
  .feature-header span:last-child {
    display: block;
  }
  .workbench,
  .review-table-section {
    padding: 0.75rem;
  }
  .workbench-tabs {
    margin-left: -0.75rem;
    margin-right: -0.75rem;
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }
  .dialog-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }
  .dialog-actions button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
