// 원생 상세 '특이사항' 탭(2.0 _tabs/memos-tab.tsx) — getStudentMemos를 Docker 복사본에서 같은 표·같은 조건으로.
// 고정(pinned) 먼저 → 최신순 · 작성자 이름 = users.display_name · 검색 허용(0250a)이 없던 행은 '허용'(2.0과 같다). 읽기 전용.

import { readStudentMemos } from './v2-students-tab-overview.mjs';

// 조회는 개요 탭과 같은 원본(v2-students-tab-overview.mjs readStudentMemos — 2.0 getStudentMemos)을 쓴다.
export async function loadTab({ base, id }) {
  return { memos: await readStudentMemos(base, id) };
}
