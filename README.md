# Rewst Analytics Dashboard

**Author:** Nick Zipse | https://github.com/nick-zip-rewst-pub

## Overview
This is an example of how to use the App Builder inside of the Rewst platform. This dashboard demonstrates building modular JavaScript components that compile into a single HTML file for deployment.

#### ⚠️  Disclaimer:
- This project is a **community contribution** and is **not an official Rewst product**. It is not developed, maintained, or supported by Rewst.



## Quick Start

Copy the entire contents of `dist/dashboard-spa-main-compiled.html` into a **HTML component** in Rewst App Builder. That's it - this single file contains all the CSS, JavaScript, and page logic needed to run the dashboard.

## Using the Dashboard

### Global Filters (Top Navigation)

- **Exclude Test Runs** - Toggle to filter out test workflow executions from all metrics
- **Tenant Filter** - Filter data by specific tenant/organization
- **Trigger Type** - Filter workflows by how they were triggered (manual, scheduled, webhook, etc.)

### Dashboard Overview

The main overview page shows high-level metrics including:
- Total workflow executions
- Success/failure rates
- Execution trends over time
- Top workflows by execution count

### Navigating to Details

- Click the **eyeball icon** in any table row to jump to a detailed view of that workflow or form
- Detail views show execution history, timing metrics, and error breakdowns

### Pages

| Page | Description |
|------|-------------|
| **Overview** | High-level metrics and trends across all workflows |
| **Workflow Detail** | Deep dive into a specific workflow's execution history, timing, and errors |
| **Form Detail** | Analytics for form submissions and completion rates |
| **Insights** | Aggregated insights and patterns across your automation |
| **Adoption** | Organization-level metrics showing form usage per org, user engagement, and adoption trends |

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
