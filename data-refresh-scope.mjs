// 2.0 저장의 확인된 영향 범위. 범위를 입증하지 않은 동작은 전체 갱신으로 보낸다.
// decideJudgment는 teacher_satisfaction_judgments와 감사 기록을 바꾼다.
// 이 표는 snapshotTables(첫 화면 원본)에 없고 class-review 작업 공간·신호에만 들어간다.
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { activeBackup } from './full-db-paths.mjs';
import { EVIDENCE, assertWorkspaces } from './domain-snapshot-core.mjs';
import { FAMILY_IDS } from './domain-snapshot.mjs';
import { classReviewFamily } from './domain-snapshot-academic2.mjs';

export const scopeForWrite = ({ screen, action } = {}) =>
  screen === 'class-review' && action === 'decideJudgment' ? 'class-review' : 'full';

export async function refreshClassReview(snapshot, records) {
  if (!snapshot?.workspaces?.families || !records?.families) throw new Error('영역 갱신의 이전 자료가 없습니다.');
  const { directory } = await activeBackup();
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  if (manifest.capturedAt !== snapshot.meta?.importedAt) throw Object.assign(new Error('복사본이 시작 때와 다릅니다.'), { code: 'copy_changed' });
  const db = await openFullDatabase();
  try {
    return await db.begin('isolation level repeatable read read only', async sql => {
      const [tenant] = await sql`select slug from public.tenants where id=${tenantId}`;
      if (tenant?.slug !== 'cs') throw new Error('Local snapshot tenant mismatch');
      const next = await classReviewFamily({ sql, t: tenantId });
      const families = { ...snapshot.workspaces.families, 'class-review': next };
      const stored = new Map(records.families);
      stored.set('class-review', { title: next.title, facets: next.facets, records: next[EVIDENCE] });
      for (const [id, f] of Object.entries(families)) if (id !== 'class-review') Object.defineProperty(f, EVIDENCE, { value: stored.get(id)?.records || [], enumerable: false });
      snapshot.workspaces = { ...snapshot.workspaces, families };
      assertWorkspaces(snapshot.workspaces, FAMILY_IDS);
      return { snapshot, records: { asOf: records.asOf, families: stored } };
    });
  } finally { await db.end(); }
}
