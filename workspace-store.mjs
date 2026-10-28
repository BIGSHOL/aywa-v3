// 작업 공간 기록 저장소 — 지금 서버가 내주는 첫 화면 자료(/snapshot.js)와 같은 시점의 것(Codex 검수 10-28 AX-H2).
// 시작 때는 snapshot.mjs가 만든 저장소(domain-snapshot.mjs workspaceRecords)를 그대로 쓰고, 저장 뒤 자료 갱신(data-refresh.mjs)이
// 끝나면 새 저장소로 바꿔 끼운다. 갱신 계산은 작업 스레드에서 하므로 메인 스레드의 domain-snapshot 저장소는 시작 때 것으로 남는다 —
// 기록을 읽는 곳(domain-http.mjs · 비서 · 업무 흐름 첨부)은 이 함수로 읽는다.
import { workspaceRecords } from './domain-snapshot.mjs';

let pinned = null;
/** data-refresh.mjs: 새로 만든 기록 저장소로 바꾼다(첫 화면 자료와 같은 틱에). */
export const useWorkspaceStore = store => { pinned = store || null; };
/** 지금 내주는 자료와 같은 시점의 기록 저장소 — 갱신 전이면 시작 때 것. 준비 전이면 null. */
export const currentWorkspaceStore = () => pinned ?? workspaceRecords();
