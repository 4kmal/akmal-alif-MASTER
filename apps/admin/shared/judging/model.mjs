/**
 * Canonical SDC 2026 Domain 1 judging model.
 *
 * The workbook is an organizer-owned template. This module keeps the
 * application data model independent from the workbook and never assigns
 * scores or feature findings on a judge's behalf.
 */

export const ASSIGNMENT_ID = 'sdc-2026'
export const JUDGE_ID = 'D1-J04'
export const DOMAIN = 'Domain 1 – Aiversecity Future-Ready Workforce'
export const JUDGE_NAME = 'Muhammad Akmal Alif bin Azam'
export const DEADLINE = null

export const CRITERIA = Object.freeze([
  Object.freeze({ id: 'innovation', label: 'Innovation & Creativity', weight: 0.3 }),
  Object.freeze({ id: 'problemSolutionFit', label: 'Problem-Solution Fit', weight: 0.25 }),
  Object.freeze({ id: 'feasibility', label: 'Feasibility of Build', weight: 0.25 }),
  Object.freeze({ id: 'clarity', label: 'Clarity of Proposal', weight: 0.2 }),
])

export const CRITERIA_WEIGHTS = Object.freeze(Object.fromEntries(CRITERIA.map(criterion => [criterion.id, criterion.weight])))

export const REPO_CHECK_VALUES = Object.freeze([
  'Yes',
  'No – private/broken',
  'No – doesn\'t match demo',
])

export const NEGATIVE_REPO_CHECK_VALUES = Object.freeze(REPO_CHECK_VALUES.slice(1))
export const FEATURE_COUNT = 6
export const SCORE_COUNT = CRITERIA.length

export const STATUS = Object.freeze({
  EMPTY: '—',
  NOT_STARTED: 'Not started',
  INCOMPLETE: 'Incomplete',
  MISSING_REPO_CHECK: 'Missing repo check',
  COMPLETE: 'Complete',
})

const TEAM_DEFINITIONS = [
  ['01-console', 13, 'Console', 'https://github.com/Epsilon3096/SDC_Hackathon'],
  ['02-ctrl-ai', 14, 'ctrl + ai', 'https://github.com/amanbulu/SDC-Hackathon-ctrl-ai'],
  ['03-ctrl-cv', 15, 'Ctrl CV', 'https://github.com/AbdulMuhaimin949/Aiversecity-Future-Skills'],
  ['04-ctrl-alt-three', 16, 'Ctrl+Alt+Three', 'https://github.com/NicingMan-zzz/SkillCast'],
  ['05-ctrl-s', 17, 'Ctrl+S', 'https://github.com/davidy1402/ctrl-s-sdc2026'],
  ['06-decisive', 18, 'Decisive', 'https://github.com/RayeC-1305/XMUMSDC_Decisive'],
  ['07-dovun', 19, 'DOVUN', 'https://github.com/AIVANCIN/aivancin'],
  ['08-dsaise', 20, 'Dsaise', 'https://github.com/shenenleow10521/SdcHackathon'],
  ['09-duologic', 21, 'DuoLogic', 'https://github.com/Zhi-Qing-6272/SDC_Hackathon_Submission'],
]

export const TEAM_IDS = Object.freeze(TEAM_DEFINITIONS.map(([id]) => id))
export const TEAMS = Object.freeze(TEAM_DEFINITIONS.map(([id, row, name, repoUrl]) => Object.freeze({ id, row, name, repoUrl })))

export const ASSIGNMENT = Object.freeze({
  id: ASSIGNMENT_ID,
  judgeId: JUDGE_ID,
  name: JUDGE_NAME,
  judgeName: JUDGE_NAME,
  domain: DOMAIN,
  deadline: DEADLINE,
  criteria: CRITERIA,
  criteriaWeights: CRITERIA_WEIGHTS,
  teams: TEAMS,
})

