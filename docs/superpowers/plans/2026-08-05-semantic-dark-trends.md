# Semantic Dark Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace harsh green/red metric trends and applicable success/failure chart series with the approved dark-mode mint/coral palette.

**Architecture:** Define semantic trend colors as light- and dark-theme CSS tokens, expose them through the existing `readChartPalette()` boundary, and consume that palette only in the two charts whose datasets explicitly mean Succeeded and Failed. Scope dark metric text overrides to neutral `.card-metric` cards so solid-color metrics retain white content.

**Tech Stack:** Plain CSS, browser JavaScript, Chart.js configuration, Node.js built-in test runner, existing `build.js` bundler.

## Global Constraints

- Dark positive/up color is `#72D6A1` and dark negative/down color is `#FF918D`.
- Solid metric cards keep white trend content.
- Only semantic Succeeded/Failed chart datasets change; total and categorical colors remain unchanged.
- IndexedDB and theme persistence remain unchanged.
- Rebuild `dist/dashboard-spa-main-compiled.html` after source changes.

---

### Task 1: Add tested semantic theme tokens

**Files:**
- Modify: `tests/theme-manager.test.js`
- Modify: `tests/theme-contrast.test.js`
- Modify: `src/theme-manager.js:145-158`
- Modify: `src/rewst-override-tailwind.css:28-60,1610-1645`

**Interfaces:**
- Consumes: CSS custom properties read by `readChartPalette(root, getComputedStyleFn)`.
- Produces: palette properties `trendUp`, `trendUpFill`, `trendDown`, and `trendDownFill`, each a CSS color string.

- [ ] **Step 1: Write failing palette and contrast tests**

Extend the `readChartPalette` fixture with these values and expect matching properties:

```js
['--theme-trend-up', '#72d6a1'],
['--theme-trend-up-fill', 'rgba(114, 214, 161, 0.12)'],
['--theme-trend-down', '#ff918d'],
['--theme-trend-down-fill', 'rgba(255, 145, 141, 0.12)'],
```

In `theme-contrast.test.js`, assert the dark token values are the approved hex colors and each has at least 4.5:1 contrast against `--theme-surface`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/theme-manager.test.js tests/theme-contrast.test.js`

Expected: FAIL because the tokens and palette properties do not exist.

- [ ] **Step 3: Add the tokens and palette properties**

Keep the existing light semantic colors in `:root`, add the approved mint/coral overrides in `:root[data-theme="dark"]`, and return all four values from `readChartPalette()`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/theme-manager.test.js tests/theme-contrast.test.js`

Expected: both files PASS.

### Task 2: Apply semantic colors to metric trends and applicable charts

**Files:**
- Create: `tests/semantic-chart-colors.test.js`
- Modify: `src/rewst-override-tailwind.css:1720-1795`
- Modify: `pages/overalldash.js:375-405`
- Modify: `pages/workflowdetail.js:310-335`

**Interfaces:**
- Consumes: `getDashboardChartPalette()` returning `trendUp`, `trendUpFill`, `trendDown`, and `trendDownFill`.
- Produces: scoped dark metric trend rules and Succeeded/Failed Chart.js datasets backed by theme tokens.

- [ ] **Step 1: Write a failing chart integration regression**

Read both page source files and assert that their `Succeeded` datasets use `chartPalette.trendUp` / `chartPalette.trendUpFill`, their `Failed` datasets use `chartPalette.trendDown` / `chartPalette.trendDownFill`, and that each chart acquires one `chartPalette` from `getDashboardChartPalette()` before constructing datasets.

- [ ] **Step 2: Run the chart regression and verify RED**

Run: `node --test tests/semantic-chart-colors.test.js`

Expected: FAIL because both pages hardcode saturated RGBA green/red.

- [ ] **Step 3: Add scoped metric CSS and consume the palette in both charts**

Add dark selectors for `.card-metric:not([class*="card-metric-"]) .text-green-600` and `.text-red-600` using the two semantic tokens. In each chart renderer, capture `const chartPalette = getDashboardChartPalette();` and use its semantic solid/fill properties for only the Succeeded and Failed datasets.

- [ ] **Step 4: Run the chart regression and focused theme tests**

Run: `node --test tests/semantic-chart-colors.test.js tests/theme-manager.test.js tests/theme-contrast.test.js`

Expected: all tests PASS.

### Task 3: Rebuild and verify the deployable artifact

**Files:**
- Modify (generated): `dist/dashboard-spa-main-compiled.html`

**Interfaces:**
- Consumes: updated CSS, theme manager, and page modules.
- Produces: the single deployable HTML bundle containing the new semantic colors.

- [ ] **Step 1: Rebuild the bundle**

Run: `node build.js`

Expected: 9 replacements and the compiled HTML updated.

- [ ] **Step 2: Run complete verification**

Run: `node --test tests/*.test.js && git diff --check`

Expected: every test passes and no whitespace errors are reported.

- [ ] **Step 3: Inspect the rendered dark dashboard**

Serve the rebuilt artifact locally and verify that neutral-card positive trends are mint, negative trends are coral, semantic chart series match, and solid/categorical colors remain unchanged.

- [ ] **Step 4: Commit the scoped implementation**

```bash
git add src/rewst-override-tailwind.css src/theme-manager.js pages/overalldash.js pages/workflowdetail.js tests/theme-manager.test.js tests/theme-contrast.test.js tests/semantic-chart-colors.test.js dist/dashboard-spa-main-compiled.html
git commit -m "fix: soften dark semantic trend colors"
```
