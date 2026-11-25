// 单文件 Web 管理界面：与 MCP、管理 API 共用 4225 端口，无外部静态资源、无运行时依赖。
// 鉴权只复用 dbx Web 会话，不提供任何口令输入框。
export const WEB_UI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>DBX MCP Gateway</title>
<style>
:root{color-scheme:light;--bg:#f6f7f9;--card:#fff;--line:#e3e6eb;--text:#1f2430;--muted:#6b7280;--brand:#2563eb;--brand-strong:#1d4ed8;--brand-soft-bg:#e8eefc;--danger:#dc2626;--danger-soft-bg:#fee2e2;--ok:#059669;--ok-soft-bg:#d1fae5;--warn:#b45309;--warn-soft-bg:#fef3c7;--hover:#f3f4f6;--focus:#bfdbfe;--code-bg:#f3f4f6;--backdrop:rgba(15,23,42,.35);--toast-bg:#111827;--toast-text:#fff;--on-brand:#fff;--shadow:0 1px 2px rgba(16,24,40,.04)}
html.dark{color-scheme:dark;--bg:#0f172a;--card:#151e2e;--line:#2b3648;--text:#e5e7eb;--muted:#9ca3af;--brand:#60a5fa;--brand-strong:#93c5fd;--brand-soft-bg:#1e3a5f;--danger:#f87171;--danger-soft-bg:#4a1d1d;--ok:#34d399;--ok-soft-bg:#123a2e;--warn:#fbbf24;--warn-soft-bg:#463410;--hover:#1e293b;--focus:#334155;--code-bg:#0b1220;--backdrop:rgba(0,0,0,.55);--toast-bg:#f3f4f6;--toast-text:#111827;--on-brand:#0b1220;--shadow:none}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:0 0 10px}
.sub{margin:0;color:var(--muted)}
.header-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.theme-btn{display:inline-flex;align-items:center;gap:6px}
.theme-btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;box-shadow:var(--shadow)}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.spacer{flex:1}
input[type=text],input[type=datetime-local]{border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;background:var(--card);color:var(--text);min-width:220px}
input:focus,select:focus{outline:2px solid var(--focus);border-color:var(--brand)}
select{border:1px solid var(--line);border-radius:8px;padding:6px 9px;font:inherit;background:var(--card);color:var(--text)}
button{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:8px;padding:8px 13px;font:inherit;cursor:pointer}
button:hover{background:var(--hover)}
button:disabled{opacity:.45;cursor:not-allowed}
button.primary{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
button.primary:hover{background:var(--brand-strong);border-color:var(--brand-strong)}
button.danger{color:var(--danger)}
button.ghost{border-color:transparent;background:transparent;color:var(--muted)}
.muted{color:var(--muted);font-size:13px}
.error{color:var(--danger);min-height:20px;margin:8px 0 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px}
.pill.active{background:var(--ok-soft-bg);color:var(--ok)}
.pill.disabled{background:var(--danger-soft-bg);color:var(--danger)}
.pill.expired{background:var(--warn-soft-bg);color:var(--warn)}
.actions{display:flex;gap:4px;flex-wrap:wrap}
.actions button{padding:4px 8px;font-size:12px}
code{display:block;background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:12px;word-break:break-all;font-size:13px;color:var(--text)}
dialog{border:1px solid var(--line);border-radius:12px;padding:22px;max-width:700px;width:calc(100% - 40px);box-shadow:0 20px 60px rgba(0,0,0,.18);background:var(--card);color:var(--text)}
dialog::backdrop{background:var(--backdrop)}
.field{margin:10px 0}
.event-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin-top:12px}
.event-grid .field{margin:0;min-width:0}
.event-grid .field.wide{grid-column:1 / -1}
.event-grid code{white-space:pre-wrap;word-break:break-word}
.field label{display:block;color:var(--muted);margin-bottom:4px}
.field input{width:100%}
.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--toast-bg);color:var(--toast-text);padding:10px 18px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .2s}
#toast.show{opacity:1}
</style>
<script>
(function(){
  function systemDark(){ return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
  var mode = "";
  try { mode = localStorage.getItem("dbx-theme") || localStorage.getItem("mcp-gateway-theme") || ""; } catch (error) {}
  mode = String(mode).toLowerCase();
  var dark = mode === "dark" || mode === "soft-dark" || mode.indexOf("system") >= 0 && systemDark() || (!mode && systemDark());
  document.documentElement.classList.toggle("dark", dark);
})();
</script>
</head>
<body>
<div class="wrap">
<header>
<div><h1>DBX MCP Gateway</h1><p class="sub">集中管理成员访问凭证，随时查看使用情况</p></div>
<div class="header-tools">
<button id="themeBtn" class="theme-btn" type="button" title="切换深浅色主题" aria-label="切换深浅色主题">
<svg id="themeMoon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>
<svg id="themeSun" viewBox="0 0 24 24" aria-hidden="true" style="display:none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
<span id="themeLabel">深色</span>
</button>
</div>
</header>

<section class="card" id="loginCard">
<h2>欢迎使用 DBX MCP Gateway</h2>
<p class="muted">使用你已有的 dbx 账号即可进入，无需另行注册或输入密码。若尚未登录，请先登录 dbx，再点击下方按钮。</p>
<div class="row" style="margin-top:14px">
<button id="dbxContinueBtn" class="primary">使用 dbx 账号继续</button>
<a id="dbxLoginLink" href="#" target="_blank" rel="noopener" hidden>前往 dbx 登录</a>
</div>
<p class="error" id="loginError"></p>
</section>

<main id="app" hidden>
<section class="card">
<div class="row">
<button id="newBtn" class="primary">+ 新建访问密钥</button>
<button id="refreshBtn">刷新</button>
<span class="spacer"></span>
<span class="muted" id="summary"></span>
</div>
</section>

<section class="card" id="tokenCard">
<table>
<thead><tr><th>用户</th><th>备注</th><th>状态</th><th>创建时间</th><th>更新时间</th><th>最近使用</th><th>到期时间</th><th>累计使用</th><th>操作</th></tr></thead>
<tbody id="tokenRows"></tbody>
</table>
</section>

<section class="card" id="detailCard" hidden>
<div class="row">
<button id="detailBackBtn">← 返回列表</button>
<h2 id="detailTitle" style="margin:0">成员使用详情</h2>
<span class="spacer"></span>
<button id="detailRefreshBtn">刷新记录</button>
</div>
<p class="muted" id="detailMeta" style="margin:12px 0"></p>
<div class="row" style="margin:0 0 12px">
<span class="muted" id="detailPageInfo"></span>
<span class="spacer"></span>
<label class="muted" for="detailPageSize">每页</label>
<select id="detailPageSize">
<option value="10">10 条</option>
<option value="20" selected>20 条</option>
<option value="50">50 条</option>
<option value="100">100 条</option>
</select>
<button id="detailPrevBtn" type="button">上一页</button>
<button id="detailNextBtn" type="button">下一页</button>
</div>
<table>
<thead><tr><th>时间</th><th>操作</th><th>状态</th><th>结果</th><th>耗时</th><th>访问来源</th><th>详情</th></tr></thead>
<tbody id="detailRows"></tbody>
</table>
<p class="muted" id="detailEmpty" hidden>该成员暂无使用记录。</p>
</section>
</main>
</div>

<dialog id="editDialog">
<form method="dialog" id="editForm">
<h2 id="editTitle">新建访问密钥</h2>
<div class="field"><label>用户名称（必填）</label><input type="text" id="fieldLabel" required></div>
<div class="field"><label>备注</label><input type="text" id="fieldNote"></div>
<div class="field"><label>到期时间（选填）</label><input type="text" id="fieldExpiry" placeholder="2027-01-01T00:00:00Z"></div>
<p class="error" id="editError"></p>
<div class="dialog-actions"><button type="button" id="editCancelBtn">取消</button><button type="submit" class="primary" id="editSubmit">保存</button></div>
</form>
</dialog>

<dialog id="tokenDialog">
<h2>请保存访问密钥</h2>
<p class="muted">密钥仅显示一次，关闭后无法再次查看。遗失请重新生成。</p>
<code id="newTokenValue"></code>
<div class="dialog-actions"><button id="copyBtn">复制</button><button class="primary" id="closeTokenBtn">完成</button></div>
</dialog>

<dialog id="eventDialog">
<h2>记录详情</h2>
<p class="muted" id="eventIdLine"></p>
<div class="event-grid" id="eventFields"></div>
<div class="dialog-actions"><button id="copyEventBtn">复制详情</button><button class="primary" id="closeEventBtn">关闭</button></div>
</dialog>

<div id="toast"></div>

<script>
(function(){
"use strict";
var editingId = null;
var currentDetail = null;
var currentEvent = null;
var detailPage = 1;
var detailPageSize = 20;
var detailTotal = 0;
var DETAIL_PAGE_SIZE_KEY = "mcp-gateway-page-size";
var apiBase = "";
var dbxWebUrl = "";

function byId(id){ return document.getElementById(id); }
function el(tag, cls, text){
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function toast(message){
  var node = byId("toast");
  node.textContent = message;
  node.className = "show";
  clearTimeout(node._timer);
  node._timer = setTimeout(function(){ node.className = ""; }, 2200);
}
function fmt(value){
  if (!value) return "-";
  var d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString("zh-CN");
}
function showLogin(){
  byId("app").hidden = true;
  byId("loginCard").hidden = false;
  byId("loginError").textContent = "";
  byId("dbxLoginLink").hidden = !dbxWebUrl;
  if (dbxWebUrl) byId("dbxLoginLink").href = dbxWebUrl;
}
function showApp(){
  byId("loginCard").hidden = true;
  byId("app").hidden = false;
}
function handleError(error){
  toast(error.message || "请求失败");
}

var DBX_THEME_KEY = "dbx-theme";
var GATEWAY_THEME_KEY = "mcp-gateway-theme";
var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function systemDark(){ return !!(darkQuery && darkQuery.matches); }
function normalizeMode(value){
  var mode = String(value || "").toLowerCase();
  if (mode === "dark" || mode === "soft-dark") return "dark";
  if (mode === "light" || mode === "soft-light") return "light";
  if (mode === "system" || mode === "soft-system") return "system";
  return "";
}
function storedMode(){
  try {
    return normalizeMode(localStorage.getItem(DBX_THEME_KEY)) || normalizeMode(localStorage.getItem(GATEWAY_THEME_KEY));
  } catch (error) {
    return "";
  }
}
function currentMode(){ return storedMode() || "system"; }
function modeIsDark(mode){ return mode === "dark" || mode === "system" && systemDark(); }
function dbxThemeAvailable(){
  try { return !!normalizeMode(localStorage.getItem(DBX_THEME_KEY)); } catch (error) { return false; }
}
function applyTheme(mode){
  var dark = modeIsDark(mode);
  document.documentElement.classList.toggle("dark", dark);
  var button = byId("themeBtn");
  if (!button) return;
  // 同源且 dbx 已有明确主题时完全跟随 dbx，不再显示独立切换按钮。
  button.hidden = dbxThemeAvailable();
  if (button.hidden) return;
  var label = dark ? "浅色" : "深色";
  var title = dark ? "切换到浅色主题" : "切换到深色主题";
  byId("themeLabel").textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  byId("themeMoon").style.display = dark ? "none" : "inline-block";
  byId("themeSun").style.display = dark ? "inline-block" : "none";
}
function setTheme(mode){
  try { localStorage.setItem(GATEWAY_THEME_KEY, mode); } catch (error) {}
  applyTheme(mode);
}
function toggleTheme(){ setTheme(modeIsDark(currentMode()) ? "light" : "dark"); }

async function api(method, path, body){
  var headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  var response = await fetch(apiBase + path, {
    method: method,
    headers: headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 401) {
    showLogin();
    throw new Error("登录已失效，请重新登录 dbx 后重试");
  }
  var text = await response.text();
  var data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(resultLabel(data.error) || ("服务暂时不可用（" + response.status + "）"));
  return data;
}

async function tryDbxSession(){
  try {
    await api("GET", "/tokens");
    showApp();
    loadTokens();
    return true;
  } catch (error) {
    byId("loginError").textContent = "登录已失效或尚未登录，请先在 dbx 完成登录。";
    return false;
  }
}

function actionButton(label, cls, onClick){
  var button = el("button", cls, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function renderTokens(tokens){
  var body = byId("tokenRows");
  body.textContent = "";
  byId("summary").textContent = "共 " + tokens.length + " 个访问密钥";
  tokens.forEach(function(item){
    var row = el("tr");
    row.appendChild(el("td", "", item.label));
    row.appendChild(el("td", "muted", item.note || "-"));
    var statusText = item.status;
    if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) statusText = "expired";
    row.appendChild(el("td")).appendChild(el("span", "pill " + statusText, statusLabel(statusText)));
    row.appendChild(el("td", "", fmt(item.createdAt)));
    row.appendChild(el("td", "", fmt(item.rotatedAt)));
    row.appendChild(el("td", "", fmt(item.lastUsedAt)));
    row.appendChild(el("td", "", fmt(item.expiresAt)));
    row.appendChild(el("td", "", item.useCount || 0));

    var actions = el("td");
    var box = el("div", "actions");
    var id = item.id;
    box.appendChild(actionButton("日志", "", function(){ openDetail(item); }));
    box.appendChild(actionButton("编辑", "", function(){ openEdit(item); }));
    box.appendChild(actionButton("重新生成", "", function(){ rotate(id); }));
    box.appendChild(actionButton(item.status === "active" ? "暂停" : "启用", "", function(){ setStatus(id, item.status === "active" ? "disable" : "enable"); }));
    box.appendChild(actionButton("删除", "danger", function(){ remove(id, item.label); }));
    actions.appendChild(box);
    row.appendChild(actions);
    body.appendChild(row);
  });
}

async function loadTokens(){
  try {
    var data = await api("GET", "/tokens");
    renderTokens(data.tokens);
  } catch (error) { handleError(error); }
}

function fmtDuration(value){
  if (typeof value !== "number" || !isFinite(value)) return "-";
  return value + " 毫秒";
}
function statusLabel(value){
  var labels = { active: "正常", disabled: "已暂停", expired: "已过期" };
  return labels[value] || value || "-";
}
function resultLabel(value){
  var labels = {
    ok: "成功", invalid_token: "密钥无效", token_disabled: "密钥已暂停", token_expired: "密钥已过期",
    unauthorized: "未授权", admin_unauthorized: "尚未登录", not_found: "未找到", method_not_allowed: "操作不允许",
    bad_request: "请求有误", upstream_error: "服务异常"
  };
  return labels[value] || value || "-";
}
var TOOL_LABELS = {
  dbx_execute_query: "执行查询", dbx_list_connections: "查看数据源", dbx_describe_table: "查看表结构",
  dbx_list_tables: "查看数据表", dbx_list_databases: "查看数据库", dbx_open_session: "建立会话",
  dbx_execute_batch: "批量执行", dbx_close_session: "关闭会话"
};
function operationLabel(entry){
  if (!entry) return "-";
  if (entry.mcpTool && TOOL_LABELS[entry.mcpTool]) return TOOL_LABELS[entry.mcpTool];
  if (entry.mcpTool) return entry.mcpTool;
  if (entry.mcpMethod) return entry.mcpMethod;
  return entry.method || "-";
}

// 内部标识仅用于区分用户，不向界面展示。
var INTERNAL_EVENT_KEYS = { tokenId: true, raw: true };
function publicEvent(entry){
  if (!entry) return entry;
  var result = {};
  Object.keys(entry).forEach(function(key){
    if (!INTERNAL_EVENT_KEYS[key]) result[key] = entry[key];
  });
  return result;
}

var EVENT_LABELS = {
  id: "记录编号", ts: "时间", event: "记录类型", user: "用户",
  method: "请求方式", path: "访问路径", status: "响应状态", reason: "结果",
  mcpMethod: "操作类型", mcpTool: "操作名称", mcpArgs: "操作参数",
  bytesIn: "接收数据量", bytesOut: "发送数据量",
  durationMs: "耗时", ip: "访问来源", remoteIp: "直连地址",
  ua: "客户端信息", action: "操作",
};
function prettyArgs(text){
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch (error) { return text; }
}
// 编号、时间、客户端信息与调用参数通常较长，单独占一行；其余字段两栏显示。
var WIDE_EVENT_KEYS = { id: true, ts: true, ua: true, mcpArgs: true };
function showEventDetail(entry){
  currentEvent = publicEvent(entry);
  entry = currentEvent;
  byId("eventIdLine").textContent = "记录编号：" + (entry.id || "-");
  var box = byId("eventFields");
  box.textContent = "";
  Object.keys(entry).forEach(function(key){
    if (key === "raw") return;
    var value = entry[key];
    if (value === undefined || value === null || value === "") return;
    var display;
    if (key === "ts") {
      display = fmt(value) + " (" + value + ")";
    } else if (key === "durationMs") {
      display = fmtDuration(value);
    } else if (key === "mcpArgs") {
      display = prettyArgs(value);
    } else if (key === "reason") {
      display = resultLabel(value);
    } else {
      display = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    var row = el("div", "field");
    if (WIDE_EVENT_KEYS[key] || String(display).length > 48) row.classList.add("wide");
    row.appendChild(el("label", "", EVENT_LABELS[key] || key));
    row.appendChild(el("code", "", display));
    box.appendChild(row);
  });
  byId("eventDialog").showModal();
}

function openDetail(item){
  currentDetail = item;
  detailPage = 1;
  detailTotal = 0;
  byId("tokenCard").hidden = true;
  byId("detailCard").hidden = false;
  byId("detailTitle").textContent = "成员使用详情 · " + item.label;
  var statusText = item.status;
  if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) statusText = "expired";
  byId("detailMeta").textContent =
    "状态：" + statusLabel(statusText) +
    " ｜ 累计使用：" + (item.useCount || 0) + " 次" +
    " ｜ 最近使用：" + fmt(item.lastUsedAt) +
    " ｜ 备注：" + (item.note || "-");
  loadDetail();
}

function closeDetail(){
  currentDetail = null;
  byId("detailCard").hidden = true;
  byId("tokenCard").hidden = false;
  loadTokens();
}

function renderPagination(){
  var totalPages = Math.max(1, Math.ceil(detailTotal / detailPageSize));
  byId("detailPageInfo").textContent = "第 " + detailPage + " / " + totalPages + " 页 · 可查看 " + detailTotal + " 条记录";
  byId("detailPrevBtn").disabled = detailPage <= 1;
  byId("detailNextBtn").disabled = detailPage >= totalPages;
}
async function loadDetail(){
  if (!currentDetail) return;
  try {
    var totalPages = Math.max(1, Math.ceil(detailTotal / detailPageSize));
    if (detailPage > totalPages) detailPage = totalPages;
    var offset = (detailPage - 1) * detailPageSize;
    var query = "/audit?limit=" + detailPageSize + "&offset=" + offset + "&event=mcp&tokenId=" + encodeURIComponent(currentDetail.id);
    var data = await api("GET", query);
    detailTotal = Number(data.total || 0);
    totalPages = Math.max(1, Math.ceil(detailTotal / detailPageSize));
    if (detailPage > totalPages) {
      detailPage = totalPages;
      await loadDetail();
      return;
    }
    var body = byId("detailRows");
    body.textContent = "";
    var entries = data.entries || [];
    entries.slice().reverse().forEach(function(entry){
      var row = el("tr");
      var values = [
        fmt(entry.ts),
        operationLabel(entry),
        entry.status,
        resultLabel(entry.reason),
        fmtDuration(entry.durationMs),
        entry.ip
      ];
      values.forEach(function(value){ row.appendChild(el("td", "", value === undefined ? "-" : value)); });
      var detailCell = el("td");
      detailCell.appendChild(actionButton("详情", "", function(){ showEventDetail(entry); }));
      row.appendChild(detailCell);
      body.appendChild(row);
    });
    byId("detailEmpty").hidden = entries.length > 0;
    renderPagination();
  } catch (error) { handleError(error); }
}

function openEdit(item){
  editingId = item ? item.id : null;
  byId("editTitle").textContent = item ? "编辑 · " + item.label : "新建访问密钥";
  byId("fieldLabel").value = item ? item.label : "";
  byId("fieldNote").value = item ? (item.note || "") : "";
  byId("fieldExpiry").value = item && item.expiresAt ? item.expiresAt : "";
  byId("editError").textContent = "";
  byId("editDialog").showModal();
}

async function saveEdit(){
  var body = {
    label: byId("fieldLabel").value.trim(),
    note: byId("fieldNote").value,
    expiresAt: byId("fieldExpiry").value.trim() || null
  };
  if (!body.label) {
    byId("editError").textContent = "请填写用户名称";
    return;
  }
  try {
    var result;
    if (editingId) {
      result = await api("PATCH", "/tokens/" + encodeURIComponent(editingId), body);
      toast("已保存 " + result.label);
    } else {
      result = await api("POST", "/tokens", body);
    }
    byId("editDialog").close();
    if (!editingId) showNewToken(result.token);
    loadTokens();
  } catch (error) {
    byId("editError").textContent = error.message;
  }
}

function showNewToken(value){
  byId("newTokenValue").textContent = value;
  byId("tokenDialog").showModal();
}

async function rotate(id){
  if (!confirm("重新生成后，旧密钥将立即失效。确定继续吗？")) return;
  try {
    var result = await api("POST", "/tokens/" + encodeURIComponent(id) + "/rotate", {});
    showNewToken(result.token);
    loadTokens();
  } catch (error) { handleError(error); }
}

async function setStatus(id, action){
  try {
    await api("POST", "/tokens/" + encodeURIComponent(id) + "/" + action);
    toast(action === "enable" ? "已恢复访问" : "已暂停访问");
    loadTokens();
  } catch (error) { handleError(error); }
}

async function remove(id, label){
  if (!confirm("确定删除「" + label + "」的访问密钥吗？此操作不可恢复。")) return;
  try {
    await api("DELETE", "/tokens/" + encodeURIComponent(id));
    toast("已删除");
    loadTokens();
  } catch (error) { handleError(error); }
}

byId("dbxContinueBtn").addEventListener("click", async function(){
  byId("loginError").textContent = "";
  await tryDbxSession();
});
byId("newBtn").addEventListener("click", function(){ openEdit(null); });
byId("refreshBtn").addEventListener("click", loadTokens);
byId("detailBackBtn").addEventListener("click", closeDetail);
byId("detailRefreshBtn").addEventListener("click", loadDetail);
byId("editForm").addEventListener("submit", function(event){
  event.preventDefault();
  saveEdit();
});
byId("editCancelBtn").addEventListener("click", function(){ byId("editDialog").close(); });
byId("copyBtn").addEventListener("click", async function(){
  var value = byId("newTokenValue").textContent;
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制到剪贴板");
  } catch (error) {
    var range = document.createRange();
    range.selectNodeContents(byId("newTokenValue"));
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    toast("已选中，请按 Ctrl/Cmd+C 复制");
  }
});
byId("closeTokenBtn").addEventListener("click", function(){ byId("tokenDialog").close(); });
byId("closeEventBtn").addEventListener("click", function(){ byId("eventDialog").close(); });
byId("copyEventBtn").addEventListener("click", async function(){
  var text = currentEvent ? JSON.stringify(currentEvent, null, 2) : "";
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制记录详情");
  } catch (error) {
    toast("复制失败，请手动选择文本");
  }
});

byId("themeBtn").addEventListener("click", toggleTheme);
window.addEventListener("storage", function(event){
  if (event.key === DBX_THEME_KEY || event.key === GATEWAY_THEME_KEY) applyTheme(currentMode());
});
if (darkQuery) {
  var onDarkChange = function(){ if (currentMode() === "system") applyTheme("system"); };
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", onDarkChange);
  else if (darkQuery.addListener) darkQuery.addListener(onDarkChange);
}
applyTheme(currentMode());

try {
  var savedPageSize = Number(localStorage.getItem(DETAIL_PAGE_SIZE_KEY));
  if ([10, 20, 50, 100].indexOf(savedPageSize) >= 0) detailPageSize = savedPageSize;
} catch (error) {}
byId("detailPageSize").value = String(detailPageSize);
byId("detailPrevBtn").addEventListener("click", function(){
  if (detailPage > 1) { detailPage -= 1; loadDetail(); }
});
byId("detailNextBtn").addEventListener("click", function(){
  var totalPages = Math.max(1, Math.ceil(detailTotal / detailPageSize));
  if (detailPage < totalPages) { detailPage += 1; loadDetail(); }
});
byId("detailPageSize").addEventListener("change", function(){
  var size = Number(byId("detailPageSize").value);
  if ([10, 20, 50, 100].indexOf(size) < 0) return;
  detailPageSize = size;
  detailPage = 1;
  try { localStorage.setItem(DETAIL_PAGE_SIZE_KEY, String(size)); } catch (error) {}
  if (currentDetail) loadDetail();
});

async function init(){
  try {
    var response = await fetch("/ui/config");
    var config = await response.json();
    apiBase = config.apiBase || "";
    dbxWebUrl = config.dbxWebUrl || "";
  } catch (error) { /* 配置读取失败时按默认路径继续 */ }
  if (await tryDbxSession()) return;
  showLogin();
}
init();
})();
</script>
</body>
</html>`;
