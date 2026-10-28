// 학원 설정에서 아직 그리지 않는 면(2.0 서버 컴포넌트 — 데이터 정리 · 감사로그 · 연동 · 팝업 · 대시보드 · 가져오기 · 강사평가 · 기여도)의 자리.
// 그 면의 조회·저장을 옮기면 이 자리를 2.0 부품으로 바꾼다(owner-page.swaps.json).
const LABEL: Record<string, string> = {
  data: '데이터 정리', audit: '감사로그', sheets: '연동', popups: '팝업 공지', dashboard: '대시보드 관리', import: '데이터 가져오기', evaluation: '강사평가', contribution: '기여도',
};

export function OwnerServerFace({ face }: { face: string }) {
  return (
    <div className="bg-card border-line rounded-2xl border p-6">
      <p className="text-foreground text-sm font-bold">{LABEL[face] ?? '이 면'}은 연습 화면에서 아직 열 수 없습니다</p>
      <p className="text-text-dim mt-1 text-sm">다른 설정 면은 그대로 볼 수 있습니다.</p>
    </div>
  );
}
