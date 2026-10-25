import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeTimestamptz,
  parseSqlInserts,
  rewriteCloudFrontUrls,
} from './import-supabase.mjs';

const TABLES = ['blog_categories', 'blog_posts'];
const POST_FIELDS = [
  'slug',
  'title',
  'excerpt',
  'cover_image_url',
  'cover_image_alt',
  'read_minutes',
  'published_at',
  'meta_title',
  'meta_description',
  'canonical_path',
  'content_html',
  'blog_categories',
];
const CATEGORY_FIELDS = ['slug', 'name', 'color_class', 'sort_order'];
const EXPECTED_POST_COUNT = 6;
const EXPECTED_CATEGORY_COUNT = 3;
const EXPECTED_MEDIA_OBJECT_COUNT = 104;
const EXPECTED_LEGACY_MEDIA_COUNT = 3;
const CONCURRENCY = 4;
const RETRIES = 2;
const TIMEOUT_MS = 15_000;
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_RANGE_CAPTURE_BYTES = 64 * 1024;
const DEFAULT_REPORT_NAME = 'deployment-verification.json';

function usage() {
  return [
    'Usage: node scripts/verify-deployment.mjs --base <origin> --backup-dir <private-dir>',
    '       [--address <public-ipv4>] [--report <path>]',
    '       [--allow-local-write] [--allow-production-write]',
  ].join('\n');
}

function parseArgs(args) {
  const values = {
    retries: RETRIES,
    timeoutMs: TIMEOUT_MS,
    concurrency: CONCURRENCY,
    allowLocalWrite: false,
    allowProductionWrite: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      return { help: true };
    }
    if (argument === '--allow-local-write') {
      values.allowLocalWrite = true;
      continue;
    }
    if (argument === '--allow-production-write') {
      values.allowProductionWrite = true;
      continue;
    }
    if (['--base', '--backup-dir', '--address', '--report'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(argument + ' requires a value');
      }
      values[argument.slice(2).replaceAll('-', '')] = value;
      index += 1;
      continue;
    }
    throw new Error('Unknown argument: ' + argument);
  }

  if (!values.base || !values.backupdir) {
    throw new Error(usage());
  }
  const base = new URL(values.base);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('--base must be an HTTP(S) origin without credentials, query, or hash');
  }
  if (base.pathname !== '/') {
    throw new Error('--base must be an origin without a path');
  }
  if (base.protocol === 'http:' && !isLocalHost(base.hostname)) {
    throw new Error('Plain HTTP is allowed only for localhost verification');
  }
  if (values.address && isIP(values.address) !== 4) {
    throw new Error('--address must be an IPv4 address');
  }
  values.baseUrl = base;
  values.backupDir = path.resolve(values.backupdir);
  values.reportPath = path.resolve(
    values.report || path.join(values.backupDir, DEFAULT_REPORT_NAME),
  );
  return values;
}

function isLocalHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1';
}

function isWorkersDev(hostname) {
  return hostname.toLowerCase().endsWith('.workers.dev');
}

function isProductionHost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'www.akmalalif.com' || normalized === 'akmalalif.com';
}

function rowObjects(statements) {
  return statements.flatMap((statement) => statement.rows.map((values) => (
    Object.fromEntries(statement.columns.map((column, index) => [column, values[index]]))
  )));
}

async function readRows(backupDir, table) {
  const source = await readFile(path.join(backupDir, table + '_rows.sql'), 'utf8');
  return rowObjects(parseSqlInserts(source, table));
}

function normalizedExportValue(value, column) {
  if (typeof value !== 'string') {
    return value;
  }
  const rewritten = rewriteCloudFrontUrls(value).value;
  return ['created_at', 'updated_at', 'published_at'].includes(column)
    ? normalizeTimestamptz(rewritten)
    : rewritten;
}

function activeValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function mapCategory(row) {
  return {
    slug: normalizedExportValue(row.slug, 'slug'),
    name: normalizedExportValue(row.name, 'name'),
    color_class: row.color_class == null ? null : normalizedExportValue(row.color_class, 'color_class'),
    sort_order: row.sort_order,
  };
}

