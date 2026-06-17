import {
  fetchBlogCategories,
  fetchPublishedBlogPosts,
  formatPublishedDate,
  getPostCategory,
} from './blog-data.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderCategories(container, categories) {
  container.innerHTML = [
    '<button class="category-btn active" data-category="all">All</button>',
    ...categories.map((category) => (
      `<button class="category-btn" data-category="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</button>`
    )),
  ].join('');
}

function renderPosts(container, posts) {
  if (!posts.length) {
    container.innerHTML = '<p class="blog-state-message">No published blog posts yet.</p>';
    return;
  }

  container.innerHTML = posts.map((post) => {
    const category = getPostCategory(post);
    const categorySlug = category?.slug ?? 'uncategorized';
    const categoryName = category?.name ?? 'Uncategorized';
    const postHref = `/blog/${encodeURIComponent(post.slug)}`;
    const imageUrl = post.cover_image_url || '/blog/blogpic/pic3.jpg';
    const imageAlt = post.cover_image_alt || post.title;

    return `
      <div class="blog-card" data-category="${escapeHtml(categorySlug)}">
        <div class="blog-card-image-wrapper">
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}" class="blog-card-image">
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
      </div>
    `;
  }).join('');
}

async function initBlogListing() {
  const filtersContainer = document.querySelector('[data-blog-filters]');
  const postsContainer = document.querySelector('[data-blog-posts]');

  if (!filtersContainer || !postsContainer) return;

  postsContainer.innerHTML = '<p class="blog-state-message">Loading blog posts...</p>';

  try {
    const [categories, posts] = await Promise.all([
      fetchBlogCategories(),
      fetchPublishedBlogPosts(),
    ]);

    renderCategories(filtersContainer, categories);
    renderPosts(postsContainer, posts);
    document.dispatchEvent(new CustomEvent('blog:rendered'));
  } catch (error) {
    console.warn('Unable to load blog posts:', error);
    postsContainer.innerHTML = '<p class="blog-state-message">Unable to load blog posts right now.</p>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBlogListing);
} else {
  initBlogListing();
}
