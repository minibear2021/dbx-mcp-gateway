# DBX MCP Gateway

为 Docker 部署的 DBX Streamable HTTP MCP 提供**多访问密钥、成员备注、重新生成与暂停、访问审计**能力。网关作为独立服务与 dbx 一起编排，不修改 dbx 本体。

## 工作方式：单端口 4225

```
                        ┌─────────────────────────────────────┐
 MCP 客户端 ──Bearer───▶ │ /mcp        多 token 校验 / 审计       │──Bearer 内部 token──▶ dbx:4224/mcp
 浏览器 ───dbx Cookie──▶ │ / 或 /ui    Web UI + 管理 API         │──透传 Cookie────────▶ dbx:4224/api/auth/check
                        └─────────────────────────────────────┘
                                     同一个 4225 端口
```

- MCP、Web UI 与管理界面**共用一个 4225 端口**，按路径分流。
- 客户端持的是网关 token；网关校验后替换 `Authorization` 为 dbx 内部 token。
- 网关把 `Host` 重写为 `dbx:4224`，剥离 `Origin` 和 `Cookie`，这样 dbx 的 Host/Origin 策略由网关侧统一处理。
- token 在磁盘上只保存 SHA-256；明文仅在创建/轮换时返回一次。校验使用恒定时间比较并遍历全部记录。
- 状态变更即时生效，无需重启 dbx 或网关。
- **每一次** MCP 调用（含成功与失败）与密钥管理操作都写入 `audit.jsonl`，包含成员、时间、操作、状态、结果、耗时和来源 IP；不记录密钥明文。

## 管理鉴权：只复用 dbx Web 会话

管理功能（Web UI 与管理 API）复用浏览器中的 dbx Web 会话，无需额外口令：

- 网关把请求里的 `Cookie` 头原样透传给 dbx 的 `GET /api/auth/check`。
- 该端点恒返回 200，真正的判据是响应体里的 `authenticated` 字段。
- 网关不接触 `DBX_PASSWORD`，不自己签发会话，也不保存任何管理口令。

CLI 不经过浏览器，因此需要手动把 dbx 会话 Cookie 传进来：

```bash
--cookie 'dbx_session=<从浏览器复制的值>'
# 或
MCP_GATEWAY_DBX_COOKIE='dbx_session=<从浏览器复制的值>'
```

## 快速开始

```bash
cd /path/to/dbx

# 1. 生成 dbx 内部 token
cp plugins/mcp-token-gateway/.env.example plugins/mcp-token-gateway/.env
node plugins/mcp-token-gateway/bin/dbx-mcp-gateway.mjs secret
# 把输出中的 internalToken 填入 DBX_MCP_INTERNAL_TOKEN。

# 2. 启动（叠加在原有 compose 之上）
docker compose --project-directory . \
  -f deploy/docker-compose.yml \
  -f plugins/mcp-token-gateway/docker-compose.mcp-gateway.yml \
  --env-file plugins/mcp-token-gateway/.env up -d --build
```

对外地址统一为 `http://<宿主机>:4225`：

- MCP 客户端：`http://<宿主机>:4225/mcp`
- Web 管理界面：`http://<宿主机>:4225/`（别名 `/ui`、`/index.html`）
- 管理 API：`http://<宿主机>:4225/tokens`、`/audit` 等

> **客户端配置提醒**：MCP 客户端的地址必须带 `/mcp` 路径。只填 `http://<宿主机>:4225/`（或只改端口不加路径）会打到 Web UI，WorkBuddy 等客户端会提示“需要认证”。若宿主机端口改成了 8083，则填 `http://<宿主机>:8083/mcp`。

dbx 的 4224 端口建议仅用于容器内部通信，不对外暴露。

> 若 dbx 配置了 `DBX_PUBLIC_BASE_PATH=/dbx`，需同时把 `.env` 里的 `MCP_GATEWAY_UPSTREAM_MCP_PATH` 改为 `/dbx/mcp`，并从 `http://<宿主机>:4225/dbx/ui` 打开管理页（Cookie 的 Path 也是 `/dbx`，根路径 `/ui` 不会带上它）。

### 群晖部署

群晖部署使用官方发布镜像 `ghcr.io/minibear2021/dbx-mcp-gateway:1.2.0`。准备数据目录与环境变量文件后即可启动：

