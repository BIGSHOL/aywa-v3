// 2.0 직원 상세의 탭(서버 컴포넌트 — basic-info-tab · monthly-schedule-tab · classes-tab · activity-log-tab · payroll/_salary-scope)을 호스트로 옮긴 것.
// 조회는 서버(/api/v2/staff — v2-staff-read.mjs)가 같은 모양으로 하고 여기서는 본문을 **글자 그대로** 옮겼다(바꾼 곳 = staff-tabs.swaps.json).
//  · 월간일정 = 노션 업무 — 연습 화면은 노션을 부르지 않는다(연결 안 된 직원은 2.0과 같은 '연결' 안내, 연결된 직원은 불러오지 못함 안내).
//  · 개인별 급여 설정의 저장(비율 설정 창)은 출석부 화면의 저장이라 이 화면에서는 '아직 지원하지 않는 저장'으로 남는다.
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { CheckSquare, Pencil, Square, GraduationCap, History, LogIn } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import type { StaffDetail, WorkDay, StaffClassRow } from "@/features/staff/server/queries";
import type { ResumeDetail } from "@/features/staff/resume/server/resume-queries";
import type { MonthlyTasksResult } from "@/features/staff/notion/server/notion";
import type { AccessSession, LoginEventRow } from "@/features/audit/server/activity-queries";
import { RESUME_CHECKS, WORKDAYS } from "@/features/staff/resume/resume";
import { buildSubjectMaps } from "@/features/owner/subjects";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { activityDetail, activityOpLabel, deviceLabel, type ActivityOp } from "@/features/audit/activity";
import { SalaryRatesButton } from "@/app/(shell)/attendance/_components/salary-rates-button";
import { ATTENDANCE_RATE_LEVELS, MIXED_NEEDS_LEVELS, mixedWithoutLevels } from "@/features/attendance/salary-rates";
import { workDaysLabel } from "@/features/staff/employment";
import { kstMonth } from "@/lib/date-kst";
import { ResumePhotoSlide } from "@/app/(shell)/staff/[id]/_components/resume-photo-slide";
import { ContractStatus } from "@/app/(shell)/staff/[id]/_components/contract-status";
import { AccountActions } from "@/app/(shell)/staff/[id]/_components/account-actions";
import { MonthlyScheduleView } from "@/app/(shell)/staff/[id]/_components/monthly-schedule-view";
import { ACTIVITY_PAGE_SIZE, type StaffInfoData, type StaffActivityData, type StaffSalaryData } from "./staff-host-parts";

// ── app/(shell)/staff/[id]/_tabs/basic-info-tab.tsx ──────────
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="micro">{label}</p>
      <div className="text-foreground text-sm">{value || <span className="text-text-faint">—</span>}</div>
    </div>
  );
}

