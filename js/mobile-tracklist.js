(() => {
  const drawerBreakpoint = 1279;
  const drawerOpenEvent = 'portfolio:drawer-open';

  function focusable(container) {
    const elements = container.matches?.('[tabindex]:not([tabindex="-1"])')
      ? [container]
      : [];

    elements.push(...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));

    return elements.filter((element) => (
      !element.hidden &&
      !element.closest('[hidden]') &&
      !element.closest('[inert]')
    ));
  }

  function setInert(element, value) {
    if (!element) return;
    if ('inert' in element) element.inert = value;
    if (value) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
  }

  function initializeMobileTracklist() {
    const panel = document.getElementById('tracklist-column');
    const trigger = document.querySelector('.mobile-tracklist-button');
    const overlay = document.getElementById('swipe-overlay');

    if (!trigger) return false;
    if (!panel || !overlay) {
      trigger.hidden = true;
      trigger.setAttribute('aria-hidden', 'true');
      return false;
    }
    trigger.hidden = false;
    trigger.removeAttribute('aria-hidden');
    if (trigger.dataset.tracklistInitialized === 'true') return true;

    const closeButton = panel.querySelector('.tracklist-close');
    let previouslyFocused = null;
    let edgeStartX = 0;
    let panelStartX = 0;
    let panelCurrentX = 0;

    const setOverlayState = (open) => {
      overlay.classList.toggle('is-active', open);
      overlay.setAttribute('aria-hidden', String(!open));
    };

    const getDesktopFocusTarget = () => [
      document.querySelector('.site-header .logo-section-link'),
      document.querySelector('.site-header .header-nav a[href]'),
      trigger,
    ].find((element) => element && !element.hidden && !element.closest('[hidden]')) || null;

    const closePanel = (restoreFocus = true, focusTarget = null) => {
      if (!panel.classList.contains('is-open') && panel.hidden) return;

      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      setInert(panel, true);
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', 'Open tracklist');
      setOverlayState(false);
      document.body.classList.remove('tracklist-drawer-open');

      window.setTimeout(() => {
        if (!panel.classList.contains('is-open') && window.innerWidth <= drawerBreakpoint) panel.hidden = true;
      }, 170);

      const nextFocus = focusTarget?.isConnected
        ? focusTarget
        : restoreFocus && previouslyFocused?.isConnected
          ? previouslyFocused
          : null;
      nextFocus?.focus();
      previouslyFocused = null;
    };

    const openPanel = () => {
      if (window.innerWidth > drawerBreakpoint) return;

      document.dispatchEvent(new CustomEvent(drawerOpenEvent, { detail: { source: 'tracklist' } }));
      previouslyFocused = document.activeElement;
      panel.hidden = false;
      panel.setAttribute('aria-hidden', 'false');
      setInert(panel, false);
      panel.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      trigger.setAttribute('aria-label', 'Close tracklist');
      setOverlayState(true);
      document.body.classList.add('tracklist-drawer-open');
      window.requestAnimationFrame(() => closeButton?.focus() || focusable(panel)[0]?.focus());
    };

    document.addEventListener(drawerOpenEvent, (event) => {
      if (event.detail?.source !== 'tracklist') closePanel(false);
    });

    const syncViewport = () => {
      const desktop = window.innerWidth > drawerBreakpoint;
      if (desktop) {
        const focusTarget = panel.classList.contains('is-open') || panel.contains(document.activeElement)
          ? getDesktopFocusTarget()
          : null;
        panel.classList.remove('is-open');
        panel.hidden = false;
        panel.setAttribute('aria-hidden', 'false');
        setInert(panel, false);
        setOverlayState(false);
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Open tracklist');
        document.body.classList.remove('tracklist-drawer-open');
        focusTarget?.focus();
        previouslyFocused = null;
        return;
      }

      if (!panel.classList.contains('is-open')) {
        panel.hidden = true;
        panel.setAttribute('aria-hidden', 'true');
        setInert(panel, true);
        setOverlayState(false);
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Open tracklist');
      }
    };

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panel.classList.contains('is-open')) closePanel();
      else openPanel();
    });

    closeButton?.addEventListener('click', () => closePanel());
    overlay.addEventListener('click', () => closePanel());

    document.addEventListener('click', (event) => {
      if (panel.classList.contains('is-open') && !panel.contains(event.target) && !trigger.contains(event.target)) {
        closePanel();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!panel.classList.contains('is-open')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel(true, trigger);
        return;
      }

      if (event.key !== 'Tab') return;
      const elements = focusable(panel);
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.addEventListener('touchstart', (event) => {
      if (window.innerWidth > drawerBreakpoint) return;
      const target = event.target?.closest?.('a, button, input, select, textarea, [draggable="true"]');
      edgeStartX = event.touches[0]?.clientX < 20 ? event.touches[0].clientX : 0;
      panelStartX = panel.classList.contains('is-open') && !target ? event.touches[0]?.clientX || 0 : 0;
      panelCurrentX = panelStartX;
    }, { passive: true });

    document.addEventListener('touchmove', (event) => {
      if (edgeStartX > 0) panelCurrentX = event.touches[0]?.clientX || panelCurrentX;
      if (panelStartX > 0) panelCurrentX = event.touches[0]?.clientX || panelCurrentX;
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (edgeStartX > 0 && panelCurrentX - edgeStartX > 50) openPanel();
      if (panelStartX > 0 && panelStartX - panelCurrentX > 50) closePanel();
      edgeStartX = 0;
      panelStartX = 0;
      panelCurrentX = 0;
    }, { passive: true });

    window.addEventListener('resize', syncViewport, { passive: true });
    window.syncMobileTracklistViewport = syncViewport;
    trigger.dataset.tracklistInitialized = 'true';
    syncViewport();
    return true;
  }

  window.initializeMobileTracklist = initializeMobileTracklist;

  const retry = () => {
    if (initializeMobileTracklist()) return;
    window.setTimeout(initializeMobileTracklist, 1000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retry, { once: true });
  else retry();
})();
