import { fetchPublishedBlogPost, formatPublishedDate } from './blog-data.js';

function getCurrentSlug() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const slug = segments[segments.length - 1] || '';
  return slug.replace(/\.html$/, '');
}

function setOrCreateMeta(name, content) {
  if (!content) return;

  let meta = document.querySelector(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', name);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

function setOrCreateCanonical(path) {
  if (!path) return;

  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', `${window.location.origin}${path}`);
}

async function initBlogPost() {
  const title = document.querySelector('[data-blog-title]');
  const meta = document.querySelector('[data-blog-meta]');
  const content = document.querySelector('[data-blog-content]');

  if (!title || !meta || !content) return;

  content.innerHTML = '<p class="blog-state-message">Loading blog post...</p>';

  try {
    const post = await fetchPublishedBlogPost(getCurrentSlug());

    if (!post) {
      title.textContent = 'Blog Post Not Found';
      meta.textContent = '';
      content.innerHTML = '<p class="blog-state-message">This blog post is not available.</p>';
      document.title = 'Blog Post Not Found - Akmal Alif';
      return;
    }

    title.textContent = post.title;
    meta.textContent = `Published at ${formatPublishedDate(post.published_at)}`;
    content.innerHTML = post.content_html || '<p class="blog-state-message">No content available.</p>';
    document.title = post.meta_title || `${post.title} - Akmal Alif`;
    setOrCreateMeta('description', post.meta_description || post.excerpt);
    setOrCreateCanonical(post.canonical_path || `/blog/${post.slug}`);
  } catch (error) {
    console.warn('Unable to load blog post:', error);
    title.textContent = 'Unable to Load Blog Post';
    meta.textContent = '';
    content.innerHTML = '<p class="blog-state-message">Unable to load this blog post right now.</p>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBlogPost);
} else {
  initBlogPost();
}
