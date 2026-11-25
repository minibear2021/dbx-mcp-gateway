#!/usr/bin/env node
// 把 mcp-token-gateway 打包成 dbx Web 插件管理可本地安装的 .dbxp（未签名候选包）。
// 用法：node plugins/mcp-token-gateway/dbxp/package.mjs
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(pluginRoot, '..', '..');
const dist = path.join(pluginRoot, 'dist');
const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'dbx-mcp-gateway-dbxp-'));
const stage = path.join(buildRoot, 'stage');
const manifest = {
  manifest_version: 1,
  id: 'dbx.mcp.gateway',
  name: 'DBX MCP Gateway',
  version: '1.0.0',
  publisher: 'local',
  description: 'DBX Streamable MCP 的多 Token 前置网关资源包：包含网关源码、部署说明与工作台入口。',
  engines: {
    dbx: '>=0.5.68',
    host_api: '^1.5',
  },
  entrypoints: {
    ui: {
      root: 'ui',
      entry: 'ui/index.html',
    },
  },
  contributions: [
    {
      type: 'workbench',
      id: 'dbx.mcp.gateway.workbench',
      label: 'MCP Gateway',
      description: '查看多 Token 网关的安装与启动说明。',
    },
  ],
  localizations: {
    'zh-CN': {
      name: 'DBX MCP Token 网关',
      description: 'DBX Streamable MCP 多 Token 前置网关资源包，含源码与部署说明。',
      contributions: {
        'dbx.mcp.gateway.workbench': {
          label: 'MCP Token 网关',
          description: '查看多 Token 网关的安装与启动说明。',
        },
      },
    },
  },
};

