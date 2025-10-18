/**
 * Minimal smoke tests for /api/health and /api/db-check handlers.
 * We import compiled JS if available or TS via dynamic transpilation is not supported here,
 * so we test presence and basic function call with mock req/res.
 */

const path = require('path');
const fs = require('fs');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; console.log('JSON', this.statusCode, obj); return this; },
    setHeader(k, v) { this.headers[k] = v; },
    write(data) { /* swallow */ },
    end() { /* swallow */ }
  };
}

async function testHealth() {
  const p = path.join(process.cwd(), 'api', 'health.ts');
  if (!fs.existsSync(p)) throw new Error('api/health.ts missing');
  const mod = require('esbuild-register/dist/node').register();
  const handler = require(p).default;
  const req = { method: 'GET' };
  const res = mockRes();
  handler(req, res);
  if (res.statusCode !== 200) throw new Error('health endpoint did not return 200');
}

async function testDbCheck() {
  const p = path.join(process.cwd(), 'api', 'db-check.ts');
  if (!fs.existsSync(p)) throw new Error('api/db-check.ts missing');
  require('esbuild-register/dist/node').register();
  const handler = require(p).default;
  const req = { method: 'GET', headers: {} };
  const res = mockRes();
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://example'; // placeholder
  await handler(req, res);
  if (res.statusCode !== 200 && res.statusCode !== 500) throw new Error('db-check endpoint returned unexpected status');
}

(async () => {
  try {
    await testHealth();
    await testDbCheck();
    console.log('Smoke tests passed.');
  } catch (e) {
    console.error('Smoke tests failed:', e);
    process.exit(1);
  }
})();