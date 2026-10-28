// 원생 상세 'srs' 탭 자리 — 아직 옮기지 않았다(서버 v2-students-tab-srs.mjs가 없으면 { missing: true }). 옮길 때 2.0 탭 파일을 글자 그대로 옮기고
// 서버 조회 자리만 바꾼다(students-tab-srs.swaps.json · 자료 = useStudentTab()).
import { MissingTab } from "./students-shared";

export function SrsTab(_props: Record<string, unknown>) {
  return <MissingTab />;
}