const UI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DBX MCP Gateway</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--line:#e3e6eb;--text:#1f2430;--muted:#6b7280;--brand:#2563eb;--warn:#b45309}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:22px;margin:0 0 6px}
h2{font-size:16px;margin:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
.muted{color:var(--muted)}
.notice{border-left:4px solid var(--warn);background:#fffbeb;padding:12px 14px;border-radius:8px;margin:14px 0}
code,pre{background:#f3f4f6;border:1px solid var(--line);border-radius:8px;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}
code{padding:2px 6px}
pre{padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}
ol{padding-left:22px}
</style>
</head>
<body>
<div class="wrap">
<h1>DBX MCP Gateway</h1>
<p class="muted">多 Token · 用户备注 · 轮换 / 禁用 · Web UI · 审计</p>

<div class="notice">
<strong>请先了解边界：</strong>dbx 插件体系没有 HTTP 鉴权扩展点，也没有安装/启动钩子。
这个 <code>.dbxp</code> 是一个可安装的资源包，<strong>不会自动启动网关，也不会改变 dbx 的 MCP 鉴权</strong>。
真正生效的仍是按 compose 方式启动的网关服务。
</div>

<div class="card">
<h2>1. 本地安装本插件</h2>
<ol>
<li>在 dbx 服务进程设置 <code>DBX_ALLOW_UNSIGNED_PLUGINS=1</code>（未签名包必须显式允许）。</li>
<li>在 dbx Web → 插件管理 → 本地安装，选择本 <code>.dbxp</code>，并勾选允许未签名插件。</li>
<li>安装后可在工作台打开“MCP Token 网关”页查看本说明。</li>
</ol>
</div>

<div class="card">
<h2>2. 启动网关（在 dbx 项目根目录）</h2>
<pre>cp plugins/mcp-token-gateway/.env.example plugins/mcp-token-gateway/.env
node plugins/mcp-token-gateway/bin/dbx-mcp-gateway.mjs secret
# 把 internalToken 填入 DBX_MCP_INTERNAL_TOKEN

docker compose --project-directory . \\
  -f deploy/docker-compose.yml \\
  -f plugins/mcp-token-gateway/docker-compose.mcp-gateway.yml \\
  --env-file plugins/mcp-token-gateway/.env up -d --build</pre>
</div>

<div class="card">
<h2>3. 使用统一端口 4225</h2>
<p>MCP：<code>http://&lt;宿主机&gt;:4225/mcp</code></p>
<p>Web UI：<code>http://&lt;宿主机&gt;:4225/</code>（或 <code>/ui</code>）</p>
<p>管理鉴权只复用 dbx Web 会话 Cookie，浏览器访问 dbx Web 与网关 UI 请使用同一主机名。</p>
</div>

<div class="card">
<h2>4. 包内文件</h2>
<p><code>gateway/</code> 是完整网关源码与 compose 文件；<code>README.md</code> 是安装说明。
这些文件随插件一起安装到 dbx 的插件数据目录，仅供查看/复制，不会被插件运行时自动执行。</p>
</div>
</div>
</body>
</html>`;

const PACKAGE_README = `# DBX MCP Gateway .dbxp 资源包

这是一个**未签名候选包**，用 dbx 自带的 packager 构建，manifest 与 checksums 均符合 v1 规范。

## 能做什么

- 可通过 dbx Web 插件管理 → 本地安装（需服务端设置 \`DBX_ALLOW_UNSIGNED_PLUGINS=1\` 并允许未签名包）。
- 安装后在工作台提供“MCP Token 网关”说明页。
- 包内 \`gateway/\` 目录包含完整网关源码、Dockerfile、compose 覆盖文件、CLI、测试与文档。

## 不能做什么

- dbx 插件没有 HTTP middleware / auth hook，无法拦截 MCP Bearer 鉴权。
- \`.dbxp\` 没有 onInstall / onStartup / docker / node 启动钩子，安装本包不会自动启动网关。
- 本包不会修改 dbx 主项目，也不会替换 dbx 的 token 配置。

## 真正启动网关

在 dbx 项目根目录执行：

\`\`\`bash
cp plugins/mcp-token-gateway/.env.example plugins/mcp-token-gateway/.env
node plugins/mcp-token-gateway/bin/dbx-mcp-gateway.mjs secret
# 把 internalToken 填入 DBX_MCP_INTERNAL_TOKEN

docker compose --project-directory . \\
  -f deploy/docker-compose.yml \\
  -f plugins/mcp-token-gateway/docker-compose.mcp-gateway.yml \\
  --env-file plugins/mcp-token-gateway/.env up -d --build
\`\`\`

群晖 Container Manager 不想用隐藏的 \`.env\` 时，改用 \`docker-compose.synology.envfile.yml\`：把它复制为项目根目录的 \`compose.yaml\`，再把 \`gateway.env.example\` 复制为 \`gateway.env\` 并填好两个相同的内部 token 即可，无需 \`--env-file\`。

MCP 与 Web UI 都在 4225 端口；管理 API 只复用 dbx Web 会话。

## 重新打包

\`\`\`bash
node plugins/mcp-token-gateway/dbxp/package.mjs
\`\`\`

产物在 \`plugins/mcp-token-gateway/dist/\`。
`;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  await mkdir(path.join(stage, 'ui'), { recursive: true });
  await mkdir(path.join(stage, 'gateway'), { recursive: true });
  await mkdir(dist, { recursive: true });

  await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(stage, 'ui', 'index.html'), UI_HTML);
  await writeFile(path.join(stage, 'README.md'), PACKAGE_README);

  const included = [
    'src',
    'bin',
    'tests',
    'package.json',
    'Dockerfile',
    'docker-compose.mcp-gateway.yml',
    '.env.example',
    'docker-compose.synology.yml',
    '.env.synology.example',
    'docker-compose.synology.envfile.yml',
    'gateway.env.example',
    'README.md',
  ];
  for (const item of included) {
    await cp(path.join(pluginRoot, item), path.join(stage, 'gateway', item), { recursive: true });
  }

  const output = path.join(dist, `dbx.mcp.gateway-${manifest.version}-universal.dbxp`);
  const artifactMetadata = output.replace(/\.dbxp$/, '.artifact.json');
  run('cargo', [
    'run', '--locked', '--release',
    '--manifest-path', path.join(repoRoot, 'plugins', 'sdk', 'packager', 'Cargo.toml'),
    '--', stage, output,
    '--artifact-metadata', artifactMetadata,
    '--target', 'universal',
    '--artifact-url', path.basename(output),
  ]);

  process.stdout.write(`已生成未签名候选包：${output}\n`);
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}
