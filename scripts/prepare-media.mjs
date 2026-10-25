#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_COMMIT = 'f8fa61a';
const DEFAULT_BACKUP_DIR = join(
  homedir(),
  '.codex',
  'backups',
  'akmalalif-cloudflare-2026-10-26',
);
const CLOUD_FRONT_HOST = /(?:^|\.)cloudfront\.net$/i;
const SOURCE_EXTENSIONS = new Set(['.html', '.css', '.js']);
const LEGACY_MEDIA = [
  {
    sourcePath: 'assets/video/brandon.mp4',
    originalUrl: '/assets/video/brandon.mp4',
    key: 'assets/video/brandon.mp4',
  },
  {
    sourcePath: 'assets/video/zopo (@aesopcash).mp4',
    originalUrl: '/assets/video/zopo (@aesopcash).mp4',
    key: 'assets/video/zopo (@aesopcash).mp4',
  },
  {
    sourcePath: 'blog/blogpic/thumb1.mp4',
    originalUrl: '/blog/blogpic/thumb1.mp4',
    key: 'blog/blogpic/thumb1.mp4',
  },
];

const CONTENT_TYPES = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

function parseArgs(argv) {
  const options = {
    backupDir: DEFAULT_BACKUP_DIR,
    commit: DEFAULT_COMMIT,
    concurrency: 4,
    legacySourceRoot: null,
    manifestPath: null,
    outputDir: null,
    repoRoot: process.cwd(),
    retries: 3,
    sqlPath: null,
  };

  const valueOptions = new Set([
    '--backup-dir',
    '--commit',
    '--concurrency',
    '--legacy-source-root',
    '--manifest',
    '--output-dir',
    '--repo-root',
    '--retries',
    '--sql-path',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (!valueOptions.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    index += 1;

    if (argument === '--backup-dir') options.backupDir = resolve(value);
    if (argument === '--commit') options.commit = value;
    if (argument === '--concurrency') options.concurrency = positiveInteger(value, argument);
    if (argument === '--legacy-source-root') options.legacySourceRoot = resolve(value);
    if (argument === '--manifest') options.manifestPath = resolve(value);
    if (argument === '--output-dir') options.outputDir = resolve(value);
    if (argument === '--repo-root') options.repoRoot = resolve(value);
    if (argument === '--retries') options.retries = nonNegativeInteger(value, argument);
    if (argument === '--sql-path') options.sqlPath = resolve(value);
  }

  options.outputDir ??= join(options.backupDir, 'media');
  options.manifestPath ??= join(options.backupDir, 'media-manifest.json');
  options.sqlPath ??= join(options.backupDir, 'blog_posts_rows.sql');

  return options;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative integer`);
  }
  return parsed;
}

function helpText() {
  return `Usage: node scripts/prepare-media.mjs [options]

Scans ${DEFAULT_COMMIT} HTML/CSS/JS plus the exported blog_posts_rows.sql,
downloads distinct CloudFront objects to an external R2-key-shaped directory,
and copies the three checked-out legacy MP4s after rejecting Git LFS pointers.

Options:
  --backup-dir <path>          Backup root containing blog_posts_rows.sql and media/
  --commit <ref>               Source Git ref (default: ${DEFAULT_COMMIT})
  --concurrency <n>            Download concurrency (default: 4)
  --legacy-source-root <path>  Checkout containing the real legacy MP4 binaries
  --manifest <path>            Manifest path (default: <backup-dir>/media-manifest.json)
  --output-dir <path>          External media output directory (default: <backup-dir>/media)
  --repo-root <path>           Repository containing the source ref (default: cwd)
  --retries <n>                Retries after the first request (default: 3)
  --sql-path <path>            Exported blog_posts_rows.sql path
`;
}

function gitText(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sourceFilesFromCommit(repoRoot, commit) {
  return gitText(repoRoot, ['ls-tree', '-r', '--name-only', commit])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => SOURCE_EXTENSIONS.has(extname(file).toLowerCase()));
}

function trimSyntaxDelimiters(value) {
  let token = value.replace(/\\+$/u, '');
  while (/[\)\],;}>]+$/u.test(token)) {
    token = token.slice(0, -1);
  }
  return token;
}

function rawPathForUrl(originalUrl) {
  const match = originalUrl.match(/^https?:\/\/[^/?#]+([^?#]*)/iu);
  return match?.[1] || '/';
}

function decodedKeyForUrl(parsedUrl, rawPath = parsedUrl.pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new Error('URL path contains malformed percent encoding');
  }

  const segments = decodedPath.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('URL path does not resolve to a safe object key');
  }
  if (segments.some((segment) => segment.includes('\0') || segment.includes('\\'))) {
    throw new Error('URL path contains an unsafe separator');
  }

  return segments.join('/');
}

export function r2KeyForUrl(originalUrl) {
  const parsedUrl = new URL(originalUrl);
  if (!CLOUD_FRONT_HOST.test(parsedUrl.hostname)) {
    throw new Error(`URL is not a CloudFront URL: ${parsedUrl.hostname}`);
  }
  return decodedKeyForUrl(parsedUrl, rawPathForUrl(originalUrl));
}

export function extractCloudFrontReferences(text, source) {
  const references = [];
  const pattern = /https?:\/\/[^\s"'`<>]+/giu;

  for (const match of text.matchAll(pattern)) {
    const originalUrl = trimSyntaxDelimiters(match[0]);
    let parsedUrl;
    let key;
    let error = null;

    try {
      parsedUrl = new URL(originalUrl);
      if (!CLOUD_FRONT_HOST.test(parsedUrl.hostname)) continue;
      key = decodedKeyForUrl(parsedUrl, rawPathForUrl(originalUrl));
    } catch (cause) {
      if (cause instanceof TypeError || /cloudfront/i.test(originalUrl)) {
        error = cause instanceof Error ? cause.message : String(cause);
      } else {
        continue;
      }
    }

    const line = text.slice(0, match.index).split('\n').length;
    references.push({
      error,
      fetchUrl: parsedUrl?.href ?? null,
      key: key ?? null,
      originalUrl,
      source,
      line,
    });
  }

  return references;
}

function lineForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function runtimeModelNames(text) {
  const names = new Set();
  const functionStart = text.indexOf('function loadModel');
  const functionEnd = functionStart >= 0 ? text.indexOf('var noise', functionStart) : -1;
  const modelSection = functionStart >= 0
    ? text.slice(functionStart, functionEnd >= 0 ? functionEnd : undefined)
    : '';
  const pattern = /\bcase\s*["']([A-Za-z0-9_-]+)["']\s*:/gu;

  for (const match of modelSection.matchAll(pattern)) {
    names.add(match[1]);
  }

  return [...names];
}

function isRuntimeModelPrefix(reference) {
  return reference.key === 'models'
    && reference.originalUrl.endsWith('/models/')
    && /\.load\s*\(\s*[A-Za-z_$][\w$]*\s*\+\s*["']\.obj["']/u.test(reference.sourceText ?? '');
}

export function extractRuntimeModelReferences(text, source, literalReferences) {
  const prefixes = literalReferences.filter((reference) => {
    return !reference.error && reference.key === 'models' && reference.originalUrl.endsWith('/models/');
  });
  if (!prefixes.length || !/\.load\s*\(\s*[A-Za-z_$][\w$]*\s*\+\s*["']\.obj["']/u.test(text)) {
    return [];
  }

  const names = runtimeModelNames(text);
  return prefixes.flatMap((prefix) => {
    const line = lineForIndex(text, text.indexOf(prefix.originalUrl));
    return names.map((name) => ({
      derived: true,
      derivedFrom: prefix.originalUrl,
      error: null,
      fetchUrl: `${prefix.fetchUrl}${name}.obj`,
      key: `${prefix.key}/${name}.obj`,
      originalUrl: `${prefix.originalUrl}${name}.obj`,
      source,
      sourceText: text,
      line,
    }));
  });
}

function addReference(byKey, invalidReferences, reference) {
  if (reference.error || !reference.key || !reference.fetchUrl) {
    const existing = invalidReferences.get(reference.originalUrl);
    if (existing) {
      existing.sources.push({ line: reference.line, source: reference.source });
    } else {
      invalidReferences.set(reference.originalUrl, {
        error: reference.error ?? 'Unable to resolve URL',
        originalUrl: reference.originalUrl,
        sources: [{ line: reference.line, source: reference.source }],
      });
    }
    return;
  }

  const existing = byKey.get(reference.key);
  if (existing) {
    if (!existing.originalUrls.includes(reference.originalUrl)) {
      existing.originalUrls.push(reference.originalUrl);
    }
    if (!existing.sources.some((source) => source.source === reference.source && source.line === reference.line)) {
      existing.sources.push({ line: reference.line, source: reference.source });
    }
    return;
  }

  byKey.set(reference.key, {
    derived: Boolean(reference.derived),
    derivedFrom: reference.derivedFrom ?? null,
    fetchUrl: reference.fetchUrl,
    key: reference.key,
    originalUrls: [reference.originalUrl],
    sources: [{ line: reference.line, source: reference.source }],
  });
}

async function readReferences(options) {
  const commitFiles = sourceFilesFromCommit(options.repoRoot, options.commit);
  const byKey = new Map();
  const invalidReferences = new Map();
  const runtimePrefixes = new Map();
  let sourceMatches = 0;
  let runtimeDerivedMatches = 0;

  for (const file of commitFiles) {
    const text = gitText(options.repoRoot, ['show', `${options.commit}:${file}`]);
    const source = `${options.commit}:${file}`;
    const references = extractCloudFrontReferences(text, source).map((reference) => ({
      ...reference,
      sourceText: text,
    }));
    sourceMatches += references.length;
    for (const reference of references) {
      if (isRuntimeModelPrefix(reference)) {
        const existing = runtimePrefixes.get(reference.originalUrl);
        if (existing) {
          if (!existing.sources.some((location) => location.source === source && location.line === reference.line)) {
            existing.sources.push({ line: reference.line, source });
          }
        } else {
          runtimePrefixes.set(reference.originalUrl, {
            fetchUrl: reference.fetchUrl,
            key: `${reference.key}/`,
            originalUrl: reference.originalUrl,
            sources: [{ line: reference.line, source }],
          });
        }
        continue;
      }
      addReference(byKey, invalidReferences, reference);
    }

    const derivedReferences = extractRuntimeModelReferences(text, source, references);
    runtimeDerivedMatches += derivedReferences.length;
    derivedReferences.forEach((reference) => addReference(byKey, invalidReferences, reference));
  }

  const sqlText = await readFile(options.sqlPath, 'utf8');
  const sqlReferences = extractCloudFrontReferences(sqlText, options.sqlPath);
  sourceMatches += sqlReferences.length;
  sqlReferences.forEach((reference) => addReference(byKey, invalidReferences, reference));

  return {
    commitFiles,
    entries: [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key)),
    invalidReferences: [...invalidReferences.values()].sort((left, right) => left.originalUrl.localeCompare(right.originalUrl)),
    runtimeDerivedMatches,
    runtimePrefixes: [...runtimePrefixes.values()].sort((left, right) => left.originalUrl.localeCompare(right.originalUrl)),
    sourceMatches,
  };
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function contentTypeForKey(key) {
  return CONTENT_TYPES[extname(key).toLowerCase()] ?? null;
}

function safeOutputPath(outputDir, key) {
  const root = resolve(outputDir);
  const target = resolve(root, ...key.split('/'));
  const relativeTarget = relative(root, target);
  if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error(`Object key escapes output directory: ${key}`);
  }
  return target;
}

async function downloadOne(entry, options) {
  const targetPath = safeOutputPath(options.outputDir, entry.key);
  let lastError = null;

  // Do not leave a prior run's object in place when this URL now fails.
  await rm(targetPath, { force: true });

  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    try {
      const response = await fetch(entry.fetchUrl, {
        headers: {
          Accept: '*/*',
          'User-Agent': 'akmalalif-media-preparer/1.0',
        },
        redirect: 'follow',
      });
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() || null;

      if (!response.ok) {
        await response.body?.cancel();
        lastError = new Error(`HTTP ${response.status}`);
        if (!isRetryableStatus(response.status) || attempt > options.retries) {
          return {
            ...entry,
            attempts: attempt,
            bytes: 0,
            contentType,
            error: lastError.message,
            sha256: null,
            status: 'failed',
            statusCode: response.status,
          };
        }
        await delay(Math.min(5000, 500 * (2 ** (attempt - 1))));
        continue;
      }

      await mkdir(dirname(targetPath), { recursive: true });
      const temporaryPath = `${targetPath}.part-${process.pid}-${randomUUID()}`;
      const hash = createHash('sha256');
      let bytes = 0;
      const digestTransform = new Transform({
        transform(chunk, _encoding, callback) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          hash.update(buffer);
          callback(null, buffer);
        },
      });

      try {
        if (response.body) {
          await pipeline(
            Readable.fromWeb(response.body),
            digestTransform,
            createWriteStream(temporaryPath, { flags: 'wx' }),
          );
        } else {
          await writeFile(temporaryPath, '');
        }
        await rm(targetPath, { force: true });
        await rename(temporaryPath, targetPath);
      } catch (cause) {
        await rm(temporaryPath, { force: true });
        throw cause;
      }

      return {
        ...entry,
        attempts: attempt,
        bytes,
        contentType,
        error: null,
        sha256: hash.digest('hex'),
        status: 'downloaded',
        statusCode: response.status,
      };
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt <= options.retries) {
        await delay(Math.min(5000, 500 * (2 ** (attempt - 1))));
        continue;
      }
    }
  }

  return {
    ...entry,
    attempts: options.retries + 1,
    bytes: 0,
    contentType: null,
    error: lastError?.message ?? 'Download failed',
    sha256: null,
    status: 'failed',
    statusCode: null,
  };
}

async function mapConcurrent(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return results;
}

function isGitLfsPointer(buffer) {
  return buffer
    .subarray(0, 200)
    .toString('utf8')
    .startsWith('version https://git-lfs.github.com/spec/v1');
}

async function copyLegacyMedia(options) {
  const results = [];

  for (const legacy of LEGACY_MEDIA) {
    const sourcePath = resolve(options.legacySourceRoot, legacy.sourcePath);
    const result = {
      attempts: 0,
      bytes: 0,
      contentType: 'video/mp4',
      error: null,
      key: legacy.key,
      originalUrls: [legacy.originalUrl],
      sha256: null,
      sourcePath: legacy.sourcePath,
      sourceRoot: options.legacySourceRoot,
      sources: [{ source: `legacy checkout: ${sourcePath}`, line: null }],
      status: 'copied',
      statusCode: null,
    };

    try {
      const buffer = await readFile(sourcePath);
      if (isGitLfsPointer(buffer)) {
        throw new Error('Git LFS pointer found; a real media binary is required');
      }
      if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') {
        throw new Error('File is not a valid MP4 container');
      }

      const targetPath = safeOutputPath(options.outputDir, legacy.key);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, buffer);
      result.bytes = buffer.length;
      result.sha256 = createHash('sha256').update(buffer).digest('hex');
    } catch (cause) {
      result.error = cause instanceof Error ? cause.message : String(cause);
      result.status = 'failed';
    }

    results.push(result);
  }

  return results;
}

