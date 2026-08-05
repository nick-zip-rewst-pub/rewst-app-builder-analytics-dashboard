const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPreferenceStore,
  createThemeManager,
  readChartPalette,
  refreshCharts,
} = require('../src/theme-manager.js');

function fakeThemeDocument() {
  const toggle = {
    checked: false,
    listeners: new Map(),
    setAttribute(name, value) {
      this[name] = String(value);
    },
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    async dispatch(type) {
      await this.listeners.get(type)?.({ target: this });
    },
  };
  const icon = { textContent: 'dark_mode' };
  const label = {
    title: 'Use dark mode',
    setAttribute(name, value) {
      this[name] = String(value);
    },
  };

  return {
    documentElement: {
      dataset: {},
      style: {},
    },
    getElementById(id) {
      return id === 'theme-toggle' ? toggle : null;
    },
    querySelector(selector) {
      if (selector === '.theme-toggle-icon') return icon;
      if (selector === '.theme-toggle-label') return label;
      return null;
    },
  };
}

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    async load(key) {
      return values.get(key) ?? null;
    },
    async save(key, value) {
      values.set(key, value);
    },
  };
}

function fakeIndexedDbDatabase() {
  const stores = {
    cache_store: new Map(),
    preferences: new Map(),
  };

  function request(operation) {
    const result = {};
    queueMicrotask(() => {
      try {
        result.result = operation();
        result.onsuccess?.();
      } catch (error) {
        result.error = error;
        result.onerror?.();
      }
    });
    return result;
  }

  return {
    stores,
    transaction(storeName) {
      const values = stores[storeName];
      if (!values) throw new Error(`Missing object store: ${storeName}`);

      return {
        objectStore() {
          return {
            get(key) {
              return request(() => values.get(key));
            },
            put(record) {
              return request(() => {
                values.set(record.key, record);
                return record.key;
              });
            },
          };
        },
      };
    },
  };
}

test('init restores a saved dark theme to the root and switch', async () => {
  const storage = memoryStorage([['theme', 'dark']]);
  const document = fakeThemeDocument();
  const manager = createThemeManager({ document, storage });

  await manager.init();

  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.getElementById('theme-toggle').checked, true);
  assert.equal(document.getElementById('theme-toggle')['aria-checked'], 'true');
  assert.equal(document.querySelector('.theme-toggle-icon').textContent, 'light_mode');
  assert.equal(document.querySelector('.theme-toggle-label').title, 'Use light mode');
});

test('setTheme persists and applies a validated theme', async () => {
  const storage = memoryStorage();
  const document = fakeThemeDocument();
  const manager = createThemeManager({ document, storage });

  const result = await manager.setTheme('dark');

  assert.deepEqual(result, { theme: 'dark', persisted: true });
  assert.equal(await storage.load('theme'), 'dark');
  assert.equal(document.documentElement.dataset.theme, 'dark');
});

