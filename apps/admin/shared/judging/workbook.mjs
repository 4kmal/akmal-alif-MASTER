import JSZip from 'jszip'

import {
  CRITERIA,
  DOMAIN,
  JUDGE_NAME,
  STATUS,
  TEAMS,
  calculateReviews,
  cloneAssignment,
  readiness,
  validateJudge,
} from './model.mjs'

const SHEET_PATH = 'xl/worksheets/sheet1.xml'
const SHARED_STRINGS_PATH = 'xl/sharedStrings.xml'
const SHEET_RELS_PATH = 'xl/worksheets/_rels/sheet1.xml.rels'

/**
 * These are the organizer-template formula strings that must survive an
 * export. Formula caches are updated by this module, while the formula
 * elements themselves remain byte-for-byte unchanged.
 */
export const WORKBOOK_FORMULA_ORACLE = Object.freeze({
  G9: Object.freeze({ formula: '=SUM(G5:G8)' }),
  I13: Object.freeze({ formula: '=IF(E13="","",E13*$G$5)', type: 'shared', ref: 'I13:I25', si: '1' }),
  J13: Object.freeze({ formula: '=IF(F13="","",F13*$G$6)', type: 'shared', ref: 'J13:J25', si: '2' }),
  K13: Object.freeze({ formula: '=IF(G13="","",G13*$G$7)', type: 'shared', ref: 'K13:K25', si: '3' }),
  L13: Object.freeze({ formula: '=IF(H13="","",H13*$G$8)', type: 'shared', ref: 'L13:L25', si: '4' }),
  M13: Object.freeze({ formula: '=IF(COUNT(E13:H13)=4,SUM(I13:L13),"")', type: 'shared', ref: 'M13:M25', si: '5' }),
  N13: Object.freeze({ formula: '=IF(M13="","",RANK(M13,$M$13:$M$25,0))', type: 'shared', ref: 'N13:N25', si: '6' }),
  O13: Object.freeze({ formula: '=IF(B13="","—",IF(COUNT(E13:H13)=4,IF(D13="","Missing repo check","Complete"),IF(COUNT(E13:H13)=0,"Not started","Incomplete")))', type: 'shared', ref: 'O13:O25', si: '7' }),
  C28: Object.freeze({ formula: '=COUNTIF(O13:O25,"Complete")&" / "&COUNTA(B13:B25)' }),
  C29: Object.freeze({ formula: '=IFERROR(AVERAGE(M13:M25),"")' }),
  C30: Object.freeze({ formula: '=IF(COUNT(M13:M25)=0,"",MAX(M13:M25))' }),
  C31: Object.freeze({ formula: '=IF(COUNT(M13:M25)=0,"",MIN(M13:M25))' }),
  C32: Object.freeze({ formula: '=IF(COUNT(M13:M25)=0,"",INDEX(B13:B25,MATCH(MAX(M13:M25),M13:M25,0)))', type: 'array', ref: 'C32' }),
  C33: Object.freeze({ formula: '=IF(AND(COUNTA(B13:B25)>0,COUNTIF(O13:O25,"Complete")=COUNTA(B13:B25),B4<>"",B5<>"",B6<>""),"YES — upload via the Google Form","NOT YET — check Status column and judge details")' }),
})

export const WORKBOOK_WRITE_ALLOWLIST = Object.freeze([
  'Scoresheet!B4:B6',
  'Scoresheet!D13:D21',
  'Scoresheet!E13:H21',
  'Scoresheet!P13:P21',
  'Scoresheet!A37',
  'Scoresheet!formula-caches',
])

const CELL_START_RE = /<c\b[^>]*>/g

function assertCondition(condition, message) {
  if (!condition)
    throw new TypeError(message)
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array)
    return bytes
  if (bytes instanceof ArrayBuffer)
    return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes))
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  throw new TypeError('Workbook bytes must be a Uint8Array or ArrayBuffer')
}

function xmlAttribute(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*(["\\\'])([\\s\\S]*?)\\1').exec(xml)
  return match ? decodeXmlEntities(match[2]) : undefined
}

function cellReference(cellXml) {
  return xmlAttribute(cellXml, 'r')
}

function decodeXmlEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return '\''
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10)
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _
  })
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function cellEntries(sheetXml) {
  const entries = []
  for (const match of sheetXml.matchAll(CELL_START_RE)) {
    const start = match.index
    const openTag = match[0]
    const openEnd = start + openTag.length
    const selfClosing = /\/\s*>$/.test(openTag)
    const closeIndex = selfClosing ? openEnd : sheetXml.indexOf('</c>', openEnd)
    assertCondition(selfClosing || closeIndex >= openEnd, 'Invalid worksheet cell XML')
    const end = selfClosing ? openEnd : closeIndex + 4
    entries.push({ start, end, xml: sheetXml.slice(start, end) })
  }
  return entries
}

