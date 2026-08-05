# Dark Mode Design

## Goal

Add an explicit light/dark theme switch to the analytics dashboard. The selected theme must persist in IndexedDB and remain present when analytics caches are refreshed or cleared. The build must continue producing one deployable HTML file at `dist/dashboard-spa-main-compiled.html`.

## User Experience

- Add a compact sun/moon switch to the sidebar footer, above the conditional “Load Sub-Workflows” action.
- Light mode is the default when no preference has been saved.
- Changing the switch applies the theme immediately without reloading the page.
- The switch remains understandable when the sidebar is collapsed through its icon, accessible name, checked state, and tooltip.
- A saved preference is restored before the dashboard performs its initial page render.
- If IndexedDB is unavailable or fails, switching still works for the current page session, but the dashboard does not claim that the preference was persisted.

## Theme Architecture

The active theme is represented by `data-theme="light"` or `data-theme="dark"` on the document root. Theme ownership stays at this shared boundary rather than adding page-specific theme state.

The existing Rewst stylesheet will define semantic surface, text, border, input, overlay, and chart color variables for light mode, then replace their values under `[data-theme="dark"]`. Existing Rewst component rules will consume those variables. A small, explicit compatibility layer will remap the Tailwind neutral utility classes already emitted by the template and dynamic DOM builders, such as `bg-white`, `bg-gray-50`, `text-gray-700`, and `border-gray-200`. Broad substring selectors will not be used.

Brand and semantic colors—teal, fandango, orange, success, warning, and error—remain recognizable in both themes. Dark-mode variants may adjust brightness only where contrast requires it.

## Preference Storage

Upgrade `rewst_dashboard_db` from version 1 to version 2 and create a dedicated `preferences` object store with a `key` key path. Store the theme as a record equivalent to:

```js
{ key: 'theme', value: 'dark' }
```

Analytics data remains in `cache_store`. Existing cache clearing continues to clear only `cache_store`, so refreshes and cache invalidation cannot remove the theme preference. The database upgrade must create a missing cache store as well as the new preferences store, preserving existing records during normal version upgrades.

A focused theme manager will own:

- validating stored values (`light` or `dark` only);
- reading and writing the IndexedDB preference;
- applying the document attribute and synchronizing the switch;
- notifying chart rendering when the active palette changes;
- keeping the selected theme in memory if persistence fails.

No localStorage theme fallback will be introduced because the requested persistent owner is IndexedDB.

## Chart Behavior

Chart.js configuration must use a shared theme palette derived from CSS variables for text, gridlines, borders, tooltips, and canvas-specific labels. Hard-coded light-only values in page chart definitions and custom drawing plugins will be replaced only where they affect theme readability.

After a theme change, existing Chart.js instances will be destroyed and the current page renderer will run once so each chart is recreated with the new palette. Existing dashboard filtering and navigation behavior remains unchanged.

## Build Integration

Theme-manager JavaScript will live in a source file and be inserted into `dashboard-spa-main-template.html` through a build marker registered in `build.js`. Theme CSS remains in `src/rewst-override-tailwind.css`. Running `node build.js` will regenerate the tracked compiled HTML with all theme code embedded.

## Testing and Verification

Automated tests will be written before implementation and will verify:

- a stored dark preference is restored and applied;
- switching themes writes the validated value to the preferences store;
- invalid stored values fall back to light mode;
- clearing analytics caches does not delete the theme preference;
- theme changes synchronize the switch and trigger chart refresh behavior;
- the build includes the theme manager, switch markup, and dark-theme CSS in the compiled HTML.

After automated tests and `node build.js` pass, verify the compiled dashboard visually in both themes at the same viewport. Check the sidebar, sticky header, filters, cards, tables, form controls, overlays, and charts, then reload and confirm the saved theme is restored.

## Scope

This change does not alter analytics APIs, cached analytics data formats, filtering behavior, page navigation, schemas outside the browser's IndexedDB database, or deployment configuration. It does not add automatic operating-system theme detection.
