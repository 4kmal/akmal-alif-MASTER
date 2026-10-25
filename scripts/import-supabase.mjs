#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TABLE_ORDER = [
  'blog_categories',
  'blog_tags',
  'blog_admins',
  'blog_posts',
  'blog_post_tags',
  'profile_page_events',
  'profile_metrics',
];

const BOOLEAN_COLUMNS = new Set(['is_active', 'featured', 'id']);
const TIMESTAMP_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'published_at',
]);
const TABLE_FILE_SUFFIX = '_rows.sql';
const CLOUDFRONT_URL = /https?:\/\/[A-Za-z0-9.-]+\.cloudfront\.net(?:\/[^\s"'<>),;]*)?/gi;

function isIdentifierCharacter(character) {
  return character != null && /[A-Za-z0-9_$]/.test(character);
}

function startsKeyword(source, index, keyword) {
  if (source.slice(index, index + keyword.length).toUpperCase() !== keyword) {
    return false;
  }

  const before = source[index - 1];
  const after = source[index + keyword.length];
  return !isIdentifierCharacter(before) && !isIdentifierCharacter(after);
}

function skipQuotedString(source, start) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] !== "'") {
      index += 1;
      continue;
    }

    if (source[index + 1] === "'") {
      index += 2;
      continue;
    }

    return index + 1;
  }

  throw new Error('Unterminated SQL string literal');
}

function skipSqlComment(source, start) {
  if (source.startsWith('--', start)) {
    const newline = source.indexOf('\n', start + 2);
    return newline === -1 ? source.length : newline + 1;
  }

  if (source.startsWith('/*', start)) {
    const end = source.indexOf('*/', start + 2);
    if (end === -1) {
      throw new Error('Unterminated SQL block comment');
    }
    return end + 2;
  }

  return start;
}

function skipWhitespaceAndComments(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }

    const next = skipSqlComment(source, index);
    if (next !== index) {
      index = next;
      continue;
    }

    break;
  }
  return index;
}

function scanBalancedParentheses(source, start) {
  if (source[start] !== '(') {
    throw new Error('Expected an opening parenthesis');
  }

  let depth = 1;
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "'") {
      index = skipQuotedString(source, index);
      continue;
    }

    const commentEnd = skipSqlComment(source, index);
    if (commentEnd !== index) {
      index = commentEnd;
      continue;
    }

    if (source[index] === '(') {
      depth += 1;
    } else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }

  throw new Error('Unterminated SQL parenthesized expression');
}

function splitCommaList(source) {
  const values = [];
  let start = 0;
  let depth = 0;
  let index = 0;

  while (index < source.length) {
    if (source[index] === "'") {
      index = skipQuotedString(source, index);
      continue;
    }

    const commentEnd = skipSqlComment(source, index);
    if (commentEnd !== index) {
      index = commentEnd;
      continue;
    }

    if (source[index] === '(') {
      depth += 1;
    } else if (source[index] === ')') {
      depth -= 1;
    } else if (source[index] === ',' && depth === 0) {
      values.push(source.slice(start, index).trim());
      start = index + 1;
    }
    index += 1;
  }

  values.push(source.slice(start).trim());
  return values;
}

function unquoteIdentifier(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

function parseIdentifierList(source) {
  return splitCommaList(source).map(unquoteIdentifier);
}

function decodeEscapeString(source, start) {
  const quote = source[start] === 'E' || source[start] === 'e' ? start + 1 : start;
  if (source[quote] !== "'") {
    throw new Error('Expected a quoted SQL string');
  }

  const escapeMode = quote !== start;
  let value = '';
  let index = quote + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "'") {
      if (source[index + 1] === "'") {
        value += "'";
        index += 2;
        continue;
      }
      return { value, end: index + 1 };
    }

    if (escapeMode && character === '\\' && index + 1 < source.length) {
      const escaped = source[index + 1];
      const escapes = {
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
        v: '\v',
        '\\': '\\',
        "'": "'",
      };
      value += escapes[escaped] ?? escaped;
      index += 2;
      continue;
    }

    value += character;
    index += 1;
  }

  throw new Error('Unterminated SQL string literal');
}

