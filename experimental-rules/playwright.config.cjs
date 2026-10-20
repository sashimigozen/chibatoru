const path = require('node:path');
module.exports = {
  testDir: __dirname,
  testMatch: 'new-rules.spec.cjs',
  workers: 1,
  reporter: 'line',
  outputDir: path.join(require('node:os').tmpdir(), 'chibatoru-new-rules-test-results'),
  use: { viewport: { width: 1440, height: 1000 } }
};
