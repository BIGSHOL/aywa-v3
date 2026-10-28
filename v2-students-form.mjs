// 2.0 화면 · 학생 수정(app/(shell)/students/[id]/edit/page.tsx) · 새 학생(new/page.tsx) — 페이지가 서버에서 하던 일을 Docker 복사본에서 같은 결과로.
// · 수정 = getStudentById · getTenantSettings · getStudentSiblings(v2-students-common.mjs readStudentSiblings — 개요 탭과 같은 원본) · canManageStudentStatusNow.
// · 학생 권한이 '전체'가 아니면 2.0은 상세(수정) · 목록(새 학생)으로 되돌린다 — 호스트가 같은 판정(studentsLevel)으로 되돌린다.
// · 읽기 전용 · 바깥 호출 없음. 저장(createStudent · updateStudent)은 이번 단계에 없다.
import { studentsBase, detailGates, readStudentSiblings } from './v2-students-common.mjs';
import { readStudent } from './v2-students-detail.mjs';

const formSettings = (s) => ({ operations: s.operations, modules: s.modules });

/** 학생 수정 — 없는 학생이면 { notFound: true }. */
export async function buildStudentEdit({ sql: tx, tenantId: t, id, importV2, viewerId = null }) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  if (!base.viewer) return { notFound: true };
  const student = await readStudent(base.sql, t, id);
  if (!student) return { notFound: true };
  const gates = detailGates(base, student);
  return { student, settings: formSettings(base.settings), siblings: await readStudentSiblings(base, student), canManageStatus: gates.canManageStatus,
    studentsLevel: gates.studentsLevel };
}

/** 새 학생 — 학원 설정(학년 · 모듈)과 권한 칸. */
export async function buildStudentNew({ sql: tx, tenantId: t, importV2, viewerId = null }) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  if (!base.viewer) return { notFound: true };
  const gates = detailGates(base, null);
  return { settings: formSettings(base.settings), canManageStatus: gates.canManageStatus, studentsLevel: gates.studentsLevel };
}
