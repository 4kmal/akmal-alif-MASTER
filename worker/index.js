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
      SELECT slug, name, color_class, sort_order
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

  return { key };
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
    // Older databases default to the existing once-per-session behavior until
    // the additive studio migration is applied.
  }
  return jsonResponse({ artwork_motion: motion }, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function handleApi(request, env, url) {
  const pathname = url.pathname;

  if (pathname === '/api/blog/settings' || pathname === '/api/blog/settings/') {
    return handleBlogSettings(request, env);
  }

  if (pathname === '/api/blog/categories' || pathname === '/api/blog/categories/') {
    return handleCategories(request, env);
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

  if (pathname === '/api/profile-metrics' || pathname === '/api/profile-metrics/') {
    return handleProfileMetrics(request, env, url);
  }

  return errorResponse(404, 'Not Found');
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === '/api/events') {
    const { handleAnalyticsGateway } = await import('./admin-gateway.js');
    return handleAnalyticsGateway(request, env);
  }
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) {
    const { handleAdminGateway } = await import('./admin-gateway.js');
    return handleAdminGateway(request, env);
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
