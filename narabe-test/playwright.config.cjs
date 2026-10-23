module.exports = {
  testDir: '../tests',
  testMatch: ['narabe.spec.js', 'narabe-specials.spec.js', 'four-mode.spec.js', 'desktop-ui.spec.js'],
  workers: 1,
  outputDir: '/tmp/chibatoru-narabe-qa',
  use: { headless: true },
  webServer: { command: 'NARABE_PORT=8791 node tools/serve-narabe-test.cjs', cwd: require('node:path').resolve(__dirname, '..'), url: 'http://127.0.0.1:8791/narabe-test/', reuseExistingServer: false }
};
