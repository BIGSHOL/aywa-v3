// 저장 뒤 자료 갱신의 계산 쪽(data-refresh.mjs, AX-H2) — 서버 밖 작업 스레드에서 한 번 돌고 끝난다.
// 복사본에서 첫 화면 자료(snapshot.mjs)·작업 공간 기록·비서 컨텍스트·업무 흐름 원본(flow-source.mjs)을 다시 만들어 한 번에 돌려준다.
// 읽기만 한다(두 조회 모두 read only 트랜잭션 · 복사본 검증 파일 대조는 snapshot.mjs 그대로). 이 스레드의 모듈 상태
// (domain-snapshot 저장소 등)는 서버 스레드와 따로라, 계산 도중에 서버가 내주는 자료가 바뀌지 않는다.
import { parentPort, workerData } from 'node:worker_threads';
import { loadSnapshot } from './snapshot.mjs';
import { workspaceRecords } from './domain-snapshot.mjs';
import { loadFlowSource } from './flow-source.mjs';
import { areaDestinations, buildAssistantContext } from './claude-bridge-context.mjs';
import { decodeRecords, encodeData } from './data-refresh.mjs';
import { refreshClassReview } from './data-refresh-scope.mjs';

const ms = t => Math.round(performance.now() - t), started = performance.now(), timings = {};
try {
  let t = performance.now();
  let snapshot, records;
  if (workerData?.scope === 'class-review' && workerData.previous) {
    const previous = workerData.previous;
    const oldRecords = await decodeRecords(previous.records);
    ({ snapshot, records } = await refreshClassReview(JSON.parse(Buffer.from(previous.json).toString('utf8')), oldRecords));
  } else {
    snapshot = await loadSnapshot();
    records = workspaceRecords();
  }
  timings.snapshot = ms(t);
  const { json, snapshotHash, recordsHash, records: packed } = encodeData(snapshot, records);
  let source = null, flowError = null;
  if (workerData?.flow) {
    t = performance.now();
    try { source = await loadFlowSource({ workspaces: snapshot.workspaces, capturedAt: snapshot.meta.importedAt, asOf: snapshot.meta.asOf }); }
    catch (error) { flowError = error?.code || 'flow_source_failed'; }
    timings.flow = ms(t);
  }
  const assistant = { context: buildAssistantContext(snapshot), area: areaDestinations(snapshot) };
  timings.total = ms(started);
  // 큰 둘(첫 화면 자료 3.8MB · 기록 14.5MB)은 바이트째 옮겨 보낸다 — 서버 스레드가 객체를 복제해 받느라 멈추지 않게.
  const own = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), jsonBytes = own(json), recordBytes = own(packed.bytes);
  parentPort.postMessage({ ok: true, meta: { importedAt: snapshot.meta.importedAt, asOf: snapshot.meta.asOf, tenant: snapshot.meta.tenant }, json: jsonBytes, snapshotHash, recordsHash,
    records: { bytes: recordBytes, ends: packed.ends, asOf: packed.asOf }, source, flowError, assistant, timings, postedAt: Date.now() }, [jsonBytes, recordBytes]);
} catch (error) {
  parentPort.postMessage({ ok: false, error: error?.code || 'snapshot_failed', message: String(error?.message || '').slice(0, 300) });
}
