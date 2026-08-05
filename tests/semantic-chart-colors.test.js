const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readPage(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', 'pages', fileName), 'utf8');
}

function datasetBlock(source, label) {
  const match = source.match(new RegExp(`label:\\s*["']${label}["']([\\s\\S]*?)(?=\\n\\s*\\},)`));
  assert.ok(match, `${label} dataset should exist`);
  return match[1];
}

for (const fileName of ['overalldash.js', 'workflowdetail.js']) {
  test(`${fileName} execution chart uses the semantic theme palette`, () => {
    const source = readPage(fileName);
    const succeeded = datasetBlock(source, 'Succeeded');
    const failed = datasetBlock(source, 'Failed');

    assert.match(source, /const chartPalette\s*=\s*getDashboardChartPalette\(\)/);
    assert.match(succeeded, /borderColor:\s*chartPalette\.trendUp/);
    assert.match(succeeded, /backgroundColor:\s*chartPalette\.trendUpFill/);
    assert.match(failed, /borderColor:\s*chartPalette\.trendDown/);
    assert.match(failed, /backgroundColor:\s*chartPalette\.trendDownFill/);
  });
}
