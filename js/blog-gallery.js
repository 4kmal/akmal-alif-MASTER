export const GALLERY_PAGE_SIZE = 24;
const MAX_MANIFEST_PAGES = 512;

const controllers = new WeakMap();
const rootStates = new WeakMap();

function stringValue(value) {
  return String(value ?? '').trim();
}

function parseNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseManifestPayload(payload) {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function normaliseGalleryManifest(payload, manifestId = '') {
  const source = parseManifestPayload(payload);
  if (!source || typeof source !== 'object') return Object.freeze({
    id: stringValue(manifestId),
    title: 'Article gallery',
    revision: null,
    pages: Object.freeze([]),
    pageCount: 0,
  });

  const pages = (Array.isArray(source.pages) ? source.pages : [])
    .map((page, index) => {
      if (!page || typeof page !== 'object') return null;
      const originalUrl = stringValue(page.original_url);
      const thumbnailUrl = stringValue(page.thumbnail_url) || originalUrl;
      if (!originalUrl || !thumbnailUrl || page.visible === false) return null;
      const originalPage = parsePositiveInteger(page.original_page, index + 1);
      const order = parseNumber(page.order, index);
      const title = stringValue(page.title);
      const caption = stringValue(page.caption);
      const label = title || caption || `Gallery page ${originalPage}`;
      return Object.freeze({
        id: stringValue(page.id),
        originalPage,
        order,
        title,
        caption,
        originalUrl,
        thumbnailUrl,
        alt: label,
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.order - right.order || left.originalPage - right.originalPage)
    .slice(0, MAX_MANIFEST_PAGES);

  return Object.freeze({
    id: stringValue(source.manifestId ?? source.id ?? manifestId),
    title: stringValue(source.title) || 'Article gallery',
    revision: source.revision ?? null,
    createdAt: stringValue(source.created_at),
    pages: Object.freeze(pages),
    pageCount: pages.length,
  });
}

export const normalizeGalleryManifest = normaliseGalleryManifest;

function markerManifestId(marker) {
  return stringValue(marker?.getAttribute?.('data-gallery-manifest-id'));
}

function markerInlineManifest(marker) {
  const raw = marker?.getAttribute?.('data-gallery-manifest');
  if (!raw) return null;
  const parsed = parseManifestPayload(raw);
  return parsed && typeof parsed === 'object' ? normaliseGalleryManifest(parsed, markerManifestId(marker)) : null;
}

function getMarkers(root) {
  if (!root) return [];
  const selector = '.blog-gallery[data-gallery-manifest-id]';
  const markers = [];
  if (root.matches?.(selector)) markers.push(root);
  root.querySelectorAll?.(selector).forEach((marker) => {
    if (!markers.includes(marker)) markers.push(marker);
  });
  return markers;
}

function createElement(documentRef, tag, className, text) {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function pageLabel(page, index) {
  return `PDF page ${page?.originalPage ?? index + 1}`;
}

function pageDescription(page, index) {
  return [pageLabel(page, index), page?.title, page?.caption].filter(Boolean).join(' · ');
}

function getFocusable(dialog) {
  return Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true');
}

function isEditableTarget(target) {
  const tagName = String(target?.tagName ?? '').toLowerCase();
  return ['input', 'textarea', 'select', 'button'].includes(tagName) || target?.isContentEditable === true;
}

function setDialogOpen(dialog, open) {
  if (!dialog) return;
  if (open) {
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        return;
      } catch {
        // jsdom and detached dialogs use the fallback open state.
      }
    }
    dialog.open = true;
    dialog.setAttribute('open', '');
  } else if (typeof dialog.close === 'function') {
    try {
      dialog.close();
    } catch {
      dialog.open = false;
    }
    dialog.removeAttribute?.('open');
  } else {
    dialog.open = false;
    dialog.removeAttribute?.('open');
  }
}

function renderFallbackLinks(marker, manifest, documentRef) {
  if (!manifest.pages.length || marker.querySelector?.('[data-gallery-fallback]')) return;
  const fallback = createElement(documentRef, 'details', 'blog-gallery-fallback');
  fallback.dataset.galleryFallback = 'true';
  const summary = createElement(documentRef, 'summary', '', 'Open gallery pages as links');
  const list = createElement(documentRef, 'ol', 'blog-gallery-fallback-list');
  manifest.pages.forEach((page, index) => {
    const item = createElement(documentRef, 'li');
    const link = createElement(documentRef, 'a', '', pageDescription(page, index));
    link.href = page.originalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.appendChild(link);
    list.appendChild(item);
  });
  fallback.append(summary, list);
  marker.appendChild(fallback);
}

function createViewer(controller) {
  const { documentRef, manifest } = controller;
  const dialog = createElement(documentRef, 'dialog', 'blog-gallery-viewer');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', manifest.title);

  const shell = createElement(documentRef, 'div', 'blog-gallery-viewer-shell');
  const header = createElement(documentRef, 'header', 'blog-gallery-viewer-header');
  const title = createElement(documentRef, 'h2', 'blog-gallery-viewer-title', manifest.title);
  const close = createElement(documentRef, 'button', 'blog-gallery-viewer-close', 'Close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close gallery viewer');
  header.append(title, close);

  const toolbar = createElement(documentRef, 'div', 'blog-gallery-viewer-toolbar');
  const previous = createElement(documentRef, 'button', 'blog-gallery-viewer-control', 'Previous');
  const next = createElement(documentRef, 'button', 'blog-gallery-viewer-control', 'Next');
  const zoomOut = createElement(documentRef, 'button', 'blog-gallery-viewer-control', '−');
  const zoomIn = createElement(documentRef, 'button', 'blog-gallery-viewer-control', '+');
  previous.type = next.type = zoomOut.type = zoomIn.type = 'button';
  previous.setAttribute('aria-label', 'Previous page');
  next.setAttribute('aria-label', 'Next page');
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomIn.setAttribute('aria-label', 'Zoom in');
  const jump = createElement(documentRef, 'form', 'blog-gallery-viewer-jump');
  const jumpLabel = createElement(documentRef, 'label', '', 'PDF page');
  const jumpInput = createElement(documentRef, 'input');
  jumpInput.type = 'number';
  const pageNumbers = manifest.pages.map((page) => page.originalPage);
  jumpInput.min = String(Math.min(...pageNumbers));
  jumpInput.max = String(Math.max(...pageNumbers));
  jumpInput.inputMode = 'numeric';
  jumpInput.setAttribute('aria-label', 'Jump to original PDF page');
  const jumpButton = createElement(documentRef, 'button', 'blog-gallery-viewer-control', 'Go');
  jumpButton.type = 'submit';
  jump.append(jumpLabel, jumpInput, jumpButton);
  toolbar.append(previous, next, zoomOut, zoomIn, jump);

  const viewport = createElement(documentRef, 'div', 'blog-gallery-viewer-viewport');
  const image = createElement(documentRef, 'img', 'blog-gallery-viewer-image');
  image.alt = '';
  image.draggable = false;
  viewport.appendChild(image);
  const caption = createElement(documentRef, 'p', 'blog-gallery-viewer-caption');
  const status = createElement(documentRef, 'p', 'blog-gallery-viewer-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  shell.append(header, toolbar, viewport, caption, status);
  dialog.appendChild(shell);
  documentRef.body?.appendChild(dialog);
  controller.viewer = { dialog, close, previous, next, zoomOut, zoomIn, jump, jumpInput, viewport, image, caption, status, shell };
  return controller.viewer;
}

function updateViewer(controller) {
  const viewer = controller.viewer;
  const page = controller.manifest.pages[controller.currentIndex];
  if (!viewer || !page || controller.disposed) return;
  viewer.image.src = page.originalUrl;
  viewer.image.alt = page.alt;
  viewer.caption.textContent = `${pageDescription(page, controller.currentIndex)} · ${controller.currentIndex + 1} of ${controller.manifest.pages.length}`;
  viewer.jumpInput.value = String(page.originalPage);
  viewer.previous.disabled = controller.currentIndex <= 0;
  viewer.next.disabled = controller.currentIndex >= controller.manifest.pages.length - 1;
  viewer.status.textContent = `${pageLabel(page, controller.currentIndex)} loaded`;
  viewer.image.style.transform = `translate(${controller.panX}px, ${controller.panY}px) scale(${controller.zoom})`;
  viewer.viewport.dataset.zoom = String(controller.zoom);
}

function setZoom(controller, nextZoom) {
  controller.zoom = Math.max(1, Math.min(4, nextZoom));
  if (controller.zoom === 1) {
    controller.panX = 0;
    controller.panY = 0;
  }
  updateViewer(controller);
}

function moveTo(controller, nextIndex) {
  if (controller.disposed || !controller.manifest.pages.length) return;
  controller.currentIndex = Math.max(0, Math.min(controller.manifest.pages.length - 1, nextIndex));
  setZoom(controller, 1);
  updateViewer(controller);
}

function openViewer(controller, index) {
  if (controller.disposed) return;
  if (!controller.viewer) createViewer(controller);
  controller.lastFocused = controller.documentRef.activeElement;
  controller.currentIndex = Math.max(0, Math.min(controller.manifest.pages.length - 1, index));
  controller.zoom = 1;
  controller.panX = 0;
  controller.panY = 0;
  updateViewer(controller);
  setDialogOpen(controller.viewer.dialog, true);
  controller.viewer.close.focus?.();
}

function closeViewer(controller) {
  if (!controller.viewer) return;
  setDialogOpen(controller.viewer.dialog, false);
  controller.lastFocused?.focus?.({ preventScroll: true });
  controller.lastFocused = null;
}

function bindViewer(controller) {
  const viewer = controller.viewer;
  viewer.close.addEventListener('click', () => closeViewer(controller));
  viewer.previous.addEventListener('click', () => moveTo(controller, controller.currentIndex - 1));
  viewer.next.addEventListener('click', () => moveTo(controller, controller.currentIndex + 1));
  viewer.zoomOut.addEventListener('click', () => setZoom(controller, controller.zoom - 0.5));
  viewer.zoomIn.addEventListener('click', () => setZoom(controller, controller.zoom + 0.5));
  viewer.jump.addEventListener('submit', (event) => {
    event.preventDefault();
    const requestedPage = Number(viewer.jumpInput.value);
    const index = controller.manifest.pages.findIndex((page) => page.originalPage === requestedPage);
    if (index >= 0) moveTo(controller, index);
    else viewer.status.textContent = `PDF page ${requestedPage} is not in this gallery`;
  });
  viewer.dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer(controller);
  });
  viewer.dialog.addEventListener('click', (event) => {
    if (event.target === viewer.dialog) closeViewer(controller);
  });
  viewer.dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewer(controller);
      return;
    }
    if (event.key === 'Tab') {
      const focusable = getFocusable(viewer.dialog);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && controller.documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && controller.documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (isEditableTarget(event.target)) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTo(controller, controller.currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveTo(controller, controller.currentIndex + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(controller, 0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(controller, controller.manifest.pages.length - 1);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(controller, controller.zoom + 0.5);
    } else if (event.key === '-') {
      event.preventDefault();
      setZoom(controller, controller.zoom - 0.5);
    }
  });

  let pointerStart = null;
  viewer.viewport.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.clientX, y: event.clientY, panX: controller.panX, panY: controller.panY };
    viewer.viewport.setPointerCapture?.(event.pointerId);
  });
  viewer.viewport.addEventListener('pointermove', (event) => {
    if (!pointerStart || controller.zoom <= 1) return;
    controller.panX = pointerStart.panX + event.clientX - pointerStart.x;
    controller.panY = pointerStart.panY + event.clientY - pointerStart.y;
    updateViewer(controller);
  });
  viewer.viewport.addEventListener('pointerup', () => { pointerStart = null; });
  viewer.viewport.addEventListener('pointercancel', () => { pointerStart = null; });

  let touchStart = null;
  viewer.viewport.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches?.[0];
    if (touch) touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  viewer.viewport.addEventListener('touchend', (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch || !touchStart || controller.zoom !== 1) {
      touchStart = null;
      return;
    }
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
      moveTo(controller, controller.currentIndex + (deltaX < 0 ? 1 : -1));
    }
    touchStart = null;
  }, { passive: true });
}

