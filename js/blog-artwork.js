export const LEGACY_BLOG_THUMBNAIL = '/blog/blogpic/pic3.jpg';
export const BLOG_ARTWORK_STORAGE_KEY = 'blog-artwork-paused';

const LEGACY_BLOG_THUMBNAIL_PATH = LEGACY_BLOG_THUMBNAIL;
const CANONICAL_BLOG_HOSTNAMES = new Set(['akmalalif.com', 'www.akmalalif.com']);
const BLOG_ARTWORK_BY_SLUG = Object.freeze({
  'versatility-humanoid-robots': 'robot-workstation',
  'hexapod-robots-military': 'hexapod',
  'work-life-balance-burnout': 'burnout-desk',
});

const BLOG_ARTWORK_SVGS = Object.freeze({
  'robot-workstation': `
    <svg class="blog-card-sprite blog-card-sprite--robot-workstation" data-blog-artwork="robot-workstation" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="26" y="137" width="268" height="5" />
      <rect class="blog-artwork-surface" x="50" y="128" width="220" height="9" />
      <rect class="blog-artwork-deep" x="86" y="54" width="70" height="59" />
      <rect class="blog-artwork-bg" x="94" y="62" width="54" height="37" />
      <rect class="blog-artwork-line" x="101" y="70" width="40" height="3" />
      <rect class="blog-artwork-line" x="105" y="80" width="21" height="7" />
      <rect class="blog-artwork-line" x="130" y="80" width="11" height="7" />
      <rect class="blog-artwork-deep" x="112" y="113" width="18" height="15" />
      <g class="blog-artwork-robot">
        <rect class="blog-artwork-mid" x="170" y="90" width="28" height="30" />
        <rect class="blog-artwork-deep" x="176" y="77" width="16" height="13" />
        <rect class="blog-artwork-accent" x="180" y="81" width="3" height="3" />
        <rect class="blog-artwork-accent" x="187" y="81" width="3" height="3" />
        <rect class="blog-artwork-deep" x="168" y="118" width="8" height="17" />
        <rect class="blog-artwork-deep" x="192" y="118" width="8" height="17" />
        <rect class="blog-artwork-mid" x="163" y="94" width="7" height="18" />
        <rect class="blog-artwork-mid" x="198" y="94" width="7" height="18" />
      </g>
      <g class="blog-artwork-motion blog-artwork-motion--blink" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="104" y="80" width="21" height="7" />
      </g>
    </svg>`,
  hexapod: `
    <svg class="blog-card-sprite blog-card-sprite--hexapod" data-blog-artwork="hexapod" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="28" y="139" width="264" height="4" />
      <rect class="blog-artwork-line" x="56" y="124" width="208" height="5" />
      <g class="blog-artwork-hexapod">
        <rect class="blog-artwork-deep" x="104" y="74" width="112" height="43" />
        <rect class="blog-artwork-mid" x="117" y="63" width="84" height="17" />
        <rect class="blog-artwork-accent" x="135" y="68" width="16" height="5" />
        <rect class="blog-artwork-line" x="157" y="68" width="28" height="5" />
        <rect class="blog-artwork-mid" x="97" y="84" width="9" height="22" />
        <rect class="blog-artwork-mid" x="214" y="84" width="9" height="22" />
        <rect class="blog-artwork-deep" x="119" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="149" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="180" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="208" y="113" width="10" height="22" />
      </g>
      <g class="blog-artwork-motion blog-artwork-motion--leg" data-blog-artwork-motion>
        <rect class="blog-artwork-deep" x="106" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="194" y="113" width="10" height="22" />
      </g>
    </svg>`,
  'burnout-desk': `
    <svg class="blog-card-sprite blog-card-sprite--burnout-desk" data-blog-artwork="burnout-desk" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="26" y="138" width="268" height="5" />
      <rect class="blog-artwork-surface" x="46" y="126" width="228" height="10" />
      <rect class="blog-artwork-deep" x="82" y="58" width="84" height="57" />
      <rect class="blog-artwork-bg" x="92" y="68" width="64" height="34" />
      <rect class="blog-artwork-line" x="101" y="77" width="45" height="4" />
      <rect class="blog-artwork-line" x="101" y="86" width="30" height="4" />
      <rect class="blog-artwork-accent" x="101" y="95" width="14" height="4" />
      <rect class="blog-artwork-mid" x="117" y="95" width="25" height="4" />
      <rect class="blog-artwork-deep" x="115" y="115" width="18" height="11" />
      <rect class="blog-artwork-mid" x="219" y="111" width="24" height="17" />
      <rect class="blog-artwork-deep" x="224" y="106" width="14" height="8" />
      <g class="blog-artwork-motion blog-artwork-motion--steam" data-blog-artwork-motion>
        <rect class="blog-artwork-line" x="225" y="94" width="4" height="10" />
        <rect class="blog-artwork-line" x="235" y="88" width="4" height="16" />
      </g>
    </svg>`,
});

