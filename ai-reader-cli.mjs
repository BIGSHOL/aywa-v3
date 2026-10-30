import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('./ai-reader-mcp.mjs', import.meta.url));
export const REASON_RULES = [
  '읽기 도구를 쓸 때는 schema로 표·열을 확인하고 query로 필요한 행을 직접 조회한다. 쓰기·발송·변경은 하지 않는다.',
  '먼저 같은 기간과 직전 기간의 신규 상담→입학 테스트→등록·휴원 복귀, 퇴원·휴원·수강 종료 흐름을 비교한다.',
  '다음으로 들어온 사람·빠진 사람·바뀐 사람과 퇴원·수강 종료 사유, 메모, 반 폐강, 담임 교체, 반 이동, 상담, 미납 기록을 잇는다.',
  '기록된 이유가 없는 사람은 사유 미기재 N명(이름)으로 쓴다. 이유가 없는 곳에 동기나 인과를 지어내지 않는다.',
  '숫자와 이름은 서버 사실 또는 조회 결과에서만 쓴다. 조회에서 나온 결론은 Q-조회번호:행번호를 qrefs에 적고 queries에 SQL과 조회번호를 싣는다.',
  '조회 SQL의 숫자 열 별칭에 단위를 넣는다(예: 상담_건, 재원_명, 수납_원). 단위 없는 숫자를 다른 단위로 바꿔 쓰지 않는다.',
  '카드·화면 숫자와 SQL 숫자가 다르면 화면 숫자를 정본으로 쓰고 집계 기준 차이를 알린다.',
  '“인과를 확인할 수 없습니다”, “기록으로는 인과를 확인할 수 없습니다” 같은 면책 문장을 쓰지 않는다.',
  '빈 명단·연결 업무를 문장으로 되읽지 않는다. 확인할 업무는 담당 역할·대상·볼 기록 또는 화면이 모두 있을 때만 적고, 없으면 비운다.',
  '이름을 여럿 나열하지 말고 변화 사건을 압축한다. 교시별 선생님 배치와 담임 변경은 구분한다.',
].join('\n');

export function readerCliFlags() {
  return ['--tools', 'mcp__ai_reader__schema,mcp__ai_reader__query', '--strict-mcp-config',
    '--mcp-config', JSON.stringify({ mcpServers: { ai_reader: { command: process.execPath, args: [server] } } })];
}

export const BANNED_REASON = /(?:인과(?:관계)?|원인|이유).{0,15}(?:확인|파악|판단).{0,8}(?:수\s*없|어렵|불가)/;
export const BANNED_COPY = /(?:책임(?:은|을|는)?\s*(?:판단|확인)할\s*수\s*없|퇴원율\s*판정|이\s*묶음|일부\s*항목|한\s*항목|(?:명단|이어진\s*업무|연결\s*업무).{0,30}(?:없|비어))/;
