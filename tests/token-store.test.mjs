import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TokenStore } from '../src/token-store.mjs';

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbx-gateway-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new TokenStore(path.join(dir, 'tokens.json'));
}

test('创建、校验、持久化 token；明文与哈希都不落在记录里', (t) => {
  const store = tempStore(t);
  const { token, record } = store.create({ label: '张三', note: '分析组' });

  assert.match(token, /^mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(record.label, '张三');
  assert.equal(record.status, 'active');
  assert.equal(JSON.stringify(record).includes(token), false);
  assert.equal(JSON.stringify(record).includes('hash'), false);

  assert.equal(store.verify(token).record?.id, record.id);
  assert.equal(store.verify(token + 'x').reason, 'invalid-token');

  const raw = fs.readFileSync(store.filePath, 'utf8');
  assert.equal(raw.includes(token), false);
  const reloaded = new TokenStore(store.filePath);
  assert.equal(reloaded.verify(token).record?.id, record.id);
  reloaded.close();
});

test('轮换使旧 token 立即失效，并保留禁用状态', (t) => {
  const store = tempStore(t);
  const first = store.create({ label: '李四' });
  const rotated = store.rotate(first.record.id);

  assert.notEqual(rotated.token, first.token);
  assert.equal(store.verify(first.token).reason, 'invalid-token');
  assert.equal(store.verify(rotated.token).record?.id, first.record.id);
  assert.ok(rotated.record.rotatedAt);

  store.setStatus(first.record.id, 'disabled');
  const rotatedAgain = store.rotate(first.record.id);
  assert.equal(rotatedAgain.record.status, 'disabled');
  assert.equal(store.verify(rotatedAgain.token).reason, 'disabled-token');
});

test('禁用、启用与过期语义', (t) => {
  const store = tempStore(t);
  const { token, record } = store.create({ label: '王五' });

  store.setStatus(record.id, 'disabled');
  assert.equal(store.verify(token).reason, 'disabled-token');
  store.setStatus(record.id, 'active');
  assert.equal(store.verify(token).record?.id, record.id);

  const expired = store.create({ label: '已过期', expiresAt: '2000-01-01T00:00:00Z' });
  assert.equal(store.verify(expired.token).reason, 'expired-token');
  store.update(expired.record.id, { expiresAt: '' });
  assert.equal(store.verify(expired.token).record?.id, expired.record.id);
});

test('修改备注、删除 token', (t) => {
  const store = tempStore(t);
  const { token, record } = store.create({ label: '旧名字', note: '旧备注' });
  const updated = store.update(record.id, { label: '新名字', note: '新备注' });
  assert.equal(updated.label, '新名字');
  assert.equal(updated.note, '新备注');
  assert.equal(store.verify(token).record?.label, '新名字');

  assert.equal(store.remove(record.id), true);
  assert.equal(store.verify(token).reason, 'invalid-token');
  assert.equal(store.remove(record.id), false);
});