const TEAM_BY_ID = new Map(TEAMS.map(team => [team.id, team]))
const NEGATIVE_REPO_CHECK_SET = new Set(NEGATIVE_REPO_CHECK_VALUES)
const REPO_CHECK_SET = new Set(REPO_CHECK_VALUES)
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertCondition(condition, message) {
  if (!condition)
    throw new TypeError(message)
}

function assertString(value, field, maxLength) {
  assertCondition(typeof value === 'string', field + ' must be a string')
  assertCondition(value.length <= maxLength, field + ' exceeds ' + maxLength + ' characters')
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function cleanNumber(value) {
  if (!Number.isFinite(value))
    return value
  return Number(value.toPrecision(15))
}

function isValidDateOnly(value) {
  if (!DATE_ONLY_PATTERN.test(value))
    return false
  const date = new Date(value + 'T00:00:00.000Z')
  return date.getUTCFullYear() === Number(value.slice(0, 4))
    && date.getUTCMonth() + 1 === Number(value.slice(5, 7))
    && date.getUTCDate() === Number(value.slice(8, 10))
}

export function isDateOnly(value) {
  return typeof value === 'string' && isValidDateOnly(value)
}

function validateScore(value, field) {
  if (value === null)
    return null
  assertCondition(typeof value === 'number' && Number.isFinite(value), field + ' must be a finite number or null')
  assertCondition(value >= 0 && value <= 100, field + ' must be between 0 and 100')
  return value
}

function defaultFeature() {
  return { proposal: 'unverified', demo: 'unverified', note: '' }
}

function defaultFeatures() {
  return Array.from({ length: FEATURE_COUNT }, defaultFeature)
}

function validateFeature(feature, index) {
  assertCondition(isPlainObject(feature), 'features[' + index + '] must be an object')
  assertCondition(feature.proposal === 'unverified' || feature.proposal === 'present' || feature.proposal === 'missing', 'features[' + index + '].proposal is invalid')
  assertCondition(feature.demo === 'unverified' || feature.demo === 'present' || feature.demo === 'missing', 'features[' + index + '].demo is invalid')
  assertString(feature.note, 'features[' + index + '].note', 2000)
  return {
    proposal: feature.proposal,
    demo: feature.demo,
    note: feature.note,
  }
}

export function emptyReview(teamId) {
  const team = TEAM_BY_ID.get(teamId)
  assertCondition(team, 'Unknown team ID: ' + teamId)
  return {
    teamId,
    scores: Array(SCORE_COUNT).fill(null),
    repoCheck: '',
    notes: '',
    reviewedAt: null,
    features: defaultFeatures(),
    warningsAcknowledged: false,
  }
}

export function normalizeReview(review, teamId, options = {}) {
  const allowDefaults = options.allowDefaults !== false
  assertCondition(isPlainObject(review), 'Review must be an object')
  const resolvedTeamId = teamId || review.teamId
  assertCondition(typeof resolvedTeamId === 'string' && TEAM_BY_ID.has(resolvedTeamId), 'Review teamId is unknown')
  if (review.teamId !== undefined)
    assertCondition(review.teamId === resolvedTeamId, 'Review teamId does not match its key')

  const hasScores = Object.prototype.hasOwnProperty.call(review, 'scores')
  assertCondition(allowDefaults || hasScores, 'Review scores are required')
  const scores = review.scores === undefined && allowDefaults
    ? Array(SCORE_COUNT).fill(null)
    : review.scores
  assertCondition(Array.isArray(scores) && scores.length === SCORE_COUNT, 'Review scores must contain exactly ' + SCORE_COUNT + ' entries')
  const normalizedScores = scores.map((value, index) => validateScore(value === undefined ? null : value, 'scores[' + index + ']'))

  const hasRepoCheck = Object.prototype.hasOwnProperty.call(review, 'repoCheck')
  assertCondition(allowDefaults || hasRepoCheck, 'Review repoCheck is required')
  const repoCheck = review.repoCheck === undefined && allowDefaults ? '' : review.repoCheck
  assertCondition(typeof repoCheck === 'string' && REPO_CHECK_SET.has(repoCheck), 'Review repoCheck is invalid')

  const hasNotes = Object.prototype.hasOwnProperty.call(review, 'notes')
  assertCondition(allowDefaults || hasNotes, 'Review notes are required')
  const notes = review.notes === undefined && allowDefaults ? '' : review.notes
  assertString(notes, 'Review notes', 10000)

  const hasReviewedAt = Object.prototype.hasOwnProperty.call(review, 'reviewedAt')
  assertCondition(allowDefaults || hasReviewedAt, 'Review reviewedAt is required')
  const reviewedAt = review.reviewedAt === undefined && allowDefaults ? null : review.reviewedAt
  assertCondition(reviewedAt === null || (typeof reviewedAt === 'string' && reviewedAt.length <= 128 && Number.isFinite(Date.parse(reviewedAt))), 'Review reviewedAt must be an ISO date string or null')

  const hasFeatures = Object.prototype.hasOwnProperty.call(review, 'features')
  assertCondition(allowDefaults || hasFeatures, 'Review features are required')
  const features = review.features === undefined && allowDefaults ? defaultFeatures() : review.features
  assertCondition(Array.isArray(features) && features.length === FEATURE_COUNT, 'Review features must contain exactly ' + FEATURE_COUNT + ' entries')
  const normalizedFeatures = features.map(validateFeature)

  const hasWarningsAcknowledged = Object.prototype.hasOwnProperty.call(review, 'warningsAcknowledged')
  assertCondition(allowDefaults || hasWarningsAcknowledged, 'Review warningsAcknowledged is required')
  const warningsAcknowledged = review.warningsAcknowledged === undefined && allowDefaults ? false : review.warningsAcknowledged
  assertCondition(typeof warningsAcknowledged === 'boolean', 'Review warningsAcknowledged must be boolean')

  return {
    teamId: resolvedTeamId,
    scores: normalizedScores,
    repoCheck,
    notes,
    reviewedAt,
    features: normalizedFeatures,
    warningsAcknowledged,
  }
}

export function validateJudge(judge, options = {}) {
  const allowDefaults = options.allowDefaults !== false
  assertCondition(isPlainObject(judge), 'Judge must be an object')
  const hasName = Object.prototype.hasOwnProperty.call(judge, 'name')
  assertCondition(allowDefaults || hasName, 'Judge name is required')
  const name = judge.name === undefined && allowDefaults ? '' : judge.name
  assertString(name, 'Judge name', 256)

  const hasDate = Object.prototype.hasOwnProperty.call(judge, 'date')
  assertCondition(allowDefaults || hasDate, 'Judge date is required')
  const date = judge.date === undefined && allowDefaults ? '' : judge.date
  assertCondition(typeof date === 'string' && date.length <= 10 && (date === '' || isValidDateOnly(date)), 'Judge date must be YYYY-MM-DD or blank')

  const hasDomain = Object.prototype.hasOwnProperty.call(judge, 'domain')
  assertCondition(allowDefaults || hasDomain, 'Judge domain is required')
  const domain = judge.domain === undefined && allowDefaults ? '' : judge.domain
  assertCondition(domain === '' || domain === DOMAIN, 'Judge domain does not match the assignment')

  const hasGeneralNotes = Object.prototype.hasOwnProperty.call(judge, 'generalNotes')
  assertCondition(allowDefaults || hasGeneralNotes, 'Judge generalNotes is required')
  const generalNotes = judge.generalNotes === undefined && allowDefaults ? '' : judge.generalNotes
  assertString(generalNotes, 'Judge generalNotes', 20000)

  const hasWarningsAcknowledged = Object.prototype.hasOwnProperty.call(judge, 'warningsAcknowledged')
  assertCondition(allowDefaults || hasWarningsAcknowledged, 'Judge warningsAcknowledged is required')
  const warningsAcknowledged = judge.warningsAcknowledged === undefined && allowDefaults ? false : judge.warningsAcknowledged
  assertCondition(typeof warningsAcknowledged === 'boolean', 'Judge warningsAcknowledged must be boolean')

  return { name, date, domain, generalNotes, warningsAcknowledged }
}

function reviewInputMap(reviews) {
  const entries = []
  if (Array.isArray(reviews)) {
    for (const review of reviews) {
      assertCondition(isPlainObject(review), 'Each review must be an object')
      entries.push([review.teamId, review])
    }
  }
  else if (isPlainObject(reviews)) {
    for (const [teamId, review] of Object.entries(reviews))
      entries.push([teamId, { ...(review || {}), teamId }])
  }
  else {
    assertCondition(reviews === undefined || reviews === null, 'Reviews must be an array or object keyed by teamId')
  }

  const map = new Map()
  for (const [teamId, review] of entries) {
    assertCondition(typeof teamId === 'string' && TEAM_BY_ID.has(teamId), 'Unknown review teamId: ' + teamId)
    assertCondition(!map.has(teamId), 'Duplicate review teamId: ' + teamId)
    map.set(teamId, normalizeReview(review, teamId, { allowDefaults: true }))
  }
  return map
}

function calculateStatus(scores, repoCheck) {
  const scored = scores.filter(score => score !== null).length
  if (scored === 0)
    return STATUS.NOT_STARTED
  if (scored !== SCORE_COUNT)
    return STATUS.INCOMPLETE
  return repoCheck === '' ? STATUS.MISSING_REPO_CHECK : STATUS.COMPLETE
}

export function calculateReviews(reviews) {
  const input = reviewInputMap(reviews)
  const rows = TEAMS.map(team => {
    const review = input.get(team.id) || emptyReview(team.id)
    const contribution = review.scores.map((score, index) => score === null ? null : cleanNumber(score * CRITERIA[index].weight))
    const complete = review.scores.every(score => score !== null) && review.repoCheck !== ''
    const total = complete ? cleanNumber(contribution.reduce((sum, value) => sum + value, 0)) : null
    return {
      ...team,
      ...review,
      contribution,
      contributions: contribution,
      weighted: contribution,
      total,
      rank: null,
      status: calculateStatus(review.scores, review.repoCheck),
    }
  })

  const totals = rows.map(row => row.total).filter(total => total !== null)
  for (const row of rows) {
    if (row.total !== null)
      row.rank = 1 + totals.filter(total => total > row.total).length
  }
  return rows
}

function pushWarning(warningDetails, code, message, teamId) {
  warningDetails.push(teamId ? { code, message, teamId } : { code, message })
}

function intakeMap(intakes) {
  if (intakes === undefined || intakes === null)
    return new Map()
  const map = new Map()
  const entries = Array.isArray(intakes)
    ? intakes.map(intake => [intake && intake.teamId, intake])
    : isPlainObject(intakes) ? Object.entries(intakes).map(([teamId, intake]) => [teamId, { ...(intake || {}), teamId }]) : null
  assertCondition(entries, 'Intakes must be an array or object keyed by teamId')
  for (const [teamId, intake] of entries) {
    assertCondition(typeof teamId === 'string' && TEAM_BY_ID.has(teamId), 'Unknown intake teamId: ' + teamId)
    assertCondition(!map.has(teamId), 'Duplicate intake teamId: ' + teamId)
    map.set(teamId, intake)
  }
  return map
}

export function readiness(judge, reviews, intakes) {
  const normalizedJudge = validateJudge(judge, { allowDefaults: true })
  const rows = calculateReviews(reviews)
  const warningDetails = []

  const judgeDetailsComplete = normalizedJudge.name.trim() !== ''
    && isValidDateOnly(normalizedJudge.date)
    && normalizedJudge.domain === DOMAIN
  if (normalizedJudge.name.trim() === '')
    pushWarning(warningDetails, 'judge_name_missing', 'Judge name is required.')
  if (!isValidDateOnly(normalizedJudge.date))
    pushWarning(warningDetails, 'judge_date_missing_or_invalid', 'Date of judging must use YYYY-MM-DD.')
  if (normalizedJudge.domain !== DOMAIN)
    pushWarning(warningDetails, 'judge_domain_missing_or_invalid', 'Judge domain must match Domain 1 – Aiversecity Future-Ready Workforce.')

  const negativeRows = []
  const reviewedRows = []
  for (const row of rows) {
    if (row.status !== STATUS.COMPLETE) {
      pushWarning(warningDetails, 'review_incomplete', row.name + ' is ' + row.status.toLowerCase() + '.', row.id)
    }
    else if (!row.reviewedAt) {
      pushWarning(warningDetails, 'reviewed_at_missing', row.name + ' has scores but no reviewedAt timestamp.', row.id)
    }
    else {
      reviewedRows.push(row)
    }
    if (NEGATIVE_REPO_CHECK_SET.has(row.repoCheck)) {
      negativeRows.push(row)
      pushWarning(warningDetails, 'negative_repo_check', row.name + ' is marked "' + row.repoCheck + '".', row.id)
      if (!row.warningsAcknowledged)
        pushWarning(warningDetails, 'review_warning_not_acknowledged', row.name + ' requires acknowledgement for the negative repository check.', row.id)
    }
  }

  if (negativeRows.length > 0 && !normalizedJudge.warningsAcknowledged)
    pushWarning(warningDetails, 'judge_warning_not_acknowledged', 'Judge-level acknowledgement is required for negative repository selections.')

  const providedIntakes = intakeMap(intakes)
  if (intakes !== undefined && intakes !== null) {
    for (const team of TEAMS) {
      if (!providedIntakes.has(team.id))
        pushWarning(warningDetails, 'intake_missing', team.name + ' has no intake record.', team.id)
    }
  }

  const nineReviewed = reviewedRows.length === TEAMS.length
  if (!nineReviewed)
    pushWarning(warningDetails, 'nine_reviews_required', 'All nine teams must have complete reviews with reviewedAt timestamps.')

  const negativeSelectionWarningsAcknowledged = negativeRows.every(row => row.warningsAcknowledged)
    && (negativeRows.length === 0 || normalizedJudge.warningsAcknowledged)
  const ready = nineReviewed && judgeDetailsComplete && negativeSelectionWarningsAcknowledged
  const warningMessages = warningDetails.map(warning => warning.message)

  return {
    ready,
    canSubmit: ready,
    reviewedCount: reviewedRows.length,
    totalTeams: TEAMS.length,
    nineReviewed,
    judgeDetailsComplete,
    negativeRepoSelections: negativeRows.map(row => row.id),
    negativeSelectionWarningsAcknowledged,
    warningsAcknowledged: normalizedJudge.warningsAcknowledged,
    missingTeamIds: rows.filter(row => !reviewedRows.includes(row)).map(row => row.id),
    warnings: warningMessages,
    warningDetails,
    rows,
  }
}

function boundedJsonValue(value, path, state, limits, depth = 0) {
  assertCondition(depth <= 8, path + ' is too deeply nested')
  state.nodes += 1
  assertCondition(state.nodes <= limits.maxNodes, 'Record contains too many values')
  if (value === null || typeof value === 'boolean')
    return
  if (typeof value === 'number') {
    assertCondition(Number.isFinite(value) && Math.abs(value) <= 1e12, path + ' must be finite and bounded')
    return
  }
  if (typeof value === 'string') {
    assertCondition(value.length <= limits.maxStringLength, path + ' exceeds ' + limits.maxStringLength + ' characters')
    return
  }
  if (Array.isArray(value)) {
    assertCondition(value.length <= limits.maxArrayLength, path + ' contains too many entries')
    value.forEach((entry, index) => boundedJsonValue(entry, path + '[' + index + ']', state, limits, depth + 1))
    return
  }
  assertCondition(isPlainObject(value), path + ' must contain JSON-compatible values')
  const keys = Object.keys(value)
  assertCondition(keys.length <= 200, path + ' contains too many keys')
  for (const key of keys) {
    assertCondition(key.length <= 128, path + ' contains an oversized key')
    boundedJsonValue(value[key], path + '.' + key, state, limits, depth + 1)
  }
}

function validateFreeformRecord(data, keyTeamId, kind) {
  assertCondition(isPlainObject(data), 'Record data must be an object')
  const limits = kind === 'evidence'
    ? { maxStringLength: 262144, maxArrayLength: 200, maxNodes: 6000 }
    : kind === 'intake'
      ? { maxStringLength: 10000, maxArrayLength: 1000, maxNodes: 12000 }
      : { maxStringLength: 10000, maxArrayLength: 200, maxNodes: 2000 }
  boundedJsonValue(data, 'data', { nodes: 0 }, limits)
  if (keyTeamId !== null && data.teamId !== undefined)
    assertCondition(data.teamId === keyTeamId, 'Record teamId does not match its key')
}

function parseRecordInternal(key, data) {
  assertCondition(typeof key === 'string' && key.length <= 128, 'Record key is invalid')
  if (key === 'judge') {
    return validateJudge(data, { allowDefaults: false })
  }
  const reviewMatch = /^review:(.+)$/.exec(key)
  if (reviewMatch) {
    assertCondition(TEAM_BY_ID.has(reviewMatch[1]), 'Record key contains an unknown review teamId')
    return normalizeReview(data, reviewMatch[1], { allowDefaults: false })
  }
  const intakeMatch = /^intake:(.+)$/.exec(key)
  if (intakeMatch) {
    assertCondition(TEAM_BY_ID.has(intakeMatch[1]), 'Record key contains an unknown intake teamId')
    validateFreeformRecord(data, intakeMatch[1], 'intake')
    return data
  }
  const evidenceMatch = /^evidence:(.+)$/.exec(key)
  if (evidenceMatch) {
    assertCondition(UUID_PATTERN.test(evidenceMatch[1]), 'Evidence record key must contain a UUID')
    validateFreeformRecord(data, data && typeof data.teamId === 'string' ? data.teamId : null, 'evidence')
    if (data && data.teamId !== undefined)
      assertCondition(TEAM_BY_ID.has(data.teamId), 'Evidence record teamId is unknown')
    return data
  }
  const assessmentMatch = /^assessment:(.+)$/.exec(key)
  if (assessmentMatch) {
    assertCondition(UUID_PATTERN.test(assessmentMatch[1]), 'Assessment record key must contain a UUID')
    validateFreeformRecord(data, data && typeof data.teamId === 'string' ? data.teamId : null, 'assessment')
    if (data && data.teamId !== undefined)
      assertCondition(TEAM_BY_ID.has(data.teamId), 'Assessment record teamId is unknown')
    return data
  }
  throw new TypeError('Record key is not allowed')
}

export function validateRecordDetailed(key, data) {
  try {
    return { success: true, valid: true, data: parseRecordInternal(key, data), issues: [] }
  }
  catch (error) {
    return {
      success: false,
      valid: false,
      data: undefined,
      issues: [error instanceof Error ? error.message : String(error)],
    }
  }
}

/**
 * Boolean predicate for route/storage callers. Use assertRecord when the
 * caller needs the first validation error.
 */
export function validateRecord(key, data) {
  return validateRecordDetailed(key, data).success
}

export function assertRecord(key, data) {
  const result = validateRecordDetailed(key, data)
  if (!result.success)
    throw new TypeError(result.issues[0])
  return result.data
}

export function createRecord(key, data, options = {}) {
  const version = options.version === undefined ? 1 : options.version
  const updatedAt = options.updatedAt === undefined ? new Date().toISOString() : options.updatedAt
  assertCondition(Number.isSafeInteger(version) && version >= 1, 'Record version must be a positive safe integer')
  assertCondition(typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt)), 'Record updatedAt must be an ISO date string')
  const validated = assertRecord(key, data)
  return { key, version, data: validated, updatedAt }
}

export function isNegativeRepoCheck(value) {
  return NEGATIVE_REPO_CHECK_SET.has(value)
}

export function isTeamId(value) {
  return typeof value === 'string' && TEAM_BY_ID.has(value)
}

export function cloneAssignment() {
  return cloneJson(ASSIGNMENT)
}
