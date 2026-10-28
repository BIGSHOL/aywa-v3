// GENERATED from 2.0 exams/input/page.tsx by v2-exams-input-generate.mjs.
const GRADE_SCOPE_PARTIAL_MESSAGE = "담당 반 일부를 불러오지 못했습니다 — 목록에 없는 반이 있으면 잠시 후 새로고침해 주세요";
import type { getTenantSettings } from "@/features/owner/server/queries";
import type { getGradeSheet } from "@/features/grades/server/queries";
import type { loadGradeSortPref } from "@/features/grades/server/list-prefs";
import type { loadTodaysMathMonthly } from "@/features/grades/server/todays-math-monthly";
export type InputLoaded = { settings: Awaited<ReturnType<typeof getTenantSettings>>; sheet: Awaited<ReturnType<typeof getGradeSheet>> | null; sortPref: Awaited<ReturnType<typeof loadGradeSortPref>>; writeError: string | null; todaysMath: Awaited<ReturnType<typeof loadTodaysMathMonthly>> };
import { SearchX } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { HrefSelect, type HrefSelectOption } from "@/components/href-select";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/toolbar";
import { kstToday } from "@/lib/date-kst";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { EXAM_SLOT_LABEL, examSlotOptions, slotUsesMonth } from "@/features/grades/exam-slots";
import { resolveGradeSelection } from "@/features/grades/selection";
import { saveGradeSortPref } from "@/features/grades/server/list-prefs";
import { axisLabelFor, axisOptionsFrom, axisValueOf } from "@/features/grades/subject-axis";
import { TERM_OPTIONS, monthAnchorDate, termLabel, termMonths, termYearOptions } from "@/features/grades/term";
import { GradesExcelTrigger } from "@/app/(shell)/exams/_components/excel-trigger";
import { ScoreGrid } from "@/app/(shell)/exams/_components/score-grid";
import { SheetMetaFields } from "@/app/(shell)/exams/_components/sheet-meta-fields";
import { GradeViewSwitch } from "@/app/(shell)/exams/_components/view-switch";

/**
 * 성적관리 — **시험을 등록하지 않는다**(원장 2026-09-22: *"시험자체를 등록하는게 아니라 과목 반별
 * 형식으로 학생리스트가 뜨고 바로 이렇게 쭈루룩 입력할 수 있게"*).
 * `년도 · 학기 · 과목 · 반 · 시험`을 고르면 그 학기 명단이 서고 점수를 바로 적는다.
 *
 * 🔑 영어는 **고르는 자리에서만** 인재원/EiE로 갈린다 — 저장되는 과목은 `english` 하나라
 *    학생 상세·추이·급락 감지는 영어를 한 과목으로 본다(subject-axis.ts).
 * 3.0 복사본에는 외부 인재원 연결 자료가 없어 성적 격자만 연다.
 */
