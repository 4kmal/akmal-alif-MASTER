function readAttribute(node, name) {
  if (!node) return '';
  if (typeof node.getAttribute === 'function') return node.getAttribute(name) || '';
  return node[name] || '';
}

function normalizeHeadingText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugifyHeading(value) {
  const slug = normalizeHeadingText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return '';
  return /^\d/.test(slug) ? `section-${slug}` : slug;
}

function createUniqueId(base, usedIds) {
  const root = base || 'section';
  let candidate = root;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function headingDetails(heading, index) {
  const text = normalizeHeadingText(heading?.textContent);
  const tagName = String(heading?.tagName || '').toLowerCase();
  const level = Number(tagName.slice(1)) || Number(heading?.level) || 2;

  return {
    heading,
    index,
    text,
    level,
    authoredId: normalizeHeadingText(readAttribute(heading, 'id')),
  };
}

export function buildOutlineEntries(headings = [], existingIds = []) {
  const details = Array.from(headings, headingDetails);
  const externalIds = new Set(
    Array.from(existingIds, (id) => normalizeHeadingText(id)).filter(Boolean),
  );
  const preservedAuthoredIds = new Set();
  details.forEach(({ authoredId }) => {
    if (authoredId && !externalIds.has(authoredId) && !preservedAuthoredIds.has(authoredId)) {
      preservedAuthoredIds.add(authoredId);
    }
  });

  const usedIds = new Set([...externalIds, ...preservedAuthoredIds]);
  const preserved = new Set();

  return details.map(({ heading, index, text, level, authoredId }) => {
    let id = '';
    const canPreserve = authoredId
      && preservedAuthoredIds.has(authoredId)
      && !preserved.has(authoredId);

    if (canPreserve) {
      id = authoredId;
      preserved.add(authoredId);
    } else {
      id = createUniqueId(slugifyHeading(text) || `section-${index + 1}`, usedIds);
    }

    return {
      heading,
      id,
      index,
      level,
      text: text || `Section ${index + 1}`,
      authored: id === authoredId && Boolean(authoredId),
    };
  });
}

function documentIdsOutsideHeadings(documentRef, headings) {
  if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return [];

  return Array.from(documentRef.querySelectorAll('[id]'))
    .filter((node) => !headings.includes(node))
    .map((node) => readAttribute(node, 'id'))
    .filter(Boolean);
}

function setHeadingTarget(heading, id) {
  if (!heading || typeof heading.setAttribute !== 'function') return;
  heading.setAttribute('id', id);
  heading.setAttribute('tabindex', '-1');
}

function appendOutlineEntry(documentRef, list, entry) {
  const item = documentRef.createElement('li');
  item.className = `outline-item outline-h${entry.level}`;

  const link = documentRef.createElement('a');
  link.setAttribute('href', `#${entry.id}`);
  link.textContent = entry.text;
  item.appendChild(link);
  list.appendChild(item);
}

export function clearBlogOutline(container) {
  if (!container) return;
  container.hidden = true;
  if (container.style) container.style.display = 'none';
  container.replaceChildren?.();
}

function isWideReader(windowRef) {
  return windowRef?.matchMedia?.('(min-width: 1280px)')?.matches ?? true;
}

function getExistingDetails(container) {
  return Array.from(container?.children ?? []).find((child) => (
    String(child?.tagName || '').toLowerCase() === 'details'
  )) ?? null;
}

function getDetailsOpenState(details, hasPrevious, windowRef, interactionState) {
  if (hasPrevious) return details?.open !== undefined ? details.open : details.hasAttribute?.('open') === true;
  if (interactionState?.manual) return interactionState.manualOpen;
  return isWideReader(windowRef);
}

const outlineInteractionState = new WeakMap();

function bindOutlineResponsiveState({ container, details, summary, windowRef }) {
  let state = outlineInteractionState.get(container);
  if (!state) {
    state = { manual: false, manualOpen: false, syncing: false, mediaQuery: null };
    outlineInteractionState.set(container, state);
  }

  summary?.addEventListener?.('click', () => {
    state.manual = true;
    state.manualOpen = !details.open;
  });

  details.addEventListener?.('toggle', () => {
    if (state.manual && !state.syncing) {
      state.manualOpen = Boolean(details.open);
    }
  });

  if (state.mediaQuery || !windowRef?.matchMedia) return;

  const mediaQuery = windowRef.matchMedia('(min-width: 1280px)');
  if (!mediaQuery?.addEventListener) return;

  state.mediaQuery = mediaQuery;
  mediaQuery.addEventListener('change', (event) => {
    if (state.manual) return;

    const currentDetails = getExistingDetails(container);
    if (!currentDetails) return;

    state.syncing = true;
    currentDetails.open = Boolean(event.matches);
    state.syncing = false;
  });
}

function bindOutlineAnchors({ container, documentRef, windowRef }) {
  if (!container?.addEventListener || container.dataset?.outlineAnchorsBound === 'true') return;

  container.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[href^="#"]');
    if (!link || !container.contains?.(link)) return;

    const rawId = link.getAttribute('href')?.slice(1) || '';
    if (!rawId) return;

    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      // Keep authored IDs that are not valid URI components intact.
    }

    const target = documentRef.getElementById?.(id);
    if (!target) return;

    event.preventDefault?.();
    target.focus?.({ preventScroll: true });
    target.scrollIntoView?.({ behavior: 'auto', block: 'start' });
    if (windowRef?.history?.replaceState) {
      windowRef.history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    } else if (windowRef?.location) {
      windowRef.location.hash = `#${encodeURIComponent(id)}`;
    }
  });

  container.dataset.outlineAnchorsBound = 'true';
}

export function renderBlogOutline({ container, headings = [], documentRef, windowRef }) {
  if (!container || !documentRef) return [];

  const headingNodes = Array.from(headings);
  const entries = buildOutlineEntries(
    headingNodes,
    documentIdsOutsideHeadings(documentRef, headingNodes),
  );

  entries.forEach((entry) => setHeadingTarget(entry.heading, entry.id));

  if (entries.length < 2) {
    clearBlogOutline(container);
    return entries;
  }

  const previousDetails = getExistingDetails(container);
  const hasPrevious = Boolean(previousDetails);
  const interactionState = outlineInteractionState.get(container);
  const desiredOpen = getDetailsOpenState(previousDetails, hasPrevious, windowRef, interactionState);
  const details = documentRef.createElement('details');
  details.className = 'blog-outline';

  const summary = documentRef.createElement('summary');
  summary.textContent = 'On this page';
  details.appendChild(summary);

  const nav = documentRef.createElement('nav');
  nav.setAttribute('aria-label', 'Article sections');
  const list = documentRef.createElement('ol');
  list.className = 'outline-list';

  entries.forEach((entry) => appendOutlineEntry(documentRef, list, entry));
  nav.appendChild(list);
  details.appendChild(nav);

  container.classList?.add('blog-outline-container');
  container.replaceChildren(details);
  container.hidden = false;
  if (container.style) container.style.display = '';
  bindOutlineResponsiveState({ container, details, summary, windowRef });
  const state = outlineInteractionState.get(container);
  if (state) state.syncing = true;
  details.open = desiredOpen;
  if (desiredOpen) details.setAttribute?.('open', '');
  else details.removeAttribute?.('open');
  if (state) state.syncing = false;
  bindOutlineAnchors({ container, documentRef, windowRef });
  return entries;
}

export function getBlogHeadings(content) {
  if (!content || typeof content.querySelectorAll !== 'function') return [];
  return Array.from(content.querySelectorAll('h2, h3, h4'));
}
