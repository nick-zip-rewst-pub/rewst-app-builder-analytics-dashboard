const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'rewst-override-tailwind.css'),
  'utf8'
);

function darkThemeVariables() {
  const match = css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/);
  assert.ok(match, 'dark theme variables should be defined');

  return Object.fromEntries(
    [...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((entry) => [
      entry[1],
      entry[2].trim(),
    ])
  );
}

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrast(first, second) {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test('dark theme has readable, visibly separated neutral surfaces', () => {
  const variables = darkThemeVariables();
  const page = variables['--theme-page'];
  const surface = variables['--theme-surface'];
  const text = variables['--theme-text'];
  const mutedText = variables['--theme-text-muted'];

  assert.ok(luminance(surface) >= 0.03, 'cards should not collapse into near-black');
  assert.ok(contrast(page, surface) >= 1.2, 'cards should separate from the page');
  assert.ok(contrast(text, surface) >= 7, 'body text should have strong contrast');
  assert.ok(contrast(mutedText, surface) >= 4.5, 'secondary text should remain readable');
});

test('dark theme turns solid metric gradients into neutral cards with accents', () => {
  for (const color of ['teal', 'fandango', 'orange', 'success', 'error', 'warning', 'snooze', 'bask']) {
    const selector = new RegExp(
      `:root\\[data-theme="dark"\\] \\.card-metric-${color}[^}]*background:\\s*var\\(--theme-surface-raised\\)`,
      's'
    );
    assert.match(css, selector, `${color} metric card should use the neutral raised surface`);
  }
});
