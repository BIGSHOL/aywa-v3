// 외부 AI로 가는 자유 글의 금지 값 판정 — 한 곳(검수 10-28 AX-H3).
// CLAUDE.md '외부 AI 전송 금지 필드'(주민번호·계좌/카드번호)와 화면 자료에서도 가리는 연락처. 연락처·이 학원의 계좌 숫자는 화면 자료와 같은
// 판정(scrub — 이메일·전화번호·DB에 있는 연락처/계좌 숫자)을 쓰고, 모양으로 알 수 있는 주민번호·카드번호·계좌번호를 더 본다.
// 비서(claude-bridge-prompt)는 걸리면 보내지 않고, 업무 판정(flow-decision)은 그 부분을 가려서 보낸다.
import { scrub } from './domain-snapshot-core.mjs';

const HIDE = '개인 정보 가림';

const SHAPES = [
  /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[- ]?[1-8]\d{6}(?!\d)/g, // 주민·외국인등록번호
  /(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{3,4}(?!\d)/g, // 카드번호(띄어 쓴 16·15자리)
  /(?<![\d,.])\d{11,16}(?![\d,.])/g, // 붙여 쓴 긴 숫자(계좌·카드·전화)
];
// 계좌번호처럼 하이픈으로 묶은 숫자 — 숫자가 10자리 이상인 묶음만(날짜 2026-10-27 같은 짧은 묶음은 그대로).
const GROUPED = /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,3})?(?![\d-])/g;
const longGroup = m => m.replace(/\D/g, '').length >= 10;

export const hasSensitive = text => {
  const s = String(text ?? '');
  return scrub(s) !== s || SHAPES.some(re => new RegExp(re.source).test(s)) || [...s.matchAll(GROUPED)].some(m => longGroup(m[0]));
};

export const maskSensitive = text => {
  let s = scrub(String(text ?? ''));
  for (const re of SHAPES) s = s.replace(re, HIDE);
  return s.replace(GROUPED, m => (longGroup(m) ? HIDE : m));
};
