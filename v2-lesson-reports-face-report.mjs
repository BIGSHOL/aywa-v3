// 2.0 화면 · 수업보고서 관리 — '보고서 설정' 면(?tab=report) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: Promise.all([getTenantSettings(), getReportTeacherCandidates(), getVideoHomeworkClassOptions(tenantId)]) →
//   { reportSettings: settings.report, teachers: cand.bySubject, staffNames: cand.staffNames, videoClasses } — 그대로.
//  · reportSettings = 뼈대가 읽은 학원 설정(2.0 resolveSettings — report 섹션은 2.0도 다듬지 않고 병합값 그대로).
//  · getReportTeacherCandidates = getTeacherLabelsBySubject(작성률 면 v2-lesson-reports-face-writing.mjs labelsBySubject — 같은 원본) ∩ 퇴사 아닌 직원 이름(users.status <> 'inactive').
//  · getVideoHomeworkClassOptions = 운영 중 반(is_active · closed_at 없음) · 운영 먼저 · 이름 가나다순.
//  · 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본은 RLS가 없어 모든 조회에 tenant_id를 직접 건다.
// · 읽기 전용 · 바깥 호출 없음. 저장(saveOwnerSection · 로고 올리기)은 다음 단계.

import { labelsBySubject } from './v2-lesson-reports-face-writing.mjs';

const MODULES = { label: 'features/timetable/lib/teacher-label.ts' };
let modsP = null;
const mods = (load) => (modsP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)]))
  .then(Object.fromEntries).catch((e) => { modsP = null; throw e; }));

/** 2.0 getReportTeacherCandidates() — 과목별 라벨 중 지금 직원 이름에 있는 것만(퇴사자·옛 라벨 제외). staffNames = 퇴사 아닌 직원 이름(공백 정리). */
export async function reportTeacherCandidates(sql, t, M) {
  const [labels, staff] = await Promise.all([
    labelsBySubject(sql, t, M),
    sql`select display_name from public.users where tenant_id=${t} and status::text <> 'inactive' order by id`,
  ]);
  const staffSet = new Set(staff.map((u) => u.display_name?.trim()).filter((n) => !!n));
  const bySubject = {};
  for (const [subject, names] of Object.entries(labels)) {
    const filtered = names.filter((n) => staffSet.has(n));
    if (filtered.length > 0) bySubject[subject] = filtered;
  }
  return { bySubject, staffNames: [...staffSet] };
}

/** 2.0 getVideoHomeworkClassOptions(tenantId) — 수업목록 '운영'과 같은 반(활성 · 종강 안 함) · 운영 먼저 · 이름 가나다순. */
export async function videoHomeworkClassOptions(sql, t) {
  const rows = await sql`select id::text id, class_name, subject, is_active from public.classes where tenant_id=${t} and is_active and closed_at is null order by id`;
  return rows.map((r) => ({ id: r.id, name: r.class_name, subjectKey: r.subject, active: r.is_active }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ko'));
}

export async function loadFace(ctx) {
  const M = await mods(ctx.importV2);
  // 같은 관문에 차례로(저장점 조회가 섞이지 않는 일반 조회라 나란히 둬도 되지만, 뼈대·작성률 면과 같은 결로 순서를 지킨다).
  const cand = await reportTeacherCandidates(ctx.sql, ctx.t, M);
  const videoClasses = await videoHomeworkClassOptions(ctx.sql, ctx.t);
  return { tabData: { reportSettings: ctx.settings.report, teachers: cand.bySubject, staffNames: cand.staffNames, videoClasses } };
}
