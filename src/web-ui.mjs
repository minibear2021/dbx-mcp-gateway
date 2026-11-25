// 单文件 Web 管理界面：与 MCP、管理 API 共用 4225 端口，无外部静态资源、无运行时依赖。
// 鉴权只复用 dbx Web 会话，不提供任何口令输入框。
export const WEB_UI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DBX MCP Token 管理</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--line:#e3e6eb;--text:#1f2430;--muted:#6b7280;--brand:#2563eb;--danger:#dc2626;--ok:#059669;--warn:#b45309}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:0 0 10px}
.sub{margin:0;color:var(--muted)}
.badge{background:#e8eefc;color:#1d4ed8;border-radius:999px;padding:6px 12px;font-size:12px;white-space:nowrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.spacer{flex:1}
input[type=text],input[type=datetime-local]{border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;background:#fff;min-width:220px}
input:focus{outline:2px solid #bfdbfe;border-color:var(--brand)}
button{border:1px solid var(--line);background:#fff;color:var(--text);border-radius:8px;padding:8px 13px;font:inherit;cursor:pointer}
button:hover{background:#f3f4f6}
button.primary{background:var(--brand);border-color:var(--brand);color:#fff}
button.primary:hover{background:#1d4ed8}
button.danger{color:var(--danger)}
button.ghost{border-color:transparent;background:transparent;color:var(--muted)}
.muted{color:var(--muted);font-size:13px}
.error{color:var(--danger);min-height:20px;margin:8px 0 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--muted);font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px}
.pill.active{background:#d1fae5;color:var(--ok)}
.pill.disabled{background:#fee2e2;color:var(--danger)}
.pill.expired{background:#fef3c7;color:var(--warn)}
.actions{display:flex;gap:4px;flex-wrap:wrap}
.actions button{padding:4px 8px;font-size:12px}
.link{border:0;background:transparent;color:var(--brand);padding:0;font:inherit;cursor:pointer;text-decoration:underline}
.link:hover{background:transparent;color:#1d4ed8}
code{display:block;background:#f3f4f6;border:1px solid var(--line);border-radius:8px;padding:12px;word-break:break-all;font-size:13px}
dialog{border:1px solid var(--line);border-radius:12px;padding:22px;max-width:560px;width:calc(100% - 40px);box-shadow:0 20px 60px rgba(0,0,0,.18)}
dialog::backdrop{background:rgba(15,23,42,.35)}
.field{margin:10px 0}
.field label{display:block;color:var(--muted);margin-bottom:4px}
.field input{width:100%}
.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 18px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .2s}
#toast.show{opacity:1}
</style>
</head>
<body>
<div class="wrap">
<header>
<div><h1>DBX MCP Token 管理</h1><p class="sub">多 Token · 用户备注 · 轮换 / 禁用 · 审计</p></div>
<div class="badge">单端口 4225 · MCP + 管理 UI</div>
</header>

<section class="card" id="loginCard">
<h2>dbx Web 登录态</h2>
<p class="muted">本页只复用你在 dbx Web 的登录会话，不需要额外凭据。请先在 dbx Web 登录，再点击下方按钮。</p>
<div class="row" style="margin-top:14px">
<button id="dbxContinueBtn" class="primary">使用 dbx 登录态继续</button>
<a id="dbxLoginLink" href="#" target="_blank" rel="noopener" hidden>打开 dbx Web 登录页</a>
</div>
<p class="error" id="loginError"></p>
</section>

<main id="app" hidden>
<section class="card">
<div class="row">
<button id="newBtn" class="primary">+ 新建 Token</button>
<button id="refreshBtn">刷新</button>
<button id="auditBtn">审计日志</button>
<span class="spacer"></span>
<span class="muted" id="summary"></span>
</div>
</section>

<section class="card" id="tokenCard">
<table>
<thead><tr><th>用户备注</th><th>说明</th><th>状态</th><th>创建</th><th>轮换</th><th>最近使用</th><th>过期</th><th>次数</th><th>操作</th></tr></thead>
<tbody id="tokenRows"></tbody>
</table>
</section>

<section class="card" id="detailCard" hidden>
<div class="row">
<button id="detailBackBtn">← 返回列表</button>
<h2 id="detailTitle" style="margin:0">用户调用详情</h2>
<span class="spacer"></span>
<button id="detailRefreshBtn">刷新记录</button>
</div>
<p class="muted" id="detailMeta" style="margin:12px 0"></p>
<table>
<thead><tr><th>时间</th><th>方法</th><th>路径</th><th>状态</th><th>结果</th><th>耗时</th><th>来源 IP</th><th>事件</th></tr></thead>
<tbody id="detailRows"></tbody>
</table>
<p class="muted" id="detailEmpty" hidden>该用户暂无 MCP 调用记录。</p>
</section>

<section class="card" id="auditCard" hidden>
<h2>最近请求</h2>
<table>
<thead><tr><th>时间</th><th>事件</th><th>用户</th><th>Token ID</th><th>方法</th><th>路径</th><th>状态</th><th>原因</th></tr></thead>
<tbody id="auditRows"></tbody>
</table>
</section>
</main>
</div>

<dialog id="editDialog">
<form method="dialog" id="editForm">
<h2 id="editTitle">新建 Token</h2>
<div class="field"><label>用户备注（必填）</label><input type="text" id="fieldLabel" required></div>
<div class="field"><label>说明</label><input type="text" id="fieldNote"></div>
<div class="field"><label>过期时间（可留空；YAML/ISO 日期均可）</label><input type="text" id="fieldExpiry" placeholder="2027-01-01T00:00:00Z"></div>
<p class="error" id="editError"></p>
<div class="dialog-actions"><button type="button" id="editCancelBtn">取消</button><button type="submit" class="primary" id="editSubmit">保存</button></div>
</form>
</dialog>

<dialog id="tokenDialog">
<h2>请保存 Token 明文</h2>
<p class="muted">它只会显示这一次。关闭后无法再次查看，遗失请轮换。</p>
<code id="newTokenValue"></code>
<div class="dialog-actions"><button id="copyBtn">复制</button><button class="primary" id="closeTokenBtn">完成</button></div>
</dialog>

<div id="toast"></div>

<script>
(function(){
"use strict";
var editingId = null;
var currentDetail = null;
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
    throw new Error("dbx 登录态无效或已过期，请先在 dbx Web 登录后重试");
  }
  var text = await response.text();
  var data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
  return data;
}

async function tryDbxSession(){
  try {
    await api("GET", "/tokens");
    showApp();
    loadTokens();
    return true;
  } catch (error) {
    byId("loginError").textContent = "尚未登录 dbx Web 或会话已失效，请先在 dbx Web 登录后重试。";
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
  byId("summary").textContent = "共 " + tokens.length + " 个 token";
  tokens.forEach(function(item){
    var row = el("tr");
    var userCell = el("td");
    var userLink = el("button", "link", item.label);
    userLink.type = "button";
    userLink.title = "查看该用户的 MCP 调用记录";
    userLink.addEventListener("click", function(){ openDetail(item); });
    userCell.appendChild(userLink);
    row.appendChild(userCell);
    row.appendChild(el("td", "muted", item.note || "-"));
    var statusText = item.status;
    if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) statusText = "expired";
    row.appendChild(el("td")).appendChild(el("span", "pill " + statusText, statusText));
    row.appendChild(el("td", "", fmt(item.createdAt)));
    row.appendChild(el("td", "", fmt(item.rotatedAt)));
    row.appendChild(el("td", "", fmt(item.lastUsedAt)));
    row.appendChild(el("td", "", fmt(item.expiresAt)));
    row.appendChild(el("td", "", item.useCount || 0));

    var actions = el("td");
    var box = el("div", "actions");
    var id = item.id;
    box.appendChild(actionButton("编辑", "", function(){ openEdit(item); }));
    box.appendChild(actionButton("轮换", "", function(){ rotate(id); }));
    box.appendChild(actionButton(item.status === "active" ? "禁用" : "启用", "", function(){ setStatus(id, item.status === "active" ? "disable" : "enable"); }));
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
  return value + " ms";
}

function openDetail(item){
  currentDetail = item;
  byId("tokenCard").hidden = true;
  byId("auditCard").hidden = true;
  byId("detailCard").hidden = false;
  byId("detailTitle").textContent = "用户调用详情 · " + item.label;
  var statusText = item.status;
  if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) statusText = "expired";
  byId("detailMeta").textContent =
    "Token ID: " + item.id +
    " ｜ 状态: " + statusText +
    " ｜ 调用次数: " + (item.useCount || 0) +
    " ｜ 最近使用: " + fmt(item.lastUsedAt) +
    " ｜ 说明: " + (item.note || "-");
  loadDetail();
}

function closeDetail(){
  currentDetail = null;
  byId("detailCard").hidden = true;
  byId("tokenCard").hidden = false;
  loadTokens();
}

async function loadDetail(){
  if (!currentDetail) return;
  try {
    var query = "/audit?limit=500&event=mcp&tokenId=" + encodeURIComponent(currentDetail.id);
    var data = await api("GET", query);
    var body = byId("detailRows");
    body.textContent = "";
    var entries = data.entries || [];
    entries.slice().reverse().forEach(function(entry){
      var row = el("tr");
      var values = [
        fmt(entry.ts),
        entry.method,
        entry.path,
        entry.status,
        entry.reason,
        fmtDuration(entry.durationMs),
        entry.ip,
        entry.event
      ];
      values.forEach(function(value){ row.appendChild(el("td", "", value === undefined ? "-" : value)); });
      body.appendChild(row);
    });
    byId("detailEmpty").hidden = entries.length > 0;
  } catch (error) { handleError(error); }
}

function openEdit(item){
  editingId = item ? item.id : null;
  byId("editTitle").textContent = item ? "编辑 " + item.label : "新建 Token";
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
    byId("editError").textContent = "用户备注不能为空";
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
  if (!confirm("轮换后旧 token 立即失效，继续？")) return;
  try {
    var result = await api("POST", "/tokens/" + encodeURIComponent(id) + "/rotate", {});
    showNewToken(result.token);
    loadTokens();
  } catch (error) { handleError(error); }
}

async function setStatus(id, action){
  try {
    await api("POST", "/tokens/" + encodeURIComponent(id) + "/" + action);
    toast("已" + (action === "enable" ? "启用" : "禁用"));
    loadTokens();
  } catch (error) { handleError(error); }
}

async function remove(id, label){
  if (!confirm("确认删除 " + label + " 的 token？此操作不可恢复。")) return;
  try {
    await api("DELETE", "/tokens/" + encodeURIComponent(id));
    toast("已删除");
    loadTokens();
  } catch (error) { handleError(error); }
}

async function loadAudit(){
  try {
    var data = await api("GET", "/audit?limit=50");
    var body = byId("auditRows");
    body.textContent = "";
    data.entries.slice().reverse().forEach(function(entry){
      var row = el("tr");
      [entry.ts, entry.event, entry.user, entry.tokenId, entry.method, entry.path, entry.status, entry.reason].forEach(function(value){
        row.appendChild(el("td", "", value === undefined ? "-" : value));
      });
      body.appendChild(row);
    });
    byId("auditCard").hidden = false;
  } catch (error) { handleError(error); }
}

byId("dbxContinueBtn").addEventListener("click", async function(){
  byId("loginError").textContent = "";
  await tryDbxSession();
});
byId("newBtn").addEventListener("click", function(){ openEdit(null); });
byId("refreshBtn").addEventListener("click", loadTokens);
byId("auditBtn").addEventListener("click", function(){
  if (currentDetail) closeDetail();
  loadAudit();
});
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
