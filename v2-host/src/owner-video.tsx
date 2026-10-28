// 2.0 video-drive-card.tsx 본문: 서버 조회만 props로 옮긴다.
export type OwnerVideoData = { setting: { accountReady: boolean; enabled: boolean; folderName: string | null; version: string | null;
  source: "saved" | "legacy" | "none"; hasConnection: boolean; accountEmail: string | null;
  accountStatus: "ready" | "needs_reauth" | null }; readOnly: boolean; oauthReady: boolean };
import { VideoDriveAccount } from "@/app/(shell)/owner/_components/video-drive-account";
import { VideoDriveForm } from "@/app/(shell)/owner/_components/video-drive-form";

/**
 * 학원 설정 '연동' → **숙제영상 드라이브** — 이 지점의 숙제 영상(올리기 사이트·ClassNote 수집·직접 제출)을 보관할
 * **Google 계정과 그 계정의 Drive 폴더**를 지점마다 따로 정한다(원장 2026-10-04 — 지점마다 다른 계정). ClassNote 기능이 켜진 지점에만 선다
 * (탭 판정은 `IntegrationsFace`). 순서 = Google 계정 연결 → 저장 폴더.
 *
 * 🔴 이 카드는 **Drive로 나가는 링크를 만들지 않는다** — 폴더 번호·연결 번호도 화면으로 내려보내지 않고 이름·이메일·상태만 보인다.
 * 🔴 첫 렌더에서 Drive·Google을 부르지 않는다([[#76]]) — 저장된 값만 읽고, 계정 확인은 로그인할 때, 폴더 확인은 [확인 후 저장]을 눌렀을 때 서버가 한다.
 * 조회·저장·권한 판정은 서버 한 곳([`drive-settings-actions.ts`](../../../../features/video-submit/server/drive-settings-actions.ts))이 한다
 * — 여기서는 그 결과를 그릴 뿐이다(화면 조건은 게이트가 아니다, [[#77]]).
 */
export function OwnerVideoCard({ view }: { view: OwnerVideoData | null }) {
  const setting = view?.setting;

  return (
    <section className="border-border bg-card space-y-4 rounded-2xl border p-5" aria-label="숙제영상 드라이브">
      <div>
        <h3 className="text-foreground text-sm font-bold">숙제영상 드라이브</h3>
        <p className="text-text-dim mt-1 text-xs break-keep">
          학생이 올린 숙제 영상과 ClassNote에서 모은 숙제 영상을 보관할 Google 계정과 폴더를 이 지점 전용으로 정합니다.
        </p>
      </div>
      {view && setting ? (
        <>
          <VideoDriveAccount
            state={{
              ready: setting.accountReady && view.oauthReady,
              email: setting.accountEmail,
              status: setting.hasConnection ? setting.accountStatus : null,
              receiving: setting.enabled,
              version: setting.version,
            }}
            readOnly={view.readOnly}
          />
          <div className="border-line border-t pt-4">
            <VideoDriveForm
              state={{
                ready: setting.accountReady,
                account: !setting.hasConnection ? "none" : setting.accountStatus === "ready" ? "ready" : "needs_reauth",
                enabled: setting.enabled,
                source: setting.source,
                folderName: setting.folderName,
                version: setting.version,
              }}
              readOnly={view.readOnly}
            />
          </div>
        </>
      ) : (
        <p className="text-danger text-sm">저장 폴더 설정을 읽지 못했습니다. 잠시 후 새로고침해 주세요.</p>
      )}
    </section>
  );
}
