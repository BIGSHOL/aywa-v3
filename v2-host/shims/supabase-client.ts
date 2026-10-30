// 2.0 `@/lib/supabase/client` 대체(운영실 호스트 요청 10-28) — 연습 자료는 브라우저에서 Supabase에 접속하지 않는다.
// 실시간 구독은 아무 일도 하지 않는다(변경 알림 없음 · 화면 갱신은 서버 액션 새로고침이 맡는다).
// 직접 조회·인증·파일 저장소를 부르면 빈 값으로 위장하지 않고 오류로 알린다 — 그 부품은 3.0 서버 화면으로 옮겨야 한다.
const unsupported = (what: string) => () => { throw new Error(`연습 자료에서는 ${what}을 쓰지 않습니다.`); };
const blocked = (what: string) => new Proxy({}, { get: () => unsupported(what) });

function channel() {
  const ch = {
    on: () => ch,
    subscribe: () => ch, // 콜백은 부르지 않는다(구독이 성사된 척하지 않는다)
    unsubscribe: () => Promise.resolve('ok' as const),
    send: () => Promise.resolve('ok' as const),
  };
  return ch;
}

const client = {
  channel,
  removeChannel: () => Promise.resolve('ok' as const),
  removeAllChannels: () => Promise.resolve([]),
  getChannels: () => [],
  from: unsupported('직접 조회'),
  rpc: unsupported('직접 조회'),
  schema: unsupported('직접 조회'),
  auth: blocked('로그인 정보'),
  storage: blocked('파일 저장소'),
  functions: blocked('서버 함수 직접 호출'),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClient(): any {
  return client;
}
