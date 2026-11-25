import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { isPublicMcpPath } from './config.mjs';
import { parseBearer } from './crypto-util.mjs';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'origin',
  'authorization',
]);

// 只采样请求体开头少量字节用于识别 JSON-RPC 方法名，不记录请求正文。
const MAX_BODY_SAMPLE = 4096;

function filterRequestHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  return result;
}

function filterResponseHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'content-length') continue;
    result[name] = value;
  }
  return result;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(`${JSON.stringify(payload)}\n`);
}

/** 从请求体采样中只提取 JSON-RPC 的方法名与工具名，失败时返回空对象。 */
function extractRpcInfo(chunks) {
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  let method;
  try {
    const payload = JSON.parse(text);
    const first = Array.isArray(payload) ? payload[0] : payload;
    if (first && typeof first.method === 'string') method = first.method;
    if (method === 'tools/call' && first.params && typeof first.params.name === 'string') {
      return { mcpMethod: method.slice(0, 100), mcpTool: first.params.name.slice(0, 200) };
    }
  } catch {
    // 请求体可能被采样上限截断，退回用正则取方法名。
    const match = text.match(/"method"\s*:\s*"([^"]+)"/);
    if (match) method = match[1];
  }
  return method ? { mcpMethod: method.slice(0, 100) } : {};
}

export function createProxyHandler(config, store, audit) {
  const upstream = new URL(config.upstreamUrl);
  const agent = upstream.protocol === 'https:'
    ? new https.Agent({ keepAlive: true })
    : new http.Agent({ keepAlive: true, maxSockets: 256 });

  return function proxyHandler(req, res) {
    const startedAt = Date.now();
    const requestId = `req_${randomUUID()}`;
    const requestUrl = new URL(req.url || '/', 'http://gateway.local');
    const pathname = requestUrl.pathname;
    const remoteIp = req.socket.remoteAddress ?? '-';
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const ua = typeof req.headers['user-agent'] === 'string'
      ? req.headers['user-agent'].slice(0, 200)
      : undefined;

    let bytesIn = 0;
    let bytesOut = 0;
    const bodySample = [];
    let sampledBytes = 0;
    req.on('data', (chunk) => {
      bytesIn += chunk.length;
      if (sampledBytes < MAX_BODY_SAMPLE) {
        const take = Math.min(chunk.length, MAX_BODY_SAMPLE - sampledBytes);
        bodySample.push(chunk.subarray(0, take));
        sampledBytes += take;
      }
    });

    // 每个 MCP 请求只写一条审计；成功调用在响应结束时落盘。
    let recorded = false;
    const recordAudit = (status, reason, tokenRecord = null) => {
      if (recorded) return;
      recorded = true;
      audit.append({
        event: 'mcp',
        id: requestId,
        tokenId: tokenRecord?.id ?? '-',
        user: tokenRecord?.label ?? '-',
        method: req.method,
        path: pathname,
        status,
        reason,
        durationMs: Date.now() - startedAt,
        ip: remoteIp,
        bytesIn,
        bytesOut,
        ...(ua ? { ua } : {}),
        ...extractRpcInfo(bodySample),
      });
    };

    const applyCors = () => {
      if (!origin) return;
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID');
      res.setHeader('Access-Control-Max-Age', '600');
    };

    if (config.allowedOrigins.size > 0 && origin && !config.allowedOrigins.has(origin)) {
      sendJson(res, 403, { error: 'origin_not_allowed' });
      recordAudit(403, 'origin-not-allowed');
      return;
    }
    applyCors();

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 通常由 server.mjs 先分流；这里保留一道防线，避免误转发管理请求。
    if (!isPublicMcpPath(pathname, config)) {
      sendJson(res, 404, { error: 'not_found' });
      recordAudit(404, 'path-not-found');
      return;
    }

    const token = parseBearer(req.headers.authorization);
    if (!token) {
      sendJson(res, 401, { error: 'missing_or_invalid_bearer_token' }, { 'www-authenticate': 'Bearer' });
      recordAudit(401, 'missing-or-invalid-bearer-token');
      return;
    }

    const { record, reason } = store.verify(token);
    if (!record) {
      sendJson(res, 401, { error: 'token_rejected', reason }, { 'www-authenticate': 'Bearer' });
      recordAudit(401, reason);
      return;
    }

    // token 校验通过后：响应结束时统一记录这一次 MCP 调用（含成功与上游非 2xx）。
    res.on('finish', () => {
      const status = res.statusCode || 200;
      recordAudit(status, status >= 400 ? 'upstream-rejected' : 'ok', record);
    });

    const headers = filterRequestHeaders(req.headers);
    headers.authorization = `Bearer ${config.upstreamToken}`;
    headers.host = upstream.host;
    const forwardedFor = [remoteIp, req.headers['x-forwarded-for']].filter(Boolean).join(', ');
    headers['x-forwarded-for'] = forwardedFor;
    // 单端口下浏览器也会把 dbx_session 发到 /mcp；它与 MCP 鉴权无关，不透传给上游。
    delete headers.origin;
    delete headers.cookie;

    const target = new URL(config.upstreamUrl);
    target.pathname = config.upstreamMcpPath;
    target.search = requestUrl.search;

    const upstreamReq = (upstream.protocol === 'https:' ? https : http).request(
      target,
      { method: req.method, headers, agent },
      (upstreamRes) => {
        const status = upstreamRes.statusCode ?? 502;
        res.writeHead(status, filterResponseHeaders(upstreamRes.headers));
        upstreamRes.on('data', (chunk) => { bytesOut += chunk.length; });
        upstreamRes.pipe(res);
        upstreamRes.on('error', () => {
          recordAudit(502, 'upstream-stream-error', record);
          if (!res.writableEnded) res.destroy();
        });
      },
    );

    upstreamReq.on('error', () => {
      recordAudit(502, 'upstream-error', record);
      if (!res.headersSent) {
        sendJson(res, 502, { error: 'upstream_unavailable' });
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });

    req.on('aborted', () => upstreamReq.destroy());
    res.on('close', () => {
      if (!res.writableEnded) upstreamReq.destroy();
    });

    req.pipe(upstreamReq);
  };
}
