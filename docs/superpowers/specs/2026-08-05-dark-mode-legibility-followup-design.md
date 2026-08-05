# Dark Mode Legibility Follow-up Design

## Goal

Preserve the dashboard's solid-color metric cards while making the dark theme cohesive and legible. Correct the mismatched Load Sub-Workflows button and the browser-gray search/autocomplete fields shown in the published dashboard screenshots.

## Approved visual direction

Use the approved **Option A: muted brand solids** for metrics that opt into `solidBackground`:

- Teal metrics use a muted teal solid (`#247e80`).
- Fandango metrics use a muted magenta solid (`#8b426f`).
- Other supported metric colors receive equivalent darker, lower-saturation solid fills.
- Metric titles, descriptions, values, trends, and icons remain white or translucent white.
- Metrics that already use the neutral card plus colored left accent remain unchanged.

This restores the intentional visual emphasis of the first two metrics without returning to the overly bright gradients.

## Controls

The Load Sub-Workflows button will use the same `btn-primary` component class as Refresh while retaining its full-width sidebar layout. This removes its explicit white-text styling and makes both controls use the same dark-theme foreground, hover state, radius, and teal fill.

The filter outline button and the exclude-test toggle remain unchanged.

## Inputs

The two broken fields come from dynamically generated RewstDOM controls that are outside a `<form>` and do not carry the shared `form-input` class. Because the dark-theme selector misses them, the browser's dark color scheme supplies the gray background.

Add `form-input` to:

- Table search inputs created by the reusable table builder.
- Autocomplete/searchable-dropdown inputs, including the workflow selector.

They will then inherit the existing dark tokens: raised slate background, theme border, readable foreground and placeholder text, and the established focus ring. No blanket rule will style every input on the page.

## Trend colors

Dark-mode trend text on neutral metric cards will use softer semantic colors instead of Tailwind's saturated `green-600` and `red-600` values:

- Positive/up trends use soft mint `#72D6A1`.
- Negative/down trends use soft coral `#FF918D`.
- Neutral trends continue to use the theme's readable neutral text color.

The overrides apply only to trend content inside `.card-metric` while dark mode is active. They do not globally recolor green or red utility classes elsewhere in the dashboard. Solid metric cards continue using their existing white trend content.

## Semantic chart colors

Charts that explicitly encode success versus failure will use the same semantic palette as metric trends:

- Succeeded series use mint `#72D6A1` in dark mode.
- Failed series use coral `#FF918D` in dark mode.
- Each series uses a low-opacity version of the same color for its area fill.

The shared chart palette will expose solid and translucent trend tokens. The Overview and Workflow Detail execution timelines will read those tokens instead of hardcoding saturated green and red. Total-execution series, categorical chart palettes, and non-semantic chart colors remain unchanged.

## Build and persistence

No IndexedDB or theme-selection behavior changes. The theme palette reader gains semantic chart colors so charts pick up the correct values when the existing theme-change rerender runs. Rebuild `dist/dashboard-spa-main-compiled.html` from the existing template and source files.

## Verification

- Add a regression test that renders or inspects the generated control classes so both reusable search inputs participate in the theme contract.
- Replace the regression expectation that dark solid metrics become neutral cards with expectations for readable muted solid fills.
- Verify white metric content meets WCAG AA contrast against every dark solid metric color.
- Verify the mint and coral trend colors meet WCAG AA contrast against the dark metric-card surface.
- Verify semantic chart palette values are read from theme tokens and the success/failure datasets use them.
- Run the complete Node test suite and rebuild test.
- Render the rebuilt dark-mode dashboard shell and confirm controls and inputs use the intended palette.

## Scope

Only metric solid fills, metric trend colors, semantic success/failure chart series, the Load Sub-Workflows button, and reusable search/autocomplete inputs are in scope. Layout, categorical chart colors, filters, persistence, light-mode colors, and other dashboard components are unchanged.
