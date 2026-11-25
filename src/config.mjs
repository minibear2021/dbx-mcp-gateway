import path from 'node:path';

const ENV_PREFIX = 'MCP_GATEWAY_';

function env(name, fallback) {
  const value = process.env[`${ENV_PREFIX}${name}`];
  return value === undefined || value === '' ? fallback : value;
}

/** 把 DBX_PUBLIC_BASE_PATH 规范成 '' 或 '/dbx' 形式。 */
export function normalizeBasePath(value) {
  if (!value || value === '/') return '';
  const trimmed = String(value).trim().replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** 去掉 dbx 的 base path，返回以 / 开头的路径；不匹配时原样返回。 */
export function stripBasePath(pathname, basePath) {
  const base = normalizeBasePath(basePath);
  if (!base) return pathname;
  if (pathname === base) return '/';
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length);
  return pathname;
}

function parseOrigins(raw) {
  return new Set(
    String(raw)
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function resolveDataDir(overrides = {}) {
  return path.resolve(overrides.dataDir ?? env('DATA_DIR', path.resolve(process.cwd(), '.gateway-data')));
}

const RESERVED_PATHS = new Set(['/', '/ui', '/ui/', '/index.html', '/ui/config', '/healthz', '/favicon.ico', '/tokens', '/audit']);

export function loadConfig(overrides = {}) {
  const dataDir = resolveDataDir(overrides);
  const upstreamToken = overrides.upstreamToken ?? env('UPSTREAM_TOKEN', '');
  if (!upstreamToken) {
    throw new Error('缺少 MCP_GATEWAY_UPSTREAM_TOKEN：这是网关转发给 dbx 的内部 token，必须配置。');
  }

  const upstreamUrl = new URL(overrides.upstreamUrl ?? env('UPSTREAM_URL', 'http://dbx:4224'));
  if (!['http:', 'https:'].includes(upstreamUrl.protocol)) {
    throw new Error('MCP_GATEWAY_UPSTREAM_URL 只支持 http/https。');
  }
  upstreamUrl.pathname = '/';
  upstreamUrl.search = '';
  upstreamUrl.hash = '';

  const upstreamMcpPath = overrides.upstreamMcpPath ?? env('UPSTREAM_MCP_PATH', '/mcp');
  const derivedBasePath = upstreamMcpPath.endsWith('/mcp') ? upstreamMcpPath.slice(0, -'/mcp'.length) : '';
  const dbxBasePath = normalizeBasePath(overrides.dbxBasePath ?? env('DBX_BASE_PATH', derivedBasePath));
  const publicMcpPath = overrides.publicMcpPath ?? env('PUBLIC_MCP_PATH', '/mcp');
  const publicMcpLocalPath = stripBasePath(publicMcpPath, dbxBasePath);

  if (!publicMcpPath.startsWith('/') || RESERVED_PATHS.has(publicMcpLocalPath)) {
    throw new Error('MCP_GATEWAY_PUBLIC_MCP_PATH 不能是 Web UI 或管理 API 的保留路径。');
  }

  const dbxAuthCheckUrl =
    overrides.dbxAuthCheckUrl ??
    env('DBX_AUTH_CHECK_URL', `${upstreamUrl.origin}${dbxBasePath}/api/auth/check`);
  const dbxWebUrl = overrides.dbxWebUrl ?? env('DBX_WEB_URL', '');
  const listenPort = Number(overrides.listenPort ?? env('LISTEN_PORT', '4225'));
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    throw new Error('MCP_GATEWAY_LISTEN_PORT 必须是 0-65535 的整数（0 表示随机端口）。');
  }

  // 是否信任前置反向代理传来的 X-Forwarded-For / X-Real-IP。
  // Docker 端口映射场景下 socket 对端只是网桥网关，拿不到真实客户端 IP；
  // 只有在网关前面放了会设置代理头的反向代理时，才应开启此开关。
  const trustProxyRaw = overrides.trustProxy ?? env('TRUST_PROXY', '0');
  const trustProxy = typeof trustProxyRaw === 'boolean'
    ? trustProxyRaw
    : ['1', 'true', 'yes', 'on'].includes(String(trustProxyRaw).toLowerCase());

  return {
    dataDir,
    tokensFile: path.join(dataDir, 'tokens.json'),
    auditFile: path.join(dataDir, 'audit.jsonl'),
    listenHost: overrides.listenHost ?? env('LISTEN_HOST', '0.0.0.0'),
    listenPort,
    publicMcpPath,
    publicMcpLocalPath,
    upstreamMcpPath,
    upstreamUrl: upstreamUrl.origin,
    upstreamToken,
    dbxBasePath,
    dbxAuthCheckUrl,
    dbxWebUrl,
    trustProxy,
    allowedOrigins: overrides.allowedOrigins instanceof Set
      ? overrides.allowedOrigins
      : parseOrigins(overrides.allowedOrigins ?? env('ALLOWED_ORIGINS', '')),
    auditEnabled: overrides.auditEnabled ?? env('AUDIT', '1') !== '0',
  };
}

/** MCP 路径与 Web UI / 管理 API 共用同一个监听端口，此处按路径分流。 */
export function isPublicMcpPath(pathname, config) {
  return stripBasePath(pathname, config.dbxBasePath) === config.publicMcpLocalPath;
}

/** CLI 访问网关的地址；MCP、Web UI、管理 API 现在都是同一个端口。 */
export function resolveGatewayBaseUrl() {
  const explicit = process.env[`${ENV_PREFIX}URL`];
  if (explicit) return explicit.replace(/\/+$/, '');
  return `http://127.0.0.1:${env('LISTEN_PORT', '4225')}`;
}
