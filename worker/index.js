const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MEDIA_CACHE_CONTROL = 'public, max-age=86400';
const READ_ONLY_MEDIA_CACHE_CONTROL = 'no-store';
const WRITE_ALLOWED_HOSTS = new Set([
  'www.akmalalif.com',
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

const DIRECT_MEDIA_PATHS = new Set([
  '/assets/video/brandon.mp4',
  '/assets/video/zopo (@aesopcash).mp4',
  '/blog/blogpic/thumb1.mp4',
]);

const POST_SELECT = `
  SELECT
    p.slug,
    p.title,
    p.excerpt,
    p.cover_image_url,
    p.cover_image_alt,
    p.read_minutes,
    p.published_at,
    p.meta_title,
    p.meta_description,
    p.canonical_path,
    p.content_html,
    c.slug AS category_slug,
    c.name AS category_name,
    c.color_class AS category_color_class,
    c.sort_order AS category_sort_order
  FROM blog_posts AS p
  LEFT JOIN blog_categories AS c ON c.id = p.category_id
`;

function jsonResponse(value, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': JSON_CONTENT_TYPE,
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });

  return new Response(JSON.stringify(value), { status, headers });
}

function errorResponse(status, message, extraHeaders = {}) {
  return jsonResponse({ error: message }, status, extraHeaders);
}

function methodNotAllowed(allow) {
  return errorResponse(405, 'Method Not Allowed', { Allow: allow });
}

function rowsFromResult(result) {
  return Array.isArray(result) ? result : result?.results ?? [];
}

function countValue(value) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function metricsShape(row) {
  return {
    profile_views: countValue(row?.profile_views),
    post_impressions: countValue(row?.post_impressions),
  };
}

async function readMetrics(env) {
  const row = await env.DB
    .prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1')
    .first();
  return metricsShape(row);
}

function mapCategory(row) {
  return {
    slug: row.slug,
    name: row.name,
    color_class: row.color_class ?? null,
    sort_order: row.sort_order,
    ...(row.icon_key ? { icon_key: row.icon_key } : {}),
  };
}

function mapPost(row) {
  const category = row.category_slug == null
    ? null
    : {
        slug: row.category_slug,
        name: row.category_name,
        color_class: row.category_color_class ?? null,
        sort_order: row.category_sort_order,
      };

  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    cover_image_url: row.cover_image_url ?? null,
    cover_image_alt: row.cover_image_alt ?? null,
    read_minutes: row.read_minutes,
    published_at: row.published_at,
    meta_title: row.meta_title ?? null,
    meta_description: row.meta_description ?? null,
    canonical_path: row.canonical_path ?? null,
    content_html: row.content_html,
    blog_categories: category,
  };
}

async function handleCategories(request, env) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }

  const result = await env.DB
    .prepare(`
      SELECT slug, name, color_class, sort_order, icon_key
      FROM blog_categories
      WHERE is_active = 1
      ORDER BY sort_order ASC, name ASC
    `)
    .all();

  return jsonResponse(rowsFromResult(result).map(mapCategory));
}

async function handlePosts(request, env, slug) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }

  const now = new Date().toISOString();
  if (slug !== undefined) {
    const row = await env.DB
      .prepare(`${POST_SELECT}
        WHERE p.slug = ?
          AND p.status = 'published'
          AND p.published_at <= ?
        LIMIT 1`)
      .bind(slug, now)
      .first();

    return jsonResponse(row ? mapPost(row) : null);
  }

  const result = await env.DB
    .prepare(`${POST_SELECT}
      WHERE p.status = 'published'
        AND p.published_at <= ?
      ORDER BY p.published_at DESC`)
    .bind(now)
    .all();

  return jsonResponse(rowsFromResult(result).map(mapPost));
}

function isWriteAllowed(hostname) {
  return WRITE_ALLOWED_HOSTS.has(hostname.toLowerCase());
}

function stringValue(value, fallback) {
  return String(value ?? fallback);
}

function leftText(value, limit) {
  return Array.from(String(value)).slice(0, limit).join('');
}

function nullableLimitedString(value, limit) {
  if (value == null) {
    return null;
  }

  const text = leftText(value, limit);
  return text === '' ? null : text;
}