1. 使用 `plugins/mcp-token-gateway/docker-compose.synology.envfile.yml`（或 `docker-compose.synology.yml`）作为 `/volume1/docker/dbx/compose.yaml`。
2. 将 `plugins/mcp-token-gateway/gateway.env.example` 另存为 `/volume1/docker/dbx/gateway.env`，用 `openssl rand -hex 32` 生成随机值，并填写以下两项为**相同值**：
   ```
   DBX_WEB_MCP_TOKEN=<随机值>
   MCP_GATEWAY_UPSTREAM_TOKEN=<同一个随机值>
   ```
   可选填写 `MCP_GATEWAY_DBX_WEB_URL=http://<NAS-IP>:8082`。
3. 在 Container Manager 中导入项目并启动。

> 若启动时提示变量缺失，表示 compose 文件版本不匹配，请替换为当前版本后重新启动项目。

## 管理 token

CLI 在容器内执行，且必须带 dbx 会话 Cookie：

```bash
EXEC="docker compose --project-directory . -f deploy/docker-compose.yml -f plugins/mcp-token-gateway/docker-compose.mcp-gateway.yml exec -T mcp-gateway"

# 先从浏览器开发者工具中复制 dbx_session Cookie 的值
$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs token add --label "张三" --note "数据分析组"

$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs token list

$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs token rotate <token-id>

$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs token disable <token-id>

$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs token enable <token-id>

$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs token remove <token-id>

$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs audit --limit 50

# 只看某个用户的 MCP 调用记录
$EXEC env MCP_GATEWAY_DBX_COOKIE='dbx_session=<会话值>' \
  node bin/dbx-mcp-gateway.mjs audit --event mcp --token-id <token-id> --limit 200
```

也可用 `--cookie 'dbx_session=...'` 代替环境变量。`token add` / `token rotate` 会打印一次明文 token，请立即交给对应客户端保存。

## Web UI（与 MCP 共用 4225 端口）

浏览器打开 `http://<宿主机>:4225/`（别名 `/ui`、`/index.html`）。页面会先自动尝试当前浏览器的 dbx 登录态；已登录 dbx Web 就直接进入管理界面，否则显示“使用 dbx 登录态继续”按钮和可选的 dbx Web 登录链接。页面里**没有任何管理口令输入框**。

页面是单文件内联 HTML/CSS/JS，由网关直接提供，不新增端口、不依赖任何前端构建产物。

**深浅色主题**：页面会优先读取同源 `localStorage` 中的 `dbx-theme`（dbx Web 的主题键），因此如果把 dbx Web 与网关放到同一反向代理后的同一 origin，dbx 切换明暗主题时本页会同步切换；也支持 `storage` 事件跨标签实时同步，仅同步明暗模式，不复制 dbx 的调色板或自定义颜色；同源且 dbx 已设置过主题时，独立切换按钮会自动隐藏，完全跟随 dbx。默认部署下 dbx Web 与网关使用不同端口（例如 8082 与 4225），浏览器按 origin 隔离 `localStorage`，无法自动读取，此时页面右上角会显示「深色 / 浅色」切换按钮，选择保存在本 origin 的 `mcp-gateway-theme`；未手动选择时跟随系统 `prefers-color-scheme`。

支持的操作：

- 列表展示每个访问密钥的用户、备注、状态、创建/更新时间、最近使用、到期时间与累计使用次数
- 新建 / 编辑（用户名称、备注、到期日期，通过靠左的日历图标选择，空值时隐藏占位文字，有效期至所选日期当天 23:59）
- 重新生成、暂停、启用、删除（二次确认）
- 新建和重新生成后弹窗展示一次性明文密钥，带复制按钮
- 每个用户条目的操作栏点击**日志**，进入该用户的详情页，查看其**每一次访问记录**（时间、操作、状态、结果、耗时、访问来源），可刷新或返回列表；记录分页展示，可自定义每页 10 / 20 / 50 / 100 条，选择会被记住
- **每条记录点「详情」**打开弹窗，展示记录编号、用户、请求方式、访问路径、操作类型、操作名称、**操作参数**、响应状态、结果、耗时、数据量、客户端信息、访问来源与直连地址；除操作参数单独占一行外，其余字段均以短框一行三栏展示，并支持一键复制详情
- 「操作参数」展示本次操作的入参，例如 `dbx_execute_query` 的 `sql`、`database`、`connection_id`，`dbx_describe_table` 的 `table` 等——可以直接看到执行了什么命令、操作了哪个库表

