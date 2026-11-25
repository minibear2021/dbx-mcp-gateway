# DBX MCP Gateway

为 Docker 部署的 DBX Streamable HTTP MCP 提供**多 token、按用户备注、轮换与禁用**能力，且不修改 dbx 主项目源码。

## 为什么是独立网关，而不是 dbx 插件中心的插件

我完整检查了本仓库的插件体系和 MCP 实现，结论如下：

- 插件清单 `plugins/manifest.schema.json` 的 `contributions` 是封闭白名单，只有 8 类：`connection-provider`、`workbench`、`filesystem-provider`、`context-menu`、`result-view`、`command`、`menus`、`mcp`。`additionalProperties: false`，无法新增扩展类型。
- MCP 的 Bearer 校验是写死的 axum 中间件：`crates/dbx-mcp/src/http_auth.rs` 的 `authorize_request()`，在 `crates/dbx-mcp/src/http.rs:103-104` 用 `middleware::from_fn_with_state` 挂到 `/mcp` 上。`HttpAuth` 内部只有一个 `Option<Arc<[u8]>>`，没有任何 trait、hook、回调或插件注册点。
- `mcp` 类 contribution 只在鉴权**通过之后**提供工具（`mcp/tools`、`mcp/call`），无法拦截 HTTP 请求或修改鉴权逻辑。
- `HttpAuth::reconfigure()` 只能整体替换那一个 token，做不到多个 token 并存。

因此，在“不改主项目、可跟随上游升级”的约束下，唯一正确的做法是把多 token 能力放在 `/mcp` **前面**：一个独立、零依赖、可随 compose 一起编排的网关 add-on。它以插件的形式放在 `plugins/mcp-token-gateway/`，但**不是**由 dbx 插件运行时加载的 sidecar（那套协议没有 HTTP 鉴权扩展点）。DBX 本体代码与构建完全不受影响。

## 工作方式：单端口 4225

```
                        ┌─────────────────────────────────────┐
 MCP 客户端 ──Bearer───▶ │ /mcp        多 token 校验 / 审计       │──Bearer 内部 token──▶ dbx:4224/mcp
 浏览器 ───dbx Cookie──▶ │ / 或 /ui    Web UI + 管理 API         │──透传 Cookie────────▶ dbx:4224/api/auth/check
                        └─────────────────────────────────────┘
                                     同一个 4225 端口
```

- MCP、Web UI、管理 API **共用一个 4225 监听端口**，按路径分流，不再有 4226 管理口。
- 客户端持的是网关 token；网关校验后替换 `Authorization` 为 dbx 内部 token。
- 网关把 `Host` 重写为 `dbx:4224`，剥离 `Origin` 和 `Cookie`，这样 dbx 的 Host/Origin 策略由网关侧统一处理。
- token 在磁盘上只保存 SHA-256；明文仅在创建/轮换时返回一次。校验使用恒定时间比较并遍历全部记录。
- 状态变更即时生效，无需重启 dbx 或网关。
- 所有 MCP 请求与 token 管理操作写入 `audit.jsonl`（含 token id、用户备注、路径、状态、原因），不记录 token 明文。

## 管理鉴权：只复用 dbx Web 会话

管理功能（Web UI 与管理 API）**没有独立口令**，唯一凭据是浏览器中的 dbx Web 会话 Cookie：

- 网关把请求里的 `Cookie` 头原样透传给 dbx 的 `GET /api/auth/check`。
- 该端点恒返回 200，真正的判据是响应体里的 `authenticated` 字段。
- 网关不接触 `DBX_PASSWORD`，不自己签发会话，也不保存任何管理口令。

旧版的独立管理口令入口已**全部移除**：相关环境变量、自动生成的口令文件、以及鉴权模式开关都不再存在。旧 `.env` 中若还留着这些变量，可以直接删掉；网关会忽略它们。

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

dbx 原有的 4224 端口建议不再对外暴露。

> 若 dbx 配置了 `DBX_PUBLIC_BASE_PATH=/dbx`，需同时把 `.env` 里的 `MCP_GATEWAY_UPSTREAM_MCP_PATH` 改为 `/dbx/mcp`，并从 `http://<宿主机>:4225/dbx/ui` 打开管理页（Cookie 的 Path 也是 `/dbx`，根路径 `/ui` 不会带上它）。

### 群晖 / 只给 dbx 加一个服务的写法

