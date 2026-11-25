import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { generateToken, hashToken } from './crypto-util.mjs';

const SCHEMA_VERSION = 1;
const HASH_HEX_LENGTH = 64;
const FLUSH_DELAY_MS = 1000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeExpiry(value) {
  if (value === undefined || value === null || value === '') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('expiresAt 必须是可解析的日期时间。');
  return new Date(time).toISOString();
}

function validateLabel(label) {
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error('label（用户备注）不能为空。');
  }
  return label.trim().slice(0, 200);
}

function isHash(value) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${HASH_HEX_LENGTH}}$`).test(value);
}

/** 对外可见的记录，绝不包含 token 明文或哈希。 */
function publicRecord(record) {
  return {
    id: record.id,
    label: record.label,
    note: record.note ?? '',
    status: record.status,
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
    expiresAt: record.expiresAt ?? null,
    useCount: record.useCount ?? 0,
  };
}

export class TokenStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.records = [];
    this.dirty = false;
    this.flushTimer = null;
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.records = [];
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.tokens)) {
      throw new Error(`无法识别的 token 存储格式：${this.filePath}`);
    }
    this.records = parsed.tokens.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        isHash(item.hash) &&
        ['active', 'disabled'].includes(item.status),
    );
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp.${process.pid}`;
    const payload = { version: SCHEMA_VERSION, tokens: this.records };
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows 上 chmod 可能不可用；文件已以 0600 创建，忽略即可。
    }
    this.dirty = false;
  }

  markDirty() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    this.flushTimer.unref?.();
  }

  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) this.save();
  }

  close() {
    this.flush();
  }

  find(id) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  list() {
    return this.records.map(publicRecord);
  }

  get(id) {
    const record = this.find(id);
    return record ? publicRecord(record) : null;
  }

  /** 创建 token。明文只通过返回值交给调用方一次，之后无法再取回。 */
  create({ label, note = '', expiresAt } = {}) {
    const token = generateToken();
    const record = {
      id: `tok_${randomBytes(8).toString('hex')}`,
      label: validateLabel(label),
      note: typeof note === 'string' ? note.trim().slice(0, 1000) : '',
      hash: hashToken(token),
      status: 'active',
      createdAt: nowIso(),
      rotatedAt: null,
      lastUsedAt: null,
      expiresAt: normalizeExpiry(expiresAt),
      useCount: 0,
    };
    this.records.push(record);
    this.save();
    return { token, record: publicRecord(record) };
  }

  /**
   * 校验 token。遍历全部记录做恒定时间比较，不因命中的下标提前退出。
   * 返回 { record, reason }：record 为 null 时 reason 描述拒绝原因。
   */
  verify(token) {
    if (typeof token !== 'string' || token.length === 0) return { record: null, reason: 'invalid-token' };
    const candidate = Buffer.from(hashToken(token), 'hex');
    let matched = null;
    for (const record of this.records) {
      const stored = Buffer.from(record.hash, 'hex');
      if (stored.length !== candidate.length) continue;
      if (timingSafeEqual(stored, candidate)) matched = record;
    }
    if (!matched) return { record: null, reason: 'invalid-token' };
    if (matched.status !== 'active') return { record: null, reason: 'disabled-token' };
    if (matched.expiresAt && Date.parse(matched.expiresAt) <= Date.now()) {
      return { record: null, reason: 'expired-token' };
    }

    matched.lastUsedAt = nowIso();
    matched.useCount = (matched.useCount ?? 0) + 1;
    this.markDirty();
    return { record: publicRecord(matched), reason: null };
  }

  /** 轮换：旧 token 立即失效，新 token 明文只返回一次；状态（禁用/启用）保持不变。 */
  rotate(id, { expiresAt } = {}) {
    const record = this.find(id);
    if (!record) return null;
    const token = generateToken();
    record.hash = hashToken(token);
    record.rotatedAt = nowIso();
    record.expiresAt = expiresAt === undefined ? null : normalizeExpiry(expiresAt);
    this.save();
    return { token, record: publicRecord(record) };
  }

  setStatus(id, status) {
    const record = this.find(id);
    if (!record) return null;
    if (!['active', 'disabled'].includes(status)) throw new Error('status 只能是 active 或 disabled。');
    record.status = status;
    this.save();
    return publicRecord(record);
  }

  update(id, patch = {}) {
    const record = this.find(id);
    if (!record) return null;
    if (patch.label !== undefined) record.label = validateLabel(patch.label);
    if (patch.note !== undefined) record.note = typeof patch.note === 'string' ? patch.note.trim().slice(0, 1000) : '';
    if (patch.expiresAt !== undefined) record.expiresAt = normalizeExpiry(patch.expiresAt);
    this.save();
    return publicRecord(record);
  }

  remove(id) {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) return false;
    this.records.splice(index, 1);
    this.save();
    return true;
  }
}