function cellXmlFromSheet(sheetXml, reference) {
  return cellEntries(sheetXml).find(entry => cellReference(entry.xml) === reference)?.xml
}

function replaceCellXml(sheetXml, reference, replacer) {
  const entry = cellEntries(sheetXml).find(candidate => cellReference(candidate.xml) === reference)
  assertCondition(entry, 'Workbook cell ' + reference + ' was not found')
  return sheetXml.slice(0, entry.start) + replacer(entry.xml) + sheetXml.slice(entry.end)
}

function cellOpenTag(cellXml) {
  const match = /^<c\b([^>]*?)(\/?>)/.exec(cellXml)
  assertCondition(match, 'Invalid workbook cell XML')
  return { attributes: match[1], end: match[2], length: match[0].length }
}

function removeTypeAttribute(attributes) {
  return attributes.replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
}

function withTypeAttribute(attributes, type) {
  const withoutType = removeTypeAttribute(attributes)
  return type ? withoutType + ' t="' + type + '"' : withoutType
}

function literalCell(cellXml, value) {
  const open = cellOpenTag(cellXml)
  const attributes = removeTypeAttribute(open.attributes)
  if (value === '' || value === null || value === undefined)
    return '<c' + attributes + '/>'
  return '<c' + attributes + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(value) + '</t></is></c>'
}

function numericCell(cellXml, value) {
  const open = cellOpenTag(cellXml)
  const attributes = removeTypeAttribute(open.attributes)
  if (value === '' || value === null || value === undefined)
    return '<c' + attributes + '/>'
  return '<c' + attributes + '><v>' + escapeXml(serializeNumber(value)) + '</v></c>'
}

function serializeNumber(value) {
  if (typeof value === 'number') {
    assertCondition(Number.isFinite(value), 'Formula cache number must be finite')
    return Number(value.toPrecision(15)).toString()
  }
  return String(value)
}

function formulaCellCache(cellXml, value) {
  const open = cellOpenTag(cellXml)
  const isNumber = typeof value === 'number' && Number.isFinite(value)
  const attributes = withTypeAttribute(open.attributes, isNumber ? null : 'str')
  const bodyStart = open.length
  const body = cellXml.slice(bodyStart).replace(/<\/c>\s*$/, '')
  const escapedValue = isNumber ? serializeNumber(value) : escapeXml(value === null || value === undefined ? '' : value)
  const cache = '<v>' + escapedValue + '</v>'
  const replacedBody = /<v(?:\s[^>]*)?>[\s\S]*?<\/v>/.test(body)
    ? body.replace(/<v(?:\s[^>]*)?>[\s\S]*?<\/v>/, cache)
    : body + cache
  return '<c' + attributes + '>' + replacedBody + '</c>'
}

function textFromCell(cellXml, sharedStrings) {
  const type = xmlAttribute(cellXml, 't')
  if (type === 's') {
    const value = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)
    if (!value)
      return ''
    const index = Number.parseInt(decodeXmlEntities(value[1]), 10)
    return Number.isInteger(index) && sharedStrings[index] !== undefined ? sharedStrings[index] : ''
  }
  if (type === 'inlineStr') {
    return textFromRichText(cellXml)
  }
  if (type === 'str') {
    const value = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)
    return value ? decodeXmlEntities(value[1]) : ''
  }
  const value = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)
  return value ? decodeXmlEntities(value[1]) : ''
}

function textFromRichText(xml) {
  let result = ''
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
    result += decodeXmlEntities(match[1])
  return result
}

function sharedStringValues(xml) {
  const result = []
  for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g))
    result.push(textFromRichText(match[0]))
  return result
}

function formulaFromCell(cellXml) {
  const match = cellXml.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)
  return match ? decodeXmlEntities(match[1]) : undefined
}

function relationTargets(xml) {
  const result = new Map()
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g)) {
    const tag = match[0]
    const id = xmlAttribute(tag, 'Id')
    const target = xmlAttribute(tag, 'Target')
    if (id && target)
      result.set(id, target)
  }
  return result
}