**累计使用与访问记录**：「累计使用」是密钥校验通过的永久计数，从创建起一直累加，不受审计日志清理影响；「可查看记录」是当前审计日志中属于该密钥的条数，日志总量上限为 5000 行（所有成员共享），超出后自动裁剪最旧记录。因此累计使用次数通常大于可查看记录数。需要长期留存时，请定期归档 `audit.jsonl`。

### 来源 IP 与反向代理

使用 Docker 端口映射时，网关看到的 TCP 对端是宿主机网桥地址。若需在审计中记录真实客户端 IP，请通过可信反向代理传递标准代理头：

1. 反向代理把请求转发到网关的 4225，并设置 `X-Forwarded-For: $remote_addr`（Nginx 写法）或等价头。
2. 在 `gateway.env`（群晖）或 `.env`（通用 compose）里设 `MCP_GATEWAY_TRUST_PROXY=1`，重启网关。
3. 此后审计里的「客户端 IP」取代理头最左值；同时另记「直连地址」（即网桥网关）便于对照。

安全提醒：只有在网关**只接受来自该反向代理的流量**时才能开启 `MCP_GATEWAY_TRUST_PROXY=1`，否则任何客户端都能伪造来源 IP。未使用代理时请保持默认值 `0`。Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:4225;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
}
```

注意：加了反向代理后，浏览器访问 dbx Web 与网关 UI 仍需使用同一个主机名，`dbx_session` Cookie 才会携带。

安全边界：调用参数中的 `password` / `token` / `api_key` / `secret` / `cookie` 等敏感字段会替换为 `***`；单个字符串值限 2000 字符、整段参数限 6000 字符。**不记录 HTTP 响应正文、Bearer token 明文或 `dbx_session` Cookie**；SQL 语句本身会记录（这就是你要看的操作命令），因此请勿在 SQL 中明文写密码等凭据。参数超过采样上限（16KB）时只记录能识别到的部分。

页面本身无需鉴权；页面内所有管理 API 调用都依赖浏览器自动携带的 `dbx_session` Cookie（`credentials: same-origin`）。收到 401 会自动退回登录入口。

**复用 dbx 登录态的前提**：浏览器访问 dbx Web 与访问网关 UI 时使用**同一个主机名**（例如都用 `localhost` 或都用 `127.0.0.1`）。dbx 的 Cookie 是 host-only、不区分端口，`SameSite=Lax` 也不阻断同站不同端口；若两者主机名不同，浏览器不会把 Cookie 发给 4225，此时请把地址统一到同一主机名，或放到同一个反向代理后面。

## 管理 API

管理 API 同样在 4225 端口，需带 `Cookie: dbx_session=...`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/healthz` | 健康检查，无需鉴权 |
| `POST` | `/tokens` | 新建：`{"label":"张三","note":"...","expiresAt":null}`，返回明文 `token` |
| `GET` | `/tokens` | 列表（不含明文/哈希） |
| `GET` | `/tokens/:id` | 单个 token 信息 |
| `PATCH` | `/tokens/:id` | 修改 `label` / `note` / `expiresAt` |
| `POST` | `/tokens/:id/rotate` | 轮换，旧 token 立即失效，返回新明文 |
| `POST` | `/tokens/:id/disable` | 禁用 |
| `POST` | `/tokens/:id/enable` | 重新启用 |
| `DELETE` | `/tokens/:id` | 删除 |
| `GET` | `/audit?limit=100` | 审计记录（按时间升序，页面倒序显示） |
| `GET` | `/audit?event=mcp&tokenId=<id>&limit=500` | 按事件与用户 token 过滤，详情视角用 |

另提供免鉴权的 `GET /ui/config`，返回 API 前缀与 dbx Web 登录链接供页面使用。

语义说明：

