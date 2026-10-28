// 감사로그 면 — 2.0 getAuditLogsPage/getAuditNameMap을 공용 실행기의 읽기 전용 트랜잭션에서 그대로 실행한다.
// 검색·기간(KST 경계)·이름 선해석·50행 페이징·조회 오류 표면화는 원본 함수가 맡는다.
import { readV2 } from './v2-server-runner.mjs';

const MODULE = 'features/audit/server/log.ts';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function loadOwnerAudit(viewerId, tenantId, params, subjects) {
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  let dateFrom = YMD.test(params.from ?? '') ? params.from : undefined;
  let dateTo = YMD.test(params.to ?? '') ? params.to : undefined;
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const page = Math.max(1, Number(params.page) || 1);
  try {
    const { value: result } = await readV2(MODULE, 'getAuditLogsPage', [
      { action: params.action, q, dateFrom, dateTo }, page, 50,
    ], { actorId: viewerId, tenantId });
    let names = {};
    if (result.rows?.length) {
      try {
        const { value: nameMap } = await readV2(MODULE, 'getAuditNameMap', [result.rows], { actorId: viewerId, tenantId });
        if (nameMap instanceof Map) names = Object.fromEntries(nameMap);
      } catch { /* 2.0도 이름 보강 실패 시 행 자체는 보여 준다. */ }
    }
    return { ...result, names, subjects };
  } catch (error) {
    return { rows: [], total: 0, error: error?.message ?? '감사로그를 불러오지 못했습니다', names: {}, subjects };
  }
}
