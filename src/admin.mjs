import { readFile } from 'node:fs/promises';
import { authorizeAdminRequest } from './admin-auth.mjs';
import { normalizeBasePath, stripBasePath } from './config.mjs';
import { WEB_UI_HTML } from './web-ui.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const FAVICON_SVG_URL = new URL('../assets/favicon.svg', import.meta.url);

function sendJson(res, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大。');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function createAdminHandler(config, store, audit) {
  return async function adminHandler(req, res) {
    const url = new URL(req.url || '/', 'http://gateway.local');
    const basePath = normalizeBasePath(config.dbxBasePath);
    const pathname = stripBasePath(url.pathname, basePath);
    const segments = pathname.split('/').filter(Boolean);

    const isUi = req.method === 'GET' && ['/', '/ui', '/ui/', '/index.html'].includes(pathname);
    const isUiConfig = req.method === 'GET' && pathname === '/ui/config';
    const isHealth = req.method === 'GET' && pathname === '/healthz';
    const isFavicon = req.method === 'GET' && pathname === '/favicon.ico';
    const isFaviconSvg = req.method === 'GET' && pathname === '/favicon.svg';
    const isAdminApi = ['tokens', 'audit'].includes(segments[0]);

    if (!isUi && !isUiConfig && !isHealth && !isFavicon && !isFaviconSvg && !isAdminApi) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    if (isHealth) {
      sendJson(res, 200, { ok: true, tokens: store.list().length });
      return;
    }

    // 页面启动配置：告诉前端 API 前缀与 dbx Web 登录入口。无需鉴权。
    if (isUiConfig) {
      sendJson(res, 200, {
        apiBase: basePath,
        dbxWebUrl: config.dbxWebUrl || '',
      });
      return;
    }

    // Web UI 与管理 API 共用 4225 端口；页面本身无需鉴权。
    if (isUi) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(WEB_UI_HTML),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(WEB_UI_HTML);
      return;
    }
    if (isFavicon) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (isFaviconSvg) {
      const body = await readFile(FAVICON_SVG_URL);
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
      return;
    }

    const auth = await authorizeAdminRequest(req, config);
    if (!auth.ok) {
      sendJson(res, 401, { error: 'admin_unauthorized', auth: 'dbx_session_required' });
      return;
    }
    res.setHeader('x-dbx-gateway-auth', auth.via);

    try {
      const [collection, id, action] = segments;

      if (collection === 'audit') {
        if (id || req.method !== 'GET') {
          sendJson(res, 405, { error: 'method_not_allowed' });
          return;
        }
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const safeLimit = Number.isFinite(limit) ? limit : 100;
        const safeOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;
        const filter = {
          tokenId: url.searchParams.get('tokenId') || undefined,
          event: url.searchParams.get('event') || undefined,
          user: url.searchParams.get('user') || undefined,
        };
        sendJson(res, 200, {
          entries: audit.read(safeLimit, filter, safeOffset),
          total: audit.count(filter),
          filter,
          limit: safeLimit,
          offset: safeOffset,
        });
        return;
      }

      // POST /tokens —— 新建 token
      if (!id && req.method === 'POST') {
        const body = await readJson(req);
        const result = store.create({ label: body.label, note: body.note, expiresAt: body.expiresAt });
        audit.append({ event: 'admin', action: 'create', tokenId: result.record.id, user: result.record.label, status: 201 });
        sendJson(res, 201, { ...result.record, token: result.token });
        return;
      }

      // GET /tokens —— 列表
      if (!id && req.method === 'GET') {
        sendJson(res, 200, { tokens: store.list() });
        return;
      }

      if (!id) {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }

      const existing = store.get(id);
      if (!existing) {
        sendJson(res, 404, { error: 'token_not_found' });
        return;
      }

      // POST /tokens/:id/rotate —— 轮换
      if (action === 'rotate' && req.method === 'POST') {
        const body = await readJson(req);
        const result = store.rotate(id, { expiresAt: body.expiresAt });
        audit.append({ event: 'admin', action: 'rotate', tokenId: id, user: result.record.label, status: 200 });
        sendJson(res, 200, { ...result.record, token: result.token });
        return;
      }

      // POST /tokens/:id/disable | enable
      if (action && ['disable', 'enable'].includes(action) && req.method === 'POST') {
        const status = action === 'enable' ? 'active' : 'disabled';
        const record = store.setStatus(id, status);
        audit.append({ event: 'admin', action, tokenId: id, user: record.label, status: 200 });
        sendJson(res, 200, record);
        return;
      }

      if (!action && req.method === 'GET') {
        sendJson(res, 200, existing);
        return;
      }

      if (!action && req.method === 'PATCH') {
        const body = await readJson(req);
        const record = store.update(id, body);
        audit.append({ event: 'admin', action: 'update', tokenId: id, user: record.label, status: 200 });
        sendJson(res, 200, record);
        return;
      }

      if (!action && req.method === 'DELETE') {
        store.remove(id);
        audit.append({ event: 'admin', action: 'delete', tokenId: id, user: existing.label, status: 204 });
        res.writeHead(204);
        res.end();
        return;
      }

      sendJson(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      sendJson(res, error instanceof SyntaxError || /请求体|日期/.test(error.message) ? 400 : 500, {
        error: error.message,
      });
    }
  };
}