function mapPost(row, categoryById) {
  const category = row.category_id == null ? null : categoryById.get(row.category_id) ?? null;
  return {
    slug: normalizedExportValue(row.slug, 'slug'),
    title: normalizedExportValue(row.title, 'title'),
    excerpt: normalizedExportValue(row.excerpt, 'excerpt'),
    cover_image_url: row.cover_image_url == null ? null : normalizedExportValue(row.cover_image_url, 'cover_image_url'),
    cover_image_alt: row.cover_image_alt == null ? null : normalizedExportValue(row.cover_image_alt, 'cover_image_alt'),
    read_minutes: row.read_minutes,
    published_at: row.published_at == null ? null : normalizedExportValue(row.published_at, 'published_at'),
    meta_title: row.meta_title == null ? null : normalizedExportValue(row.meta_title, 'meta_title'),
    meta_description: row.meta_description == null ? null : normalizedExportValue(row.meta_description, 'meta_description'),
    canonical_path: row.canonical_path == null ? null : normalizedExportValue(row.canonical_path, 'canonical_path'),
    content_html: normalizedExportValue(row.content_html, 'content_html'),
    blog_categories: category,
  };
}

async function loadExpected(backupDir) {
  const categoryRows = await readRows(backupDir, 'blog_categories');
  const postRows = await readRows(backupDir, 'blog_posts');
  const categoryById = new Map(
    categoryRows.map((row) => [row.id, activeValue(row.is_active) ? mapCategory(row) : null]),
  );
  const categories = categoryRows
    .filter((row) => activeValue(row.is_active))
    .map(mapCategory)
    .sort((left, right) => (
      Number(left.sort_order) - Number(right.sort_order)
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    ));
  const posts = postRows
    .filter((row) => row.status === 'published' && row.published_at != null)
    .map((row) => mapPost(row, categoryById))
    .filter((post) => Date.parse(post.published_at) <= Date.now())
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at));

  const mediaManifest = JSON.parse(await readFile(path.join(backupDir, 'media-manifest.json'), 'utf8'));
  if (!Array.isArray(mediaManifest.objects) || !Array.isArray(mediaManifest.explicit3legacyURLs)) {
    throw new Error('media-manifest.json is missing objects or explicit3legacyURLs arrays');
  }

  return {
    categories,
    posts,
    mediaManifest,
    sourceSummary: {
      categoryRows: categoryRows.length,
      activeCategories: categories.length,
      postRows: postRows.length,
      publishedPosts: posts.length,
      mediaObjectCount: mediaManifest.objects.length,
      mediaObjectFields: Object.keys(mediaManifest.objects[0] ?? {}),
      legacyMediaCount: mediaManifest.explicit3legacyURLs.length,
      mediaTotalBytes: mediaManifest.totals?.bytes ?? null,
    },
  };
}

function bodySummary(body) {
  const hash = createHash('sha256').update(body).digest('hex');
  return {
    bodyBytes: body.length,
    bodySha256: hash,
  };
}

function consumeBody(response, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let capturedBytes = 0;
    let truncated = false;
    response.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (capturedBytes < maxBytes) {
        const remaining = maxBytes - capturedBytes;
        const captured = buffer.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
      }
      if (totalBytes > maxBytes) {
        truncated = true;
      }
    });
    response.once('error', reject);
    response.once('end', () => {
      const body = Buffer.concat(chunks, capturedBytes);
      resolve({
        body,
        totalBytes,
        capturedBytes,
        truncated,
      });
    });
  });
}

