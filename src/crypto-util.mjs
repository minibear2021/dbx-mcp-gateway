import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 生成高熵 token：mcp_ + 256bit 随机值的 base64url 形式。 */
export function generateToken(prefix = 'mcp_') {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

/** token 落库只存 SHA-256；token 本身是高熵随机值，无需加盐。 */
export function hashToken(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * 对两个字符串做恒定时间比较。先各自哈希，避免长度差异导致提前返回。
 * 比较的始终是 32 字节摘要，因此 timingSafeEqual 不会因长度不等抛错。
 */
export function safeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(Buffer.from(hashToken(a), 'hex'), Buffer.from(hashToken(b), 'hex'));
}

/**
 * 解析 Authorization: Bearer <token>。
 * 与 dbx 自身 http_auth.rs 的规则保持一致：scheme 不区分大小写，
 * 只允许一个空格，token 非空且不含任何空白字符。
 */
export function parseBearer(value) {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf(' ');
  if (separator < 0) return null;
  const scheme = value.slice(0, separator);
  const token = value.slice(separator + 1);
  if (!/^bearer$/i.test(scheme)) return null;
  if (token.length === 0 || /\s/.test(token)) return null;
  return token;
}
