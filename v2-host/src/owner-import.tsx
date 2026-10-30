import { useState } from 'react';
import { IMPORT_META, type ImportKind } from '@/features/excel-import/kinds';

export type OwnerImportRow = { kind: ImportKind; allowed: boolean };

/** ImportHubFace의 설명·순서·권한별 줄. 파일 처리 주소는 연습 호스트에 없으므로 버튼에서 안내한다. */
export function OwnerImportFace({ rows }: { rows: OwnerImportRow[] }) {
  const [notice, setNotice] = useState<ImportKind | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <section className="bg-card border-line rounded-2xl border p-5">
        <p className="text-foreground text-sm font-bold">엑셀로 한꺼번에 넣기</p>
        <p className="text-text-dim mt-1 text-xs">연습 자료에서는 엑셀 파일 가져오기를 아직 지원하지 않습니다.</p>
        <ol className="text-text-dim mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>항목마다 [엑셀로 넣기] → <b>서식 내려받기</b>. 지금 들어 있는 자료가 담긴 서식이면 고쳐서 다시 올려도 됩니다.</li>
          <li>서식의 시트·열 제목 그대로 채웁니다. 주황 칸(*)이 필수이고, 열 설명은 &lsquo;안내&rsquo; 시트에 있습니다.</li>
          <li>올릴 때 <b>추가</b>(이미 있는 것은 건너뜀) 또는 <b>덮어쓰기</b>(있는 것은 파일 값으로 바꿈)를 고릅니다. 파일을 고르면 먼저 미리보기가 뜨고, [반영]을 눌러야 들어갑니다.</li>
          <li>서식이 틀리면 <b>시트·행·열</b>로 어디가 틀렸는지 표로 보여 주고, [오류 칸 표시 파일 받기]로 틀린 칸이 빨갛게 칠해진 파일을 받을 수 있습니다. 검사에서 오류가 하나라도 나오면 아무것도 들어가지 않습니다. 반영 도중 서버 오류로 멈추면 그 앞까지는 남으니, 같은 파일을 같은 방식으로 다시 올리면 나머지만 들어갑니다.</li>
          <li>아래 순서대로 넣어야 서로 연결됩니다(직원 → 강의실 → 원생 → 반·시간표·반 배정 → 상담·출결·수납). 반 배정 시트는 원생과 반이 먼저 있어야 합니다.</li>
        </ol>
      </section>
      <ul className="bg-card border-line divide-line-faint divide-y rounded-2xl border">
        {rows.map(({ kind, allowed }, i) => {
          const m = IMPORT_META[kind];
          return (
            <li key={kind} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="num text-text-faint w-6 shrink-0 text-sm font-bold">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-bold">{m.title} <span className="text-text-faint font-normal">· {m.where}</span></p>
                <p className="text-text-dim text-xs">{m.templateNote}</p>
              </div>
              {allowed ? (
                <div className="flex flex-col items-end gap-1">
                  <button type="button" className="border-line text-foreground hover:bg-hover rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => setNotice(kind)}>엑셀로 넣기</button>
                  {notice === kind ? <span role="status" className="text-text-dim text-xs">{m.title} 엑셀 가져오기는 아직 지원하지 않습니다.</span> : null}
                </div>
              ) : (
                <span className="text-text-faint text-xs">이 메뉴의 전체 권한이 없습니다</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
