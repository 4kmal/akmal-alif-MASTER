import {
  fetchBlogCategories,
  fetchPublishedBlogPosts,
  formatPublishedDate,
  getPostCategory,
} from './blog-data.js';
import {
  initBlogArtworkMotion,
  renderBlogFilterIcon,
  renderBlogSprite,
  resolveBlogThumbnail,
} from './blog-artwork.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normaliseCategories(categories) {
  const uniqueCategories = [];
  const seenSlugs = new Set();

  for (const category of Array.isArray(categories) ? categories : []) {
    const slug = String(category?.slug ?? '').trim();
    const name = String(category?.name ?? '').trim();

    if (!slug || !name || seenSlugs.has(slug)) continue;

    seenSlugs.add(slug);
    uniqueCategories.push({ slug, name });
  }

  return uniqueCategories;
}

function renderCategories(container, categories) {
  const uniqueCategories = normaliseCategories(categories);

  container.innerHTML = [
    `<button type="button" class="category-btn active" data-category="all" aria-pressed="true">${renderBlogFilterIcon('all')}<span>All</span></button>`,
    ...uniqueCategories.map((category) => (
      `<button type="button" class="category-btn" data-category="${escapeHtml(category.slug)}" aria-pressed="false">${renderBlogFilterIcon(category.slug)}<span>${escapeHtml(category.name)}</span></button>`
    )),
  ].join('');
}

function renderResolvedThumbnail(thumbnail) {
  if (thumbnail.type === 'sprite') {
    return renderBlogSprite(thumbnail.artwork);
  }

  return `<img src="${escapeHtml(thumbnail.src)}" alt="${escapeHtml(thumbnail.alt)}" class="blog-card-image">`;
}

function renderPosts(container, posts) {
  if (!Array.isArray(posts) || !posts.length) {
    container.innerHTML = '<p class="blog-state-message blog-state-message--empty" data-blog-state="empty" role="status">No published blog posts yet.</p>';
    return;
  }

  container.innerHTML = posts.map((post) => {
    const category = getPostCategory(post);
    const categorySlug = String(category?.slug ?? 'uncategorized').trim() || 'uncategorized';
    const categoryName = String(category?.name ?? 'Uncategorized').trim() || 'Uncategorized';
    const postSlug = String(post?.slug ?? '').trim();
    const postHref = `/blog/${encodeURIComponent(postSlug)}`;
    const thumbnail = resolveBlogThumbnail(post);
    const artworkClass = thumbnail.type === 'sprite' ? ' blog-card--sprite' : '';

    return `
      <article class="blog-card${artworkClass}" data-category="${escapeHtml(categorySlug)}" data-blog-state="ready">
        <div class="blog-card-image-wrapper">
          ${renderResolvedThumbnail(thumbnail)}
        </div>
        <div class="blog-card-content">
          <h2 class="post-title"><a href="${postHref}">${escapeHtml(post.title)}</a></h2>
          <p class="post-meta">
            <span class="post-date">${escapeHtml(formatPublishedDate(post.published_at))}</span>
            <span class="post-read-time">${escapeHtml(post.read_minutes)} min read</span>
          </p>
          <div class="blog-category-tag ${escapeHtml(categorySlug)}">${escapeHtml(categoryName)}</div>
          <p class="post-excerpt">${escapeHtml(post.excerpt)}</p>
          <a href="${postHref}" class="read-more-button">Read Full Post</a>
        </div>
      </article>
    `;
  }).join('');
}

function renderStateMessage(container, state, message) {
  const role = state === 'error' ? 'alert' : 'status';
  container.innerHTML = `<p class="blog-state-message blog-state-message--${escapeHtml(state)}" data-blog-state="${escapeHtml(state)}" role="${role}">${escapeHtml(message)}</p>`;
}

function deriveCategories(posts) {
  return normaliseCategories(
    (Array.isArray(posts) ? posts : []).map((post) => getPostCategory(post)),
  );
}

function emitRendered(state) {
  initBlogArtworkMotion();
  document.dispatchEvent(new CustomEvent('blog:rendered', {
    detail: { state },
  }));
}

async function initBlogListing() {
  const filtersContainer = document.querySelector('[data-blog-filters]');
  const postsContainer = document.querySelector('[data-blog-posts]');

  if (!filtersContainer || !postsContainer) return;

  renderStateMessage(postsContainer, 'loading', 'Loading blog posts…');

  try {
    const [categoriesResult, postsResult] = await Promise.allSettled([
      fetchBlogCategories(),
      fetchPublishedBlogPosts(),
    ]);

    if (categoriesResult.status === 'rejected') {
      console.warn('Unable to load blog categories:', categoriesResult.reason);
    }

    if (postsResult.status === 'rejected') {
      renderCategories(filtersContainer, []);
      renderStateMessage(postsContainer, 'error', 'Unable to load blog posts right now.');
      emitRendered('error');
      return;
    }

    if (!Array.isArray(postsResult.value)) {
      console.warn('Blog posts response was not an array.');
      renderCategories(filtersContainer, []);
      renderStateMessage(postsContainer, 'error', 'Unable to load blog posts right now.');
      emitRendered('error');
      return;
    }

    const posts = postsResult.value;
    const categories = categoriesResult.status === 'fulfilled'
      && Array.isArray(categoriesResult.value)
      && categoriesResult.value.length
      ? categoriesResult.value
      : deriveCategories(posts);

    renderCategories(filtersContainer, categories);
    renderPosts(postsContainer, posts);
    emitRendered(posts.length ? 'ready' : 'empty');
  } catch (error) {
    console.warn('Unable to load blog posts:', error);
    renderCategories(filtersContainer, []);
    renderStateMessage(postsContainer, 'error', 'Unable to load blog posts right now.');
    emitRendered('error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBlogListing);
} else {
  initBlogListing();
}