function renderGalleryPage(controller) {
  const { documentRef, manifest, renderer } = controller;
  const pageCount = Math.ceil(manifest.pages.length / GALLERY_PAGE_SIZE);
  renderer.thumbnails.replaceChildren();
  const start = controller.pageIndex * GALLERY_PAGE_SIZE;
  const visiblePages = manifest.pages.slice(start, start + GALLERY_PAGE_SIZE);
  visiblePages.forEach((page, offset) => {
    const index = start + offset;
    const item = createElement(documentRef, 'figure', 'blog-gallery-thumb');
    const button = createElement(documentRef, 'button', 'blog-gallery-thumb-button');
    button.type = 'button';
    button.setAttribute('aria-label', `Open ${pageDescription(page, index)}`);
    const image = createElement(documentRef, 'img', 'blog-gallery-thumb-image');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = page.thumbnailUrl;
    image.alt = page.alt;
    button.appendChild(image);
    button.addEventListener('click', () => openViewer(controller, index));
    const caption = createElement(documentRef, 'figcaption', '', pageDescription(page, index));
    item.append(button, caption);
    renderer.thumbnails.appendChild(item);
  });
  renderer.pageStatus.textContent = pageCount > 1
    ? `Thumbnail pages ${controller.pageIndex + 1} of ${pageCount}`
    : `${manifest.pages.length} page${manifest.pages.length === 1 ? '' : 's'}`;
  renderer.previous.disabled = controller.pageIndex <= 0;
  renderer.next.disabled = controller.pageIndex >= pageCount - 1;
}