function requestOnce(target, {
  method = 'GET',
  headers = {},
  body = null,
  address = null,
  timeoutMs = TIMEOUT_MS,
  maxCaptureBytes = MAX_CAPTURE_BYTES,
} = {}) {
  const url = new URL(target);
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const requestHeaders = {
    ...headers,
    Host: url.host,
  };
  if (body != null) {
    requestHeaders['Content-Length'] = Buffer.byteLength(body);
  }
  const options = {
    protocol: url.protocol,
    hostname: address || url.hostname,
    port: url.port || undefined,
    path: url.pathname + url.search,
    method,
    headers: requestHeaders,
    timeout: timeoutMs,
  };
  if (address) {
    options.lookup = (_hostname, _options, callback) => callback(null, address, 4);
  }
  if (url.protocol === 'https:') {
    options.servername = url.hostname;
  }

  return new Promise((resolve, reject) => {
    const request = transport(options, async (response) => {
      try {
        const captured = await consumeBody(response, maxCaptureBytes);
        resolve({
          status: response.statusCode ?? null,
          headers: response.headers,
          ...captured,
        });
      } catch (error) {
        reject(error);
      }
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('request timeout')));
    request.once('error', reject);
    if (body != null) {
      request.write(body);
    }
    request.end();
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestWithRetry(target, options = {}) {
  const retries = options.retries ?? RETRIES;
  let lastError = null;
  let lastResponse = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await requestOnce(target, options);
      response.attempts = attempt + 1;
      lastResponse = response;
      if (response.status == null || response.status >= 500) {
        if (attempt < retries) {
          await wait(100 * (attempt + 1));
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await wait(100 * (attempt + 1));
      }
    }
  }
  return {
    status: lastResponse?.status ?? null,
    headers: lastResponse?.headers ?? {},
    body: lastResponse?.body ?? Buffer.alloc(0),
    bodyBytes: lastResponse?.bodyBytes ?? 0,
    capturedBytes: lastResponse?.capturedBytes ?? 0,
    truncated: lastResponse?.truncated ?? false,
    attempts: retries + 1,
    error: lastError?.message ?? (lastResponse ? 'HTTP request failed' : 'HTTP request returned no response'),
  };
}

function responseHeader(response, name) {
  return response?.headers?.[name.toLowerCase()] ?? null;
}

function parseJson(response) {
  if (!response || response.error || response.truncated) {
    return {
      value: null,
      error: response?.error || (response?.truncated ? 'response body exceeded capture limit' : 'no response'),
    };
  }
  try {
    return { value: JSON.parse(response.body.toString('utf8')), error: null };
  } catch {
    return { value: null, error: 'invalid JSON response' };
  }
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function compareValues(expected, actual, pathName, mismatches = [], limit = 30) {
  if (mismatches.length >= limit) {
    return mismatches;
  }
  if (expected === actual) {
    return mismatches;
  }
  if (typeName(expected) !== typeName(actual)) {
    mismatches.push({ path: pathName, expectedType: typeName(expected), actualType: typeName(actual) });
    return mismatches;
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) {
      mismatches.push({ path: pathName + '.length', expected: expected.length, actual: actual.length });
    }
    const length = Math.min(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      compareValues(expected[index], actual[index], pathName + '[' + index + ']', mismatches, limit);
    }
    return mismatches;
  }
  if (typeof expected === 'object') {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!(key in expected) || !(key in actual)) {
        mismatches.push({
          path: pathName + '.' + key,
          expectedType: key in expected ? typeName(expected[key]) : 'missing',
          actualType: key in actual ? typeName(actual[key]) : 'missing',
        });
      } else {
        compareValues(expected[key], actual[key], pathName + '.' + key, mismatches, limit);
      }
    }
    return mismatches;
  }
  mismatches.push({ path: pathName, expectedType: typeName(expected), actualType: typeName(actual) });
  return mismatches;
}

function addCheck(checks, name, ok, details = {}) {
  checks.push({ name, ok: Boolean(ok), ...details });
}

function responseDetails(response, expectedStatus = null) {
  return {
    status: response?.status ?? null,
    expectedStatus,
    attempts: response?.attempts ?? null,
    error: response?.error ?? null,
    ...(response ? bodySummary(response.body) : {}),
    bodyCapturedBytes: response?.capturedBytes ?? 0,
    bodyTruncated: response?.truncated ?? false,
  };
}

async function runPool(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: error.message };
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => run(),
  ));
  return results;
}