function sheetHyperlinks(sheetXml, relsXml) {
  const rels = relationTargets(relsXml)
  const links = new Map()
  const hyperlinks = sheetXml.match(/<hyperlinks\b[\s\S]*?<\/hyperlinks>/)?.[0] || ''
  for (const match of hyperlinks.matchAll(/<hyperlink\b[^>]*\/?>(?:<\/hyperlink>)?/g)) {
    const ref = xmlAttribute(match[0], 'ref')
    const relationId = xmlAttribute(match[0], 'r:id')
    const target = relationId ? rels.get(relationId) : undefined
    if (ref && target)
      links.set(ref, target)
  }
  return links
}

function cellValueMap(sheetXml, sharedStrings) {
  const values = new Map()
  for (const entry of cellEntries(sheetXml))
    values.set(cellReference(entry.xml), textFromCell(entry.xml, sharedStrings))
  return values
}

function validateFormulaOracle(sheetXml) {
  for (const [reference, expected] of Object.entries(WORKBOOK_FORMULA_ORACLE)) {
    const cellXml = cellXmlFromSheet(sheetXml, reference)
    assertCondition(cellXml, 'Workbook formula cell ' + reference + ' was not found')
    const formula = formulaFromCell(cellXml)
    assertCondition('=' + formula === expected.formula, 'Workbook formula drift at ' + reference)
    if (expected.type)
      assertCondition(xmlAttribute(cellXml.match(/<f\b[^>]*>/)?.[0] || '', 't') === expected.type, 'Workbook formula type drift at ' + reference)
    if (expected.ref)
      assertCondition(xmlAttribute(cellXml.match(/<f\b[^>]*>/)?.[0] || '', 'ref') === expected.ref, 'Workbook formula ref drift at ' + reference)
    if (expected.si)
      assertCondition(xmlAttribute(cellXml.match(/<f\b[^>]*>/)?.[0] || '', 'si') === expected.si, 'Workbook shared formula index drift at ' + reference)
  }
}

async function loadTemplate(bytes) {
  const zip = await JSZip.loadAsync(toUint8Array(bytes))
  const sheetFile = zip.file(SHEET_PATH)
  assertCondition(sheetFile, 'Workbook is missing ' + SHEET_PATH)
  const sheetXml = await sheetFile.async('string')
  const sharedStringsXml = zip.file(SHARED_STRINGS_PATH)
    ? await zip.file(SHARED_STRINGS_PATH).async('string')
    : '<sst></sst>'
  const relsXml = zip.file(SHEET_RELS_PATH)
    ? await zip.file(SHEET_RELS_PATH).async('string')
    : '<Relationships></Relationships>'
  return {
    zip,
    entryNames: new Set(Object.keys(zip.files)),
    sheetXml,
    sharedStrings: sharedStringValues(sharedStringsXml),
    relsXml,
  }
}

function validateCanonicalTemplate(sheetXml, sharedStrings, relsXml) {
  validateFormulaOracle(sheetXml)
  const values = cellValueMap(sheetXml, sharedStrings)
  assertCondition(values.get('B4') === JUDGE_NAME, 'Workbook judge name does not match D1-J04')
  assertCondition(values.get('B6') === DOMAIN, 'Workbook domain does not match Domain 1')
  for (const team of TEAMS) {
    assertCondition(values.get('B' + team.row) === team.name, 'Workbook team name drift at row ' + team.row)
    const links = sheetHyperlinks(sheetXml, relsXml)
    assertCondition(links.get('C' + team.row) === team.repoUrl, 'Workbook repository hyperlink drift at row ' + team.row)
  }
  for (let row = 22; row <= 25; row++)
    assertCondition((values.get('B' + row) || '') === '', 'Workbook has an unexpected extra team at row ' + row)
  return values
}

function reviewByTeamId(reviews) {
  const rows = calculateReviews(reviews)
  return new Map(rows.map(row => [row.id, row]))
}

function formulaCacheValue(row, column, rowsById) {
  if (row >= 13 && row <= 21) {
    const team = TEAMS[row - 13]
    const review = rowsById.get(team.id)
    if (column === 'I') return review.contribution[0]
    if (column === 'J') return review.contribution[1]
    if (column === 'K') return review.contribution[2]
    if (column === 'L') return review.contribution[3]
    if (column === 'M') return review.total
    if (column === 'N') return review.rank
    if (column === 'O') return review.status === STATUS.EMPTY ? '—' : review.status
  }
  return column === 'O' ? '—' : null
}

