const controllers = new WeakMap();
const rootObservers = new WeakMap();

export function normaliseYoutubeId(value) {
  const source = String(value ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(source)) return source;
  if (!source) return '';

  try {
    const url = new URL(source, 'https://www.youtube.com');
    const hostname = url.hostname.toLowerCase();
    let id = '';
    if (hostname === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    else if (hostname === 'youtube.com'
      || hostname.endsWith('.youtube.com')
      || hostname === 'youtube-nocookie.com'
      || hostname.endsWith('.youtube-nocookie.com')) {
      id = url.searchParams.get('v') ?? '';
      if (!id) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live') id = segments[1] ?? '';
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function getMarkerId(marker) {
  return normaliseYoutubeId(
    marker?.dataset?.youtubeId
      || marker?.dataset?.youtubeVideoId
      || marker?.dataset?.youtube
      || marker?.dataset?.videoId
      || marker?.getAttribute?.('data-youtube-marker')
      || '',
  );
}

function createElement(documentRef, tag, className, text) {
  const element = documentRef.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function getMarkers(root) {
  if (!root) return [];
  const markers = [];
  if (root.matches?.('[data-youtube-id], [data-youtube], [data-youtube-marker], [data-video-id]')) markers.push(root);
  root.querySelectorAll?.('[data-youtube-id], [data-youtube], [data-youtube-marker], [data-video-id]').forEach((marker) => {
    if (!markers.includes(marker)) markers.push(marker);
  });
  return markers;
}

function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

export function renderYoutubePlaceholder(marker, videoId, documentRef = marker?.ownerDocument ?? globalThis.document) {
  const id = normaliseYoutubeId(videoId);
  if (!marker || !documentRef || !id) return null;
  const existing = controllers.get(marker);
  existing?.dispose?.();

  const block = createElement(documentRef, 'section', 'youtube-click-to-load');
  block.dataset.youtubeRendered = 'true';
  block.setAttribute('aria-labelledby', `youtube-title-${id}`);
  const preview = createElement(documentRef, 'div', 'youtube-preview');
  preview.setAttribute('aria-hidden', 'true');
  const playGlyph = createElement(documentRef, 'span', 'youtube-preview-glyph', '▶');
  const previewLabel = createElement(documentRef, 'span', 'youtube-preview-label', 'YouTube video');
  preview.append(playGlyph, previewLabel);
  const videoTitle = marker.getAttribute('data-youtube-title') || marker.getAttribute('aria-label') || marker.querySelector('a')?.textContent?.trim() || 'Watch this video';
  const title = createElement(documentRef, 'h3', 'youtube-title', videoTitle);
  title.id = `youtube-title-${id}`;
  const loadButton = createElement(documentRef, 'button', 'youtube-load-button', 'Load video');
  loadButton.type = 'button';
  loadButton.setAttribute('aria-describedby', title.id);
  const watchLink = createElement(documentRef, 'a', 'youtube-watch-link', 'Watch on YouTube');
  watchLink.href = watchUrl(id);
  watchLink.target = '_blank';
  watchLink.rel = 'noopener noreferrer';
  const note = createElement(documentRef, 'p', 'youtube-privacy-note', 'The video loads after you choose to view it.');
  block.append(preview, title, loadButton, watchLink, note);
  marker.replaceChildren(block);

  const controller = {
    marker,
    block,
    id,
    documentRef,
    loaded: false,
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.iframe?.remove?.();
      if (controllers.get(marker) === this) controllers.delete(marker);
    },
  };
  controllers.set(marker, controller);

  loadButton.addEventListener('click', () => {
    if (controller.loaded || controller.disposed) return;
    controller.loaded = true;
    controller.iframe = createElement(documentRef, 'iframe', 'youtube-iframe');
    controller.iframe.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    controller.iframe.title = videoTitle;
    controller.iframe.loading = 'lazy';
    controller.iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    controller.iframe.allow = 'encrypted-media; picture-in-picture';
    controller.iframe.allowFullscreen = true;
    block.replaceChildren(controller.iframe);
    block.dataset.youtubeLoaded = 'true';
  });
  return controller;
}

function mountMarker(marker, documentRef) {
  const id = getMarkerId(marker);
  if (!id) {
    marker.dataset.youtubeState = 'invalid';
    return null;
  }
  marker.dataset.youtubeState = 'ready';
  return renderYoutubePlaceholder(marker, id, documentRef);
}

export function initYouTubeEmbeds(root = globalThis.document?.querySelector?.('[data-blog-content]')) {
  if (!root) return null;
  const documentRef = root.ownerDocument ?? globalThis.document;
  if (!rootObservers.has(root) && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      getMarkers(root).forEach((marker) => {
        if (!controllers.has(marker) && marker.dataset.youtubeState !== 'ready') mountMarker(marker, documentRef);
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    rootObservers.set(root, observer);
  }
  getMarkers(root).forEach((marker) => {
    if (!controllers.has(marker)) mountMarker(marker, documentRef);
  });
  return rootObservers.get(root) ?? null;
}

export function disposeYouTubeEmbeds(root = globalThis.document?.querySelector?.('[data-blog-content]')) {
  if (!root) return;
  rootObservers.get(root)?.disconnect?.();
  rootObservers.delete(root);
  getMarkers(root).forEach((marker) => {
    const controller = controllers.get(marker);
    controller?.dispose?.();
    controllers.delete(marker);
  });
}

const youtubeApi = {
  init: initYouTubeEmbeds,
  dispose: disposeYouTubeEmbeds,
  render: renderYoutubePlaceholder,
  normaliseId: normaliseYoutubeId,
};

if (typeof window !== 'undefined') window.PublicYouTube = youtubeApi;
