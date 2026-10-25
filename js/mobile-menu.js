(() => {
  const menuBreakpoint = 768;
  const drawerOpenEvent = 'portfolio:drawer-open';

  function focusable(container) {
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden && !element.closest('[hidden]'));
  }

  function setInert(element, value) {
    if (!element) return;
    if ('inert' in element) element.inert = value;
    if (value) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
  }

  function initializeNewMobileMenu() {
    const menuButton = document.querySelector('.mobile-menu-button');
    const menuDropdown = document.getElementById('mobileMenuDropdown') || document.querySelector('.mobile-menu-dropdown');
    const menuContent = document.getElementById('mobileMenuContent');
    const tracklistTrigger = document.querySelector('.mobile-tracklist-button');

    if (!menuButton || !menuDropdown || !menuContent) return false;

    if (tracklistTrigger && !document.getElementById('tracklist-column')) {
      tracklistTrigger.hidden = true;
      tracklistTrigger.setAttribute('aria-hidden', 'true');
    }

    if (menuButton.dataset.menuInitialized === 'true') return true;

    const nestedDropdowns = Array.from(menuDropdown.querySelectorAll('.mobile-nested-dropdown'));
    let previouslyFocused = null;

    const setNestedState = (dropdown, open) => {
      const trigger = dropdown.querySelector('.mobile-menu-trigger');
      const content = dropdown.querySelector('.mobile-nested-content');
      if (!trigger || !content) return;

      dropdown.classList.toggle('active', open);
      trigger.setAttribute('aria-expanded', String(open));
      content.hidden = !open;
      content.setAttribute('aria-hidden', String(!open));
      setInert(content, !open);
    };

    const closeNested = () => nestedDropdowns.forEach((dropdown) => setNestedState(dropdown, false));

    const getDesktopFocusTarget = () => [
      document.querySelector('.site-header .logo-section-link'),
      document.querySelector('.site-header .header-nav a[href]'),
      menuButton,
    ].find((element) => element && !element.hidden && !element.closest('[hidden]')) || null;

    const closeMenu = (restoreFocus = true, focusTarget = null) => {
      if (menuDropdown.hidden && !menuDropdown.classList.contains('active')) return;

      menuDropdown.classList.remove('active');
      menuButton.classList.remove('active');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Open menu');
      menuDropdown.setAttribute('aria-hidden', 'true');
      setInert(menuDropdown, true);
      document.body.classList.remove('mobile-menu-open');
      closeNested();

      window.setTimeout(() => {
        if (!menuDropdown.classList.contains('active')) menuDropdown.hidden = true;
      }, 170);

      const nextFocus = focusTarget?.isConnected
        ? focusTarget
        : restoreFocus && previouslyFocused?.isConnected
          ? previouslyFocused
          : null;
      nextFocus?.focus();
      previouslyFocused = null;
    };

    const openMenu = () => {
      if (window.innerWidth > menuBreakpoint) return;

      document.dispatchEvent(new CustomEvent(drawerOpenEvent, { detail: { source: 'menu' } }));
      previouslyFocused = document.activeElement;
      menuDropdown.hidden = false;
      menuDropdown.setAttribute('aria-hidden', 'false');
      setInert(menuDropdown, false);
      menuDropdown.classList.add('active');
      menuButton.classList.add('active');
      menuButton.setAttribute('aria-expanded', 'true');
      menuButton.setAttribute('aria-label', 'Close menu');
      document.body.classList.add('mobile-menu-open');

      window.requestAnimationFrame(() => focusable(menuContent)[0]?.focus());
    };

    document.addEventListener(drawerOpenEvent, (event) => {
      if (event.detail?.source !== 'menu') closeMenu(false);
    });

    menuButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menuDropdown.classList.contains('active')) closeMenu();
      else openMenu();
    });

    menuDropdown.addEventListener('click', (event) => {
      const nestedTrigger = event.target.closest('.mobile-menu-trigger');
      if (nestedTrigger) {
        event.preventDefault();
        event.stopPropagation();
        const dropdown = nestedTrigger.closest('.mobile-nested-dropdown');
        const isOpen = dropdown?.classList.contains('active');
        nestedDropdowns.forEach((other) => setNestedState(other, other === dropdown && !isOpen));
        return;
      }

      if (event.target.closest('a')) closeMenu(false);
    });

    document.addEventListener('click', (event) => {
      if (menuDropdown.classList.contains('active') &&
        !menuDropdown.contains(event.target) &&
        !menuButton.contains(event.target)) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!menuDropdown.classList.contains('active')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key !== 'Tab') return;
      const elements = focusable(menuContent);
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

    window.addEventListener('resize', () => {
      if (window.innerWidth > menuBreakpoint && menuDropdown.classList.contains('active')) {
        closeMenu(false, getDesktopFocusTarget());
      }
    }, { passive: true });

    menuButton.dataset.menuInitialized = 'true';
    setInert(menuDropdown, true);
    closeNested();
    return true;
  }

  window.initializeNewMobileMenu = initializeNewMobileMenu;

  const retry = () => {
    if (initializeNewMobileMenu()) return;
    window.setTimeout(initializeNewMobileMenu, 1000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retry, { once: true });
  else retry();
})();
