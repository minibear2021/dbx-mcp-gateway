import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicMcpPath, loadConfig } from './config.mjs';
import { TokenStore } from './token-store.mjs';
import { AuditLog } from './audit.mjs';
import { createProxyHandler } from './proxy.mjs';
import { createAdminHandler } from './admin.mjs';

function listenOn(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function displayHost(address) {
  if (!address || typeof address === 'string') return String(address);
  const host = ['0.0.0.0', '::'].includes(address.address) ? 'localhost' : address.address;
  return `${host}:${address.port}`;
}

/** 单端口分流：MCP 路径走代理，Web UI / 管理 API 走管理处理器。 */
export function createGatewayHandler(config, store, audit) {
  const proxyHandler = createProxyHandler(config, store, audit);
  const adminHandler = createAdminHandler(config, store, audit);

  return function gatewayHandler(req, res) {
    const pathname = new URL(req.url || '/', 'http://gateway.local').pathname;
    if (isPublicMcpPath(pathname, config)) {
      proxyHandler(req, res);
      return;
    }
    adminHandler(req, res);
  };
}

export function createGateway(overrides = {}) {
  const config = loadConfig(overrides);
  const store = new TokenStore(config.tokensFile);
  const audit = new AuditLog(config.auditFile, config.auditEnabled);
  const server = http.createServer(createGatewayHandler(config, store, audit));

  return {
    config,
    store,
    audit,
    server,
    async listen() {
      const address = await listenOn(server, config.listenPort, config.listenHost);
      return { address };
    },
    async close() {
      store.close();
      // fetch/keep-alive 连接会拖住 server.close；先释放空闲连接再优雅关闭。
      server.closeIdleConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function startGateway(overrides = {}) {
  const gateway = createGateway(overrides);
  const { address } = await gateway.listen();
  const uiPath = gateway.config.dbxBasePath ? `${gateway.config.dbxBasePath}/ui` : '/ui';
  console.log(`[mcp-token-gateway] MCP 端点: http://${displayHost(address)}${gateway.config.publicMcpPath}`);
  console.log(`[mcp-token-gateway] Web UI / 管理 API: http://${displayHost(address)}${uiPath}`);
  console.log('[mcp-token-gateway] 管理鉴权: 复用 dbx Web 会话（不提供独立管理口令）');
  console.log(`[mcp-token-gateway] 上游: ${gateway.config.upstreamUrl}${gateway.config.upstreamMcpPath}`);

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[mcp-token-gateway] 收到 ${signal}，正在关闭…`);
    await gateway.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  return gateway;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await startGateway();
}
