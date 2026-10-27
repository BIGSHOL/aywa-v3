// Persistent local workflow overlay (FLOW-ENGINE.md). One JSON state file per
// namespace/tenant/snapshot under F:/aywa-dev/owner-flow — never the source or clone DB.
// Writes are serialized, atomic (temp file + fsync + rename) and only replace the
// in-memory state after the disk write succeeded. A state written for another tenant,
// snapshot or schema is an explicit error; nothing is reset or deleted automatically.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const SCHEMA_VERSION = 1;
export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const stamp = iso => String(iso).replace(/[^0-9]/g, '').slice(0, 14);
export const namespaceDir = ({ root, namespace, tenantSlug, capturedAt }) => {
  // Worktree folder names like v3.0.0 are allowed; no separators, no '..', no trailing dot (Windows drops it).
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,59}[a-z0-9])?$/i.test(namespace || '') || namespace.includes('..') || !/^[a-z0-9_-]{1,40}$/i.test(tenantSlug || '')) throw new StoreError('store_config', '저장 위치 설정이 올바르지 않습니다.');
  return resolve(root, namespace, `${tenantSlug}-${stamp(capturedAt)}`);
};

export const emptyState = identity => ({
  schemaVersion: SCHEMA_VERSION, tenantId: identity.tenantId, tenantSlug: identity.tenantSlug, capturedAt: identity.capturedAt,
  revision: 0, seq: 0, seededKeys: {}, cases: {}, events: [], commands: {}, decisions: {}, createdAt: new Date().toISOString(),
});

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
const locked = () => new StoreError('store_locked', '다른 서버가 이 업무 기록을 쓰고 있습니다.');

// Exclusive-create lock holding "<pid>:<token>". A live holder (this process included) keeps it;
// a dead holder's lock is moved aside and creation is retried once.
async function acquireLock(lockFile) {
  const token = `${process.pid}:${randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const h = await open(lockFile, 'wx'); try { await h.writeFile(token); await h.sync(); } finally { await h.close(); } return token; } catch (error) {
      if (error.code !== 'EEXIST') throw new StoreError('store_unreadable', '업무 기록 잠금을 만들지 못했습니다.');
      const held = await readFile(lockFile, 'utf8').catch(() => null);
      if (held === null) continue; // released meanwhile
      const pid = Number(held.split(':')[0]);
      if (pid && pidAlive(pid)) throw locked();
      // No pid yet = another opener between create and write; only an old empty file is stale.
      const info = await stat(lockFile).catch(() => null);
      if (!pid && (!info || Date.now() - info.mtimeMs < 10_000)) throw locked();
      // Move the stale file aside, then make sure what moved is the stale lock we inspected;
      // if a new owner's lock was taken by mistake, put it back and step aside.
      const aside = `${lockFile}.stale-${token.split(':')[1]}`;
      try { await rename(lockFile, aside); } catch { throw locked(); }
      if ((await readFile(aside, 'utf8').catch(() => null)) !== held) { await rename(aside, lockFile).catch(() => {}); throw locked(); }
    }
  }
  throw locked();
}
async function releaseLock(lockFile, token) {
  if (token && (await readFile(lockFile, 'utf8').catch(() => null)) === token) await rm(lockFile, { force: true });
}

export async function openStore({ dir, identity, lock = true }) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'state.json'), lockFile = join(dir, 'state.lock');
  const token = lock ? await acquireLock(lockFile) : null;
  let state;
  try {
    try { state = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw new StoreError('store_unreadable', '업무 기록 파일을 읽지 못했습니다. 파일을 옮긴 뒤 다시 시작해 주세요.');
      state = emptyState(identity);
    }
    if (state.schemaVersion !== SCHEMA_VERSION) throw new StoreError('flow_state_mismatch', '업무 기록 형식 버전이 다릅니다. 기존 파일을 보관한 뒤 다시 시작해 주세요.');
    if (state.tenantId !== identity.tenantId || state.capturedAt !== identity.capturedAt) throw new StoreError('flow_state_mismatch', '다른 지점 또는 다른 복사본의 업무 기록입니다. 섞지 않고 멈췄습니다.');
  } catch (error) { await releaseLock(lockFile, token); throw error; }

  let chain = Promise.resolve(), counter = 0, closed = false;
  async function persist(next) {
    const tmp = `${file}.tmp-${process.pid}-${(counter += 1)}`;
    const handle = await open(tmp, 'w');
    try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
    try { await rename(tmp, file); } catch (error) { await rm(tmp, { force: true }); throw error; }
  }
  return {
    dir, file,
    get state() { return state; },
    /** Runs fn(draft) one at a time; fn returns { next, result }. Disk first, memory second. */
    transact(fn) {
      if (closed) return Promise.reject(new StoreError('store_closed', '업무 기록이 닫혔습니다.'));
      const run = chain.then(async () => {
        const draft = structuredClone(state);
        const { next, result } = await fn(draft);
        if (next) {
          try { await persist(next); } catch { throw new StoreError('store_write_failed', '업무 기록을 저장하지 못했습니다. 변경은 반영되지 않았습니다.'); }
          state = next;
        }
        return result;
      });
      chain = run.catch(() => {});
      return run;
    },
    /** Waits for pending writes, then releases only the lock this store owns. */
    async close() { closed = true; await chain; await releaseLock(lockFile, token); },
  };
}