async function handleProfileMetrics(request, env, url) {
  if (request.method === 'GET') {
    return jsonResponse(await readMetrics(env));
  }

  if (request.method !== 'POST') {
    return methodNotAllowed('GET, POST');
  }

  if (!isWriteAllowed(url.hostname)) {
    return jsonResponse(await readMetrics(env));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Request body must be valid JSON');
  }

  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'Request body must be a JSON object');
  }

  const originalPagePath = body.page_path == null ? '' : String(body.page_path);
  const pagePath = leftText(stringValue(body.page_path, '/'), 512);
  const referrer = nullableLimitedString(body.referrer, 1024);
  const userAgent = nullableLimitedString(body.user_agent, 1024);
  const isBlogPage = originalPagePath.startsWith('/blog') ? 1 : 0;
  const timestamp = new Date().toISOString();

  const statements = [
    env.DB
      .prepare(`
        INSERT INTO profile_page_events (page_path, referrer, user_agent, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(pagePath, referrer, userAgent, timestamp),
    env.DB
      .prepare(`
        UPDATE profile_metrics
        SET profile_views = profile_views + 1,
            post_impressions = post_impressions + ?,
            updated_at = ?
        WHERE id = 1
      `)
      .bind(isBlogPage, timestamp),
    env.DB
      .prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1'),
  ];

  const result = await env.DB.batch(statements);
  const metrics = metricsShape(rowsFromResult(result?.[2])[0]);
  return jsonResponse(metrics);
}

function redirectResponse(url, targetPath) {
  const target = new URL(targetPath, url.origin);
  target.search = url.search;
  return new Response(null, {
    status: 308,
    headers: { Location: target.toString() },
  });
}

function cleanRedirectTarget(pathname) {
  if (pathname === '/blog.html') {
    return '/blogs';
  }

  if (pathname.startsWith('/blog/') && pathname.endsWith('/')) {
    const slug = pathname.slice('/blog/'.length, -1);
    if (slug && !slug.includes('/')) {
      return `/blog/${slug}`;
    }
  }

  if (pathname.startsWith('/blog/') && pathname.endsWith('.html')) {
    const slug = pathname.slice('/blog/'.length, -'.html'.length);
    if (slug && !slug.includes('/')) {
      return `/blog/${slug}`;
    }
  }

  if (pathname === '/index.html') {
    return '/';
  }

  if (pathname.endsWith('/index.html')) {
    const directory = pathname.slice(0, -'/index.html'.length);
    return directory || '/';
  }

  return null;
}

function staticAssetPath(pathname) {
  if (pathname === '/') {
    return '/index.html';
  }

  if (pathname === '/blogs' || pathname === '/blogs/') {
    return '/blog.html';
  }

  if (pathname.startsWith('/blog/') && !pathname.endsWith('/')) {
    const slug = pathname.slice('/blog/'.length);
    if (slug && !slug.includes('/') && !slug.endsWith('.html')) {
      return `/blog/${slug}.html`;
    }
  }

  if (pathname.endsWith('/')) {
    return `${pathname}index.html`;
  }

  if (!pathname.includes('.')) {
    return `${pathname}/index.html`;
  }

  return pathname;
}

function assetRequest(request, assetPath) {
  const url = new URL(request.url);
  url.pathname = assetPath;
  return new Request(url, request);
}

async function handleStatic(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return methodNotAllowed('GET, HEAD');
  }

  const redirectTarget = cleanRedirectTarget(url.pathname);
  if (redirectTarget) {
    return redirectResponse(url, redirectTarget);
  }

  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return errorResponse(500, 'Static asset binding unavailable');
  }

  const assetResponse = await env.ASSETS.fetch(assetRequest(request, staticAssetPath(url.pathname)));
  if (assetResponse.status !== 404 || !isDynamicBlogPath(url.pathname)) {
    return assetResponse;
  }

  let slug;
  try {
    slug = decodeURIComponent(url.pathname.slice('/blog/'.length));
  } catch {
    return assetResponse;
  }
  const published = await publishedPostForSlug(env, slug);
  if (!published) {
    return assetResponse;
  }

  const template = await env.ASSETS.fetch(assetRequest(request, '/blog/article-template.html'));
  if (!template.ok) {
    return assetResponse;
  }

  return new Response(template.body, {
    status: template.status,
    statusText: template.statusText,
    headers: new Headers(template.headers),
  });
}

function isDynamicBlogPath(pathname) {
  return pathname.startsWith('/blog/')
    && !pathname.endsWith('/')
    && !pathname.endsWith('.html')
    && pathname.slice('/blog/'.length).length > 0
    && !pathname.slice('/blog/'.length).includes('/');
}

async function publishedPostForSlug(env, slug) {
  if (!env.DB || typeof env.DB.prepare !== 'function') {
    return null;
  }
  return env.DB.prepare(`
    SELECT p.id, p.slug, p.title, p.excerpt, p.content_html, p.published_at
    FROM blog_posts AS p
    WHERE p.slug = ? AND p.status = 'published' AND p.published_at <= ?
    LIMIT 1
  `).bind(slug, new Date().toISOString()).first();
}

function mediaKeyForRequest(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { error: 'Malformed media URL' };
  }

  let key = null;
  if (pathname.startsWith('/media/')) {
    key = pathname.slice('/media/'.length);
  } else if (DIRECT_MEDIA_PATHS.has(pathname)) {
    key = pathname.slice(1);
  }

  if (!key || key.split('/').some((part) => part === '..')) {
    return null;
  }

  if (key === 'blog/originals' || key.startsWith('blog/originals/')) {
    return null;
  }

  return { key };
}

function isPrivateBlogOriginalPath(pathname) {
  let candidate = pathname;
  for (let index = 0; index < 3; index += 1) {
    if (candidate === '/media/blog/originals' || candidate.startsWith('/media/blog/originals/')) {
      return true;
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) {
        break;
      }
      candidate = decoded;
    } catch {
      break;
    }
  }
  return false;
}

function mediaContentType(key) {
  const extension = key.toLowerCase().split('.').pop();
  const types = {
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    webm: 'video/webm',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
  };
  return types[extension] ?? 'application/octet-stream';
}

function setMediaMetadataHeaders(headers, metadata, key) {
  const httpMetadata = metadata?.httpMetadata ?? {};
  headers.set('Content-Type', httpMetadata.contentType ?? mediaContentType(key));

  if (httpMetadata.contentLanguage) {
    headers.set('Content-Language', httpMetadata.contentLanguage);
  }
  if (httpMetadata.contentDisposition) {
    headers.set('Content-Disposition', httpMetadata.contentDisposition);
  }
  if (httpMetadata.contentEncoding) {
    headers.set('Content-Encoding', httpMetadata.contentEncoding);
  }
  const httpEtag = metadata?.httpEtag ?? (metadata?.etag ? `"${metadata.etag.replace(/^"|"$/g, '')}"` : null);
  if (httpEtag) {
    headers.set('ETag', httpEtag);
  }
  if (metadata?.uploaded) {
    const uploaded = metadata.uploaded instanceof Date
      ? metadata.uploaded
      : new Date(metadata.uploaded);
    if (!Number.isNaN(uploaded.getTime())) {
      headers.set('Last-Modified', uploaded.toUTCString());
    }
  }

  headers.set('Accept-Ranges', 'bytes');
}

function parseByteRange(value, size) {
  if (!value || !value.startsWith('bytes=') || value.slice('bytes='.length).includes(',')) {
    return null;
  }

  const range = value.slice('bytes='.length).trim();
  const separator = range.indexOf('-');
  if (separator < 0 || size <= 0) {
    return null;
  }

  const startText = range.slice(0, separator).trim();
  const endText = range.slice(separator + 1).trim();
  let start;
  let end;

  if (startText === '') {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    if (!Number.isInteger(start) || start < 0 || start >= size) {
      return null;
    }

    if (endText === '') {
      end = size - 1;
    } else {
      end = Number(endText);
      if (!Number.isInteger(end) || end < start) {
        return null;
      }
      end = Math.min(end, size - 1);
    }
  }

  return { start, end, length: end - start + 1 };
}

function matchesIfNoneMatch(value, etag) {
  if (!value || !etag) {
    return false;
  }

  const normalizedEtag = etag.replace(/^W\//, '');
  return value
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate.replace(/^W\//, '') === normalizedEtag);
}

function mediaNotFound() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': READ_ONLY_MEDIA_CACHE_CONTROL,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

async function handleMedia(request, env, key) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return methodNotAllowed('GET, HEAD');
  }
  if (!env.MEDIA || typeof env.MEDIA.head !== 'function' || typeof env.MEDIA.get !== 'function') {
    return errorResponse(503, 'Media binding unavailable');
  }

  const head = await env.MEDIA.head(key);
  if (!head) {
    return mediaNotFound();
  }

  const size = Number(head.size ?? 0);
  const headers = new Headers();
  setMediaMetadataHeaders(headers, head, key);
  if (matchesIfNoneMatch(request.headers.get('If-None-Match'), headers.get('ETag'))) {
    headers.set('Cache-Control', MEDIA_CACHE_CONTROL);
    return new Response(null, { status: 304, headers });
  }

  const rangeHeader = request.headers.get('Range');
  const range = rangeHeader ? parseByteRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Cache-Control': READ_ONLY_MEDIA_CACHE_CONTROL,
        'Content-Range': `bytes */${size}`,
      },
    });
  }

  if (!range) {
    headers.set('Content-Length', String(size));
    headers.set('Cache-Control', MEDIA_CACHE_CONTROL);
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    const object = await env.MEDIA.get(key);
    if (!object) {
      return mediaNotFound();
    }
    setMediaMetadataHeaders(headers, object, key);
    headers.set('Content-Length', String(object.size ?? size));
    headers.set('Cache-Control', MEDIA_CACHE_CONTROL);
    return new Response(object.body, { status: 200, headers });
  }

  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Cache-Control', READ_ONLY_MEDIA_CACHE_CONTROL);
  if (request.method === 'HEAD') {
    return new Response(null, { status: 206, headers });
  }

  const object = await env.MEDIA.get(key, {
    range: { offset: range.start, length: range.length },
  });
  if (!object) {
    return mediaNotFound();
  }
  setMediaMetadataHeaders(headers, object, key);
  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('Cache-Control', READ_ONLY_MEDIA_CACHE_CONTROL);
  return new Response(object.body, { status: 206, headers });
}

async function handlePublishedBlogMedia(request, env, assetId) {
  if (!env.DB || typeof env.DB.prepare !== 'function') {
    return mediaNotFound();
  }
  const row = await env.DB.prepare(`
    SELECT a.object_key
    FROM blog_assets AS a
    WHERE a.id = ?
      AND a.status = 'ready'
      AND EXISTS (
        SELECT 1
        FROM blog_post_asset_refs AS r
        INNER JOIN blog_posts AS p ON p.id = r.post_id
        WHERE r.asset_id = a.id
          AND r.scope = 'published'
          AND p.status = 'published'
          AND p.published_at <= ?
      )
    LIMIT 1
  `).bind(assetId, new Date().toISOString()).first();
  if (!row || typeof row.object_key !== 'string') {
    return mediaNotFound();
  }
  return handleMedia(request, env, row.object_key);
}

async function handleBlogSettings(request, env) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }
  let motion = 'once';
  try {
    const row = await env.DB.prepare("SELECT value FROM blog_settings WHERE key = 'artwork_motion' LIMIT 1").first();
    if (row?.value === 'off') {
      motion = 'off';
    }
  } catch {
    return errorResponse(503, 'Blog settings unavailable');
  }
  return jsonResponse({ artwork_motion: motion }, 200, { 'Cache-Control': 'public, max-age=60' });
}

function calendarDate(value, key) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${key} must use YYYY-MM-DD`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

function calendarLocalDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calendarYearLater(value) {
  const [year, month, day] = value.split('-').map(Number);
  const horizon = new Date(Date.UTC(year + 1, month - 1, day));
  return horizon.toISOString().slice(0, 10);
}

function calendarRange(url) {
  let start;
  let end;
  try {
    start = calendarDate(url.searchParams.get('start'), 'start');
    end = calendarDate(url.searchParams.get('end'), 'end');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Calendar range is invalid' };
  }
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (end <= start || span < 1 || span > 366) {
    return { error: 'Calendar range must be 1 to 366 days' };
  }
  const utcStart = new Date(`${start}T00:00:00+08:00`).toISOString();
  const utcEnd = new Date(`${end}T00:00:00+08:00`).toISOString();
  return { start, end, utcStart, utcEnd };
}

function mapPublicCalendarEvent(row) {
  if (row.visibility === 'busy') {
    return {
      title: 'Busy',
      visibility: 'busy',
      timezone: row.timezone || 'Asia/Kuala_Lumpur',
      all_day: Number(row.all_day) === 1,
      start_date: row.start_date ?? null,
      end_date: row.end_date ?? null,
      starts_at: row.starts_at ?? null,
      ends_at: row.ends_at ?? null,
    };
  }
  return {
    id: row.id,
    version: Number(row.version),
    title: row.title,
    description: row.description ?? null,
    location: row.location ?? null,
    url: row.url ?? null,
    kind: row.kind,
    timezone: row.timezone || 'Asia/Kuala_Lumpur',
    all_day: Number(row.all_day) === 1,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    visibility: 'public',
    participation: row.participation,
    blocks_availability: Number(row.blocks_availability) === 1,
  };
}

async function handleCalendar(request, env, url) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }
  const range = calendarRange(url);
  if (range.error) {
    return errorResponse(400, range.error);
  }
  if (!env.DB || typeof env.DB.prepare !== 'function') {
    return errorResponse(503, 'Calendar unavailable');
  }
  try {
    const result = await env.DB.prepare(`
      SELECT id, version, title, description, location, url, kind, timezone, all_day,
        start_date, end_date, starts_at, ends_at, visibility, participation, blocks_availability
      FROM calendar_events
      WHERE archived_at IS NULL
        AND visibility IN ('public', 'busy')
        AND (
          (start_date IS NOT NULL AND start_date < ? AND end_date > ?)
          OR (starts_at IS NOT NULL AND starts_at < ? AND ends_at > ?)
        )
      ORDER BY COALESCE(starts_at, start_date) ASC, id ASC
    `).bind(range.end, range.start, range.utcEnd, range.utcStart).all();
    const actualNow = new Date();
    const upcomingStart = actualNow.toISOString();
    const upcomingStartDate = calendarLocalDate(actualNow);
    const upcomingEndDate = calendarYearLater(upcomingStartDate);
    const upcomingEnd = new Date(`${upcomingEndDate}T00:00:00+08:00`).toISOString();
    const upcomingResult = await env.DB.prepare(`
      SELECT id, version, title, description, location, url, kind, timezone, all_day,
        start_date, end_date, starts_at, ends_at, visibility, participation, blocks_availability
      FROM calendar_events
      WHERE archived_at IS NULL
        AND visibility IN ('public', 'busy')
        AND (
          (start_date IS NOT NULL AND start_date < ? AND end_date > ?)
          OR (starts_at IS NOT NULL AND starts_at < ? AND ends_at > ?)
        )
      ORDER BY COALESCE(starts_at, start_date) ASC, id ASC
      LIMIT 3
    `).bind(upcomingEndDate, upcomingStartDate, upcomingEnd, upcomingStart).all();
    return jsonResponse({
      timezone: 'Asia/Kuala_Lumpur',
      events: rowsFromResult(result).map(mapPublicCalendarEvent),
      upcoming: rowsFromResult(upcomingResult).map(mapPublicCalendarEvent),
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  } catch {
    return errorResponse(503, 'Calendar unavailable');
  }
}

async function handlePublishedBlogGallery(request, env, manifestId) {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET');
  }
  if (!env.DB || typeof env.DB.prepare !== 'function') {
    return mediaNotFound();
  }
  const now = new Date().toISOString();
  const manifest = await env.DB.prepare(`
    SELECT m.id, m.revision, m.title, m.created_at
    FROM blog_gallery_manifests AS m
    INNER JOIN blog_post_gallery_refs AS r ON r.manifest_id = m.id AND r.scope = 'published'
    INNER JOIN blog_posts AS p ON p.id = r.post_id
    WHERE m.id = ? AND p.status = 'published' AND p.published_at <= ?
    LIMIT 1
  `).bind(manifestId, now).first();
  if (!manifest) {
    return errorResponse(404, 'Not Found');
  }
  const pages = await env.DB.prepare(`
    SELECT page_id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id
    FROM blog_gallery_manifest_pages WHERE manifest_id = ? AND visible = 1
    ORDER BY sort_order ASC, original_page ASC
  `).bind(manifestId).all();
  return jsonResponse({
    id: manifest.id,
    manifestId: manifest.id,
    revision: Number(manifest.revision),
    title: manifest.title,
    created_at: manifest.created_at,
    pages: rowsFromResult(pages).map(page => ({
      id: page.page_id,
      original_page: Number(page.original_page),
      title: page.title ?? null,
      caption: page.caption ?? null,
      order: Number(page.sort_order),
      visible: Number(page.visible) === 1,
      asset_id: page.asset_id,
      thumbnail_asset_id: page.thumbnail_asset_id,
      original_url: `/media/blog/${encodeURIComponent(page.asset_id)}`,
      thumbnail_url: page.thumbnail_asset_id
        ? `/media/blog/${encodeURIComponent(page.thumbnail_asset_id)}`
        : `/media/blog/${encodeURIComponent(page.asset_id)}`,
    })),
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function handleApi(request, env, url) {
  const pathname = url.pathname;

  if (pathname === '/api/blog/settings' || pathname === '/api/blog/settings/') {
    return handleBlogSettings(request, env);
  }

  if (pathname === '/api/blog/categories' || pathname === '/api/blog/categories/') {
    return handleCategories(request, env);
  }

  if (pathname === '/api/calendar' || pathname === '/api/calendar/') {
    return handleCalendar(request, env, url);
  }

  if (pathname === '/api/blog/posts' || pathname === '/api/blog/posts/') {
    return handlePosts(request, env);
  }

  const postsPrefix = '/api/blog/posts/';
  if (pathname.startsWith(postsPrefix)) {
    const rawSlug = pathname.slice(postsPrefix.length);
    if (!rawSlug || rawSlug.includes('/')) {
      return errorResponse(404, 'Not Found');
    }

    let slug;
    try {
      slug = decodeURIComponent(rawSlug);
    } catch {
      return errorResponse(400, 'Malformed post slug');
    }
    return handlePosts(request, env, slug);
  }

  const galleriesPrefix = '/api/blog/galleries/';
  if (pathname.startsWith(galleriesPrefix)) {
    const rawManifestId = pathname.slice(galleriesPrefix.length);
    if (!rawManifestId || rawManifestId.includes('/')) {
      return errorResponse(404, 'Not Found');
    }
    let manifestId;
    try {
      manifestId = decodeURIComponent(rawManifestId);
    } catch {
      return errorResponse(400, 'Malformed gallery manifest id');
    }
    if (!/^[\w-]+$/.test(manifestId)) {
      return errorResponse(404, 'Not Found');
    }
    return handlePublishedBlogGallery(request, env, manifestId);
  }

  if (pathname === '/api/profile-metrics' || pathname === '/api/profile-metrics/') {
    return handleProfileMetrics(request, env, url);
  }

  return errorResponse(404, 'Not Found');
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    const { handlePortfolioAuth } = await import('./auth.js');
    return handlePortfolioAuth(request, env);
  }

  if (url.pathname === '/api/judging-sync/pair' || url.pathname.startsWith('/api/judging-sync/sdc-2026/')) {
    const { handleJudgingSyncGateway } = await import('./admin-gateway.js');
    return handleJudgingSyncGateway(request, env);
  }

  if (url.pathname === '/api/events') {
    const { handleAnalyticsGateway } = await import('./admin-gateway.js');
    return handleAnalyticsGateway(request, env);
  }
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) {
    const { handleAdminGateway } = await import('./admin-gateway.js');
    return handleAdminGateway(request, env);
  }

  if (url.pathname === '/api/exepert' || url.pathname.startsWith('/api/exepert/')) {
    const { handleExepert } = await import('./exepert/gateway.js');
    return handleExepert(request, env, url);
  }

  if (url.pathname.startsWith('/api/')) {
    return handleApi(request, env, url);
  }

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(url.pathname);
  } catch {
    return errorResponse(400, 'Malformed media URL');
  }
  if (isPrivateBlogOriginalPath(decodedPathname)) {
    return mediaNotFound();
  }
  if (decodedPathname.startsWith('/media/blog/')) {
    const assetId = decodedPathname.slice('/media/blog/'.length);
    if (!assetId) {
      return mediaNotFound();
    }
    if (!assetId.includes('/')) {
      return handlePublishedBlogMedia(request, env, assetId);
    }
  }

  const media = mediaKeyForRequest(url);
  if (media?.error) {
    return errorResponse(400, media.error);
  }
  if (media?.key) {
    return handleMedia(request, env, media.key);
  }

  return handleStatic(request, env, url);
}

export async function fetch(request, env, ctx) {
  try {
    return await handleRequest(request, env, ctx);
  } catch (error) {
    console.error('Worker request failed', error);
    return errorResponse(500, 'Internal Server Error');
  }
}

export default { fetch };

// EXEPERT multiplayer Durable Objects (bound in wrangler.jsonc).
export { ExepertRoom } from './exepert/room-do.js';
export { ExepertLobby } from './exepert/lobby-do.js';