function mediaPath(key, prefix = '/media/') {
  return prefix + key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function checkApis(baseUrl, expected, options, checks) {
  const base = baseUrl.toString();
  const categoriesResponse = await requestWithRetry(new URL('/api/blog/categories', base), {
    address: options.address,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });
  const categoriesJson = parseJson(categoriesResponse);
  const categoriesMismatches = categoriesJson.value == null
    ? [{ path: '$', error: categoriesJson.error }]
    : compareValues(expected.categories, categoriesJson.value, '$');
  addCheck(checks, 'api.blog.categories', categoriesResponse.status === 200 && categoriesMismatches.length === 0, {
    ...responseDetails(categoriesResponse, 200),
    expectedCount: expected.categories.length,
    actualCount: Array.isArray(categoriesJson.value) ? categoriesJson.value.length : null,
    mismatches: categoriesMismatches,
  });

  const postsResponse = await requestWithRetry(new URL('/api/blog/posts', base), {
    address: options.address,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });
  const postsJson = parseJson(postsResponse);
  const postsMismatches = postsJson.value == null
    ? [{ path: '$', error: postsJson.error }]
    : compareValues(expected.posts, postsJson.value, '$');
  addCheck(checks, 'api.blog.posts', postsResponse.status === 200 && postsMismatches.length === 0, {
    ...responseDetails(postsResponse, 200),
    expectedCount: expected.posts.length,
    actualCount: Array.isArray(postsJson.value) ? postsJson.value.length : null,
    mismatches: postsMismatches,
  });

  const slugResults = await runPool(expected.posts, async (post) => {
    const response = await requestWithRetry(
      new URL('/api/blog/posts/' + encodeURIComponent(post.slug), base),
      { address: options.address, timeoutMs: options.timeoutMs, retries: options.retries },
    );
    const json = parseJson(response);
    const mismatches = json.value == null
      ? [{ path: '$', error: json.error }]
      : compareValues(post, json.value, '$');
    return { post, response, mismatches };
  });
  for (const result of slugResults) {
    addCheck(checks, 'api.blog.post.' + result.post.slug, result.response?.status === 200 && result.mismatches.length === 0, {
      ...responseDetails(result.response, 200),
      mismatches: result.mismatches,
    });
  }

  const missingSlug = '__migration-validation-missing__';
  const missingResponse = await requestWithRetry(
    new URL('/api/blog/posts/' + missingSlug, base),
    { address: options.address, timeoutMs: options.timeoutMs, retries: options.retries },
  );
  const missingJson = parseJson(missingResponse);
  addCheck(checks, 'api.blog.post.missing-is-null', missingResponse.status === 200 && missingJson.value === null, {
    ...responseDetails(missingResponse, 200),
    actualType: typeName(missingJson.value),
  });

  const metricsGet = async () => {
    const response = await requestWithRetry(new URL('/api/profile-metrics', base), {
      address: options.address,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    return { response, json: parseJson(response) };
  };
  const before = await metricsGet();
  const beforeValue = before.json.value;
  addCheck(checks, 'api.profile-metrics.get', before.response.status === 200
    && beforeValue != null
    && typeof beforeValue.profile_views === 'number'
    && typeof beforeValue.post_impressions === 'number', {
    ...responseDetails(before.response, 200),
    shape: beforeValue == null ? null : Object.keys(beforeValue).sort(),
  });

  const hostname = baseUrl.hostname;
  const workersWrite = isWorkersDev(hostname);
  const localWrite = isLocalHost(hostname) && options.allowLocalWrite;
  const productionWrite = isProductionHost(hostname) && options.allowProductionWrite;
  const writeAllowed = workersWrite || localWrite || productionWrite;
  if (!writeAllowed) {
    addCheck(checks, 'api.profile-metrics.post-suppressed', true, {
      skipped: true,
      reason: isProductionHost(hostname)
        ? 'production write requires --allow-production-write'
        : 'POST is restricted to workers.dev unless an explicit local test flag is used',
    });
    return;
  }

  const postBody = JSON.stringify({
    page_path: '/blogs',
    user_agent: 'migration validation',
  });
  const postResponse = await requestWithRetry(new URL('/api/profile-metrics', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: postBody,
    address: options.address,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });
  const postJson = parseJson(postResponse);
  const after = await metricsGet();
  const afterValue = after.json.value;
  const expectedPostValue = beforeValue && (workersWrite
    ? beforeValue
    : {
        profile_views: beforeValue.profile_views + 1,
        post_impressions: beforeValue.post_impressions + 1,
      });
  const postMismatches = postJson.value == null
    ? [{ path: '$', error: postJson.error }]
    : compareValues(expectedPostValue, postJson.value, '$');
  const persistedMismatches = afterValue == null
    ? [{ path: '$', error: after.json.error }]
    : compareValues(expectedPostValue, afterValue, '$');
  addCheck(checks, 'api.profile-metrics.post-write-policy', postResponse.status === 200
    && postMismatches.length === 0
    && after.response.status === 200
    && persistedMismatches.length === 0, {
    ...responseDetails(postResponse, 200),
    policy: workersWrite ? 'workers.dev write suppressed' : 'explicit local/production write',
    postMismatches,
    persistedMismatches,
    before: beforeValue,
    after: afterValue,
  });
}

async function checkMedia(baseUrl, manifest, options, checks) {
  const objects = manifest.objects;
  const headResults = await runPool(objects, async (object) => {
    const response = await requestWithRetry(
      new URL(mediaPath(object.key), baseUrl),
      {
        method: 'HEAD',
        address: options.address,
        timeoutMs: options.timeoutMs,
        retries: options.retries,
        maxCaptureBytes: 0,
      },
    );
    const contentLength = responseHeader(response, 'content-length');
    const contentType = responseHeader(response, 'content-type')?.toLowerCase() ?? null;
    const expectedType = object.contentType?.toLowerCase() ?? null;
    const ok = response.status === 200
      && contentLength === String(object.bytes)
      && (!expectedType || contentType === expectedType);
    return {
      object,
      response,
      ok,
      contentLength,
      contentType,
    };
  });
  for (const result of headResults) {
    const object = result.object ?? {};
    addCheck(checks, 'media.head.' + (object.key ?? 'unknown'), result.ok === true, {
      ...responseDetails(result.response, 200),
      expectedBytes: object.bytes ?? null,
      actualContentLength: result.contentLength ?? null,
      expectedContentType: object.contentType ?? null,
      actualContentType: result.contentType ?? null,
    });
  }

  const objectsByKey = new Map(objects.map((object) => [object.key, object]));
  const legacyResults = await runPool(manifest.explicit3legacyURLs, async (legacy) => {
    const object = objectsByKey.get(legacy.key) ?? legacy;
    const size = Number(legacy.bytes ?? object.bytes);
    const directPath = legacy.originalUrl || '/' + legacy.key;
    const requestOptions = {
      address: options.address,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    };
    const head = await requestWithRetry(new URL(directPath, baseUrl), {
      ...requestOptions,
      method: 'HEAD',
      maxCaptureBytes: 0,
    });
    const rangeEnd = Math.min(15, size - 1);
    const rangeLength = rangeEnd + 1;
    const range = await requestWithRetry(new URL(directPath, baseUrl), {
      ...requestOptions,
      headers: { Range: 'bytes=0-' + rangeEnd },
      maxCaptureBytes: MAX_RANGE_CAPTURE_BYTES,
    });
    const suffixLength = Math.min(16, size);
    const suffix = await requestWithRetry(new URL(directPath, baseUrl), {
      ...requestOptions,
      headers: { Range: 'bytes=-' + suffixLength },
      maxCaptureBytes: MAX_RANGE_CAPTURE_BYTES,
    });
    const invalid = await requestWithRetry(new URL(directPath, baseUrl), {
      ...requestOptions,
      headers: { Range: 'bytes=' + size + '-' },
      maxCaptureBytes: 0,
    });
    const type = object.contentType?.toLowerCase() ?? null;
    const headOk = head.status === 200
      && responseHeader(head, 'content-length') === String(size)
      && (!type || responseHeader(head, 'content-type')?.toLowerCase() === type);
    const rangeOk = range.status === 206
      && responseHeader(range, 'content-range') === 'bytes 0-' + rangeEnd + '/' + size
      && range.bodyBytes === rangeLength;
    const suffixStart = size - suffixLength;
    const suffixOk = suffix.status === 206
      && responseHeader(suffix, 'content-range') === 'bytes ' + suffixStart + '-' + (size - 1) + '/' + size
      && suffix.bodyBytes === suffixLength;
    const invalidOk = invalid.status === 416
      && responseHeader(invalid, 'content-range') === 'bytes */' + size;
    return {
      key: legacy.key,
      head,
      range,
      suffix,
      invalid,
      ok: headOk && rangeOk && suffixOk && invalidOk,
      subchecks: { headOk, rangeOk, suffixOk, invalidOk },
    };
  });
  for (const result of legacyResults) {
    addCheck(checks, 'media.legacy.' + result.key, result.ok === true, {
      subchecks: result.subchecks,
      head: responseDetails(result.head, 200),
      range: responseDetails(result.range, 206),
      suffix: responseDetails(result.suffix, 206),
      invalid: responseDetails(result.invalid, 416),
    });
  }
}

async function checkStatic(baseUrl, expected, options, checks) {
  const staticPaths = [
    ['homepage', '/'],
    ['blogs', '/blogs'],
    ['contact', '/contact'],
    ['playground', '/playground'],
    ['examples', '/contoh'],
    ...expected.posts.map((post) => ['blog.' + post.slug, '/blog/' + encodeURIComponent(post.slug)]),
  ];
  const staticResults = await runPool(staticPaths, async ([name, pathname]) => {
    const response = await requestWithRetry(new URL(pathname, baseUrl), {
      address: options.address,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    return { name, response };
  });
  for (const result of staticResults) {
    addCheck(checks, 'static.' + result.name, result.response?.status === 200, responseDetails(result.response, 200));
  }

  const firstSlug = expected.posts[0]?.slug || 'missing';
  const redirectCases = [
    ['/blog.html?verify=migration', '/blogs?verify=migration'],
    ['/blog/' + encodeURIComponent(firstSlug) + '.html?verify=migration', '/blog/' + encodeURIComponent(firstSlug) + '?verify=migration'],
    ['/index.html?verify=migration', '/?verify=migration'],
    ['/contact/index.html?verify=migration', '/contact?verify=migration'],
  ];
  const redirectResults = await runPool(redirectCases, async ([source, destination]) => {
    const response = await requestWithRetry(new URL(source, baseUrl), {
      address: options.address,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    const expectedLocation = new URL(destination, baseUrl).toString();
    return {
      source,
      destination,
      response,
      expectedLocation,
      actualLocation: responseHeader(response, 'location'),
    };
  });
  for (const result of redirectResults) {
    addCheck(checks, 'redirect.' + result.source.split('?')[0], result.response?.status === 308
      && result.actualLocation === result.expectedLocation, {
      ...responseDetails(result.response, 308),
      expectedLocation: result.expectedLocation,
      actualLocation: result.actualLocation,
    });
  }

  const missing = await requestWithRetry(new URL('/missing-route-for-validation?verify=migration', baseUrl), {
    address: options.address,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
  });
  addCheck(checks, 'static.missing-is-404', missing.status === 404, responseDetails(missing, 404));
}

async function verifyDeployment(options) {
  const expected = await loadExpected(options.backupDir);
  const checks = [];
  addCheck(checks, 'source.categories.expected-count', expected.sourceSummary.activeCategories === EXPECTED_CATEGORY_COUNT, {
    expected: EXPECTED_CATEGORY_COUNT,
    actual: expected.sourceSummary.activeCategories,
  });
  addCheck(checks, 'source.posts.expected-count', expected.sourceSummary.publishedPosts === EXPECTED_POST_COUNT, {
    expected: EXPECTED_POST_COUNT,
    actual: expected.sourceSummary.publishedPosts,
  });
  addCheck(checks, 'source.media-manifest.object-count', expected.sourceSummary.mediaObjectCount === EXPECTED_MEDIA_OBJECT_COUNT, {
    expected: EXPECTED_MEDIA_OBJECT_COUNT,
    actual: expected.sourceSummary.mediaObjectCount,
    objectFields: expected.sourceSummary.mediaObjectFields,
  });
  addCheck(checks, 'source.media-manifest.legacy-count', expected.sourceSummary.legacyMediaCount === EXPECTED_LEGACY_MEDIA_COUNT, {
    expected: EXPECTED_LEGACY_MEDIA_COUNT,
    actual: expected.sourceSummary.legacyMediaCount,
  });
  addCheck(checks, 'source.media-manifest.no-failures', (expected.mediaManifest.failures ?? []).length === 0, {
    failures: (expected.mediaManifest.failures ?? []).length,
  });

  await checkApis(options.baseUrl, expected, options, checks);
  await checkMedia(options.baseUrl, expected.mediaManifest, options, checks);
  await checkStatic(options.baseUrl, expected, options, checks);

  const passed = checks.filter((check) => check.ok && !check.skipped).length;
  const failed = checks.filter((check) => !check.ok).length;
  const skipped = checks.filter((check) => check.skipped).length;
  const report = {
    generatedAt: new Date().toISOString(),
    base: options.baseUrl.origin,
    address: options.address ?? null,
    transport: options.baseUrl.protocol.slice(0, -1),
    settings: {
      concurrency: options.concurrency,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
      maxCaptureBytes: MAX_CAPTURE_BYTES,
    },
    source: expected.sourceSummary,
    checks,
    summary: { passed, failed, skipped, total: checks.length },
    reportPath: options.reportPath,
  };
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

export { loadExpected, parseArgs, requestWithRetry, verifyDeployment };

export async function runCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const report = await verifyDeployment(options);
  console.log(JSON.stringify({
    report: report.reportPath,
    base: report.base,
    ...report.summary,
  }));
  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
  return report;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
