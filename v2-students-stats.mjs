import { Worker } from 'node:worker_threads';

/** 원본 통계 로더의 다섯 카드 Promise를 읽기 트랜잭션에서 모두 기다린다. */
export async function readStudentStats({ tenantId, actorId, subject, firstParams, trendParams }) {
  const worker = new Worker(new URL('./v2-students-stats-worker.mjs', import.meta.url));
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('원생 통계가 제때 끝나지 않았습니다')), 120_000);
      worker.once('error', e => { clearTimeout(timer); reject(e); });
      worker.on('message', m => {
        if (m?.ready) { worker.postMessage({ id: 1, tenantId, actorId, subject, firstParams, trendParams }); return; }
        if (m?.id !== 1) return;
        clearTimeout(timer);
        if (m.ok) resolve(m.result); else reject(new Error(`원생 통계: ${m.message}`));
      });
    });
  } finally { await worker.terminate(); }
}
