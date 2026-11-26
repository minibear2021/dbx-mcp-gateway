#!/usr/bin/env node
import { generateToken } from '../src/crypto-util.mjs';
import { resolveGatewayBaseUrl } from '../src/config.mjs';

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) {
      flags[key] = inline;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[key] = argv[++i];
    } else {
      flags[key] = 'true';
    }
  }
  return { positionals, flags };
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`错误：${message}\n`);
  process.exitCode = 1;
}

const USAGE = `用法：
  dbx-mcp-gateway serve
  dbx-mcp-gateway secret
  dbx-mcp-gateway token add --label "张三" [--note "说明"] [--expires-at 2027-01-01T00:00:00Z]
  dbx-mcp-gateway token list
  dbx-mcp-gateway token get <id>
  dbx-mcp-gateway token update <id> [--label ...] [--note ...] [--expires-at ...|\'\']
  dbx-mcp-gateway token rotate <id>
  dbx-mcp-gateway token disable <id>
  dbx-mcp-gateway token enable <id>
  dbx-mcp-gateway token remove <id>
  dbx-mcp-gateway audit [--limit 100] [--token-id <id>] [--event mcp|admin]

网关地址默认 http://127.0.0.1:4225（MCP 与管理界面共用），
可用 MCP_GATEWAY_URL 覆盖。

管理鉴权只复用 dbx Web 会话：
  用 --cookie 'dbx_session=...' 或 MCP_GATEWAY_DBX_COOKIE 传入浏览器中的会话 Cookie。
  该 Cookie 与 MCP 客户端 token 是两套凭据，不能互换。`;

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const [command, subcommand, id] = positionals;

  if (!command || flags.help || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (command === 'serve') {
    const { startGateway } = await import('../src/server.mjs');
    await startGateway();
    return;
  }

  if (command === 'secret') {
    print({ internalToken: generateToken('mcp_') });
    return;
  }

  const cookie = flags.cookie ?? process.env.MCP_GATEWAY_DBX_COOKIE ?? '';
  if (!cookie) {
    fail('请提供 dbx 会话 Cookie：--cookie \'dbx_session=...\' 或 MCP_GATEWAY_DBX_COOKIE。');
    return;
  }
  const baseUrl = resolveGatewayBaseUrl();

  async function call(method, endpoint, body) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      fail(`${method} ${endpoint} 失败（${response.status}）：${payload.error ?? JSON.stringify(payload)}`);
      return null;
    }
    return payload;
  }

  if (command === 'audit') {
    const params = new URLSearchParams({ limit: flags.limit ?? '100' });
    if (flags['token-id']) params.set('tokenId', flags['token-id']);
    if (flags.event) params.set('event', flags.event);
    const result = await call('GET', `/audit?${params.toString()}`);
    if (result) print(result.entries);
    return;
  }

  if (command !== 'token') {
    fail(`未知命令：${command}\n${USAGE}`);
    return;
  }

  switch (subcommand) {
    case 'add': {
      if (!flags.label) {
        fail('必须提供 --label（该 token 对应的用户备注）。');
        return;
      }
      const result = await call('POST', '/tokens', {
        label: flags.label,
        note: flags.note ?? '',
        expiresAt: flags['expires-at'] ?? null,
      });
      if (result) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.stderr.write('请保存上面的 token 明文：它只会显示这一次。\n');
      }
      return;
    }
    case 'list': {
      const result = await call('GET', '/tokens');
      if (result) print(result.tokens);
      return;
    }
    case 'get': {
      if (!id) return fail('缺少 token id。');
      const result = await call('GET', `/tokens/${encodeURIComponent(id)}`);
      if (result) print(result);
      return;
    }
    case 'update': {
      if (!id) return fail('缺少 token id。');
      const body = {};
      if (flags.label !== undefined) body.label = flags.label;
      if (flags.note !== undefined) body.note = flags.note;
      if (flags['expires-at'] !== undefined) body.expiresAt = flags['expires-at'];
      const result = await call('PATCH', `/tokens/${encodeURIComponent(id)}`, body);
      if (result) print(result);
      return;
    }
    case 'rotate': {
      if (!id) return fail('缺少 token id。');
      const body = flags['expires-at'] !== undefined ? { expiresAt: flags['expires-at'] } : {};
      const result = await call('POST', `/tokens/${encodeURIComponent(id)}/rotate`, body);
      if (result) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.stderr.write('旧 token 已立即失效；请保存上面的新 token，它只会显示这一次。\n');
      }
      return;
    }
    case 'disable':
    case 'enable': {
      if (!id) return fail('缺少 token id。');
      const result = await call('POST', `/tokens/${encodeURIComponent(id)}/${subcommand}`);
      if (result) print(result);
      return;
    }
    case 'remove': {
      if (!id) return fail('缺少 token id。');
      const result = await call('DELETE', `/tokens/${encodeURIComponent(id)}`);
      if (result) print({ removed: id });
      return;
    }
    default:
      fail(`未知子命令：${subcommand}\n${USAGE}`);
  }
}

await main();
