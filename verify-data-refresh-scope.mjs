// 실제 복사본 읽기 전용: 만족도 영역 갱신은 나머지 첫 화면·작업 공간을 유지한다.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { loadSnapshot } from './snapshot.mjs';
import { workspaceRecords } from './domain-snapshot.mjs';
import { encodeData, decodeRecords, runWorker } from './data-refresh.mjs';
import { refreshClassReview } from './data-refresh-scope.mjs';

const start = performance.now();
const full = await loadSnapshot();
const fullMs = Math.round(performance.now() - start);
const packed = encodeData(full, workspaceRecords());
const records = await decodeRecords(packed.records);
const scopedStart = performance.now();
const scoped = await refreshClassReview(JSON.parse(packed.json.toString('utf8')), records);
const scopedMs = Math.round(performance.now() - scopedStart);
const next = encodeData(scoped.snapshot, scoped.records);
assert.equal(next.snapshotHash, packed.snapshotHash, '변경 전 첫 화면 자료는 동일');
assert.equal(next.recordsHash, packed.recordsHash, '변경 전 영역별 기록도 동일');
assert.deepEqual([...scoped.records.families.keys()], [...records.families.keys()]);
assert(scopedMs < fullMs, `영역 갱신 ${scopedMs}ms / 전체 ${fullMs}ms`);
const workerStart = performance.now();
const worker = await runWorker({ flow: false, scope: 'class-review', previous: { json: packed.json, records: packed.records } });
const workerMs = Math.round(performance.now() - workerStart);
assert.equal(worker.snapshotHash, packed.snapshotHash);
assert.equal(worker.recordsHash, packed.recordsHash);
assert.equal(worker.timings.snapshot < fullMs, true);
console.log(`만족도 영역 갱신 ${scopedMs}ms · 작업 스레드 ${workerMs}ms · 전체 재계산 ${fullMs}ms · 첫 화면·기록 해시 동일`);
