/**
 * Web UI / 管理 API 的唯一鉴权方式：复用 dbx Web 会话。
 *
 * 网关把浏览器带来的 Cookie 头原样透传给 dbx 的 GET /api/auth/check，
 * 该端点恒返回 200，真正的判据是 body 里的 authenticated 字段。
 * 网关不接触 DBX_PASSWORD，也不自己签发任何会话或口令。
 */
export async function authorizeAdminRequest(req, config) {
  if (!req.headers.cookie) return { ok: false, via: null };

  try {
    const response = await fetch(config.dbxAuthCheckUrl, {
      headers: { cookie: req.headers.cookie },
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.authenticated === true) return { ok: true, via: 'dbx' };
    }
  } catch {
    // dbx 不可达、超时或返回异常时按未授权处理。
  }

  return { ok: false, via: null };
}