function createRenderer(controller) {
  const { documentRef, manifest, marker } = controller;
  const renderer = createElement(documentRef, 'section', 'blog-gallery-renderer');
  renderer.dataset.galleryRendered = 'true';
  const title = createElement(documentRef, 'h3', 'blog-gallery-title', manifest.title);
  const pageStatus = createElement(documentRef, 'p', 'blog-gallery-page-status', '');
  pageStatus.setAttribute('role', 'status');
  pageStatus.setAttribute('aria-live', 'polite');
  const controls = createElement(documentRef, 'div', 'blog-gallery-controls');
  const previous = createElement(documentRef, 'button', 'blog-gallery-control', 'Previous');
  const next = createElement(documentRef, 'button', 'blog-gallery-control', 'Next');
  previous.type = next.type = 'button';
  previous.setAttribute('aria-label', 'Previous gallery thumbnail page');
  next.setAttribute('aria-label', 'Next gallery thumbnail page');
  const thumbnails = createElement(documentRef, 'div', 'blog-gallery-thumbnails');
  thumbnails.setAttribute('role', 'list');
  controls.append(previous, next);
  renderer.append(title, pageStatus, controls, thumbnails);
  marker.insertBefore(renderer, marker.firstChild);
  controller.renderer = { renderer, pageStatus, previous, next, thumbnails };
  previous.addEventListener('click', () => {
    controller.pageIndex = Math.max(0, controller.pageIndex - 1);
    renderGalleryPage(controller);
  });
  next.addEventListener('click', () => {
    const pageCount = Math.ceil(manifest.pages.length / GALLERY_PAGE_SIZE);
    controller.pageIndex = Math.min(pageCount - 1, controller.pageIndex + 1);
    renderGalleryPage(controller);
  });
  renderGalleryPage(controller);
  return controller.renderer;
}

