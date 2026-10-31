// Inlines reviewed, animated SVG diagrams from assets/blog/diagrams/ into published articles.
// Keep BLOG_DIAGRAMS in step with apps/admin/shared/utils/blog-diagrams.ts; test/blog-diagram.test.js compares them.
export const BLOG_DIAGRAMS = Object.freeze(['publictransport-live-data']);

const DIAGRAM_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOCKED_ELEMENTS = 'script, foreignObject, iframe, object, embed, audio, video';
const controllers = new WeakMap();

export function isApprovedDiagram(key) {
  return typeof key === 'string' && key.length <= 64 && DIAGRAM_KEY.test(key) && BLOG_DIAGRAMS.includes(key);
}

export function diagramUrl(key) {
  return isApprovedDiagram(key) ? `/assets/blog/diagrams/${key}.svg` : '';
}

// Diagrams are first-party files, but strip anything executable or external before inlining.
export function sanitizeDiagramSvg(svg) {
  svg.querySelectorAll(BLOCKED_ELEMENTS).forEach(element => element.remove());
  svg.querySelectorAll('style').forEach((style) => {
    if (/@import|url\(\s*['"]?(?!#)/i.test(style.textContent)) style.remove();
  });
  [svg, ...svg.querySelectorAll('*')].forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on')) element.removeAttribute(attribute.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) element.removeAttribute(attribute.name);
      else if (/url\(\s*['"]?(?!#)/i.test(value)) element.removeAttribute(attribute.name);
    });
  });
  return svg;
}

function prefersReducedMotion(windowRef) {
  return Boolean(windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function setPlaying(controller, playing) {
  const { svg, figure, button } = controller;
  if (playing) svg.unpauseAnimations?.();
  else svg.pauseAnimations?.();
  figure.classList.toggle('is-paused', !playing);
  if (button) {
    button.textContent = playing ? 'Pause animation' : 'Play animation';
    button.setAttribute('aria-pressed', String(!playing));
  }
}

function renderFallback(figure, documentRef, key) {
  const link = documentRef.createElement('a');
  link.className = 'blog-diagram__fallback';
  link.href = diagramUrl(key);
  link.textContent = 'Open the diagram';
  figure.prepend(link);
  figure.dataset.diagramState = 'error';
}

export async function mountDiagram(figure, {
  documentRef = figure?.ownerDocument ?? globalThis.document,
  windowRef = documentRef?.defaultView ?? globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  const key = figure?.dataset?.diagramKey;
  if (!figure || !documentRef || controllers.has(figure)) return controllers.get(figure) ?? null;
  if (!isApprovedDiagram(key) || typeof fetchImpl !== 'function') {
    figure.dataset.diagramState = 'invalid';
    return null;
  }

  const controller = { figure, svg: null, button: null, userPaused: false, visible: true, observer: null, disposed: false };
  controllers.set(figure, controller);
  figure.dataset.diagramState = 'loading';
  try {
    const response = await fetchImpl(diagramUrl(key), { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Diagram request failed with ${response.status}`);
    const parsed = new windowRef.DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    const source = parsed.documentElement;
    if (!source || source.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Diagram is not valid SVG');
    if (controller.disposed) return null;

    const svg = sanitizeDiagramSvg(documentRef.importNode(source, true));
    svg.setAttribute('focusable', 'false');
    const canvas = documentRef.createElement('div');
    canvas.className = 'blog-diagram__canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-label', figure.getAttribute('aria-label') || 'Diagram');
    canvas.append(svg);

    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'blog-diagram__button';
    button.addEventListener('click', () => {
      controller.userPaused = !figure.classList.contains('is-paused');
      setPlaying(controller, !controller.userPaused && controller.visible);
    });

    // The article column is narrow, so readers can lift the diagram into a full-window dialog.
    const expand = documentRef.createElement('button');
    expand.type = 'button';
    expand.className = 'blog-diagram__button';
    expand.textContent = 'Expand diagram';
    const dialog = documentRef.createElement('dialog');
    dialog.className = 'blog-diagram-dialog';
    dialog.setAttribute('aria-label', canvas.getAttribute('aria-label'));
    const close = documentRef.createElement('button');
    close.type = 'button';
    close.className = 'blog-diagram__button blog-diagram-dialog__close';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    const stage = documentRef.createElement('div');
    stage.className = 'blog-diagram-dialog__stage';
    dialog.append(close, stage);
    expand.addEventListener('click', () => {
      if (typeof dialog.showModal !== 'function') {
        windowRef.open?.(diagramUrl(key), '_blank', 'noopener');
        return;
      }
      stage.append(svg);
      dialog.showModal();
    });
    dialog.addEventListener('close', () => canvas.append(svg));

    const controls = documentRef.createElement('div');
    controls.className = 'blog-diagram__controls';
    controls.append(button, expand);

    figure.querySelector('noscript')?.remove();
    figure.prepend(canvas, controls);
    figure.append(dialog);
    controller.svg = svg;
    controller.button = button;
    controller.userPaused = prefersReducedMotion(windowRef);
    setPlaying(controller, !controller.userPaused);

    if (typeof windowRef.IntersectionObserver === 'function') {
      controller.observer = new windowRef.IntersectionObserver(([entry]) => {
        controller.visible = Boolean(entry?.isIntersecting);
        if (!controller.userPaused) setPlaying(controller, controller.visible);
      });
      controller.observer.observe(figure);
    }
    figure.dataset.diagramState = 'ready';
    return controller;
  } catch (error) {
    console.warn('Unable to load diagram:', error);
    if (!controller.disposed) renderFallback(figure, documentRef, key);
    return null;
  }
}

function getFigures(root) {
  return root?.querySelectorAll ? [...root.querySelectorAll('figure.blog-diagram[data-diagram-key]')] : [];
}

export function initBlogDiagrams(root = globalThis.document?.querySelector?.('[data-blog-content]'), options = {}) {
  return Promise.all(getFigures(root).map(figure => mountDiagram(figure, options)));
}

export function disposeBlogDiagrams(root = globalThis.document?.querySelector?.('[data-blog-content]')) {
  getFigures(root).forEach((figure) => {
    const controller = controllers.get(figure);
    if (!controller) return;
    controller.disposed = true;
    controller.observer?.disconnect?.();
    figure.querySelector('dialog')?.close?.();
    controllers.delete(figure);
  });
}
