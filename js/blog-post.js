import { fetchPublishedBlogPost, formatPublishedDate, getPostCategory } from './blog-data.js';
import {
  clearBlogOutline,
  getBlogHeadings,
  renderBlogOutline,
} from './blog-reader.js';
import { disposeBlogGalleries, initBlogGalleries } from './blog-gallery.js';
import { disposeYouTubeEmbeds, initYouTubeEmbeds } from './youtube-embed.js';

const pageStates = new WeakMap();

function getPageState(documentRef) {
  let state = pageStates.get(documentRef);
  if (!state) {
    state = { requestId: 0, resolvedHash: '' };
    pageStates.set(documentRef, state);
  }
  return state;
}

function getCurrentSlug(windowRef) {
  const segments = windowRef?.location?.pathname?.split('/').filter(Boolean) || [];
  const slug = segments[segments.length - 1] || '';
  return slug.replace(/\.html$/, '');
}

function setOrCreateMeta(documentRef, name, content) {
  if (!content || !documentRef?.head) return;

  let meta = documentRef.querySelector(`meta[name="${name}"]`);
  if (!meta) {
    meta = documentRef.createElement('meta');
    meta.setAttribute('name', name);
    documentRef.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

function setOrCreateCanonical(documentRef, windowRef, path) {
  if (!path || !documentRef?.head) return;

  let canonical = documentRef.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = documentRef.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    documentRef.head.appendChild(canonical);
  }
  canonical.setAttribute('href', `${windowRef?.location?.origin || ''}${path}`);
}

function formatPostMeta(post, formatDate) {
  const parts = [];
  const published = formatDate(post?.published_at);
  const category = getPostCategory(post);

  if (published) parts.push(`Published ${published}`);
  if (category?.name) parts.push(category.name);

  const readMinutes = Number(post?.read_minutes);
  if (Number.isFinite(readMinutes) && readMinutes > 0) {
    parts.push(`${readMinutes} min read`);
  }

  return parts.join(' · ');
}

function getHashId(windowRef) {
  const hash = windowRef?.location?.hash || '';
  if (!hash || hash === '#') return { hash: '', id: '' };

  const encodedId = hash.slice(1);
  try {
    return { hash, id: decodeURIComponent(encodedId) };
  } catch {
    return { hash, id: encodedId };
  }
}

function resolveInitialHash(documentRef, windowRef, state) {
  const { hash, id } = getHashId(windowRef);
  if (!hash || !id || state.resolvedHash === hash) return;

  const target = documentRef.getElementById?.(id);
  if (!target) return;

  target.focus?.({ preventScroll: true });
  target.scrollIntoView?.({ behavior: 'auto', block: 'start' });
  state.resolvedHash = hash;
}

function getDocumentRef(documentRef) {
  if (documentRef) return documentRef;
  return typeof document === 'undefined' ? null : document;
}

function getWindowRef(windowRef) {
  if (windowRef) return windowRef;
  return typeof window === 'undefined' ? null : window;
}

export async function initBlogPost({
  documentRef: suppliedDocument,
  windowRef: suppliedWindow,
  fetchPost = fetchPublishedBlogPost,
  formatDate = formatPublishedDate,
} = {}) {
  const documentRef = getDocumentRef(suppliedDocument);
  const windowRef = getWindowRef(suppliedWindow);
  if (!documentRef) return;

  const title = documentRef.querySelector('[data-blog-title]');
  const meta = documentRef.querySelector('[data-blog-meta]');
  const content = documentRef.querySelector('[data-blog-content]');
  const outline = documentRef.querySelector('#blog-outline-container');

  if (!title || !meta || !content) return;

  const state = getPageState(documentRef);
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  clearBlogOutline(outline);
  disposeBlogGalleries(content);
  disposeYouTubeEmbeds(content);
  content.innerHTML = '<p class="blog-state-message">Loading blog post...</p>';

  try {
    const post = await fetchPost(getCurrentSlug(windowRef));
    if (requestId !== state.requestId) return;

    if (!post || typeof post !== 'object') {
      title.textContent = 'Blog Post Not Found';
      meta.textContent = '';
      content.innerHTML = '<p class="blog-state-message">This blog post is not available.</p>';
      clearBlogOutline(outline);
      documentRef.title = 'Blog Post Not Found - Akmal Alif';
      return;
    }

    title.textContent = post.title || 'Untitled Blog Post';
    meta.textContent = formatPostMeta(post, formatDate);
    content.innerHTML = typeof post.content_html === 'string' && post.content_html
      ? post.content_html
      : '<p class="blog-state-message">No content available.</p>';

    initBlogGalleries(content);
    initYouTubeEmbeds(content);

    const headings = getBlogHeadings(content);
    renderBlogOutline({ container: outline, headings, documentRef, windowRef });
    resolveInitialHash(documentRef, windowRef, state);

    documentRef.title = post.meta_title || `${post.title || 'Blog Post'} - Akmal Alif`;
    setOrCreateMeta(documentRef, 'description', post.meta_description || post.excerpt);
    setOrCreateCanonical(documentRef, windowRef, post.canonical_path || `/blog/${post.slug}`);
  } catch (error) {
    if (requestId !== state.requestId) return;
    console.warn('Unable to load blog post:', error);
    title.textContent = 'Unable to Load Blog Post';
    meta.textContent = '';
    content.innerHTML = '<p class="blog-state-message">Unable to load this blog post right now.</p>';
    initBlogGalleries(content);
    initYouTubeEmbeds(content);
    clearBlogOutline(outline);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initBlogPost(), { once: true });
  } else {
    initBlogPost();
  }
}
