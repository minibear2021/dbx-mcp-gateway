import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGateway } from '../src/server.mjs';

function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbx-gateway-e2e-'));
  const seen = [];

  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ headers: req.headers, method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'test-session' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamAddress = await listen(upstream);

  // 模拟 dbx 的 GET /api/auth/check：只有 dbx_session=valid-session 才已登录。
  const authServer = http.createServer((req, res) => {
    const authenticated = (req.headers.cookie || '').includes('dbx_session=valid-session');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ authenticated, required: true, setup_required: false }));
  });
  const authAddress = await listen(authServer);

  const gateway = createGateway({
    dataDir: dir,
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamUrl: `http://127.0.0.1:${upstreamAddress.port}`,
    upstreamToken: 'internal-secret',
    upstreamMcpPath: '/mcp',
    publicMcpPath: '/mcp',
    dbxAuthCheckUrl: `http://127.0.0.1:${authAddress.port}/api/auth/check`,
    allowedOrigins: new Set(),
    ...overrides,
  });
  const { address } = await gateway.listen();

  t.after(async () => {
    await gateway.close();
    await close(upstream);
    await close(authServer);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function admin(method, endpoint, { body, cookie = 'dbx_session=valid-session' } = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  async function mcp(token, init = {}, mcpPath = '/mcp') {
    return fetch(`${baseUrl}${mcpPath}`, {
      method: 'POST',
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        'content-type': 'application/json',
        ...init.headers,
      },
      body: init.body ?? JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
  }

  return { gateway, seen, baseUrl, adminUrl: baseUrl, admin, mcp, upstreamAddress, authAddress };
}

test('多 token 校验通过；网关注入内部 token 并重写 Host、剥离 Origin/Cookie', async (t) => {
  const { seen, admin, mcp, upstreamAddress } = await setup(t);

  const a = (await admin('POST', '/tokens', { body: { label: '张三' } })).body;
  const b = (await admin('POST', '/tokens', { body: { label: '李四' } })).body;
  assert.notEqual(a.token, b.token);

  const response = await mcp(a.token, {
    headers: { origin: 'https://any-client.example', cookie: 'dbx_session=valid-session' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), 'test-session');
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.authorization, 'Bearer internal-secret');
  assert.equal(seen[0].headers.host, `127.0.0.1:${upstreamAddress.port}`);
  assert.equal(seen[0].headers.origin, undefined);
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[0].body.includes('initialize'), true);

  const second = await mcp(b.token);
  assert.equal(second.status, 200);
  assert.equal(seen.length, 2);
});

test('无效 token、缺失 token 与错误路径被拒绝', async (t) => {
  const { seen, admin, mcp, baseUrl } = await setup(t);
  await admin('POST', '/tokens', { body: { label: '张三' } });

  const invalid = await mcp('not-a-real-token');
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get('www-authenticate'), 'Bearer');

  const missing = await mcp(null);
  assert.equal(missing.status, 401);

  const wrongPath = await fetch(`${baseUrl}/other`, {
    method: 'POST',
    headers: { authorization: 'Bearer anything' },
  });
  assert.equal(wrongPath.status, 404);
  assert.equal(seen.length, 0);
});

test('管理 API：仅 dbx 会话可用；列表脱敏、禁用/启用、轮换', async (t) => {
  const { admin, mcp } = await setup(t);

  assert.equal((await admin('GET', '/tokens', { cookie: null })).status, 401);
  assert.equal((await admin('GET', '/tokens', { cookie: 'dbx_session=wrong' })).status, 401);

  const created = (await admin('POST', '/tokens', { body: { label: '王五', note: '测试组' } })).body;
  const list = (await admin('GET', '/tokens')).body.tokens;
  assert.equal(list.length, 1);
  assert.equal('token' in list[0], false);
  assert.equal('hash' in list[0], false);

  assert.equal((await mcp(created.token)).status, 200);
  const disabled = await admin('POST', `/tokens/${created.id}/disable`);
  assert.equal(disabled.body.status, 'disabled');
  assert.equal((await mcp(created.token)).status, 401);

  const enabled = await admin('POST', `/tokens/${created.id}/enable`);
  assert.equal(enabled.body.status, 'active');
  assert.equal((await mcp(created.token)).status, 200);

  const rotated = (await admin('POST', `/tokens/${created.id}/rotate`)).body;
  assert.notEqual(rotated.token, created.token);
  assert.equal((await mcp(created.token)).status, 401);
  assert.equal((await mcp(rotated.token)).status, 200);

  assert.equal((await admin('DELETE', `/tokens/${created.id}`)).status, 204);
  assert.equal((await admin('GET', '/tokens')).body.tokens.length, 0);
});

test('Web UI 与 MCP 共用同一个 4225 端口；页面不再包含管理口令', async (t) => {
  const { admin, baseUrl, mcp } = await setup(t);

  for (const uiPath of ['/', '/ui', '/index.html']) {
    const response = await fetch(`${baseUrl}${uiPath}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /DBX MCP Token 管理/);
    assert.match(html, /使用 dbx 登录态继续/);
    assert.doesNotMatch(html, /管理口令/);
    assert.doesNotMatch(html, /type="password"/);
    assert.match(html, /\/audit\?limit=50/);
  }

  const config = await fetch(`${baseUrl}/ui/config`).then((response) => response.json());
  assert.equal(config.apiBase, '');
  assert.equal('authMode' in config, false);

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);

  const created = (await admin('POST', '/tokens', { body: { label: '同端口验证' } })).body;
  assert.equal((await mcp(created.token)).status, 200);
});

test('管理 API 拒绝单独提供的 Bearer 凭据', async (t) => {
  const { baseUrl } = await setup(t);
  const response = await fetch(`${baseUrl}/tokens`, {
    headers: { authorization: 'Bearer admin-secret' },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'admin_unauthorized', auth: 'dbx_session_required' });
});

test('dbx 会话透传：Cookie 原样送到 /api/auth/check，响应标记 via=dbx', async (t) => {
  const { admin, authAddress } = await setup(t);
  const result = await admin('GET', '/tokens', { cookie: 'dbx_session=valid-session; other=1' });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-dbx-gateway-auth'), 'dbx');
  assert.ok(authAddress.port > 0);
});

test('DBX_PUBLIC_BASE_PATH：UI、管理 API 与 MCP 在带前缀路径下仍共用 4225', async (t) => {
  const { admin, mcp, baseUrl } = await setup(t, { dbxBasePath: '/dbx' });

  const ui = await fetch(`${baseUrl}/dbx/ui`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /DBX MCP Token 管理/);

  const config = await fetch(`${baseUrl}/ui/config`).then((response) => response.json());
  assert.equal(config.apiBase, '/dbx');

  const created = (await admin('POST', '/dbx/tokens', { body: { label: '前缀用户' } })).body;
  assert.equal(created.label, '前缀用户');
  assert.equal((await mcp(created.token, {}, '/dbx/mcp')).status, 200);
});

test('Origin 白名单：合法 Origin 透出 CORS 头，非法 Origin 返回 403', async (t) => {
  const { admin, mcp } = await setup(t, { allowedOrigins: new Set(['https://allowed.example']) });
  const created = (await admin('POST', '/tokens', { body: { label: '浏览器客户端' } })).body;

  const allowed = await mcp(created.token, { headers: { origin: 'https://allowed.example' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');

  const blocked = await mcp(created.token, { headers: { origin: 'https://evil.example' } });
  assert.equal(blocked.status, 403);
});