export function parseSqlLiteral(raw) {
  const token = raw.trim();
  if (token === '') {
    throw new Error('Empty SQL value');
  }

  const quoted = token[0] === "'" || (token.length > 1 && (token[0] === 'E' || token[0] === 'e') && token[1] === "'");
  if (quoted) {
    const parsed = decodeEscapeString(token, 0);
    const trailing = token.slice(parsed.end).trim();
    if (trailing && !/^::[A-Za-z0-9_."\[\]]+$/.test(trailing)) {
      throw new Error(`Unsupported SQL string suffix: ${trailing}`);
    }
    return parsed.value;
  }

  if (/^null$/i.test(token)) {
    return null;
  }
  if (/^(true|t)$/i.test(token)) {
    return true;
  }
  if (/^(false|f)$/i.test(token)) {
    return false;
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
    const numeric = Number(token);
    return Number.isSafeInteger(numeric) || Number.isFinite(numeric) ? numeric : token;
  }

  return token;
}

function parseTuple(source) {
  return splitCommaList(source).map(parseSqlLiteral);
}

function parseTableName(source, index) {
  const match = source.slice(index).match(/^INSERT\s+INTO\s+(?:(?:"((?:[^"]|"")+)"|([A-Za-z_][\w$]*))\s*\.\s*)?(?:"((?:[^"]|"")+)"|([A-Za-z_][\w$]*))/i);
  if (!match) {
    return null;
  }

  return {
    table: unquoteIdentifier(match[3] ?? match[4]),
    end: index + match[0].length,
  };
}

function parseInsertAt(source, start) {
  const table = parseTableName(source, start);
  if (!table) {
    return null;
  }

  let index = skipWhitespaceAndComments(source, table.end);
  if (source[index] !== '(') {
    throw new Error(`INSERT INTO ${table.table} is missing its column list`);
  }
  const columnsEnd = scanBalancedParentheses(source, index);
  const columns = parseIdentifierList(source.slice(index + 1, columnsEnd));
  index = skipWhitespaceAndComments(source, columnsEnd + 1);

  const valuesKeyword = source.slice(index).match(/^VALUES\b/i);
  if (!valuesKeyword) {
    throw new Error(`INSERT INTO ${table.table} is missing VALUES`);
  }
  index += valuesKeyword[0].length;

  const rows = [];
  while (index < source.length) {
    index = skipWhitespaceAndComments(source, index);
    if (source[index] !== '(') {
      break;
    }

    const rowEnd = scanBalancedParentheses(source, index);
    const values = parseTuple(source.slice(index + 1, rowEnd));
    if (values.length !== columns.length) {
      throw new Error(`INSERT INTO ${table.table} has ${columns.length} columns but ${values.length} values`);
    }
    rows.push(values);
    index = skipWhitespaceAndComments(source, rowEnd + 1);

    if (source[index] === ',') {
      index += 1;
      continue;
    }
    if (source[index] === ';') {
      index += 1;
    }
    break;
  }

  if (rows.length === 0) {
    throw new Error(`INSERT INTO ${table.table} has no value tuples`);
  }

  return { table: table.table, columns, rows, end: index };
}

function nextInsertIndex(source, start) {
  let index = start;
  while (index < source.length) {
    if (source[index] === "'") {
      index = skipQuotedString(source, index);
      continue;
    }

    const commentEnd = skipSqlComment(source, index);
    if (commentEnd !== index) {
      index = commentEnd;
      continue;
    }

    if (startsKeyword(source, index, 'INSERT INTO')) {
      return index;
    }
    index += 1;
  }
  return -1;
}

export function parseSqlInserts(source, tableHint = null) {
  const statements = [];
  let index = 0;
  while (true) {
    const insertIndex = nextInsertIndex(source, index);
    if (insertIndex === -1) {
      break;
    }

    const statement = parseInsertAt(source, insertIndex);
    if (tableHint && statement.table.toLowerCase() !== tableHint.toLowerCase()) {
      throw new Error(`Expected ${tableHint} export but found ${statement.table}`);
    }
    statements.push(statement);
    index = statement.end;
  }
  return statements;
}

export function normalizeTimestamptz(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/i);
  if (!match) {
    return value;
  }

  const [, date, clock, fraction = '', timezone] = match;
  const millisecondFraction = (fraction || '0').padEnd(3, '0').slice(0, 3);
  let zone = timezone.toUpperCase();
  if (zone !== 'Z') {
    zone = zone.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    if (/^[+-]\d{2}$/.test(zone)) {
      zone += ':00';
    }
  }
  const parsed = new Date(`${date}T${clock}.${millisecondFraction}${zone}`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const outputFraction = fraction
    ? fraction.padEnd(6, '0').slice(0, 6)
    : '000';
  return `${parsed.toISOString().slice(0, 19)}.${outputFraction}Z`;
}

export function rewriteCloudFrontUrls(value) {
  if (typeof value !== 'string') {
    return { value, replacements: 0 };
  }

  let replacements = 0;
  const rewritten = value.replace(CLOUDFRONT_URL, (match) => {
    let url;
    try {
      url = new URL(match);
    } catch {
      return match;
    }
    replacements += 1;
    const pathPart = url.pathname.replace(/^\/+/, '');
    return `/media/${pathPart}${url.search}${url.hash}`;
  });
  return { value: rewritten, replacements };
}

function normalizeValue(value, column) {
  let normalized = value;
  let replacements = 0;

  if (typeof normalized === 'string') {
    const rewritten = rewriteCloudFrontUrls(normalized);
    normalized = rewritten.value;
    replacements += rewritten.replacements;
    if (TIMESTAMP_COLUMNS.has(column)) {
      normalized = normalizeTimestamptz(normalized);
    }
  }

  if (BOOLEAN_COLUMNS.has(column) && typeof normalized === 'boolean') {
    normalized = normalized ? 1 : 0;
  }

  return { value: normalized, replacements };
}

function quotedSqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlString(value, singleLine) {
  if (!singleLine || !/[\r\n]/.test(value)) {
    return quotedSqlString(value);
  }

  const pieces = [];
  let text = '';
  const flushText = () => {
    if (text !== '') {
      pieces.push(quotedSqlString(text));
      text = '';
    }
  };

  for (const character of value) {
    if (character === '\r' || character === '\n') {
      flushText();
      pieces.push(`char(${character === '\r' ? 13 : 10})`);
    } else {
      text += character;
    }
  }
  flushText();
  return pieces.length > 0 ? pieces.join(' || ') : "''";
}

function sqlValue(value, singleLine) {
  if (value == null) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return sqlString(String(value), singleLine);
}

function canonicalTableName(table) {
  const normalized = table.toLowerCase();
  if (!TABLE_ORDER.includes(normalized)) {
    throw new Error(`Unsupported exported table: ${table}`);
  }
  return normalized;
}

export function buildImportSql(tableStatements, { singleLine = false } = {}) {
  const comment = (text) => (singleLine ? `/* ${text} */` : `-- ${text}`);
  const lines = [
    comment('Generated by scripts/import-supabase.mjs. Source data is private.'),
    'BEGIN;',
  ];
  const counts = {};
  let replacements = 0;

  for (const table of TABLE_ORDER) {
    const statements = tableStatements.get(table) ?? [];
    const rows = statements.flatMap((statement) => statement.rows.map((values) => ({ columns: statement.columns, values })));
    counts[table] = rows.length;
    lines.push(comment(`${table}: ${rows.length} row${rows.length === 1 ? '' : 's'}`));

    if (rows.length === 0) {
      lines.push(comment(`${table}: no rows in export`));
      continue;
    }

    for (const row of rows) {
      const normalizedValues = [];
      for (let index = 0; index < row.columns.length; index += 1) {
        const normalized = normalizeValue(row.values[index], row.columns[index]);
        normalizedValues.push(normalized.value);
        replacements += normalized.replacements;
      }

      const keyword = table === 'profile_metrics' ? 'INSERT OR REPLACE' : 'INSERT';
      lines.push(`${keyword} INTO ${table} (${row.columns.join(', ')}) VALUES (${normalizedValues.map((value) => sqlValue(value, singleLine)).join(', ')});`);
    }
  }

  lines.push('COMMIT;');
  return { sql: lines.join(singleLine ? ' ' : '\n') + (singleLine ? '' : '\n'), counts, replacements };
}

async function sha256File(filePath) {
  const contents = await readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

async function readExportTables(inputDir) {
  const files = new Map();
  const tableStatements = new Map();
  const missing = [];

  await readdir(inputDir, { withFileTypes: true });
  for (const table of TABLE_ORDER) {
    const filename = `${table}${TABLE_FILE_SUFFIX}`;
    const filePath = path.join(inputDir, filename);
    let source;
    try {
      source = await readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        missing.push(filename);
        tableStatements.set(table, []);
        continue;
      }
      throw error;
    }

    files.set(filename, { bytes: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex') });
    tableStatements.set(table, parseSqlInserts(source, table));
  }

  return { files, tableStatements, missing };
}

export async function convertDirectory(inputDir, outputPath, { singleLine = false } = {}) {
  const { files, tableStatements, missing } = await readExportTables(inputDir);
  const conversion = buildImportSql(tableStatements, { singleLine });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, conversion.sql, 'utf8');

  const outputBytes = Buffer.byteLength(conversion.sql);
  const outputSha256 = await sha256File(outputPath);
  const manifest = {
    format: 1,
    generated_at: new Date().toISOString(),
    source_files: Object.fromEntries(files),
    missing_files: missing,
    single_line: singleLine,
    counts: conversion.counts,
    cloudfront_replacements: conversion.replacements,
    output: {
      file: path.basename(outputPath),
      bytes: outputBytes,
      sha256: outputSha256,
    },
  };
  const manifestPath = `${outputPath}.manifest.json`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { ...conversion, outputPath, manifestPath, manifest };
}

function parseCliArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--single-line') {
      values.singleLine = true;
      continue;
    }
    if (argument === '--input' || argument === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path`);
      }
      values[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      return { help: true };
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!values.input || !values.output) {
    throw new Error('Usage: node scripts/import-supabase.mjs --input <dir> --output <private.sql> [--single-line]');
  }
  return values;
}

export async function runCli(args) {
  const options = parseCliArgs(args);
  if (options.help) {
    console.log('Usage: node scripts/import-supabase.mjs --input <dir> --output <private.sql> [--single-line]');
    return null;
  }

  const result = await convertDirectory(path.resolve(options.input), path.resolve(options.output), {
    singleLine: Boolean(options.singleLine),
  });
  console.log(JSON.stringify({
    output: result.outputPath,
    manifest: result.manifestPath,
    counts: result.counts,
    cloudfront_replacements: result.replacements,
  }));
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
