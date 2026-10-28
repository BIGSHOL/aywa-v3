// 2.0 원생 상세 '개요' 탭(app/(shell)/students/[id]/_tabs/overview-tab.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 탭이 서버에서 하던 조회는
// 상세 GET(v2-students-tab-overview.mjs loadTab)이 하고 여기서는 그 파일 본문(첫 상수부터 끝까지)을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(students-tab-overview.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-students-tabs-a.mjs가 2.0 본문에 같은 짝을 대어 대조한다.
// 자료 = useStudentTab()(Promise.all의 이름 그대로) · kstToday = 복사본 날짜(students-shared.tsx). 같은 이름·같은 props로 서는 감싸개(OverviewTab)는
// 아직 자료가 없으면(서버가 { missing:true }) 안내 한 줄을 그린다.
import { SheetTeacherName, SheetText } from "@/features/teacher-view/interface-label";
import { Sparkles } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { formatCreatedAt } from "@/lib/utils";
import { kstShortStamp } from "@/lib/date-kst";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import type { AttendanceWindowStats, CareFocus, StudentBillingRow, StudentConsultationRow, StudentDetail, StudentEnrollment, StudentMemoRow } from "@/features/students/server/queries";
import { KIND_LABEL, scoreUnit, type UnifiedRow } from "@/features/grades/unified/model";
import { buildSubjectMaps, type SubjectSetting } from "@/features/owner/subjects";
import { invoiceOutstanding } from "@/features/billing/calc";
import { TabLink } from "@/app/(shell)/students/[id]/_components/tab-link";
import { memoCategoryLabel } from "@/features/students/detail/memo-category";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { classNameFor } from "@/features/teacher-view/class-name";
import { ProfileSiblings } from "@/app/(shell)/students/[id]/_components/profile-siblings";
import type { SiblingView } from "@/features/students/server/siblings";
import type { SheetLang } from "@/features/teacher-view/i18n";
import { kstToday, useStudentTab, isMissingTab, MissingTab } from "./students-shared";

/** 상세 GET이 실어 보내는 개요 자료(v2-students-tab-overview.mjs loadTab) — overview-tab.tsx Promise.all의 이름 그대로. */
type OverviewTabData = {
  attendance: AttendanceWindowStats;
  enrollments: StudentEnrollment[];
  grades: UnifiedRow[];
  invoices: StudentBillingRow[];
  consultations: StudentConsultationRow[];
  memos: StudentMemoRow[];
  settings: { operations: { subjects: SubjectSetting[] } };
  lang: SheetLang;
  teacherNames: Record<string, string>;
  siblings: { ready: boolean; siblings: SiblingView[]; review: SiblingView[]; autoIds: string[] };
};

/** 2.0 OverviewTab 자리(같은 이름·같은 props) — 자료가 오면 2.0 본문(OverviewTabBody)을 그린다. */
export function OverviewTab(props: { student: StudentDetail; canSeeBilling: boolean }) {
  const data = useStudentTab<OverviewTabData | { missing: true } | null>();
  return !data || isMissingTab(data) ? <MissingTab /> : <OverviewTabBody {...props} />;
}

const won = (n: number) => n.toLocaleString();

const PRIORITY_COLOR: Record<CareFocus["priority"], string> = {
  high: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  medium: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  low: "text-chart-1 bg-chart-1/10 border-chart-1/20",
};

const PRIORITY_LABEL: Record<CareFocus["priority"], string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

