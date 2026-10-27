export type CriterionId = 'innovation' | 'problemSolutionFit' | 'feasibility' | 'clarity'
export type TeamId = '01-console' | '02-ctrl-ai' | '03-ctrl-cv' | '04-ctrl-alt-three' | '05-ctrl-s' | '06-decisive' | '07-dovun' | '08-dsaise' | '09-duologic'
export type RepoCheck = 'Yes' | 'No – private/broken' | 'No – doesn\'t match demo'
export type FeatureState = 'unverified' | 'present' | 'missing'
export type FeatureFinding = { proposal: FeatureState; demo: FeatureState; note: string }
export type Score = number | null

export interface Criterion {
  readonly id: CriterionId
  readonly label: string
  readonly weight: number
}

export interface Team {
  readonly id: TeamId
  readonly row: number
  readonly name: string
  readonly repoUrl: string
}

export interface Assignment {
  readonly id: string
  readonly judgeId: string
  readonly name: string
  readonly judgeName: string
  readonly domain: string
  readonly deadline: string | null
  readonly criteria: readonly Criterion[]
  readonly criteriaWeights: Readonly<Record<CriterionId, number>>
  readonly teams: readonly Team[]
}

export interface Review {
  teamId: TeamId
  scores: [Score, Score, Score, Score]
  repoCheck: RepoCheck | ''
  notes: string
  reviewedAt: string | null
  features: [FeatureFinding, FeatureFinding, FeatureFinding, FeatureFinding, FeatureFinding, FeatureFinding]
  warningsAcknowledged: boolean
}

export type ReviewInput = Partial<Review> & { teamId?: TeamId }

export type ReviewStatus = '—' | 'Not started' | 'Incomplete' | 'Missing repo check' | 'Complete'

export interface CalculatedReview extends Review, Team {
  contribution: [Score, Score, Score, Score]
  contributions: [Score, Score, Score, Score]
  weighted: [Score, Score, Score, Score]
  total: number | null
  rank: number | null
  status: ReviewStatus
}

export interface Judge {
  name: string
  date: string
  domain: string
  generalNotes: string
  warningsAcknowledged: boolean
}

export interface ReadinessWarning {
  code: string
  message: string
  teamId?: TeamId
}

export interface ReadinessResult {
  ready: boolean
  canSubmit: boolean
  reviewedCount: number
  totalTeams: number
  nineReviewed: boolean
  judgeDetailsComplete: boolean
  negativeRepoSelections: TeamId[]
  negativeSelectionWarningsAcknowledged: boolean
  warningsAcknowledged: boolean
  missingTeamIds: TeamId[]
  warnings: string[]
  warningDetails: ReadinessWarning[]
  rows: CalculatedReview[]
}

export interface EvidencePage {
  page: number
  text: string
}

export type EvidenceKind = 'source' | 'document' | 'transcript' | 'link'

export interface EvidenceRecord {
  id: string
  teamId: TeamId
  snapshotSha: string
  path: string
  kind: EvidenceKind
  sha256: string
  text: string
  lines: number
  pages?: EvidencePage[]
  coverage: string
  createdAt: string
}

export interface IntakeArtifact {
  path: string
  size: number
  sha256: string
}

export interface IntakeLink {
  url: string
  kind: string
  status: number | null
  parity: 'unverified' | 'match' | 'mismatch'
  error?: string
  accessible?: boolean
  finalUrl?: string
  checkedAt?: string
}

export interface IntakeRecord {
  teamId: TeamId
  repoUrl: string
  branch: string
  sha: string
  retrievedAt: string
  snapshotPath: string
  verified: boolean
  evidenceIds: string[]
  artifacts: IntakeArtifact[]
  links: IntakeLink[]
  demoParity: 'unverified' | 'match' | 'mismatch'
  issues: string[]
  declaredDemoCommits: string[]
  previousSnapshots: unknown[]
}

export type RecordData = Judge | Review | IntakeRecord | EvidenceRecord | Record<string, unknown>

export interface RecordEnvelope<T extends RecordData = RecordData> {
  key: string
  version: number
  data: T
  updatedAt: string
}

export const ASSIGNMENT_ID: 'sdc-2026'
export const JUDGE_ID: 'D1-J04'
export const DOMAIN: string
export const JUDGE_NAME: 'Muhammad Akmal Alif bin Azam'
export const DEADLINE: '2026-10-28T00:00:00.000Z'
export const CRITERIA: readonly Criterion[]
export const CRITERIA_WEIGHTS: Readonly<Record<CriterionId, number>>
export const REPO_CHECK_VALUES: readonly RepoCheck[]
export const NEGATIVE_REPO_CHECK_VALUES: readonly Exclude<RepoCheck, 'Yes'>[]
export const FEATURE_COUNT: 6
export const SCORE_COUNT: 4
export const STATUS: Readonly<Record<'EMPTY' | 'NOT_STARTED' | 'INCOMPLETE' | 'MISSING_REPO_CHECK' | 'COMPLETE', ReviewStatus>>
export const TEAM_IDS: readonly TeamId[]
export const TEAMS: readonly Team[]
export const ASSIGNMENT: Assignment

export function isDateOnly(value: unknown): value is string
export function emptyReview(teamId: TeamId): Review
export function normalizeReview(review: ReviewInput, teamId?: TeamId, options?: { allowDefaults?: boolean }): Review
export function validateJudge(judge: Partial<Judge>, options?: { allowDefaults?: boolean }): Judge
export function calculateReviews(reviews?: readonly ReviewInput[] | Partial<Record<TeamId, ReviewInput | null>> | null): CalculatedReview[]
export function readiness(judge: Partial<Judge>, reviews?: readonly ReviewInput[] | Partial<Record<TeamId, ReviewInput | null>> | null, intakes?: unknown): ReadinessResult
export function validateRecordDetailed(key: string, data: unknown): { success: true; valid: true; data: RecordData; issues: never[] } | { success: false; valid: false; data: undefined; issues: string[] }
export function validateRecord(key: string, data: unknown): boolean
export function assertRecord(key: string, data: unknown): RecordData
export function createRecord(key: string, data: unknown, options?: { version?: number; updatedAt?: string }): RecordEnvelope
export function isNegativeRepoCheck(value: unknown): value is Exclude<RepoCheck, 'Yes'>
export function isTeamId(value: unknown): value is TeamId
export function cloneAssignment(): Assignment
