// 2.0 수납관리 호스트의 자리표시 — page.tsx의 서버 동작(requireAccess의 이동 · redirect) 자리와 아직 옮기지 않은 면.
import { useEffect } from 'react';
import { hostNavigate } from '../shims/host-nav';
import { NOT_SUPPORTED } from '../shims/server-action';

/** 아직 옮기지 않은 면 — 2.0 면 탭은 그대로 두고 본문 자리만. */
export function HostFaceNotReady() {
  return <p className="text-text-dim rounded-lg border border-dashed px-4 py-10 text-center text-sm" role="status">{NOT_SUPPORTED}</p>;
}

/** 2.0 requireAccess가 역할 홈으로 보내던 자리 — 그 사람은 이 화면을 볼 수 없다. */
export function HostNoAccess() {
  return <p className="text-text-dim p-6 text-sm" role="status">고른 사람은 이 화면을 볼 수 없습니다.</p>;
}

/** 2.0 redirect(href) 자리 — 같은 화면 안 이동(replace). */
export function HostRedirect({ to }: { to: string }) {
  useEffect(() => { hostNavigate(to, 'replace'); }, [to]);
  return <p className="text-text-dim p-6 text-sm" role="status">수납관리를 여는 중…</p>;
}