function OverviewTabBody({ student, canSeeBilling }: { student: StudentDetail; canSeeBilling: boolean }) {
  const sid = student.id;
  const { attendance, enrollments, grades, invoices, consultations, memos, settings, lang, teacherNames, siblings } = useStudentTab<OverviewTabData>();
  const subjects = buildSubjectMaps(settings.operations.subjects, lang);
  const hasCareAi = student.aiCareSummary !== null;

  // 🔴 `!endDate`로 자르면 안 된다(2026-08-29) — 반이동을 예약하면 옛 수강에 **미래 종료일**이
  //    붙는데, 그 학생은 그날까지 그 반에 다닌다. 잘라 버리면 지금 다니는 반이 개요에서 증발하고,
  //    아직 시작도 안 한 새 반만 보였다(실측 김준서A: MS2B가 사라지고 MS2A만 뜸).
  //    판정은 enrollmentPhaseOn 단일 소스 — 오늘 명단(active∪leaving)만 '수강 중'이다.
  const today = kstToday();
  const activeClasses = enrollments.filter((e) =>
    isEnrollmentOnRosterOn({ startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred }, today),
  );
  // 미납 = unpaid/partial만(refunded/void 제외) + 행 레벨 clamp — calc.ts 단일 공식(수납관리 KPI와 일치).
  const unpaid = invoices.filter((i) => i.status === "unpaid" || i.status === "partial");
  const unpaidTotal = unpaid.reduce((s, i) => s + invoiceOutstanding(i), 0);
  const recentMemos = [...memos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const base = `/students/${sid}`;

  return (
    <div className="space-y-4">
      {/* 최근 30일 출결 — 전체 폭 KPI */}
      <section className="bg-card border-border rounded-2xl border p-4">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-bold tracking-tight"><SheetText value={"최근 30일 출결"} /></h2>
          <p className="text-muted-foreground num text-xs"><SheetText value={"총 "} />{attendance.total}<SheetText value={"건"} /></p>
        </header>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="출석률"
            value={attendance.total > 0 ? `${attendance.rate.toFixed(1)}%` : "—"}
            highlight="text-chart-2"
          />
          <Stat label="출석" value={String(attendance.present)} unit="건" />
          <Stat label="결석" value={String(attendance.absent)} unit="건" highlight="text-chart-4" />
          <Stat label="지각" value={String(attendance.late)} unit="건" highlight="text-chart-3" />
        </div>
      </section>

      {/* 같은 행의 카드 높이를 맞추고, 좁은 창에서는 2열·1열로 순서대로 읽는다. */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <section className="bg-card border-border min-w-0 space-y-3 rounded-2xl border p-4">
          <h2 className="text-sm font-bold tracking-tight"><SheetText value={"프로필"} /></h2>
          <dl className="space-y-3 text-sm">
            {student.englishName ? <Field label="영문명" value={student.englishName} /> : null}
            {student.nickname ? <Field label="닉네임" value={student.nickname} /> : null}
            {student.studentCode ? <Field label="원생번호" value={student.studentCode} mono /> : null}
            {student.attendanceCode ? (
              <Field label="출결번호" value={student.attendanceCode} mono />
            ) : null}
            {student.gender ? (
              <Field label="성별" value={lang === "en" ? student.gender === "male" ? "Male" : "Female" : student.gender === "male" ? "남" : "여"} />
            ) : null}
            {student.birthDate ? <Field label="생년월일" value={student.birthDate} mono /> : null}
            {student.graduationYear ? (
              <Field label="졸업연도" value={student.graduationYear} mono />
            ) : null}
            {student.studentPhone ? (
              <Field label="학생 연락처" value={student.studentPhone} mono />
            ) : null}
            {student.homePhone ? <Field label="집전화" value={student.homePhone} mono /> : null}
            {student.otherPhone ? (
              <Field label="기타 연락처" value={student.otherPhone} mono />
            ) : null}
            <Field label="학부모 이름" value={student.parentName} />
            {student.parentRelation ? <Field label="보호자 관계" value={student.parentRelation} /> : null}
            <Field label="학부모 연락처" value={student.parentPhone} mono />
            <ProfileSiblings siblings={siblings.siblings} lang={lang} />
            {student.email ? <Field label="이메일" value={student.email} mono /> : null}
            {student.address || student.addressDetail || student.zipCode ? (
              <Field
                label="주소"
                value={
                  [student.zipCode ? `(${student.zipCode})` : null, student.address, student.addressDetail]
                    .filter(Boolean)
                    .join(" ")
                }
              />
            ) : null}
            <Field label="등록일" value={student.enrolledAt} mono />
            {student.withdrawnAt ? (
              <Field label="퇴원일" value={student.withdrawnAt} mono />
            ) : null}
          </dl>
        </section>

        <DigestCard title="최근 성적" count={grades.length} more={<TabLink href={`${base}?tab=grades`}><SheetText value={"성적"} /></TabLink>}>
          {grades.length === 0 ? (
            <Empty><SheetText value={"성적 기록 없음"} /></Empty>
          ) : (
            grades.slice(0, 4).map((g) => (
              <DigestRow
                key={g.key}
                left={`${subjects.labelOf(g.subject)} ${KIND_LABEL[g.kind]}`}
                right={g.noExam ? "시험없음" : g.score == null ? g.rawScore || "—" : `${g.score}${g.maxScore == null ? "" : ` / ${g.maxScore}`}${scoreUnit(g)}`}
                detail={[
                  g.date,
                  ...g.classes.map((c) => classNameFor(c.name, lang)),
                ].filter(Boolean).join(" · ")}
                mono
              />
            ))
          )}
        </DigestCard>

        <DigestCard title="최근 상담" count={consultations.length} more={<TabLink href={`${base}?tab=consultations`}><SheetText value={"상담"} /></TabLink>}>
          {consultations.length === 0 ? (
            <Empty><SheetText value={"상담 기록 없음"} /></Empty>
          ) : (
            consultations.slice(0, 3).map((c) => (
              <RecordPreview
                key={c.id}
                date={c.consultedAt}
                author={c.counselorName}
                authorLabel="상담자"
                content={c.summary}
                category={c.subject ? subjects.labelOf(c.subject) : undefined}
              />
            ))
          )}
        </DigestCard>

        <DigestCard title="수강 중인 반" count={activeClasses.length} more={<TabLink href={`${base}?tab=classes`}><SheetText value={"수업"} /></TabLink>}>
          {activeClasses.length === 0 ? (
            <Empty><SheetText value={"수강 중인 반 없음"} /></Empty>
          ) : (
            activeClasses.slice(0, 4).map((e) => (
              <DigestRow
                key={e.id}
                left={classNameFor(e.className, lang)}
                right={[subjects.labelOf(e.subject), teacherNameFor(e.teacherName, teacherNames, lang)].filter(Boolean).join(" · ")}
              />
            ))
          )}
        </DigestCard>

        {canSeeBilling ? <DigestCard title="수납 현황" more={<TabLink href={`${base}?tab=billing`}><SheetText value={"수납"} /></TabLink>}>
          {invoices.length === 0 ? (
            <Empty><SheetText value={"청구 내역 없음"} /></Empty>
          ) : (
            <>
              <DigestRow left="총 청구" right={`${invoices.length}건`} />
              <DigestRow
                left="미납"
                right={unpaid.length === 0 ? "없음" : `${unpaid.length}건 · ${won(unpaidTotal)}원`}
                highlight={unpaid.length > 0 ? "text-amber" : "text-chart-2"}
              />
              {invoices[0] ? <DigestRow left="최근" right={invoices[0].period} mono /> : null}
            </>
          )}
        </DigestCard> : null}

        <DigestCard title="최근 특이사항" count={memos.length} more={<TabLink href={`${base}?tab=memos`}><SheetText value={"특이사항"} /></TabLink>}>
          {recentMemos.length === 0 ? (
            <Empty><SheetText value={"특이사항 없음"} /></Empty>
          ) : (
            recentMemos.slice(0, 3).map((m) => (
              <RecordPreview
                key={m.id}
                date={m.createdAt}
                author={m.createdByName}
                content={m.content}
                category={memoCategoryLabel(m.category)}
                pinned={m.pinned}
              />
            ))
          )}
        </DigestCard>
      </div>

      {hasCareAi ? (
        <section className="bg-card border-border space-y-4 rounded-2xl border p-5">
          <header className="flex items-baseline justify-between">
            <div className="inline-flex items-center gap-2">
              <Sparkles className="text-chart-4 size-4" />
              <h2 className="text-foreground text-sm font-bold"><SheetText value={"AI 케어 인사이트"} /></h2>
            </div>
            {student.aiCareGeneratedAt ? (
              <span className="text-muted-foreground num text-xs">
                {formatCreatedAt(student.aiCareGeneratedAt)}
              </span>
            ) : null}
          </header>

          <div className="space-y-2">
            <p className="eyebrow"><SheetText value={"종합 요약"} /></p>
            <p className="text-foreground text-sm leading-relaxed">{student.aiCareSummary}</p>
          </div>

          {student.aiCareFocus && student.aiCareFocus.length > 0 ? (
            <div className="space-y-2">
              <p className="eyebrow"><SheetText value={"주의 영역"} /></p>
              <ul className="space-y-2">
                {student.aiCareFocus.map((f, i) => (
                  <li
                    key={i}
                    className="border-border bg-muted/30 flex items-start gap-3 rounded-md border px-3 py-2.5"
                  >
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-xs font-medium ${PRIORITY_COLOR[f.priority]}`}
                    >
                      {PRIORITY_LABEL[f.priority]}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-foreground text-sm font-medium">{f.area}</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {f.recommendation}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs"><SheetText value={label} /></dt>
      <dd className={`text-foreground min-w-0 text-right text-sm break-words ${mono ? "num" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

function DigestCard({
  title,
  count,
  more,
  children,
}: {
  title: string;
  count?: number;
  more?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border-border flex min-w-0 flex-col rounded-2xl border p-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold">
          <SheetText value={title} />
          {count != null && count > 0 ? <span className="num ml-2 text-xs font-normal">{count}<SheetText value="건" /></span> : null}
        </h2>
        {more}
      </header>
      <div className="divide-border/60 flex-1 divide-y">{children}</div>
    </section>
  );
}

function DigestRow({
  left,
  right,
  mono,
  detail,
  highlight,
}: {
  left: React.ReactNode;
  right: string;
  mono?: boolean;
  detail?: string;
  highlight?: string;
}) {
  return (
    <div className="space-y-1 py-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-text-dim min-w-0 flex-1 break-words">{left}</span>
        <span className={`text-foreground max-w-[55%] text-right break-words ${mono ? "num" : ""} ${highlight ?? ""}`}>
          {right}
        </span>
      </div>
      {detail ? <p className="text-text-dim leading-relaxed break-words">{detail}</p> : null}
    </div>
  );
}

function RecordPreview({
  date,
  author,
  authorLabel = "작성자",
  content,
  category,
  pinned,
}: {
  date: string;
  author: string | null;
  authorLabel?: string;
  content: string;
  category?: string;
  pinned?: boolean;
}) {
  return (
    <article className="space-y-1.5 py-2.5">
      <div className="text-text-dim flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-relaxed break-words">
        {pinned ? <EyIcon name="pin" size={13} aria-label="고정 특이사항" /> : null}
        {category ? <span className="text-foreground font-medium">{category}</span> : null}
        <time dateTime={date} className="num">{date.length === 10 ? date : kstShortStamp(date) ?? "일자 정보 없음"}</time>
        <span className="min-w-0"><SheetText value={authorLabel} /> {author ? <SheetTeacherName value={author} /> : <SheetText value="정보 없음" />}</span>
      </div>
      <p className="text-foreground line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{content}</p>
    </article>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-text-faint py-3 text-center text-xs">{children}</p>;
}

function Stat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow"><SheetText value={label} /></p>
      <p className={`num text-foreground text-xl font-bold ${highlight ?? ""}`}>
        {value}
        {unit ? (
          <span className="text-muted-foreground ml-0.5 text-xs font-normal"><SheetText value={unit} /></span>
        ) : null}
      </p>
    </div>
  );
}
