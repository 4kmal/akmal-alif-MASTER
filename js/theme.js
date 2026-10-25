(() => {
  if (window.PortfolioTheme) return;

  const themeKey = 'theme';
  const legacyKey = 'darkMode';
  const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

  function readPreference() {
    try {
      const savedTheme = window.localStorage.getItem(themeKey);
      if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;

      const legacyTheme = window.localStorage.getItem(legacyKey);
      if (legacyTheme === 'true' || legacyTheme === 'false') {
        return legacyTheme === 'true' ? 'dark' : 'light';
      }
    } catch (error) {
      // Private browsing can deny storage access; system preference still works.
    }

    return mediaQuery?.matches ? 'dark' : 'light';
  }

  function hasStoredPreference() {
    try {
      return window.localStorage.getItem(themeKey) !== null ||
        window.localStorage.getItem(legacyKey) !== null;
    } catch (error) {
      return false;
    }
  }

  function updateControls(theme) {
    const isDark = theme === 'dark';
    document.querySelectorAll('#headerDarkToggle').forEach((control) => {
      control.setAttribute('aria-pressed', String(isDark));
      control.setAttribute('aria-label', isDark ? 'Use light theme' : 'Use dark theme');
      control.dataset.theme = theme;
    });
  }

  function apply(theme, persist = false) {
    const resolvedTheme = theme === 'dark' ? 'dark' : 'light';
    const isDark = resolvedTheme === 'dark';
    const root = document.documentElement;

    root.classList.toggle('dark', isDark);
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
    document.body?.classList.toggle('dark', isDark);

    if (persist) {
      try {
        window.localStorage.setItem(themeKey, resolvedTheme);
        window.localStorage.setItem(legacyKey, String(isDark));
      } catch (error) {
        // The visual state remains usable when storage is unavailable.
      }
    }

    updateControls(resolvedTheme);
    return resolvedTheme;
  }

  const api = {
    getTheme: () => document.documentElement.dataset.theme || readPreference(),
    apply: (theme, persist = true) => apply(theme, persist),
    toggle: () => apply(api.getTheme() === 'dark' ? 'light' : 'dark', true),
    syncBody: () => apply(api.getTheme(), false),
    syncControls: () => updateControls(api.getTheme()),
    init: () => {
      apply(readPreference(), false);
      return api.getTheme();
    },
  };

  window.PortfolioTheme = api;
  apply(readPreference(), false);

  if (!window.__portfolioThemeClickBound) {
    document.addEventListener('click', (event) => {
      const control = event.target.closest?.('#headerDarkToggle');
      if (!control) return;
      event.preventDefault();
      event.stopPropagation();
      api.toggle();
    });
    window.__portfolioThemeClickBound = true;
  }

  if (mediaQuery?.addEventListener && !window.__portfolioThemeMediaBound) {
    mediaQuery.addEventListener('change', () => {
      if (!hasStoredPreference()) apply(readPreference(), false);
    });
    window.__portfolioThemeMediaBound = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      api.syncBody();
      api.syncControls();
    }, { once: true });
  } else {
    api.syncBody();
    api.syncControls();
  }
})();
