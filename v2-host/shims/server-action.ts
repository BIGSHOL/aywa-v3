// 2.0 서버 액션("use server") 자리표시 — 2.0 Next가 브라우저 묶음에서 서버 함수 호출로 바꾸는 바로 그 경계.
// 1단계(보기)는 모든 저장을 거절한다: 2.0 액션이 돌려주는 실패 모양({ error } · { ok:false, error })으로 '복사본 보기 전용'을 알린다.
// 2단계에서 화면별로 /api/v2/<화면>/<동작>(Docker 복사본 저장)으로 잇는다.
export const VIEW_ONLY = '복사본 보기 전용 — 이 화면의 저장은 아직 열지 않았습니다';

export function serverAction(module: string, name: string) {
  const fn = async (..._args: unknown[]) => {
    console.info(`[v2-host] 서버 액션 ${module}#${name} — ${VIEW_ONLY}`);
    return { ok: false, error: VIEW_ONLY };
  };
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}