/** 이질적 다(多)섹션 구획 — 헤더 달린 카드(디자인 규칙). 2열 배치 시 높이 균형 위해 flex-col. */
function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-card border-line shadow-card flex flex-col rounded-2xl border p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="micro">{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = () => <p className="text-text-faint text-sm">입력된 내용이 없습니다</p>;

export function BasicInfoTab({
  data,
  staff,
  displayRole,
  canManageThis,
  canManageContracts = false,
  showSalary,
  roleOptions,
  resume,
  resumeAccess = false,
  resumeCanWrite = false,
  resumePhotoUrls,
}: {
  data: StaffInfoData;
  staff: StaffDetail;
  // 표시용 역할(super_admin은 '관리자'로 위장). 배지·급여카드 노출 등 '보이는 것'에만 사용.
  // 권한/위계 로직(AccountActions)엔 실제 staff.systemRole 유지.
  displayRole: SystemRole;
  canManageThis: boolean;
  /** 계약 갱신 권한 = 직원관리 쓰기(사무실). canManageThis(쓰기 AND 자신 권한 이하 대상)와 축이 다르다. */
  canManageContracts?: boolean;
  showSalary: boolean;
  roleOptions: SystemRole[];
  /** 연결된 이력서(원장·관리자 게이트 통과 시에만 전달) — 이 탭의 내용 원천. */
  resume?: ResumeDetail | null;
  /** 이력서 열람 자격(원장·관리자) — 민감 항목(주민번호·계좌·급여계약) 노출 여부. */
  resumeAccess?: boolean;
  /** 이력서 수정 가능 여부 — '수정'/'이력서 작성' 버튼 노출. */
  resumeCanWrite?: boolean;
  /** 증명사진 signed URL(슬라이드) — 게이트 통과 시에만 서버가 resolve. */
  resumePhotoUrls?: (string | null)[];
}) {
  // 독립 조회 병렬(B4). 담임 반 목록·인계 후보는 계정 관리 패널(퇴사 경고·일괄 인계)에서만 쓰여
  // canManageThis일 때만 조회한다. 계약서 파일은 계약현황 카드용(2026-08-03).
  const [settings, homeroomClasses, contracts, contractFiles, handoverTeachers, assistClasses, protection] = [
    data.settings,
    data.homeroomClasses,
    data.contracts,
    data.contractFiles,
    data.handoverTeachers,
    data.assistClasses,
    data.protection,
  ] as const;
  // 오늘 날짜는 **서버에서** 확정해 내려보낸다 — 클라에서 new Date()를 쓰면 시간대·하이드레이션이 어긋난다.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  // 과목 라벨·색은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const isTeacherLike = displayRole === "teacher" || displayRole === "master";
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

  const d = resume?.data ?? null;
  const p = d?.personal;
  const c = d?.contract;
  // 연락처·직급·입사일·근무부서·근무형태는 **이력서가 단일 소스**다(원장 지시 2026-08-25 — 근무 설정
  // 폼에서 이 칸들을 뺐다). users 값은 이력서가 아직 없는 직원(임포트분)을 위한 폴백으로만 남는다.
  const phone = p?.phone || staff.phone || "";
  const jobTitle = c?.jobTitle || staff.jobTitle || "";
  const department = c?.division || staff.department || "";
  const employmentType = c?.employmentType || staff.employmentType || "";
  const hireDate = c?.startDate || staff.hireDate || "";
  const dayLabels = c ? WORKDAYS.filter((w) => c.workDays.includes(w.key)).map((w) => w.label) : [];
  const salary = c
    ? [c.salaryMonthly && `월급 ${c.salaryMonthly}`, c.salaryAnnual && `연봉 ${c.salaryAnnual}`].filter(Boolean).join(" · ")
    : "";
  const educations = d?.education.filter((e) => e.school.trim()) ?? [];
  const careers = d?.career.filter((r) => r.company.trim()) ?? [];
  const certs = d?.certificates.filter((r) => r.name.trim()) ?? [];
  const langs = d?.languages.filter((r) => r.name.trim()) ?? [];
  const email = staff.email.toLowerCase().endsWith("@imported.local") ? "" : staff.email;

  const editButton = resumeCanWrite ? (
    <Button
      variant="outline"
      size="sm"
      render={
        resume ? (
          // 수정 = 이력서 편집 모드로 바로 — 저장하면 이 view가 따라 갱신된다.
          <WindowLink href={`/staff/resumes/${resume.id}?edit=1`} title={`${staff.displayName} 이력서 수정`} />
        ) : (
          <WindowLink href={`/staff/resumes/new?staff=${staff.id}`} title={`이력서 작성 — ${staff.displayName}`} />
        )
      }
    >
      <Pencil className="size-3.5" />
      {/* ⚠️ "수정" 단독 금지 — 페이지 헤더의 '근무 설정'과 나란히 보인다(원장 지적 2026-08-07).
          이 버튼은 인적사항 칸만이 아니라 **이력서 전체**(계약·학력·경력 포함)를 연다. */}
      {resume ? "이력서 수정" : "이력서 작성"}
    </Button>
  ) : null;

  return (
    <div className="space-y-5">
      {/* 인적사항 — 이력서 첫 섹션 느낌 그대로: 사진이 정보 옆에 */}
      <SectionCard title="인적사항" action={editButton}>
        <div className="flex flex-col-reverse items-start gap-5 sm:flex-row">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-3">
            <Field label="성명" value={<span className="font-bold">{p?.name || staff.displayName}</span>} />
            {/* 이력서 '영문 이름'과 계정 '영어 닉네임'(users.english_name)은 **다른 값**이다 —
                폴백으로 이어 붙이면 시간표 매칭용 닉네임이 이력서 서식 칸에 앉아, 어느 쪽을 고쳐야
                하는지 알 수 없게 된다(닉네임은 아래 계약사항 카드에 제 칸이 있다, 2026-08-25). */}
            <Field label="영문 이름" value={p?.nameEn} />
            <Field label="연락처" value={phone ? <span className="num">{phone}</span> : null} />
            <Field label="이메일" value={email ? <span className="num">{email}</span> : null} />
            {resumeAccess ? (
              <>
                <Field label="주민등록번호" value={p?.residentId ? <span className="num">{p.residentId}</span> : null} />
                <Field label="주소" value={p?.address} />
              </>
            ) : null}
          </div>
          {/* 사진 자리는 비어 있어도 유지 — 인적사항에서 얼굴을 보는 게 이 카드의 목적. */}
          {resumeAccess ? <ResumePhotoSlide urls={resumePhotoUrls ?? []} /> : null}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
        {/* 계약사항 — 이력서 5번 섹션 */}
        <SectionCard title="계약사항">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Field label="근무부서" value={department} />
            <Field label="근무형태" value={employmentType} />
            <Field label="직급" value={jobTitle} />
            <Field label="입사일" value={hireDate ? <span className="num">{hireDate}</span> : null} />
            <Field label="근무요일" value={dayLabels.length ? dayLabels.join(" · ") : null} />
            {/* 시스템 쪽 항목(역할·과목·강의실·닉네임)은 '계정 정보' 카드가 계약현황으로 바뀌면서
                여기로 합쳤다(2026-07-29 원장 지시) — 어차피 같은 '이 사람이 어떻게 일하는가' 축. */}
            <Field label="시스템 역할" value={ROLE_LABEL[displayRole] ?? displayRole} />
            <Field
              label="담당 과목"
              value={
                staff.subjects.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {staff.subjects.map((s) => (
                      <Pill key={s} color={subjects.colorOf(s)} soft>
                        {subjects.labelOf(s)}
                      </Pill>
                    ))}
                  </div>
                ) : null
              }
            />
            <Field label="기본 강의실" value={staff.defaultClassroom} />
            <Field label="영어 닉네임" value={staff.englishName} />
            {resumeAccess ? (
              <>
                <Field label="급여 계약" value={salary ? <span className="num">{salary}</span> : null} />
                <Field
                  label="계좌"
                  value={
                    c?.account ? (
                      <span className="num">
                        {c.account}
                        {c.bank ? ` (${c.bank})` : ""}
                      </span>
                    ) : null
                  }
                />
                <Field label="처리담당자" value={c?.manager} />
              </>
            ) : null}
          </div>
          {staff.memo ? (
            <div className="border-line mt-4 border-t pt-4">
              <p className="micro mb-1">메모</p>
              <p className="text-text-dim text-sm whitespace-pre-wrap">{staff.memo}</p>
            </div>
          ) : null}
        </SectionCard>

        {/* 계약현황 — 구 '계정 정보' 자리(2026-07-29 원장 지시). 현재계약 + 계약조건 히스토리 + 연장. */}
        <ContractStatus
          userId={staff.id}
          hireDate={hireDate || null}
          rows={contracts}
          files={contractFiles}
          today={today}
          canWrite={canManageContracts}
        />
      </div>

      {resumeAccess ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
          {/* 학력사항 */}
          <SectionCard title="학력사항">
            {educations.length > 0 ? (
              <ul className="divide-line/60 divide-y">
                {educations.map((e, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{e.school}</span>
                      {e.major ? <span className="text-text-dim"> · {e.major}</span> : null}
                      {e.gpa ? <span className="text-text-faint text-xs"> · 학점 {e.gpa}</span> : null}
                    </span>
                    {e.period ? <span className="text-text-faint num shrink-0 text-xs">{e.period}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </SectionCard>

          {/* 경력사항 */}
          <SectionCard title="경력사항">
            {careers.length > 0 ? (
              <ul className="divide-line/60 divide-y">
                {careers.map((r, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{r.company}</span>
                      {r.duties ? <span className="text-text-dim"> · {r.duties}</span> : null}
                      {r.leaveReason ? <span className="text-text-faint text-xs"> · {r.leaveReason}</span> : null}
                    </span>
                    {r.period ? <span className="text-text-faint num shrink-0 text-xs">{r.period}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </SectionCard>

          {/* 자격증 · 외국어 */}
          <SectionCard title="자격증 · 외국어">
            {certs.length > 0 || langs.length > 0 ? (
              <ul className="divide-line/60 divide-y">
                {certs.map((r, i) => (
                  <li key={`c${i}`} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{r.name}</span>
                      {r.issuer ? <span className="text-text-dim"> · {r.issuer}</span> : null}
                    </span>
                    {r.date ? <span className="text-text-faint num shrink-0 text-xs">{r.date}</span> : null}
                  </li>
                ))}
                {langs.map((r, i) => (
                  <li key={`l${i}`} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{r.name}</span>
                      {r.score ? <span className="text-text-dim"> · {r.score}</span> : null}
                    </span>
                    {r.testDate ? <span className="text-text-faint num shrink-0 text-xs">{r.testDate}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </SectionCard>

          {/* 제출서류 확인 */}
          <SectionCard title="제출서류 확인">
            {d ? (
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {RESUME_CHECKS.map((item) => (
                  <span key={item.key} className="text-foreground inline-flex items-center gap-1.5 text-sm">
                    {d.checks[item.key] ? (
                      <CheckSquare size={14} className="text-primary" aria-hidden="true" />
                    ) : (
                      <Square size={14} className="text-text-faint" aria-hidden="true" />
                    )}
                    {item.label}
                  </span>
                ))}
              </div>
            ) : (
              <Empty />
            )}
            {/* 카드 높이 균형(2열 규칙) — 남는 공간은 아래로 밀착 */}
            <div className="mt-auto" />
          </SectionCard>
        </div>
      ) : null}

      {showSalary && isTeacherLike ? (
        <SectionCard title="급여 기준">
          <div className="grid grid-cols-2 gap-5">
            <Field label="시급" value={<span className="tabular">{won(staff.hourlyRate)}</span>} />
            <Field label="기본급" value={<span className="tabular">{won(staff.monthlyBase)}</span>} />
          </div>
        </SectionCard>
      ) : null}

      {canManageThis ? (
        <AccountActions
          staffId={staff.id}
          displayName={staff.displayName}
          currentEmail={staff.email}
          currentRole={staff.systemRole}
          currentStatus={staff.status}
          roleOptions={roleOptions}
          homeroomClasses={homeroomClasses}
          assistClasses={assistClasses}
          handoverTeachers={handoverTeachers}
          protection={protection}
        />
      ) : null}
    </div>
  );
}

// ── app/(shell)/staff/[id]/_tabs/monthly-schedule-tab.tsx ──────────
export function MonthlyScheduleTab({
  initialData,
  staffId,
  staffName,
  canManage,
}: {
  initialData: MonthlyTasksResult;
  staffId: string;
  staffName: string;
  canManage: boolean;
}) {
  const month = kstMonth();
  const initial = initialData; // 서버(v2-staff-read.mjs monthlyData) — 노션 호출 없이 연결 여부만

  return (
    <MonthlyScheduleView
      staffId={staffId}
      staffName={staffName}
      canManage={canManage}
      initialMonth={month}
      initial={initial}
    />
  );
}

// ── app/(shell)/staff/[id]/_tabs/classes-tab.tsx ──────────
const DAY_LABEL: Record<WorkDay, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export function ClassesTab({ classes, settings, staffId }: { classes: StaffClassRow[]; settings: { operations: { subjects: SubjectSetting[] } }; staffId: string }) {
  void staffId;
  const subjects = buildSubjectMaps(settings.operations.subjects);

  if (classes.length === 0) {
    return <EmptyState image="classes" icon={() => <GraduationCap size={32} strokeWidth={1.8} />} title="담당 수업이 없습니다" />;
  }

  return (
    <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
      <table className="w-full min-w-[460px] text-sm">
        <thead>
          <tr className="border-line text-text-dim border-b text-left">
            <th className="px-4 py-2.5 font-medium">수업명</th>
            <th className="px-3 py-2.5 font-medium">과목</th>
            <th className="px-3 py-2.5 font-medium">요일·시간</th>
            <th className="px-3 py-2.5 text-right font-medium">인원</th>
            <th className="px-3 py-2.5 font-medium">상태</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {classes.map((c) => (
            <tr key={c.id} className="hover:bg-bg-soft transition">
              <td className="px-4 py-2.5">
                <WindowLink
                  href={`/classes/${c.id}`}
                  title={c.className}
                  className="text-foreground hover:text-primary font-medium hover:underline"
                >
                  {c.className}
                </WindowLink>
              </td>
              <td className="text-text-dim px-3 py-2.5">{subjects.labelOf(c.subject)}</td>
              <td className="px-3 py-2.5">
                {c.schedules.length === 0 ? (
                  <span className="text-text-faint text-xs">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {c.schedules.map((s, i) => (
                      <span key={i} className="border-line bg-bg-soft num rounded-sm border px-1.5 py-0.5 text-xs">
                        {DAY_LABEL[s.day]} {s.startTime}–{s.endTime}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="tabular px-3 py-2.5 text-right">{c.studentCount}</td>
              <td className="px-3 py-2.5">
                {c.isActive ? (
                  <Pill color="primary" soft>
                    진행중
                  </Pill>
                ) : (
                  <Pill color="neutral" soft>
                    종료
                  </Pill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}

// ── app/(shell)/staff/[id]/_tabs/activity-log-tab.tsx ──────────
const OP_COLOR: Record<ActivityOp, PillColor> = { INSERT: "primary", UPDATE: "blue", DELETE: "danger" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });

type AccessGroup = {
  key: string;
  ip: string | null;
  device: string;
  count: number;
  firstStarted: string;
  lastActive: string;
};

const ms = (iso: string) => new Date(iso).getTime();

/**
 * 세션을 IP·기기 기준으로 묶는다 — 집/학원망은 공인 IP 1개(NAT)라 같은 곳에서 온 세션이 목록을 도배해
 * "중복처럼" 보였다. 그룹당 세션 수 + 가장 최근 활동으로 요약해 낯선 IP만 한 줄로 또렷이 드러나게(보안 검토값 유지).
 * 최신 활동순 정렬. 문자열 비교 대신 epoch(ms)로 비교(타임존/소수초 표기차 방어).
 */
function groupSessions(sessions: AccessSession[]): AccessGroup[] {
  const map = new Map<string, AccessSession[]>();
  for (const s of sessions) {
    const key = `${s.ip ?? "?"}|${deviceLabel(s.userAgent)}`;
    const arr = map.get(key);
    if (arr) arr.push(s);
    else map.set(key, [s]);
  }
  const groups = [...map.entries()].map(([key, arr]) => ({
    key,
    ip: arr[0].ip,
    device: deviceLabel(arr[0].userAgent),
    count: arr.length,
    firstStarted: arr.reduce((m, s) => (ms(s.startedAt) < ms(m) ? s.startedAt : m), arr[0].startedAt),
    lastActive: arr.reduce((m, s) => (ms(s.lastActive) > ms(m) ? s.lastActive : m), arr[0].lastActive),
  }));
  groups.sort((a, b) => ms(b.lastActive) - ms(a.lastActive));
  return groups;
}

/**
 * 최근 접속(순수 프레젠테이션 — 데이터는 부모가 Promise.all로 병렬 조회해 주입, B4 준수). 사무실만(RLS + 탭 게이트).
 * IP·기기별로 묶어 세션 수 + 첫 로그인~마지막 활동을 요약(중복감 제거). 아래 "로그인 기록"은 개별 로그인 이력(영구).
 */
function RecentAccess({ sessions, logins }: { sessions: AccessSession[]; logins: LoginEventRow[] }) {
  if (sessions.length === 0 && logins.length === 0) return null;
  const groups = groupSessions(sessions);
  return (
    <section className="bg-card border-line space-y-2 rounded-2xl border p-4">
      <p className="micro flex items-center gap-1.5">
        <LogIn className="text-text-dim size-3.5" /> 최근 접속
      </p>
      {groups.length > 0 ? (
        <ul className="divide-line divide-y text-sm">
          {groups.map((g) => (
            <li key={g.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
              <span className="text-foreground num">{g.ip ?? "IP 미상"}</span>
              <span className="text-text-dim">{g.device}</span>
              <span className="text-text-dim num ml-auto text-xs">
                세션 {g.count}개 ·{" "}
                {g.count > 1 ? `${when(g.firstStarted)} ~ ` : ""}마지막 활동 {when(g.lastActive)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {logins.length > 0 ? (
        <div className="border-line border-t pt-2">
          <p className="text-text-faint mb-1 text-xs">로그인 기록(직접 로그인)</p>
          <ul className="text-text-dim space-y-0.5 text-xs">
            {logins.map((l) => (
              <li key={l.id} className="num flex flex-wrap gap-x-2">
                <span>{when(l.at)}</span>
                <span className="not-num">{deviceLabel(l.userAgent)}</span>
                {l.ip ? <span>{l.ip}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 직원 상세 "활동 로그" 탭 — 이 직원이 시스템에서 한 변경(생성·수정·삭제)을 최신순으로.
 * activity_log(0081a DB 트리거)가 소스 — 사무실(master/admin/manager)만 열람(RLS + 페이지 게이트 이중).
 * 책임추적: "누가·언제·무엇을 어떻게 바꿨나"를 자동 기록(앱에서 빠뜨려도 누락 없음).
 */
export function ActivityLogTab({ data, userId, page }: { data: StaffActivityData; userId: string; page: number }) {
  // 독립 3쿼리 병렬(B4) — activity_log(무거운 count) 완료를 기다리며 접속 조회가 지연되지 않게.
  const [{ rows, total }, sessions, logins] = [data.log, data.sessions, data.logins] as const;
  const totalPages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const hrefForPage = (p: number) =>
    p > 1 ? `/staff/${userId}?tab=activity&page=${p}` : `/staff/${userId}?tab=activity`;

  return (
    <div className="space-y-4">
      <RecentAccess sessions={sessions} logins={logins} />
      {total === 0 ? (
        <EmptyState
          image="audit"
          icon={() => <History size={32} strokeWidth={1.8} />}
          title="기록된 활동이 없습니다"
          description="이 직원이 학생·반·수납·지출·출결·공지 등 핵심 데이터를 생성·수정·삭제하면 여기에 자동으로 남습니다."
        />
      ) : (
        <section className="space-y-3">
          <p className="micro">
            활동 <span className="text-foreground font-bold">{total}</span>건
            <span className="text-text-faint ml-2 normal-case">· 핵심 데이터 변경을 자동 기록(책임추적)</span>
          </p>
          <ul className="bg-card border-line divide-line divide-y rounded-2xl border">
            {rows.map((r) => {
              const { head, changes } = activityDetail(r.table, r.op, r.targetLabel, r.changed);
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                  <Pill color={OP_COLOR[r.op]}>{activityOpLabel(r.op)}</Pill>
                  <div className="min-w-0 flex-1">
                    {changes.length <= 1 ? (
                      // 변경 0~1건: 한 줄 인라인.
                      <p className="text-foreground text-sm break-keep">
                        {head}
                        {changes.length ? ` — ${changes[0]}` : ""}
                      </p>
                    ) : (
                      // 변경 여러 건: 머리말 + 항목별 줄바꿈 리스트.
                      <>
                        <p className="text-foreground text-sm font-medium break-keep">{head}</p>
                        <ul className="mt-1 space-y-0.5">
                          {changes.map((c, i) => (
                            <li key={i} className="text-text-dim flex gap-1.5 text-sm break-keep">
                              <span className="text-text-faint select-none">·</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <p className="text-text-faint num mt-1 text-xs">{when(r.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} totalPages={totalPages} hrefForPage={hrefForPage} total={total} />
        </section>
      )}
    </div>
  );
}

// ── app/(shell)/staff/[id]/payroll/_salary-scope.tsx ──────────
/** 같은 개인별 비율표를 연다. 직원 상세에 별도 급여 규칙이나 저장소를 만들지 않는다. */
export function PersonalSalaryScope({ data, teacherId, teacherName, period }: {
  data: StaffSalaryData | null; teacherId: string; teacherName: string; period: string;
}) {
  void period;
  if (!data) return null;
  const month = data.month;
  const config = "unavailable" in data ? { unavailable: true as const } : data;
  if (!config) return null;
  if ("unavailable" in config) return <p role="status" className="border-line bg-card rounded-lg border p-4 text-sm">개인별 급여 설정을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p>;
  const { rates, canEdit, classes, mixed } = config;
  return (
      <section aria-labelledby="personal-salary-heading" className="border-line bg-card rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="personal-salary-heading" className="text-base font-bold">개인별 급여 설정</h2>
            <p className="text-text-dim mt-1 text-sm">달과 관계없이 이 선생님에게만 적용합니다. 출석부와 급여명세서가 같은 설정을 사용합니다.</p>
          </div>
          {canEdit ? <SalaryRatesButton teacherId={teacherId} teacherName={teacherName} month={month} rates={rates} classes={classes} mixed={mixed} /> : null}
        </div>
        {/* 혼합 계약(근로 + 용역, 원장 2026-10-16) — 대상 학년이 용역 몫, 근로 요일이 근로 몫이다(`employment.ts`). */}
        {mixed ? (
          <p className="text-text-dim mt-2 text-sm break-keep">혼합 계약(근로 + 용역) — 급여 대상 학년이 용역(프리랜서) 몫이고, 근로 요일은 강사평가 근태를 세는 요일입니다.</p>
        ) : null}
        {mixedWithoutLevels({ rates, mixed }) ? <p role="alert" className="text-danger mt-2 text-sm break-keep">{MIXED_NEEDS_LEVELS}</p> : null}
        <dl className={`mt-3 grid grid-cols-1 gap-3 text-sm ${mixed ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
          <div><dt className="text-text-dim">{mixed ? "급여 대상 학년(용역)" : "급여 대상 학년"}</dt><dd className="mt-1 font-semibold">{(rates.levels ?? ATTENDANCE_RATE_LEVELS).join(" · ")}</dd></div>
          {mixed ? <div><dt className="text-text-dim">근로 요일</dt><dd className="mt-1 font-semibold">{rates.workDays?.length ? workDaysLabel(rates.workDays) : "정하지 않음(모든 요일)"}</dd></div> : null}
          <div><dt className="text-text-dim">특강 대상</dt><dd className="mt-1 font-semibold">{rates.includeSpecial ? "학년 제한 없이 포함" : "급여 대상 학년만 포함"}</dd></div>
          <div><dt className="text-text-dim">반별 예외 비율</dt><dd className="mt-1 font-semibold">{Object.keys(rates.classes).length ? `${Object.keys(rates.classes).length}개 반` : "없음"}</dd></div>
        </dl>
      </section>
  );
}
