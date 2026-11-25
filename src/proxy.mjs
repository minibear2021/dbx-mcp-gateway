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

// 只采样请求体开头字节用于提取 JSON-RPC 调用摘要（方法、工具名、参数）。
const MAX_BODY_SAMPLE = 16384;
const MAX_ARG_STRING = 2000;
const MAX_ARGS_JSON = 6000;

// 参数中这些字段一律脱敏，不写入审计日志。
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|api[_-]?key|credential|authorization|cookie|private[_-]?key/i;

function sanitizeArg(key, value, depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '***';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, MAX_ARG_STRING);
  if (Array.isArray(value)) {
    if (depth >= 3) return `[${value.length} items]`;
    return value.slice(0, 30).map((item) => sanitizeArg('', item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 3) return '[nested object]';
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 40)) {
      result[childKey] = sanitizeArg(childKey, childValue, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, MAX_ARG_STRING);
}

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

/** 从请求体采样中提取 JSON-RPC 方法、工具名与脱敏后的调用参数。 */
function extractRpcInfo(chunks) {
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  let method;
  try {
    const payload = JSON.parse(text);
    const first = Array.isArray(payload) ? payload[0] : payload;
    if (first && typeof first.method === 'string') method = first.method;
    if (method === 'tools/call' && first.params && typeof first.params.name === 'string') {
      const result = { mcpMethod: method.slice(0, 100), mcpTool: first.params.name.slice(0, 200) };
      if (first.params.arguments !== undefined) {
        const safe = sanitizeArg('arguments', first.params.arguments);
        let json = JSON.stringify(safe);
        if (json.length > MAX_ARGS_JSON) json = `${json.slice(0, MAX_ARGS_JSON)}…（已截断）`;
        result.mcpArgs = json;
      }
      return result;
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