export async function fetchGalleryManifest(manifestId, fetchRef = globalThis.fetch, options = {}) {
  if (!manifestId || typeof fetchRef !== 'function') throw new Error('Gallery manifest is unavailable');
  const response = await fetchRef(`/api/blog/galleries/${encodeURIComponent(manifestId)}`, {
    headers: { Accept: 'application/json' },
    ...options,
  });
  if (!response?.ok) throw new Error(`Gallery request failed (${response?.status ?? 'unknown'})`);
  return normaliseGalleryManifest(await response.json(), manifestId);
}

function markerIsMounted(marker, root) {
  if (marker?.isConnected === false) return false;
  return root === marker || root?.contains?.(marker) === true;
}

function createController(marker, manifest, documentRef, rootState = null) {
  const controller = {
    marker,
    documentRef,
    manifest,
    fetchRef: null,
    rootState,
    pageIndex: 0,
    currentIndex: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    renderer: null,
    viewer: null,
    lastFocused: null,
    disposed: false,
  };
  controller.dispose = () => disposeController(controller);
  return controller;
}

async function mountMarker(rootState, marker, fetchRef) {
  if (rootState.disposed || controllers.has(marker) || rootState.pending.has(marker)) return controllers.get(marker) ?? null;
  const documentRef = marker.ownerDocument ?? globalThis.document;
  const generation = rootState.generation;
  const abortController = typeof AbortController === 'function' ? new AbortController() : null;
  rootState.pending.set(marker, { generation, abortController });
  marker.dataset.galleryState = 'loading';

  try {
    let manifest = markerInlineManifest(marker);
    if (!manifest) manifest = await fetchGalleryManifest(markerManifestId(marker), fetchRef, abortController ? { signal: abortController.signal } : {});
    if (rootState.disposed || generation !== rootState.generation || !markerIsMounted(marker, rootState.root)) return null;
    if (!manifest.pages.length) {
      marker.dataset.galleryState = 'empty';
      return null;
    }
    const controller = createController(marker, manifest, documentRef, rootState);
    controllers.set(marker, controller);
    rootState.controllers.add(controller);
    renderFallbackLinks(marker, manifest, documentRef);
    createRenderer(controller);
    createViewer(controller);
    bindViewer(controller);
    marker.dataset.galleryState = 'ready';
    return controller;
  } catch (error) {
    if (rootState.disposed || generation !== rootState.generation || error?.name === 'AbortError') return null;
    marker.dataset.galleryState = 'error';
    marker.querySelector?.('[data-gallery-error]')?.removeAttribute('hidden');
    return null;
  } finally {
    const pending = rootState.pending.get(marker);
    if (pending?.generation === generation) rootState.pending.delete(marker);
  }
}