如果不想在 NAS 上 build 镜像，可用 `node:22-alpine` 直接挂载源码启动。把插件目录放到 `/volume1/docker/dbx/plugins/mcp-token-gateway/`（该目录下要有 `src/`、`bin/`、`package.json`）后：

1. 把 `plugins/mcp-token-gateway/docker-compose.synology.yml` 的全文复制到 `/volume1/docker/dbx/compose.yaml`（`docker-compose.synology.envfile.yml` 是同一方案的副本，二者都没有任何 `${...}` 插值）。
2. 把 `plugins/mcp-token-gateway/gateway.env.example` 复制为 `/volume1/docker/dbx/gateway.env`，用 `openssl rand -hex 32` 生成随机值，并把下面两行填成**同一个值**：
   ```
   DBX_WEB_MCP_TOKEN=<随机值>
   MCP_GATEWAY_UPSTREAM_TOKEN=<同一个随机值>
   ```
   可选地填写 `MCP_GATEWAY_DBX_WEB_URL=http://<NAS-IP>:8082`。
3. 在 Container Manager 里删除旧项目后重新导入/启动，不需要 `.env`、不需要 `--env-file`。

如果仍看到 `required variable DBX_MCP_INTERNAL_TOKEN is missing a value`，说明 `/volume1/docker/dbx/compose.yaml` 还是旧内容。可在 NAS 上执行下面这条命令自检：

```bash
grep -n 'DBX_MCP_INTERNAL_TOKEN\|env_file' /volume1/docker/dbx/compose.yaml
```

正常输出应只看到两行 `env_file:`，不应出现 `${DBX_MCP_INTERNAL_TOKEN`。出现后者说明没复制成功或 Container Manager 仍在用缓存的旧项目，删掉项目重新导入即可。

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
```

也可用 `--cookie 'dbx_session=...'` 代替环境变量。`token add` / `token rotate` 会打印一次明文 token，请立即交给对应客户端保存。

## Web UI（与 MCP 共用 4225 端口）

浏览器打开 `http://<宿主机>:4225/`（别名 `/ui`、`/index.html`）。页面会先自动尝试当前浏览器的 dbx 登录态；已登录 dbx Web 就直接进入管理界面，否则显示“使用 dbx 登录态继续”按钮和可选的 dbx Web 登录链接。页面里**没有任何管理口令输入框**。

页面是单文件内联 HTML/CSS/JS，由网关直接提供，不新增端口、不依赖任何前端构建产物。

支持的操作：

- 列表展示每个 token 的用户备注、说明、状态、创建/轮换/最近使用/过期时间与调用次数
- 新建 / 编辑（备注、说明、过期时间）
- 轮换、禁用、启用、删除（二次确认）
- 新建和轮换后弹窗展示一次性明文 token，带复制按钮
- 查看最近 50 条审计记录

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
| `GET` | `/audit?limit=100` | 审计记录 |

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

## `.dbxp` 本地安装包

可用 dbx 自带的 packager 生成一个未签名候选包，在 dbx Web 插件管理里做本地安装验证：

```bash
cd /path/to/dbx
node plugins/mcp-token-gateway/dbxp/package.mjs
# 产物：plugins/mcp-token-gateway/dist/dbx.mcp.gateway-1.0.0-universal.dbxp
```

安装前需要在 dbx 服务进程设置 `DBX_ALLOW_UNSIGNED_PLUGINS=1`，并在 Web 本地安装时勾选允许未签名包。包内包含完整网关源码和一个工作台说明页。

**边界**：dbx 插件体系没有 HTTP 鉴权扩展点，也没有安装/启动钩子；`.dbxp` 不会自动启动网关，也不会改变 dbx 的 MCP 鉴权。真正生效的仍是前面 compose 方式启动的网关服务。

## 安全建议

- 网关前面请再挂 TLS 终止（Nginx/Caddy/云负载均衡），不要让明文 HTTP 直接公网可达。
- 复用 dbx 会话意味着**任何已登录 dbx Web 的管理员都能管理 MCP token**；dbx 本来就是单管理员模型，通常符合预期。
- dbx 会话只存在内存，dbx 重启后全部失效；网关会返回 401，用户重新登录 dbx Web 即可。网关重启不影响该会话。
- 移除 dbx 自身的 `4224:4224` 宿主机映射，避免绕过网关直接使用内部 token。
- Token 明文只回显一次；遗失后只能轮换。
