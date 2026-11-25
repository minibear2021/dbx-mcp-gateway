import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_LINES = 5000;

export class AuditLog {
  constructor(filePath, enabled = true) {
    this.filePath = filePath;
    this.enabled = enabled;
  }

  append(entry) {
    if (!this.enabled) return;
    const line = `${JSON.stringify({
      id: `evt_${randomUUID()}`,
      ts: new Date().toISOString(),
      ...entry,
    })}\n`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.filePath, line, { mode: 0o600 });
    this.trim();
  }

  /** 简单按行截断，避免审计日志无限增长；只在明显超限时才执行。 */
  trim() {
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length <= MAX_LINES) return;
      fs.writeFileSync(this.filePath, `${lines.slice(-MAX_LINES).join('\n')}\n`, { mode: 0o600 });
    } catch {
      // 审计失败不应影响主流程。
    }
  }

  /** 按 tokenId / event / user 过滤出匹配的条目（按写入顺序，越靠后越新）。 */
  filtered(filter = {}) {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    const entries = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
    return entries.filter((entry) => {
      if (filter.tokenId && entry.tokenId !== filter.tokenId) return false;
      if (filter.event && entry.event !== filter.event) return false;
      if (filter.user && entry.user !== filter.user) return false;
      return true;
    });
  }

  /**
   * 读取审计条目。offset 表示从最新条目往前跳过的条数，用于分页。
   * 返回值仍是按写入顺序（旧的在前，新的在后）。
   */
  read(limit = 100, filter = {}, offset = 0) {
    const filtered = this.filtered(filter);
    const size = Math.min(Math.max(limit, 1), MAX_LINES);
    const skip = Math.max(offset, 0);
    const end = filtered.length - skip;
    if (end <= 0) return [];
    const start = Math.max(0, end - size);
    return filtered.slice(start, end);
  }

  count(filter = {}) {
    return this.filtered(filter).length;
  }
}
