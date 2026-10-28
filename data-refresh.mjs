// 저장 뒤 자료 갱신(Codex 검수 10-28 AX-H2). 2.0 화면이 Docker 복사본에 저장하면(v2-screens.mjs onWrite) 같은 복사본에서
// 첫 화면 자료(/snapshot.js)·작업 공간 기록(workspace-store.mjs)·AI 비서 컨텍스트·업무 흐름 원본을 다시 만든다.
// · 모아서 한 번 — 마지막 저장 뒤 debounceMs. 계속 저장해도 첫 저장 뒤 maxWaitMs 안에는 한 번 돈다.
// · 한 번에 하나 — 도는 중에 저장이 오면 끝난 뒤 한 번 더(그때도 모아서).
// · 계산은 작업 스레드(data-refresh-worker.mjs). 스냅숏 계산이 서버 스레드를 한 번에 4.6초 붙잡았다(10-28 실측 — 그동안 모든
//   요청이 멈춤). 작업 스레드로 돌리면 메인 스레드는 결과를 받는 수십 ms만 쓰고, 그동안 요청은 옛 자료로 바로 답한다.
// · 바꿔 끼우기는 한 틱 — 첫 화면 자료·기록 저장소·비서 컨텍스트가 함께 바뀐다(업무 흐름은 바로 뒤 reloadSource).
// · 실패하면 옛 자료 그대로(서버는 계속 돈다). retryMs 뒤 다시, 연달아 maxRetries번까지 — 그다음은 다음 저장 때.
// · 같은 복사본만 — 복사 시각(importedAt)·기준일이 시작 때와 다르면(복사본을 갈아 끼움) 아무것도 바꾸지 않고 멈춘다.
//   업무 흐름 저장소 폴더가 복사 시각으로 정해지므로 새 빈 저장소로 갈아타지 않게. 그때는 서버를 다시 켠다.
//   (저장으로 내용이 바뀐 것은 정상 — 복사본 검증 파일·활성 백업은 그대로라 snapshot.mjs의 검증도 그대로 통과한다.)
// · 내용이 같으면(해시) 개정 번호를 올리지 않는다 — 열린 화면이 3.8MB를 다시 받지 않게.
import { Worker } from 'node:worker_threads';
import { setImmediate } from 'node:timers';
import { createHash } from 'node:crypto';
import { useWorkspaceStore } from './workspace-store.mjs';
import { scopeForWrite } from './data-refresh-scope.mjs';

export const DATA_REVISION_PATH = '/api/data-revision';
export class RefreshError extends Error { constructor(code, message, { final = false } = {}) { super(message); this.code = code; this.final = final; } }

const sha = data => createHash('sha256').update(data).digest('hex');
/**
 * 기록 저장소를 영역별 JSON 바이트 한 묶음으로(ends = 영역마다 끝 위치). 작업 스레드는 이것을 복사 없이 옮겨 보낸다 — 기록 5.7만 건을
 * 객체째 복제해 받으면 서버 스레드가 1.6초 멈췄다(10-28 실측, JSON.parse는 0.4초). 기록은 JSON 값뿐이라 풀어도 똑같다(같은 날 전수 확인).
 */
export function encodeRecords(records) {
  const parts = records ? [...records.families].map(entry => Buffer.from(JSON.stringify(entry))) : [], ends = [];
  let at = 0; for (const p of parts) ends.push(at += p.length);
  const bytes = Buffer.concat(parts);
  return { bytes, ends, asOf: records?.asOf ?? null, hash: sha(bytes) };
}
/** 서버 스레드: 영역 하나씩 풀고 사이마다 다른 요청에 차례를 넘긴다(바꿔 끼우기는 다 푼 뒤 한 번에). */
export async function decodeRecords({ bytes, ends, asOf }) {
  const buf = Buffer.from(bytes), families = new Map(); let start = 0;
  for (const end of ends) { const [id, family] = JSON.parse(buf.toString('utf8', start, end)); families.set(id, family); start = end; await new Promise(r => setImmediate(r)); }
  return Object.freeze({ asOf, families });
}
/** 내줄 모양(시작 때 서버와 작업 스레드가 같은 함수로): 첫 화면 자료 JSON('<' 이스케이프 — script 안에 넣는다)·기록 묶음과 내용 해시. */
export function encodeData(snapshot, records) {
  const json = Buffer.from(JSON.stringify(snapshot).replaceAll('<', '\\u003c')), packed = encodeRecords(records);
  return { json, snapshotHash: sha(json), recordsHash: packed.hash, records: packed };
}

