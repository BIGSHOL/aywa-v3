// 2.0 lib/auth/current-user.ts getCurrentUser() 자리 — 3.0엔 로그인이 없어 화면에서 고른 '보는 사람'이 그 요청의 사용자다.
// 모양은 2.0 CurrentUser 그대로(id · tenantId · email · displayName · jobTitle · systemRole). 지점 보기·다른 강사 보기는 없다.
import { currentCall } from '../context.mjs';
export async function getCurrentUser() {
  const a = currentCall().actor;
  return a ? { id: a.id, tenantId: a.tenantId, email: a.email, displayName: a.displayName, jobTitle: a.jobTitle, systemRole: a.systemRole } : null;
}