- **轮换**：生成新 token 并替换哈希，旧 token 立刻不可用；状态保持原样（禁用的 token 轮换后仍禁用）；默认清除过期时间，可通过 `--expires-at` 指定新的。
- **禁用**：校验直接拒绝，记录保留，可随时重新启用。
- **过期**：`expiresAt` 到期后按拒绝处理，不自动删除记录。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_GATEWAY_UPSTREAM_TOKEN` | 必填 | 发给 dbx 的内部 token |
| `MCP_GATEWAY_UPSTREAM_URL` | `http://dbx:4224` | dbx 地址 |
| `MCP_GATEWAY_UPSTREAM_MCP_PATH` | `/mcp` | 上游 MCP 路径 |
| `MCP_GATEWAY_LISTEN_HOST/PORT` | `0.0.0.0:4225` | 唯一监听端口（MCP + Web UI + 管理 API） |
| `MCP_GATEWAY_PUBLIC_MCP_PATH` | `/mcp` | 对外 MCP 路径；不能与 Web UI / 管理 API 路径冲突 |
| `MCP_GATEWAY_DBX_AUTH_CHECK_URL` | 由上游地址推导 | dbx 的 `/api/auth/check` 地址 |
| `MCP_GATEWAY_DBX_BASE_PATH` | 由上游 MCP 路径推导 | dbx 的 `DBX_PUBLIC_BASE_PATH` |
| `MCP_GATEWAY_DBX_WEB_URL` | 空 | 可选，Web UI 里“打开 dbx Web 登录页”的链接 |
| `MCP_GATEWAY_DATA_DIR` | `./.gateway-data` | token 库与审计日志目录 |
| `MCP_GATEWAY_ALLOWED_ORIGINS` | 空（回显任意 Origin） | 逗号分隔的精确 Origin 白名单 |
| `MCP_GATEWAY_AUDIT` | `1` | 设为 `0` 关闭审计 |
| `MCP_GATEWAY_URL` | `http://127.0.0.1:4225` | CLI 访问网关的地址 |
| `MCP_GATEWAY_DBX_COOKIE` | 空 | CLI 使用的 dbx 会话 Cookie，也可用 `--cookie` |
| `MCP_GATEWAY_PUBLIC_PORT` | `4225` | compose 宿主机映射端口（容器内始终是 4225） |

## 本地开发 / 测试

```bash
cd plugins/mcp-token-gateway
npm test
npm start   # 需设置 MCP_GATEWAY_UPSTREAM_TOKEN
```

代码零运行时依赖，只用 Node 20+ 内置模块。

## 版本与 Docker 镜像发布

版本号以 `package.json` 的 `version` 为唯一来源（当前 `1.2.0`）。发布时版本号会写入镜像标签、`org.opencontainers.image.version` 标签以及容器内的 `MCP_GATEWAY_VERSION` 环境变量。

推送到 `master` / `main` 且 `package.json` 版本发生变化，或推送 `v<版本号>` 标签（例如 `v1.2.0`）时，GitHub Actions 会自动构建镜像并推送到 GHCR：

- `ghcr.io/minibear2021/dbx-mcp-gateway:1.2.0`
- `ghcr.io/minibear2021/dbx-mcp-gateway:v1.2.0`
- `ghcr.io/minibear2021/dbx-mcp-gateway:latest`

推荐发布流程：

```bash
# 先修改 package.json 的 version，例如 1.2.0 -> 1.3.0
git add package.json
git commit -m "chore: release v1.2.0"
git tag v1.2.0
git push origin master
git push origin v1.2.0
```

标签版本与 `package.json` 不一致时工作流会直接失败并提示。也可以在 GitHub 页面手动触发（Actions → Build and publish Docker image → Run workflow），此时使用当前 `package.json` 版本。

仓库中的 `docker-compose.synology.yml` 与 `docker-compose.synology.envfile.yml` 已默认使用 GHCR 镜像，并移除了源码只读挂载；只需保留 `/volume1/docker/dbx/data/mcp-gateway` 可写卷。若你仍在使用旧的本地构建 compose，请把 `mcp-gateway` 服务的 `build:` 段替换为 `image: ghcr.io/minibear2021/dbx-mcp-gateway:1.2.0` 并删除源码挂载。若 GHCR 包为私有，需先在 GitHub 生成带 `read:packages` 权限的令牌，并在 NAS 上执行 `docker login ghcr.io -u <用户名> -p <令牌>`；公开包可直接拉取。本地构建的镜像版本显示为 `dev`。

> **部署方式**：通过 Docker Compose 启动，不提供插件市场安装包。

## 安全建议

- 网关前面请再挂 TLS 终止（Nginx/Caddy/云负载均衡），不要让明文 HTTP 直接公网可达。
- 复用 dbx 会话意味着**任何已登录 dbx Web 的管理员都能管理 MCP token**；dbx 本来就是单管理员模型，通常符合预期。
- dbx 会话只存在内存，dbx 重启后全部失效；网关会返回 401，用户重新登录 dbx Web 即可。网关重启不影响该会话。
- 移除 dbx 自身的 `4224:4224` 宿主机映射，避免绕过网关直接使用内部 token。
- Token 明文只回显一次；遗失后只能轮换。