/** 지금 내주는 첫 화면 자료 — 개정 번호·ETag·/snapshot.js 본문(끝에 개정 번호를 붙여 화면이 자기 자료의 번호를 안다). */
export function createDataHolder(initial, now = () => new Date().toISOString()) {
  const make = (d, revision) => {
    const etag = `"${d.snapshotHash.slice(0, 24)}"`;
    const script = Buffer.concat([Buffer.from('window.AcademySnapshot='), d.json, Buffer.from(`;window.AcademySnapshotRevision=${JSON.stringify({ revision, etag })};`)]);
    return Object.freeze({ revision, etag, refreshedAt: now(), json: d.json, script, snapshotHash: d.snapshotHash, recordsHash: d.recordsHash });
  };
  let current = make(initial, 1);
  return {
    get current() { return current; },
    /** 내용(첫 화면 자료·기록)이 바뀌었으면 개정 번호를 올려 바꿔 끼우고 true, 같으면 그대로 두고 false. */
    replace(d) {
      if (d.snapshotHash === current.snapshotHash && d.recordsHash === current.recordsHash) return false;
      current = make(d, current.revision + 1);
      return true;
    },
  };
}

/** 모아서 한 번 · 한 번에 하나 · 실패하면 몇 번만 다시. run이 던지면 실패(error.final이면 다시 하지 않음). */
// minGapMs = 앞 갱신이 끝난 뒤 다음 갱신까지 쉬는 시간 — 저장이 이어져도 복사본 DB를 쉬지 않고 누르지 않게(한 번에 20~30초 읽는다).
export function createRefreshScheduler({ run, debounceMs = 3000, maxWaitMs = 20000, minGapMs = 5000, retryMs = 30000, maxRetries = 3, log = console.log, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null, firstAt = 0, lastAt = 0, endedAt = -Infinity, running = null, failures = 0, closed = false;
  const st = { refreshing: false, pending: false, failures: 0, checkedAt: null, lastMs: null, lastError: null, runs: 0 };
  // 예약 실행이 던져도 처리 안 된 거부로 서버가 끝나지 않게.
  const arm = delay => { if (timer) clearTimer(timer); timer = setTimer(() => { fire().catch(error => console.error(`자료 갱신 예약 오류: ${error?.message || error}`)); }, Math.max(0, delay)); timer?.unref?.(); };
  const due = () => Math.max(Math.min(lastAt + debounceMs, firstAt + maxWaitMs), endedAt + minGapMs) - now();
  function schedule() {
    if (closed) return;
    const t = now(); lastAt = t; if (!firstAt) firstAt = t; st.pending = true;
    if (!running) arm(due());
  }
  async function fire() {
    timer = null;
    if (closed || running) return;
    firstAt = 0; st.pending = false; st.refreshing = true;
    const started = now();
    running = Promise.resolve().then(run).then(() => null, error => error || new RefreshError('refresh_failed', '자료를 다시 만들지 못했습니다.'));
    const error = await running;
    running = null; endedAt = now(); st.refreshing = false; st.runs += 1; st.lastMs = endedAt - started; st.checkedAt = new Date().toISOString();
    if (error) { failures += 1; st.lastError = error.code || 'refresh_failed'; log(`자료 갱신 실패(${st.lastError}${failures > 1 ? ` · 연달아 ${failures}번` : ''}) — 옛 자료를 그대로 씁니다. ${error.message || ''}`); }
    else { failures = 0; st.lastError = null; }
    st.failures = failures;
    if (closed) return;
    if (firstAt) arm(due()); // 도는 동안 온 저장 — 모아서 한 번 더
    else if (error && !error.final && failures <= maxRetries) { st.pending = true; arm(retryMs); }
  }
  return {
    schedule,
    status: () => ({ ...st }),
    /** 지금 도는 갱신이 끝날 때까지(없으면 바로) — 시험·종료용. */
    idle: () => running || Promise.resolve(),
    async close() { closed = true; if (timer) clearTimer(timer); timer = null; await running; },
  };
}

/** 작업 스레드 한 번 — 결과를 받으면 바로 끝낸다(스레드의 DB 연결·메모리는 스레드와 함께 사라진다). */
export function runWorker({ flow, scope = 'full', previous = null, timeoutMs = 180_000 }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./data-refresh-worker.mjs', import.meta.url), { workerData: { flow, scope, previous } });
    let settled = false;
    const done = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate().catch(() => {}); fn(value); };
    const timer = setTimeout(() => done(reject, new RefreshError('timeout', `자료 계산이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`)), timeoutMs);
    worker.once('message', m => (m?.ok ? done(resolve, m) : done(reject, new RefreshError(m?.error || 'refresh_failed', m?.message || '자료를 다시 만들지 못했습니다.', { final: m?.error === 'copy_changed' }))));
    worker.once('error', e => done(reject, new RefreshError('worker_error', e?.message || '작업 스레드에서 오류가 났습니다.')));
    worker.once('exit', code => done(reject, new RefreshError('worker_exit', `작업 스레드가 결과 없이 끝났습니다(${code}).`)));
  });
}

/**
 * serve-live.mjs 배선: schedule()(저장 성공 알림) → 작업 스레드 계산 → 같은 복사본인지 확인 → 한 틱에 바꿔 끼우기
 * (data · 기록 저장소 · assistant.use) → flow.service.reloadSource(source). reloadSource가 아직 없으면 건너뛰고 로그만.
 * expect = 시작 때의 { importedAt, asOf }.
 */