export function createBlogGalleryController({ marker, manifest, documentRef = marker?.ownerDocument ?? globalThis.document } = {}) {
  if (!marker || !manifest || !documentRef) return null;
  controllers.get(marker)?.dispose?.();
  const normalised = normaliseGalleryManifest(manifest);
  if (!normalised.pages.length) return null;
  const controller = createController(marker, normalised, documentRef);
  controllers.set(marker, controller);
  renderFallbackLinks(marker, normalised, documentRef);
  createRenderer(controller);
  createViewer(controller);
  bindViewer(controller);
  marker.dataset.galleryState = 'ready';
  return controller;
}

export function initBlogGalleries(root = globalThis.document?.querySelector?.('[data-blog-content]'), {
  fetchRef = root?.ownerDocument?.defaultView?.fetch?.bind(root.ownerDocument.defaultView) ?? globalThis.fetch,
} = {}) {
  if (!root) return null;
  let rootState = rootStates.get(root);
  if (!rootState || rootState.disposed) {
    rootState = {
      root,
      disposed: false,
      generation: 0,
      pending: new Map(),
      controllers: new Set(),
    };
    rootStates.set(root, rootState);
  }
  getMarkers(root).forEach((marker) => {
    if (controllers.has(marker) || rootState.pending.has(marker)) return;
    void mountMarker(rootState, marker, fetchRef);
  });
  return rootState;
}

export function disposeBlogGalleries(root = globalThis.document?.querySelector?.('[data-blog-content]')) {
  const rootState = root ? rootStates.get(root) : null;
  if (!rootState) return;
  rootState.disposed = true;
  rootState.generation += 1;
  rootState.pending.forEach(({ abortController }) => abortController?.abort?.());
  rootState.pending.clear();
  rootState.controllers.forEach((controller) => {
    controller.dispose?.();
    controllers.delete(controller.marker);
  });
  rootState.controllers.clear();
  rootStates.delete(root);
}

function disposeController(controller) {
  if (!controller || controller.disposed) return;
  controller.disposed = true;
  closeViewer(controller);
  controller.viewer?.dialog?.remove?.();
  controller.renderer?.renderer?.remove?.();
  controller.rootState?.controllers?.delete(controller);
  if (controllers.get(controller.marker) === controller) controllers.delete(controller.marker);
}

const galleryApi = {
  init: initBlogGalleries,
  dispose: disposeBlogGalleries,
  create: createBlogGalleryController,
  fetch: fetchGalleryManifest,
  normalise: normaliseGalleryManifest,
  normalize: normaliseGalleryManifest,
  pageSize: GALLERY_PAGE_SIZE,
};

if (typeof window !== 'undefined') window.BlogGallery = galleryApi;
