# Rewst Analytics Dashboard

An example of how to use the App Builder inside of the Rewst platform. This dashboard demonstrates building modular JavaScript components that compile into a single HTML file for deployment.

## Quick Start

```bash
# Build the combined dashboard
node build.js

# Output: dist/dashboard-spa-main-compiled.html
# Copy this into Rewst App Builder into a HTML component
```

## Project Structure

```
├── src/
│   ├── rewst-override-tailwind.css    # Tailwind overrides & Rewst theme
│   ├── zip-graphql-js-lib-v2-optimized.js  # GraphQL API wrapper
│   └── rewst-dom-builder.js           # DOM builder utilities
├── pages/
│   ├── overalldash.js                 # Main dashboard overview
│   ├── workflowdetail.js              # Workflow detail view
│   ├── formdetail.js                  # Form detail view
│   ├── insightsdetail.js              # Insights page
│   └── adoptiondetail.js              # Adoption metrics page
├── dashboard-spa-main-template.html   # HTML template with markers
├── dist/
│   └── dashboard-spa-main-compiled.html  # Combined output (generated)
└── build.js                           # Combines files into dist/
```

## How It Works

The `build.js` script takes `dashboard-spa-main-template.html` and replaces markers like `{{ CSS_THEME }}` with the actual file contents, producing a single `dist/dashboard-spa-main-compiled.html` file ready to paste into Rewst App Builder.

## Markers

| Marker | Source File |
|--------|-------------|
| `{{ CSS_THEME }}` | src/rewst-override-tailwind.css |
| `{{ GRAPHQL_LIB }}` | src/zip-graphql-js-lib-v2-optimized.js |
| `{{ DOM_BUILDER }}` | src/rewst-dom-builder.js |
| `{{ PAGE_OVERALL }}` | pages/overalldash.js |
| `{{ PAGE_WORKFLOW }}` | pages/workflowdetail.js |
| `{{ PAGE_FORM }}` | pages/formdetail.js |
| `{{ PAGE_INSIGHTS }}` | pages/insightsdetail.js |
| `{{ PAGE_ADOPTION }}` | pages/adoptiondetail.js |

## Customization

1. Fork this repo
2. Edit the source files in `src/` and `pages/`
3. Run `node build.js`
4. Copy `dist/dashboard-spa-main-compiled.html` into your Rewst App Builder
