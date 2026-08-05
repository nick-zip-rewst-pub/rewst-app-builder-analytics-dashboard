# Dark Mode Legibility Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore muted solid-color dark-mode metric cards and make the sidebar action and reusable search fields match the approved dark-theme control system.

**Architecture:** Keep theme decisions in the existing CSS token layer, route reusable RewstDOM search inputs through the existing `form-input` contract, and reuse `btn-primary` for the sidebar action. The build process continues to fold all source changes into the single compiled HTML artifact.

**Tech Stack:** Plain CSS, browser DOM JavaScript, Node.js built-in test runner, existing `build.js` bundler.

## Global Constraints

- Use approved Option A muted solid metric colors in dark mode.
- Keep neutral accent-border metrics unchanged.
- Do not change IndexedDB, theme persistence, charts, filters, layout, or light-mode colors.
- Rebuild `dist/dashboard-spa-main-compiled.html` after source changes.

---

### Task 1: Restore readable solid metric colors

**Files:**
- Modify: `tests/theme-contrast.test.js`
- Modify: `src/rewst-override-tailwind.css:1610-1790`

**Interfaces:**
- Consumes: `:root[data-theme="dark"]` theme variables and existing `.card-metric-{color}` classes.
- Produces: `--theme-metric-{color}` tokens and dark-mode metric backgrounds with white-content contrast of at least 4.5:1.

- [ ] **Step 1: Replace the neutral-card regression with a failing solid-color behavior test**

Parse the dark theme variables and each dark metric rule, resolve its background token, and assert the background differs from `--theme-surface-raised` and has at least 4.5:1 contrast against `#ffffff` for teal, fandango, orange, success, error, warning, snooze, and bask.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/theme-contrast.test.js`

Expected: FAIL because every dark solid metric currently resolves to `var(--theme-surface-raised)`.

- [ ] **Step 3: Add muted solid metric tokens and backgrounds**

Add these dark tokens:

```css
--theme-metric-teal: #247e80;
--theme-metric-fandango: #8b426f;
--theme-metric-orange: #946221;
--theme-metric-success: #29756c;
--theme-metric-error: #874746;
--theme-metric-warning: #946221;
--theme-metric-snooze: #5f5686;
--theme-metric-bask: #874746;
```

Give each `.card-metric-{color}` its matching token as the complete `background`, and remove the dark-mode left-border overrides from solid metric classes. Do not alter `.card-accent-{color}`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/theme-contrast.test.js`

Expected: both dark-theme contrast tests PASS.

### Task 2: Route reusable controls through shared theme classes

**Files:**
- Create: `tests/rewst-dom-builder-theme.test.js`
- Modify: `src/rewst-dom-builder.js:535-560`
- Modify: `src/rewst-dom-builder.js:3425-3440`
- Modify: `dashboard-spa-main-template.html:203-209`

**Interfaces:**
- Consumes: `RewstDOM.createTable(data, options)`, `RewstDOM.createAutocomplete(items, options)`, `.form-input`, and `.btn-primary`.
- Produces: table and autocomplete inputs carrying `form-input`; sidebar action carrying `btn-primary` plus its existing full-width layout classes.

- [ ] **Step 1: Write failing real-component tests for the generated inputs**

Create a minimal fake DOM test utility that supports the real RewstDOM builders. Call `createAutocomplete([{ name: 'Workflow', id: '1' }])` and `createTable([{ name: 'Workflow' }], { searchable: true, sortable: false, pagination: false })`; recursively locate each generated `<input>` and assert its class list contains the literal `form-input` token.

- [ ] **Step 2: Run the generated-control tests and verify RED**

Run: `node --test tests/rewst-dom-builder-theme.test.js`

Expected: FAIL because both generated inputs omit `form-input`.

- [ ] **Step 3: Add the shared input class and unify the sidebar action**

Prepend `form-input` to both generated input class strings. Replace the Load Sub-Workflows button's custom `bg-rewst-teal ... text-white` recipe with:

```html
class="btn-primary flex items-center justify-center gap-2 w-full text-sm whitespace-nowrap"
```

- [ ] **Step 4: Run generated-control tests and verify GREEN**

Run: `node --test tests/rewst-dom-builder-theme.test.js`

Expected: both input-theme tests PASS.

### Task 3: Rebuild and verify the complete artifact

**Files:**
- Modify (generated): `dist/dashboard-spa-main-compiled.html`

**Interfaces:**
- Consumes: updated CSS, DOM builder, and template.
- Produces: deployable single-file dashboard with the approved dark-mode presentation.

- [ ] **Step 1: Rebuild the compiled dashboard**

Run: `node build.js`

Expected: 9 replacements and `dist/dashboard-spa-main-compiled.html` updated.

- [ ] **Step 2: Run all automated tests**

Run: `node --test tests/*.test.js`

Expected: every test passes with no failures.

- [ ] **Step 3: Run static verification**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Render and inspect dark mode**

Serve the rebuilt file locally, activate dark mode, and verify: muted teal/magenta solid metric fills; white metric content; identical Refresh and Load Sub-Workflows foreground treatment; raised-slate table search and workflow autocomplete backgrounds.

- [ ] **Step 5: Commit the scoped implementation**

```bash
git add src/rewst-override-tailwind.css src/rewst-dom-builder.js dashboard-spa-main-template.html dist/dashboard-spa-main-compiled.html tests/theme-contrast.test.js tests/rewst-dom-builder-theme.test.js
git commit -m "fix: refine dark dashboard controls and metrics"
```