export function createDataRefresh({ data, assistant = null, flow = null, expect, initialRecords = null, spawn = runWorker, log = console.log, scheduler = {} }) {
  let blocked = null, recordsForNext = initialRecords, pendingScope = null;
  async function run() {
    if (blocked) throw blocked;
    const started = Date.now();
    const scope = pendingScope === 'class-review' && recordsForNext ? 'class-review' : 'full';
    pendingScope = null;
    // 업무 흐름이 아직 시작 중이면 기다린다(시작이 실패했으면 흐름 없이).
    const service = flow ? (flow.service || await Promise.resolve(flow.ready).then(() => flow.service, () => null) || null) : null;
    const out = await spawn({ flow: Boolean(service), scope, previous: scope === 'full' ? null : { json: data.current.json, records: recordsForNext } });
    // 지점은 snapshot.mjs가 slug로 이미 확인한다 — 지점 이름은 내용이라(저장으로 바뀔 수 있다) 비교하지 않는다.
    for (const key of ['importedAt', 'asOf']) if (out.meta?.[key] !== expect[key]) {
      blocked = new RefreshError('copy_changed', `복사본이 시작 때와 다릅니다(${key}). 자료를 바꾸지 않았습니다 — 서버를 다시 켜 주세요.`, { final: true });
      throw blocked;
    }
    const transit = Number.isFinite(out.postedAt) ? Date.now() - out.postedAt : null, before = data.current;
    const snapshotChanged = out.snapshotHash !== before.snapshotHash, recordsChanged = out.recordsHash !== before.recordsHash;
    let records = null, unpack = 0;
    if (recordsChanged) { const at = Date.now(); records = await decodeRecords(out.records); unpack = Date.now() - at; } // 같으면 풀지도 않는다
    // 여기부터 한 틱 — 첫 화면 자료·기록 저장소·비서 컨텍스트가 같은 시점으로.
    const changed = data.replace({ json: Buffer.from(out.json), snapshotHash: out.snapshotHash, recordsHash: out.recordsHash });
    if (recordsChanged) useWorkspaceStore(records);
    recordsForNext = out.records;
    if (snapshotChanged) assistant?.use?.(out.assistant);
    let note = '업무 흐름 꺼짐', failed = null;
    if (service && out.flowError) { note = `업무 흐름 원본 실패(${out.flowError}) — 흐름은 옛 원본`; failed = new RefreshError('flow_source_failed', '업무 흐름 원본을 다시 읽지 못했습니다.'); }
    else if (service && typeof service.reloadSource !== 'function') note = '업무 흐름 reloadSource 아직 없음 — 건너뜀';
    else if (service) {
      const at = Date.now();
      // 로그에는 건수와 반영 여부만(changes 목록은 길어질 수 있다). applied:false = 미리보기만(OWNER_CONCEPT_FLOW_RECONCILE=apply가 아님).
      const brief = r => r && typeof r === 'object' ? Object.fromEntries(['created', 'updated', 'closed', 'reopened', 'unchanged', 'applied'].filter(k => k in r).map(k => [k, r[k]])) : r ?? null;
      try { const result = await service.reloadSource(out.source); note = `업무 흐름 reloadSource ${Date.now() - at}ms ${JSON.stringify(brief(result))}`; }
      catch (error) { note = `업무 흐름 reloadSource 실패(${error?.code || 'error'})`; failed = new RefreshError('flow_reload_failed', error?.message || '업무 흐름을 새 원본으로 맞추지 못했습니다.'); }
    }
    const t = out.timings || {};
    const what = changed ? `바뀜: ${[snapshotChanged && '첫 화면', recordsChanged && '기록'].filter(Boolean).join('·')}` : '그대로';
    log(`자료 갱신 r${data.current.revision}(${what}) ${Date.now() - started}ms — 작업 스레드 ${t.total ?? '-'}ms(스냅숏 ${t.snapshot ?? '-'}ms · 흐름 원본 ${t.flow ?? '-'}ms) · 전달 ${transit ?? '-'}ms${recordsChanged ? ` · 기록 풀기 ${unpack}ms` : ''} · ${note}${scope === 'full' ? '' : ` · 영향 영역 ${scope}`}`);
    if (failed) throw failed; // 첫 화면 쪽은 이미 새 자료 — 흐름만 다시 맞추러 한 번 더(횟수 제한)
  }
  const s = createRefreshScheduler({ run, log, ...scheduler });
  return {
    ...s,
    schedule() { pendingScope = 'full'; s.schedule(); },
    scheduleWrite(write) {
      const next = scopeForWrite(write);
      pendingScope = pendingScope === null ? next : pendingScope === next ? next : 'full';
      s.schedule();
    },
    /** GET /api/data-revision 본문 — 화면은 revision·etag만 본다. */
    info() {
      const d = data.current, st = s.status();
      return { revision: d.revision, etag: d.etag, asOf: expect.asOf, refreshedAt: d.refreshedAt, checkedAt: st.checkedAt, refreshing: st.refreshing, pending: st.pending, stale: st.failures > 0 || Boolean(blocked) };
    },
  };
}