const BLOG_FILTER_ICONS = Object.freeze({
  all: `
    <svg class="blog-filter-icon blog-filter-icon--all" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="6" height="6" fill="currentColor" />
      <rect x="12" y="2" width="6" height="6" fill="currentColor" />
      <rect x="2" y="12" width="6" height="6" fill="currentColor" />
      <rect x="12" y="12" width="6" height="6" fill="currentColor" />
    </svg>`,
  psychology: `
    <svg class="blog-filter-icon blog-filter-icon--psychology" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6 3h6v2h3v3h2v5h-3v3H8v-2H5v-3H3V7h3V3Z" fill="currentColor" />
      <rect x="8" y="7" width="2" height="2" fill="var(--blog-accent)" />
      <rect x="12" y="10" width="2" height="2" fill="var(--blog-accent)" />
    </svg>`,
  'machine-learning': `
    <svg class="blog-filter-icon blog-filter-icon--machine-learning" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="10" height="10" fill="currentColor" />
      <rect x="8" y="8" width="4" height="4" fill="var(--blog-accent)" />
      <path d="M2 7h3v2H2V7Zm0 4h3v2H2v-2Zm13-4h3v2h-3V7Zm0 4h3v2h-3v-2ZM7 2h2v3H7V2Zm4 0h2v3h-2V2ZM7 15h2v3H7v-3Zm4 0h2v3h-2v-3Z" fill="currentColor" />
    </svg>`,
  neuroscience: `
    <svg class="blog-filter-icon blog-filter-icon--neuroscience" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m4 5 5 3m2 0 5-3M4 15l5-3m2 0 5 3M9 8v4m2-4v4" stroke="currentColor" stroke-width="2" fill="none" />
      <rect x="2" y="3" width="4" height="4" fill="currentColor" />
      <rect x="14" y="3" width="4" height="4" fill="currentColor" />
      <rect x="2" y="13" width="4" height="4" fill="currentColor" />
      <rect x="14" y="13" width="4" height="4" fill="currentColor" />
      <rect x="8" y="8" width="4" height="4" fill="var(--blog-accent)" />
    </svg>`,
});

