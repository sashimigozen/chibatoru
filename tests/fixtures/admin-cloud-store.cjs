// Test-only store for exercising the real authenticated HTTP pages without Cloudflare access.
const fs = require('node:fs');
const storagePath = process.env.CHIBATORU_TEST_CLOUD_LOG_FILE;
if (!storagePath) throw Error('Cloud log fixture is missing');
require('../../server/d1-log-store.js').createD1LogStore = () => ({
  async list(cursor = '') {
    const logs = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    return { logs: cursor ? logs.filter(log => log.gameId < cursor) : logs, nextCursor: '' };
  },
  async get(id) {
    return JSON.parse(fs.readFileSync(storagePath, 'utf8')).find(log => log.gameId === id) || null;
  },
  async put() {}
});