test('invalid saved values fall back to light', async () => {
  const document = fakeThemeDocument();
  const manager = createThemeManager({
    document,
    storage: memoryStorage([['theme', 'sepia']]),
  });

  assert.equal(await manager.init(), 'light');
  assert.equal(manager.getTheme(), 'light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.getElementById('theme-toggle').checked, false);
});

test('a persistence failure still applies the theme for this session', async () => {
  const document = fakeThemeDocument();
  const manager = createThemeManager({
    document,
    storage: {
      load: async () => null,
      save: async () => {
        throw new Error('blocked');
      },
    },
  });

  const result = await manager.setTheme('dark');

  assert.deepEqual(result, { theme: 'dark', persisted: false });
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(manager.getTheme(), 'dark');
});

test('setTheme rejects unsupported theme names without changing state', async () => {
  const document = fakeThemeDocument();
  const manager = createThemeManager({ document, storage: memoryStorage() });
  await manager.init();

  await assert.rejects(() => manager.setTheme('sepia'), /Unsupported theme/);
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(manager.getTheme(), 'light');
});

test('refreshCharts destroys existing charts before rendering once', () => {
  const destroyed = [];
  const ChartApi = {
    instances: new Map([
      [1, { destroy: () => destroyed.push(1) }],
      [2, { destroy: () => destroyed.push(2) }],
    ]),
  };
  let renders = 0;

  refreshCharts(ChartApi, () => {
    renders += 1;
  });

  assert.deepEqual(destroyed, [1, 2]);
  assert.equal(renders, 1);
});

test('theme preference survives clearing the analytics cache store', async () => {
  const database = fakeIndexedDbDatabase();
  const preferences = createPreferenceStore({
    getDatabase: async () => database,
    storeName: 'preferences',
  });
  database.stores.cache_store.set('rewst_dashboard_cache_org_30_v2.5', { data: [1, 2, 3] });

  await preferences.save('theme', 'dark');
  database.stores.cache_store.clear();

  assert.equal(await preferences.load('theme'), 'dark');
  assert.equal(database.stores.cache_store.size, 0);
  assert.equal(database.stores.preferences.size, 1);
});

test('missing IndexedDB preference loads as null', async () => {
  const database = fakeIndexedDbDatabase();
  const preferences = createPreferenceStore({
    getDatabase: async () => database,
    storeName: 'preferences',
  });

  assert.equal(await preferences.load('theme'), null);
});

test('readChartPalette returns trimmed semantic chart colors', () => {
  const values = new Map([
    ['--theme-text', ' #d6e0e5 '],
    ['--theme-text-muted', '#9fb0ba'],
    ['--theme-grid', 'rgba(214, 224, 229, 0.14)'],
    ['--theme-border', '#344652'],
    ['--theme-surface', '#18232d'],
    ['--theme-tooltip', 'rgba(8, 14, 20, 0.96)'],
    ['--theme-trend-up', '#72d6a1'],
    ['--theme-trend-up-fill', 'rgba(114, 214, 161, 0.12)'],
    ['--theme-trend-down', '#ff918d'],
    ['--theme-trend-down-fill', 'rgba(255, 145, 141, 0.12)'],
  ]);
  const palette = readChartPalette({}, () => ({
    getPropertyValue(name) {
      return values.get(name) || '';
    },
  }));

  assert.deepEqual(palette, {
    text: '#d6e0e5',
    mutedText: '#9fb0ba',
    grid: 'rgba(214, 224, 229, 0.14)',
    border: '#344652',
    surface: '#18232d',
    tooltipBackground: 'rgba(8, 14, 20, 0.96)',
    trendUp: '#72d6a1',
    trendUpFill: 'rgba(114, 214, 161, 0.12)',
    trendDown: '#ff918d',
    trendDownFill: 'rgba(255, 145, 141, 0.12)',
  });
});

test('theme callback observes the newly applied document theme', async () => {
  const document = fakeThemeDocument();
  const observedThemes = [];
  const manager = createThemeManager({
    document,
    storage: memoryStorage(),
    onThemeChange(theme) {
      observedThemes.push([theme, document.documentElement.dataset.theme]);
    },
  });

  await manager.setTheme('dark');

  assert.deepEqual(observedThemes, [['dark', 'dark']]);
});

test('refreshCharts safely rerenders when Chart.js is unavailable', () => {
  let renders = 0;

  assert.doesNotThrow(() => refreshCharts(null, () => {
    renders += 1;
  }));
  assert.equal(renders, 1);
});

test('bound switch changes theme even before dashboard data initialization', async () => {
  const document = fakeThemeDocument();
  const storage = memoryStorage();
  const manager = createThemeManager({ document, storage });
  await manager.init();

  assert.equal(manager.bindToggle(), true);
  const toggle = document.getElementById('theme-toggle');
  toggle.checked = true;
  await toggle.dispatch('change');

  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(await storage.load('theme'), 'dark');
});