function findLegacySourceRoot(explicitRoot) {
  if (explicitRoot) return explicitRoot;
  const candidates = [
    process.env.PORTFOLIO_SOURCE_ROOT,
    'C:/xampp/htdocs/akmal-alif-MASTER',
    process.cwd(),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? process.cwd();
}

function asFailure(reference) {
  return {
    attempts: 0,
    bytes: 0,
    contentType: null,
    error: reference.error,
    key: null,
    originalUrls: [reference.originalUrl],
    sha256: null,
    sources: reference.sources,
    status: 'failed',
    statusCode: null,
  };
}

function manifestFor(options, scan, downloaded, legacyResults) {
  const invalidResults = scan.invalidReferences.map(asFailure);
  const objects = [...downloaded, ...legacyResults, ...invalidResults].sort((left, right) => {
    const leftKey = left.key ?? left.originalUrls[0];
    const rightKey = right.key ?? right.originalUrls[0];
    return leftKey.localeCompare(rightKey);
  });
  const failures = objects.filter((object) => object.status === 'failed');
  const cloudfrontUrlToKey = {};
  for (const object of downloaded) {
    for (const originalUrl of object.originalUrls) {
      cloudfrontUrlToKey[originalUrl] = object.key;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: {
      commit: options.commit,
      filesScanned: scan.commitFiles.length,
      literalMatches: scan.sourceMatches,
      runtimeDerivedMatches: scan.runtimeDerivedMatches,
      sqlPath: options.sqlPath,
    },
    outputDir: options.outputDir,
    cloudfrontUrlToKey,
    runtimePrefixes: scan.runtimePrefixes.map((prefix) => ({
      ...prefix,
      reason: 'Runtime base path; derived object names were downloaded separately.',
    })),
    explicit3legacyURLs: legacyResults.map((result) => ({
      bytes: result.bytes,
      error: result.error,
      key: result.key,
      originalUrl: result.originalUrls[0],
      sha256: result.sha256,
      sourcePath: result.sourcePath,
      status: result.status,
    })),
    objects,
    totals: {
      bytes: objects.reduce((total, object) => total + (object.status === 'failed' ? 0 : object.bytes), 0),
      copiedLegacy: legacyResults.filter((object) => object.status === 'copied').length,
      downloaded: downloaded.filter((object) => object.status === 'downloaded').length,
      distinctCloudFrontKeys: downloaded.length,
      distinctCloudFrontUrls: Object.keys(cloudfrontUrlToKey).length,
      failed: failures.length,
      runtimeDerivedMatches: scan.runtimeDerivedMatches,
      runtimePrefixes: scan.runtimePrefixes.length,
      sourceMatches: scan.sourceMatches + scan.runtimeDerivedMatches,
      literalSourceMatches: scan.sourceMatches,
    },
    failures,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  options.legacySourceRoot = findLegacySourceRoot(options.legacySourceRoot);
  await mkdir(options.outputDir, { recursive: true });
  await mkdir(dirname(options.manifestPath), { recursive: true });

  const scan = await readReferences(options);
  const downloaded = await mapConcurrent(
    scan.entries,
    options.concurrency,
    async (entry, index) => {
      const result = await downloadOne(entry, options);
      const label = `${index + 1}/${scan.entries.length}`;
      console.log(`[media] ${label} ${result.status} ${result.key}${result.statusCode ? ` (${result.statusCode})` : ''}`);
      return result;
    },
  );
  const legacyResults = await copyLegacyMedia(options);
  const manifest = manifestFor(options, scan, downloaded, legacyResults);
  await writeFile(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Prepared media in ${options.outputDir}`);
  console.log(`Manifest: ${options.manifestPath}`);
  console.log(`Totals: ${JSON.stringify(manifest.totals)}`);
  if (manifest.failures.length) {
    for (const failure of manifest.failures) {
      console.error(`[media] failure ${failure.originalUrls.join(', ')}: ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

export {
  LEGACY_MEDIA,
  isGitLfsPointer,
  safeOutputPath,
};