function patchLiteral(sheetXml, reference, value, numeric = false) {
  return replaceCellXml(sheetXml, reference, cellXml => numeric ? numericCell(cellXml, value) : literalCell(cellXml, value))
}

function patchFormulaCache(sheetXml, reference, value) {
  return replaceCellXml(sheetXml, reference, cellXml => formulaCellCache(cellXml, value))
}

function summaryCacheValues(rowsById, judge) {
  const rows = [...rowsById.values()]
  const complete = rows.filter(row => row.status === STATUS.COMPLETE)
  const totals = complete.map(row => row.total).filter(value => typeof value === 'number')
  const average = totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : ''
  const maximum = totals.length ? Math.max(...totals) : ''
  const minimum = totals.length ? Math.min(...totals) : ''
  const top = totals.length ? rows.find(row => row.total === maximum)?.name || '' : ''
  const status = complete.length === TEAMS.length && judge.name !== '' && judge.date !== '' && judge.domain !== ''
    ? 'YES — upload via the Google Form'
    : 'NOT YET — check Status column and judge details'
  return {
    C28: complete.length + ' / ' + TEAMS.length,
    C29: average,
    C30: maximum,
    C31: minimum,
    C32: top,
    C33: status,
  }
}

function ensureFinalReadiness(judge, reviews) {
  const result = readiness(judge, reviews)
  if (!result.ready)
    throw new Error('Workbook is not ready to submit: ' + result.warnings.join(' '))
  return result
}

/**
 * Read and verify the organizer-owned workbook without modifying it. The
 * returned assignment is canonical application data, so fixed team metadata
 * cannot be silently changed by a modified upload.
 */
export async function importAssignment(templateBytes) {
  const template = await loadTemplate(templateBytes)
  validateCanonicalTemplate(template.sheetXml, template.sharedStrings, template.relsXml)
  return cloneAssignment()
}

/**
 * Patch the judge-owned fields and formula caches in a copy of the workbook.
 * All other ZIP entries and all formula XML are retained by JSZip.
 */
export async function exportWorkbook(templateBytes, payload, options = {}) {
  assertCondition(payload && typeof payload === 'object', 'Workbook payload is required')
  const template = await loadTemplate(templateBytes)
  validateCanonicalTemplate(template.sheetXml, template.sharedStrings, template.relsXml)
  const judge = validateJudge(payload.judge || {}, { allowDefaults: true })
  const reviews = payload.reviews === undefined ? {} : payload.reviews
  if (options.final === true)
    ensureFinalReadiness(judge, reviews)

  const rowsById = reviewByTeamId(reviews)
  let sheetXml = template.sheetXml
  sheetXml = patchLiteral(sheetXml, 'B4', judge.name)
  sheetXml = patchLiteral(sheetXml, 'B5', judge.date)
  sheetXml = patchLiteral(sheetXml, 'B6', judge.domain)
  for (const team of TEAMS) {
    const row = rowsById.get(team.id)
    sheetXml = patchLiteral(sheetXml, 'D' + team.row, row.repoCheck)
    for (let index = 0; index < CRITERIA.length; index++)
      sheetXml = patchLiteral(sheetXml, String.fromCharCode('E'.charCodeAt(0) + index) + team.row, row.scores[index], true)
    sheetXml = patchLiteral(sheetXml, 'P' + team.row, row.notes)
  }
  sheetXml = patchLiteral(sheetXml, 'A37', judge.generalNotes)

  for (let row = 13; row <= 25; row++) {
    for (const column of ['I', 'J', 'K', 'L', 'M', 'N', 'O'])
      sheetXml = patchFormulaCache(sheetXml, column + row, formulaCacheValue(row, column, rowsById))
  }
  const summary = summaryCacheValues(rowsById, judge)
  for (const [reference, value] of Object.entries(summary))
    sheetXml = patchFormulaCache(sheetXml, reference, value)

  template.zip.file(SHEET_PATH, sheetXml)
  // JSZip may synthesize directory entries when a file path is assigned.
  // The organizer package has no directory entries, so remove only entries
  // that did not exist in the source package; real source entries survive.
  for (const name of Object.keys(template.zip.files)) {
    if (name.endsWith('/') && !template.entryNames.has(name))
      delete template.zip.files[name]
  }
  return template.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export { SHEET_PATH }
