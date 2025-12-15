#!/usr/bin/env node
/**
 * Build Script
 * Combines all source files into a single dashboard.html
 *
 * Usage: node build.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = __dirname;
const TEMPLATE_PATH = path.join(REPO_ROOT, 'dashboard-spa-main-template.html');
const OUTPUT_PATH = path.join(REPO_ROOT, 'dist/dashboard-spa-main-compiled.html');

// Markers in template and their corresponding source files
const MARKERS = {
  '{{ CSS_THEME }}': 'src/rewst-override-tailwind.css',
  '{{ GRAPHQL_LIB }}': 'src/zip-graphql-js-lib-v2-optimized.js',
  '{{ DOM_BUILDER }}': 'src/rewst-dom-builder.js',
  '{{ PAGE_OVERALL }}': 'pages/overalldash.js',
  '{{ PAGE_WORKFLOW }}': 'pages/workflowdetail.js',
  '{{ PAGE_FORM }}': 'pages/formdetail.js',
  '{{ PAGE_INSIGHTS }}': 'pages/insightsdetail.js',
  '{{ PAGE_ADOPTION }}': 'pages/adoptiondetail.js',
};

console.log('🔨 Building dashboard.html...\n');

// Check template exists
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error('❌ Template not found: src/template.html');
  console.error('   Run "node publish.js" first to copy files from dev workspace');
  process.exit(1);
}

let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
let replacements = 0;

for (const [marker, filePath] of Object.entries(MARKERS)) {
  const fullPath = path.join(REPO_ROOT, filePath);

  if (!template.includes(marker)) {
    console.log(`⚠️  Marker not found in template: ${marker}`);
    continue;
  }

  if (!fs.existsSync(fullPath)) {
    console.log(`❌ File not found: ${filePath}`);
    continue;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  template = template.replaceAll(marker, () => content);
  console.log(`✅ ${marker} → ${filePath}`);
  replacements++;
}

// Ensure dist directory exists
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

// Write output
fs.writeFileSync(OUTPUT_PATH, template);

console.log(`\n📊 Done: ${replacements} replacements made`);
console.log(`📄 Output: dist/dashboard.html`);

// Show file size
const stats = fs.statSync(OUTPUT_PATH);
const sizeKB = (stats.size / 1024).toFixed(1);
console.log(`📏 Size: ${sizeKB} KB`);