function normaliseLegacyPath(value) {
  const source = String(value ?? '').trim();
  if (!source) return '';

  try {
    const parsed = new URL(source, 'https://www.akmalalif.com');
    const isRelative = !/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('//');

    if (!isRelative && !CANONICAL_BLOG_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
      return '';
    }

    return parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function isLegacyBlogThumbnail(value) {
  return normaliseLegacyPath(value) === LEGACY_BLOG_THUMBNAIL_PATH;
}

export function resolveBlogThumbnail(post) {
  const slug = String(post?.slug ?? '').trim();
  const coverUrl = String(post?.cover_image_url ?? '').trim();
  const artwork = BLOG_ARTWORK_BY_SLUG[slug];

  if (artwork && (!coverUrl || isLegacyBlogThumbnail(coverUrl))) {
    return { type: 'sprite', artwork };
  }

  return {
    type: 'image',
    src: coverUrl || LEGACY_BLOG_THUMBNAIL,
    alt: String(post?.cover_image_alt || post?.title || 'Blog post'),
  };
}

export function renderBlogSprite(artwork) {
  return BLOG_ARTWORK_SVGS[artwork] ?? '';
}

export function renderBlogFilterIcon(slug) {
  return BLOG_FILTER_ICONS[String(slug ?? '').trim().toLowerCase()] ?? '';
}

function getLocalStorage(windowRef) {
  try {
    return windowRef?.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPaused(storage) {
  try {
    return storage?.getItem(BLOG_ARTWORK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writePaused(storage, paused) {
  try {
    storage?.setItem(BLOG_ARTWORK_STORAGE_KEY, String(paused));
  } catch {
    // Keep the in-memory preference when browser storage is unavailable.
  }
}

function getReducedMotion(windowRef) {
  return windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
}

function isCardFiltered(sprite) {
  const card = sprite.closest?.('.blog-card');
  return Boolean(card?.hidden)
    || card?.dataset?.filterState === 'hidden'
    || card?.classList?.contains?.('is-filtered') === true;
}

function listArtwork(root) {
  return Array.from(root?.querySelectorAll?.('[data-blog-artwork]') ?? []);
}

export function createBlogArtworkMotionController({
  root,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  intersectionObserver = windowRef?.IntersectionObserver ?? globalThis.IntersectionObserver,
  mutationObserver = windowRef?.MutationObserver ?? globalThis.MutationObserver,
  storage = getLocalStorage(windowRef),
  mediaQuery = getReducedMotion(windowRef),
} = {}) {
  if (!root) return null;

  const visible = new Map();
  const observed = new Set();
  const state = {
    disposed: false,
    documentHidden: Boolean(documentRef?.hidden),
    reducedMotion: Boolean(mediaQuery?.matches),
    userPaused: readPaused(storage),
  };
  const IntersectionObserverRef = intersectionObserver;
  const MutationObserverRef = mutationObserver;
  const observer = typeof IntersectionObserverRef === 'function'
    ? new IntersectionObserverRef((entries) => {
      if (state.disposed) return;

      entries.forEach((entry) => visible.set(entry.target, entry.isIntersecting));
      updatePlayback();
    }, { threshold: 0.01 })
    : null;
  const mutations = typeof MutationObserverRef === 'function'
    ? new MutationObserverRef(() => refresh())
    : null;
  const toggle = documentRef?.querySelector?.('[data-blog-artwork-toggle]') ?? null;

  function shouldPlay(sprite) {
    return !state.documentHidden
      && !state.reducedMotion
      && !state.userPaused
      && !isCardFiltered(sprite)
      && (observer ? visible.get(sprite) === true : true);
  }

  function updateToggle() {
    if (!toggle) return;

    if (state.reducedMotion) {
      toggle.disabled = true;
      toggle.textContent = 'Animations disabled';
      toggle.setAttribute('aria-label', 'Animations disabled because reduced motion is enabled');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.dataset.motionState = 'disabled';
      return;
    }

    toggle.disabled = false;
    toggle.textContent = state.userPaused ? 'Resume animations' : 'Pause animations';
    toggle.setAttribute('aria-label', toggle.textContent);
    toggle.setAttribute('aria-pressed', String(state.userPaused));
    toggle.dataset.motionState = state.userPaused ? 'paused' : 'playing';
  }

  function updatePlayback() {
    if (state.disposed) return;

    listArtwork(root).forEach((sprite) => {
      sprite.dataset.artworkMotionState = shouldPlay(sprite) ? 'playing' : 'paused';
    });
    updateToggle();
  }

  function refresh() {
    if (state.disposed) return;

    const sprites = listArtwork(root);
    const current = new Set(sprites);
    visible.forEach((_isVisible, sprite) => {
      if (!current.has(sprite)) {
        visible.delete(sprite);
        observed.delete(sprite);
        observer?.unobserve?.(sprite);
      }
    });

    sprites.forEach((sprite) => {
      if (!visible.has(sprite)) visible.set(sprite, observer ? false : true);
      if (observer && !observed.has(sprite)) {
        observer.observe(sprite);
        observed.add(sprite);
      }
    });
    updatePlayback();
  }

  function togglePlayback() {
    if (state.disposed || state.reducedMotion) return state.userPaused;

    state.userPaused = !state.userPaused;
    writePaused(storage, state.userPaused);
    updatePlayback();
    return state.userPaused;
  }

  function handleVisibilityChange() {
    if (state.disposed) return;

    state.documentHidden = Boolean(documentRef?.hidden);
    updatePlayback();
  }

  function handleMotionChange(event) {
    if (state.disposed) return;

    state.reducedMotion = Boolean(event.matches);
    updatePlayback();
  }

  function dispose() {
    if (state.disposed) return;

    state.disposed = true;
    listArtwork(root).forEach((sprite) => {
      sprite.dataset.artworkMotionState = 'paused';
    });
    observer?.disconnect();
    observed.clear();
    mutations?.disconnect();
    documentRef?.removeEventListener?.('visibilitychange', handleVisibilityChange);
    mediaQuery?.removeEventListener?.('change', handleMotionChange);
    mediaQuery?.removeListener?.(handleMotionChange);
    toggle?.removeEventListener?.('click', togglePlayback);
  }

  documentRef?.addEventListener?.('visibilitychange', handleVisibilityChange);
  if (mediaQuery?.addEventListener) mediaQuery.addEventListener('change', handleMotionChange);
  else mediaQuery?.addListener?.(handleMotionChange);
  mutations?.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-filter-state', 'hidden'],
  });
  toggle?.addEventListener?.('click', togglePlayback);
  refresh();

  return {
    dispose,
    refresh,
    togglePlayback,
    getState: () => ({ ...state }),
    getArtworkState: (sprite) => sprite?.dataset?.artworkMotionState ?? null,
  };
}

const controllers = new WeakMap();

export function initBlogArtworkMotion(documentRef = globalThis.document) {
  const root = documentRef?.querySelector?.('[data-blog-posts]');
  if (!root) return null;

  const existing = controllers.get(root);
  if (existing) {
    if (!existing.getState().disposed) {
      existing.refresh();
      return existing;
    }

    controllers.delete(root);
  }

  const controller = createBlogArtworkMotionController({ root, documentRef, windowRef: documentRef?.defaultView ?? globalThis.window });
  if (controller) controllers.set(root, controller);
  return controller;
}

export function disposeBlogArtworkMotion(documentRef = globalThis.document) {
  const root = documentRef?.querySelector?.('[data-blog-posts]');
  const controller = root ? controllers.get(root) : null;
  controller?.dispose();
  if (root) controllers.delete(root);
}
