const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const compiledDashboard = path.join(repositoryRoot, 'dist/dashboard-spa-main-compiled.html');

test('build embeds the persistent theme feature in the compiled dashboard', () => {
  execFileSync(process.execPath, ['build.js'], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });

  const compiled = fs.readFileSync(compiledDashboard, 'utf8');

  assert.doesNotMatch(compiled, /\{\{ THEME_MANAGER \}\}/);
  assert.match(compiled, /function attachRewstTheme/);
  assert.match(compiled, /id="theme-toggle"/);
  assert.match(compiled, /IDB_PREFERENCES_STORE_NAME = 'preferences'/);
});
