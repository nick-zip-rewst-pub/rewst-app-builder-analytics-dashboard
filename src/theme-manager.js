(function attachRewstTheme(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.RewstTheme = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRewstThemeApi() {
  const THEME_KEY = 'theme';
  const DEFAULT_THEME = 'light';
  const SUPPORTED_THEMES = new Set(['light', 'dark']);

  function assertTheme(theme) {
    if (!SUPPORTED_THEMES.has(theme)) {
      throw new Error(`Unsupported theme: ${theme}`);
    }
    return theme;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function createPreferenceStore({ getDatabase, storeName = 'preferences' }) {
    if (typeof getDatabase !== 'function') {
      throw new Error('Preference store requires a database provider');
    }

    return {
      async load(key) {
        const database = await getDatabase();
        const store = database.transaction(storeName, 'readonly').objectStore(storeName);
        const record = await requestResult(store.get(key));
        return record?.value ?? null;
      },

      async save(key, value) {
        const database = await getDatabase();
        const store = database.transaction(storeName, 'readwrite').objectStore(storeName);
        await requestResult(store.put({ key, value }));
      },
    };
  }

  function createThemeManager({ document, storage, onThemeChange = () => {} }) {
    if (!document?.documentElement) {
      throw new Error('Theme manager requires a document root');
    }

    let currentTheme = DEFAULT_THEME;
    let toggleBound = false;

    function syncControls(theme) {
      const toggle = document.getElementById?.('theme-toggle');
      const isDark = theme === 'dark';
      const actionLabel = isDark ? 'Use light mode' : 'Use dark mode';

      if (toggle) {
        toggle.checked = isDark;
        toggle.setAttribute?.('aria-checked', String(isDark));
        toggle.setAttribute?.('aria-label', actionLabel);
      }

      const icon = document.querySelector?.('.theme-toggle-icon');
      if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';

      const label = document.querySelector?.('.theme-toggle-label');
      if (label) label.title = actionLabel;
    }

    function applyTheme(theme) {
      currentTheme = assertTheme(theme);
      document.documentElement.dataset.theme = currentTheme;
      syncControls(currentTheme);
      onThemeChange(currentTheme);
      return currentTheme;
    }

    const manager = {
      async init() {
        let storedTheme = null;
        try {
          storedTheme = await storage?.load?.(THEME_KEY);
        } catch (_error) {
          storedTheme = null;
        }

        return applyTheme(SUPPORTED_THEMES.has(storedTheme) ? storedTheme : DEFAULT_THEME);
      },

      async setTheme(theme) {
        applyTheme(theme);
        let persisted = true;

        try {
          await storage?.save?.(THEME_KEY, currentTheme);
        } catch (_error) {
          persisted = false;
        }

        return { theme: currentTheme, persisted };
      },

      async toggle() {
        return this.setTheme(currentTheme === 'dark' ? 'light' : 'dark');
      },

      bindToggle({ onPersistenceError = () => {} } = {}) {
        const toggle = document.getElementById?.('theme-toggle');
        if (!toggle?.addEventListener || toggleBound) return Boolean(toggle);

        toggle.addEventListener('change', async () => {
          const result = await manager.setTheme(toggle.checked ? 'dark' : 'light');
          if (!result.persisted) onPersistenceError(result.theme);
        });
        toggleBound = true;
        return true;
      },

      getTheme() {
        return currentTheme;
      },
    };

    return manager;
  }

  function refreshCharts(ChartApi, renderCurrentPage) {
    if (ChartApi?.instances) {
      const instances = typeof ChartApi.instances.values === 'function'
        ? Array.from(ChartApi.instances.values())
        : Object.values(ChartApi.instances);
      instances.forEach(chart => chart?.destroy?.());
    }

    renderCurrentPage?.();
  }

  function readChartPalette(root, getComputedStyleFn) {
    const styles = getComputedStyleFn(root);
    const read = property => styles.getPropertyValue(property).trim();

    return {
      text: read('--theme-text'),
      mutedText: read('--theme-text-muted'),
      grid: read('--theme-grid'),
      border: read('--theme-border'),
      surface: read('--theme-surface'),
      tooltipBackground: read('--theme-tooltip'),
      trendUp: read('--theme-trend-up'),
      trendUpFill: read('--theme-trend-up-fill'),
      trendDown: read('--theme-trend-down'),
      trendDownFill: read('--theme-trend-down-fill'),
    };
  }

  return {
    createPreferenceStore,
    createThemeManager,
    readChartPalette,
    refreshCharts,
  };
});
