# Rewst Analytics Dashboard

A comprehensive analytics dashboard for Rewst, built with modular JavaScript components.

## Quick Start

```bash
# Install dependencies (none required - just Node.js)

# Build the combined dashboard
node build.js

# Output is in dist/dashboard.html - copy this into Rewst
```

## Project Structure

```
├── src/
│   ├── styles/
│   │   └── theme.css           # Tailwind overrides & Rewst theme
│   ├── lib/
│   │   ├── rewst-graphql.js    # GraphQL API wrapper
│   │   └── rewst-dom.js        # DOM builder utilities
│   └── pages/
│       ├── overall.js          # Main dashboard overview
│       ├── workflow-details.js # Workflow detail view
│       ├── form-details.js     # Form detail view
│       ├── insights.js         # Insights page
│       └── adoption.js         # Adoption metrics page
├── dist/
│   └── dashboard.html          # Combined output (generated)
├── build.js                    # Combines src files into dist/
└── publish.js                  # (Dev) Copies from dev workspace
```

## How It Works

The `build.js` script takes `src/template.html` and replaces markers like `{{ CSS_THEME }}` with the actual file contents, producing a single `dist/dashboard.html` file ready to paste into Rewst.

## Markers

| Marker | Source File |
|--------|-------------|
| `{{ CSS_THEME }}` | src/styles/theme.css |
| `{{ GRAPHQL_LIB }}` | src/lib/rewst-graphql.js |
| `{{ DOM_BUILDER }}` | src/lib/rewst-dom.js |
| `{{ PAGE_OVERALL }}` | src/pages/overall.js |
| `{{ PAGE_WORKFLOW }}` | src/pages/workflow-details.js |
| `{{ PAGE_FORM }}` | src/pages/form-details.js |
| `{{ PAGE_INSIGHTS }}` | src/pages/insights.js |
| `{{ PAGE_ADOPTION }}` | src/pages/adoption.js |

## Customization

1. Fork this repo
2. Edit the source files in `src/`
3. Run `node build.js`
4. Copy `dist/dashboard.html` into your Rewst app