export function ExamsInputPage({ sp, loaded }: { sp: Record<string, string>; loaded: InputLoaded }) {
  const one = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const isEmbed = one(sp.embed) === "1";
  // 🔑 이 주소가 **학기 격자 입력**(ScoreGrid — 1차·2차상담·성적확인 표식·시험없음·월·정렬·엑셀)의 자리다.
  //    통합 화면(`/exams`)의 '입력' 입구와 확인 뷰의 '입력'이 여기로 온다(전수 점검 F8 — 예전엔 JJ가 아니면
  //    통합 화면으로 되돌려 보내 격자로 갈 길이 없었다).
  const settings = loaded.settings;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const subjectOptions = axisOptionsFrom(subjects.options);
  const sel = resolveGradeSelection(
    {
      year: sp.year,
      term: sp.term,
      subject: sp.subject,
      class: sp.class,
      slot: sp.slot,
      date: sp.date,
      max: sp.max,
    },
    { subjectOptions: subjects.options, todayIso: kstToday() },
  );

  if (!sel) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="학생 관리" title="성적관리" description="반별로 점수를 바로 입력합니다" />
        <EmptyState
          compact
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title="학원 설정에 과목이 없습니다"
          description="학원 설정 → 운영에서 과목을 먼저 등록해주세요."
        />
      </div>
    );
  }

  const sheet = loaded.sheet, sortPref = loaded.sortPref, writeError = loaded.writeError;
  const buildHref = (patch: Partial<Record<string, string>>) => {
    const cur: Record<string, string> = {
      year: String(sel.year),
      term: String(sel.term),
      subject: axisValueOf(sel),
      class: sel.classId ?? "",
      slot: sel.slot,
      date: sel.date,
      max: String(sel.maxScore),
      ...patch,
    };
    // 과목을 바꾸면 반·시험 칸이 통째로 달라진다 — 옛 값이 따라가면 엉뚱한 반이 고정되거나 그 과목에
    // 없는 시험이 주소에 남는다(해석은 폴백하지만 주소가 거짓말을 한다).
    if (patch.subject !== undefined && patch.subject !== axisValueOf(sel)) {
      cur.class = "";
      if (patch.slot === undefined) cur.slot = "";
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v) params.set(k, v);
    if (isEmbed) params.set("embed", "1");
    const s = params.toString();
    return s ? `/exams/input?${s}` : "/exams/input";
  };

  const excelHref = (() => {
    const p = new URLSearchParams({
      year: String(sel.year),
      term: String(sel.term),
      subject: axisValueOf(sel),
      slot: sel.slot,
      date: sel.date,
      max: String(sel.maxScore),
    });
    if (sel.classId) p.set("class", sel.classId);
    return `/api/exams/excel?${p.toString()}`;
  })();

  const yearOptions: HrefSelectOption[] = termYearOptions(kstToday()).map((y) => ({
    value: String(y),
    label: `${y}년`,
    href: buildHref({ year: String(y) }),
  }));
  const termOptions: HrefSelectOption[] = TERM_OPTIONS.map((t) => ({
    ...t,
    href: buildHref({ term: t.value }),
  }));
  const subjectSelectOptions: HrefSelectOption[] = subjectOptions.map((o) => ({
    ...o,
    href: buildHref({ subject: o.value }),
  }));
  const slotOptions: HrefSelectOption[] = examSlotOptions(sel.subject).map((o) => ({
    ...o,
    href: buildHref({ slot: o.value }),
  }));
  // ⚠️ `cap`을 올려 둔다 — 반이 80개를 넘어 기본 50이면 한 묶음이 통째로 가린다([[#84]]).
  // 🔴 형광 표기(marker)는 **쓰지 않는다**(원장 2026-09-22: *"어떤 반은 누르면 작고 어떤 반은 겁나
  //    크게 뜨고 너무 난장판임 … 그럴 거면 통일하고"*) — 이 화면 툴바는 드롭다운이 여섯이라 하나만
  //    28px 노란 알약이 되면 줄 높이가 반을 고를 때마다 널뛴다. 출석부·ECS·MCS의 표기는 그대로다.
  const classOptions = (sheet?.classes ?? []).map((c) => ({
    value: c.id,
    label: c.className,
    hint: c.studentCount == null ? undefined : `${c.studentCount}명`,
  }));
  // 🔑 **월 선택**(원장 2026-09-23: *"시험일이 있으니까 월도 선택해서 볼수있게"*) — 달마다 치는
  //    시험(월말평가)에만 선다. 월은 시험일에서 도출하므로 이 드롭다운은 **시험일을 그 달로 옮기는
  //    링크**다(두 값이 어긋날 자리를 안 만든다).
  const monthOptions: HrefSelectOption[] = termMonths(sel.term).map((m) => ({
    value: String(m),
    label: `${m}월`,
    href: buildHref({ date: monthAnchorDate(sel.year, sel.term, m, kstToday()) }),
  }));
  // 오늘 수학 월말평가 결과(개발 중 — 학원 설정 토글 ∧ 라이선스 ∧ 수학 월말평가 칸일 때만, 아니면 null = 단추 없음).
  const todaysMath = loaded.todaysMath;
  const canWrite = !writeError;
  const lockReason =
    writeError ??
    (sheet && !sheet.schemaReady
      ? "성적 표 준비(0283a)가 아직 적용되지 않아 입력을 잠갔습니다 — 적용 후 저장할 수 있습니다"
      : // 🔴 월 축이 없으면 월말평가는 학기에 한 칸이라 다른 달을 적는 순간 지난달을 덮는다 —
        //    경고만 띄우지 말고 **저장을 막는다**(서버도 같은 판정: `writeGradeCells`).
        sheet && !sheet.monthReady && slotUsesMonth(sel.slot)
        ? "월 축 준비(0288a)가 아직 적용되지 않아 월말평가 입력을 잠갔습니다 — 지금 저장하면 지난달 점수를 덮어씁니다"
        : null);

  // 격자를 그릴 때만 **창 높이를 채우는 flex 기둥**(등록상담 목록뷰 선례) — 표가 남는 높이를 전부
  // 가져가 그 안에서 스크롤하고 저장 바는 창 바닥에 붙는다. 빈 화면은 문서 흐름.
  // 🔴 폭으로 가르지 않는다(좁은 창만 문서 흐름으로 두려다 **머리줄 고정이 죽는** 것을 리뷰에서
  //    잡았다 — 스크롤러가 없으면 `sticky thead`가 붙을 자리가 없어 그냥 위로 사라진다). 좁은 창
  //    대비는 표에 최소 높이를 주는 쪽으로(그 아래로 밀리면 페이지가 스크롤한다).
  const gridView = !!sheet && sheet.rows.length > 0;

  return (
    <div className={gridView ? "flex h-full min-h-0 flex-col space-y-5" : "space-y-5"}>
      <PageHeader
        eyebrow="학생 관리"
        title="성적관리"
        description={`${termLabel(sel.year, sel.term)} · ${axisLabelFor(sel, subjects.labelOf)} · ${EXAM_SLOT_LABEL[sel.slot]}`}
        embedLabel={`${termLabel(sel.year, sel.term)} · ${EXAM_SLOT_LABEL[sel.slot]}`}
      />

      <Toolbar>
        {/* 🔑 입력 ↔ 확인(원장 2026-09-23) — 확인 뷰는 축이 학기 전체라 시험 칸·시험일을 안 넘긴다. */}
        <GradeViewSwitch
          active="input"
          inputHref={buildHref({})}
          viewHref={`/exams/view?year=${sel.year}&term=${sel.term}&subject=${sel.subject}${isEmbed ? "&embed=1" : ""}`}
          unifiedHref={isEmbed ? "/exams?embed=1" : "/exams"}
        />
        <HrefSelect axisLabel="년도" ariaLabel="년도 선택" value={String(sel.year)} options={yearOptions} />
        <HrefSelect axisLabel="학기" ariaLabel="학기 선택" value={String(sel.term)} options={termOptions} />
        <HrefSelect
          axisLabel="과목"
          ariaLabel="과목 선택"
          value={axisValueOf(sel)}
          options={subjectSelectOptions}
        />
        <>
            <FilterSelect
              paramName="class"
              axisLabel="반"
              ariaLabel="반 선택"
              value={sel.classId ?? ""}
              options={classOptions}
              cap={300}
              // 반만 다른 부품(SearchableSelect)이라 기본 상자가 다르다 — 툴바 한 줄에서 **같은 치수**로.
              triggerClassName={TOOLBAR_SELECT}
            />
            <HrefSelect axisLabel="시험" ariaLabel="시험 선택" value={sel.slot} options={slotOptions} />
            {slotUsesMonth(sel.slot) ? (
              <HrefSelect
                axisLabel="월"
                ariaLabel="월 선택"
                value={String(sel.month)}
                options={monthOptions}
              />
            ) : null}
            {/* 시험일·만점은 주소에 실린다 — 격자·엑셀·저장이 같은 값을 본다(한쪽만 바뀌면 시트가
                화면과 다른 칸을 가리킨다). 클라 조각이 `__V__` 자리에 값을 끼워 이동한다. */}
            <SheetMetaFields
              date={sel.date}
              maxScore={sel.maxScore}
              dateHref={buildHref({ date: "__V__" })}
              maxHref={buildHref({ max: "__V__" })}
            />
            <GradesExcelTrigger excelHref={excelHref} canWrite={canWrite} />
        </>
      </Toolbar>

      {sheet?.scopePartial ? <p role="status" className="text-amber text-sm">{GRADE_SCOPE_PARTIAL_MESSAGE}</p> : null}

      {sheet && sheet.rows.length > 0 ? (
        <ScoreGrid
          /* 🔴 축이 바뀌면 **다시 마운트**한다 — 격자는 입력값을 제 상태로 들고 있어서, 키가 없으면
             중간고사에 친 점수가 기말고사 칸에 그대로 남는다(반·학기를 바꿔도 같다). 시험일·만점은
             키에 넣지 않는다: 그 둘은 같은 칸의 속성이라, 넣으면 적다 만 점수가 사라진다. */
          key={`${sel.year}:${sel.term}:${sel.subject}:${sel.track ?? ""}:${sel.classId ?? ""}:${sel.slot}`}
          sheet={sheet}
          sort={sortPref}
          saveSort={saveGradeSortPref}
          canWrite={canWrite}
          slotLabel={EXAM_SLOT_LABEL[sel.slot]}
          lockReason={lockReason}
          todaysMath={todaysMath}
        />
      ) : (
        <EmptyState
          compact
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title={
            (sheet?.classes.length ?? 0) === 0
              ? "이 과목에 운영 중인 반이 없습니다"
              : "이 학기 명단이 없습니다"
          }
          description={
            (sheet?.classes.length ?? 0) === 0
              ? "수업목록에서 반을 먼저 만들거나 과목을 바꿔보세요."
              : `${termLabel(sel.year, sel.term)}에 이 반을 다닌 학생이 없습니다. 년도·학기나 반을 바꿔보세요.`
          }
        />
      )}
    </div>
  );
}
