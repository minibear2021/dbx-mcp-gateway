import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 5000;

export class AuditLog {
  constructor(filePath, enabled = true) {
    this.filePath = filePath;
    this.enabled = enabled;
  }

  append(entry) {
    if (!this.enabled) return;
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
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

  read(limit = 100) {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-Math.min(Math.max(limit, 1), MAX_LINES)).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  }
}
