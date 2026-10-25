(function () {
  function normaliseCategory(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function getFilterElements() {
    const filters = document.querySelector('[data-blog-filters]');
    const posts = document.querySelector('[data-blog-posts]');

    if (!filters || !posts) return null;

    return { filters, posts };
  }

  function setActiveButtons(buttons, selectedCategory) {
    buttons.forEach((button) => {
      const isActive = normaliseCategory(button.dataset.category) === selectedCategory;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function syncEmptyState(posts, cards, visibleCount) {
    let emptyState = posts.querySelector('[data-filter-empty]');

    if (!cards.length || visibleCount) {
      if (emptyState) emptyState.hidden = true;
      return;
    }

    if (!emptyState) {
      emptyState = document.createElement('p');
      emptyState.className = 'blog-state-message blog-state-message--empty';
      emptyState.dataset.filterEmpty = 'true';
      emptyState.setAttribute('role', 'status');
      emptyState.textContent = 'No blog posts in this category yet.';
      posts.appendChild(emptyState);
    }

    emptyState.hidden = false;
  }

  function applyBlogFilter(selectedCategory, elements) {
    const filter = normaliseCategory(selectedCategory) || 'all';
    const buttons = Array.from(elements.filters.querySelectorAll('.category-btn'));
    const cards = Array.from(elements.posts.querySelectorAll('.blog-card'));
    let visibleCount = 0;

    setActiveButtons(buttons, filter);
    elements.filters.dataset.activeCategory = filter;

    cards.forEach((card) => {
      const matches = filter === 'all'
        || normaliseCategory(card.dataset.category) === filter;

      card.hidden = !matches;
      card.classList.toggle('is-filtered', !matches);
      card.dataset.filterState = matches ? 'visible' : 'hidden';

      if (matches) visibleCount += 1;
    });

    elements.posts.dataset.filterState = cards.length
      ? (visibleCount ? 'ready' : 'empty')
      : (elements.posts.dataset.blogState || 'empty');
    syncEmptyState(elements.posts, cards, visibleCount);
  }

  function initBlogFilters() {
    const elements = getFilterElements();

    if (!elements) return;

    if (elements.filters.dataset.filterBound !== 'true') {
      elements.filters.addEventListener('click', (event) => {
        const button = event.target?.closest?.('.category-btn');

        if (!button || !elements.filters.contains(button)) return;

        applyBlogFilter(button.dataset.category, elements);
      });
      elements.filters.dataset.filterBound = 'true';
    }

    const currentCategory = normaliseCategory(
      elements.filters.dataset.activeCategory
      || elements.filters.querySelector('.category-btn.active')?.dataset.category
      || 'all',
    );

    applyBlogFilter(currentCategory, elements);
  }

  window.initBlogFilters = initBlogFilters;

  document.addEventListener('DOMContentLoaded', initBlogFilters);
  document.addEventListener('blog:rendered', initBlogFilters);
}());
