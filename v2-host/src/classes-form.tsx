// 2.0 반 수정(app/(shell)/classes/[id]/edit/page.tsx) · 새 반(app/(shell)/classes/new/page.tsx)의 조립 — 서버 컴포넌트라 그대로 못 불러와서,
// 서버가 하던 조회는 /api/v2/classes?v2path=…(Docker 복사본, v2-classes-detail.mjs)가 하고 여기서는 두 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐(classes-form.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-classes.mjs가 글자를 대조한다.
// 남의 반 수정 폼은 열지 않는다(2.0 canWriteLoadedClass → notFound) — 서버가 같은 판정으로 { notFound }를 돌려준다.
import { isModuleEnabled } from "@/lib/modules";
import { BackLink } from "@/components/back-link";
import type { ClassDetail } from "@/features/classes/server/queries";
import type { ClassroomOption } from "@/features/enrollments/server/queries";
import { buildSubjectMaps, type SubjectSetting } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { isCurrentSlot } from "@/features/classes/schedule-preserve";
import { commonPeriod } from "@/features/classes/class-period";
import { kstToday } from "@/lib/date-kst";
import { ClassForm } from "@/app/(shell)/classes/_components/class-form";

type Settings = { operations: Parameters<typeof settingsToPeriodsConfig>[0] & { subjects: SubjectSetting[] }; modules: { disabled: Parameters<typeof isModuleEnabled>[0] } };
type TeacherOption = { id: string; name: string; subjects: string[] };

/** /api/v2/classes?v2path=/classes/<id>/edit — 2.0 Promise.all 이름 그대로. */
export type ClassEditData = { klass: ClassDetail; teachers: TeacherOption[]; classrooms: ClassroomOption[]; settings: Settings };
/** /api/v2/classes?v2path=/classes/new */
export type ClassNewData = { teachers: TeacherOption[]; classrooms: ClassroomOption[]; settings: Settings };

/** [id]/edit/page.tsx `EditClassPage`의 그리기 — 서버 호출 자리만 data로. */
export function EditClassPage({ data }: { data: ClassEditData }) {
  const { klass, teachers, classrooms, settings } = data;
  const id = klass.id;
  // 🔴 **남의 반 수정 폼은 열지 않는다** — 서버 액션(`updateClass`)과 같은 판정을 화면에서도 한 번
  //    (#77: 폼을 열 수 있으면 "저장만 거절"이 되고, 그 사이 입력한 것이 통째로 사라진다).
  //    `getClassDetail`이 이미 열람 스코프를 걸지만 그쪽은 **부담임·위임까지 넓다**(읽기 축).
  // 🔴 현재 담임이 배정 후보 밖(퇴직·역할 변경)이어도 **선택지에 남긴다**. 담임 select는 컨트롤드라
  // 값에 맞는 option이 없으면 빈 칸이 되고, 그대로 저장하면 `teacherId: get(...) || null`로 담임이
  // **조용히 NULL이 된다**(반을 고치러 들어갔다가 담임을 지우는 사고). 이름은 이미 klass에 있어 추가 조회 없음.
  const teacherOptions =
    klass.teacherId && !teachers.some((t) => t.id === klass.teacherId)
      ? [...teachers, { id: klass.teacherId, name: `${klass.teacherName ?? "이름 없음"} (현재 담임)`, subjects: [] }]
      : teachers;
  const subjectOptions = buildSubjectMaps(settings.operations.subjects).options;
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  // 폼이 편집하는 대상 = **현재 유효한 슬롯만**. 운영 종료일이 지난 행은 지난 배치의 이력이라
  // (영어 시트 구조 가져오기가 옛 배치를 마감하고 새 배치를 넣는다) 화면에 섞으면 ① 같은 칸에 옛/현
  // 두 행이 겹쳐 보이고 ② 저장 시 옛 강사·강의실 라벨이 현재 행에 되살아난다. 서버도 같은 범위만 쓴다.
  const today = kstToday();
  const liveSlots = klass.scheduleSlots.filter((s) => isCurrentSlot(s.validTo, today));
  const historyCount = klass.scheduleSlots.length - liveSlots.length;
  // 운영 기간 프리필 — 기간은 스케줄 **슬롯마다** 있고 폼은 반 단위 한 쌍이라, 전 슬롯이 같을 때만
  // 채운다(갈리면 비우고 periodMixed로 알림 — 조용한 소급·덮어쓰기 방지).
  const period = commonPeriod(liveSlots);

  return (
    <div className="space-y-6">
      <BackLink href={`/classes/${id}`} label="반 상세로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">반 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{klass.className}</h1>
      </header>

      <ClassForm
        mode="edit"
        scope={`class:${id}`}
        today={today}
        defaults={{
          id: klass.id,
          className: klass.className,
          subject: klass.subject,
          teacherId: klass.teacherId,
          classroomId: klass.classroomId,
          notes: klass.notes,
          bgColor: klass.bgColor,
          isSpecial: klass.isSpecial,
          reportOptout: klass.reportOptout,
          ...(klass.englishTrack ? { englishTrack: klass.englishTrack } : {}),
          validFrom: period.validFrom,
          validTo: period.validTo,
          ...(period.mixed ? { periodMixed: period.mixed } : {}),
          ...(historyCount > 0 ? { historyCount } : {}),
          schedules: liveSlots.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            teacherId: s.teacherId,
            classroomId: s.classroomId,
            slotTeacherLabel: s.slotTeacherLabel,
            labSeparate: s.labSeparate,
          })),
          labSeparateKnown: klass.labSeparateKnown,
        }}
        teacherOptions={teacherOptions}
        classroomOptions={classrooms}
        subjectOptions={subjectOptions}
        periodsConfig={periodsConfig}
        showEnglishTrack={isModuleEnabled(settings.modules.disabled, "eie")}
      />
    </div>
  );
}

/** new/page.tsx `NewClassPage`의 그리기 — 서버 호출 자리만 data로. */
export function NewClassPage({ data }: { data: ClassNewData }) {
  const { teachers, classrooms, settings } = data;
  const subjectOptions = buildSubjectMaps(settings.operations.subjects).options;
  const periodsConfig = settingsToPeriodsConfig(settings.operations);

  return (
    <div className="space-y-6">
      <BackLink href="/classes" label="수업목록으로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">새 반 생성</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">반 정보</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          기본 정보 입력 후 주간 스케줄을 설정하세요.
        </p>
      </header>

      <ClassForm
        mode="create"
        today={kstToday()}
        teacherOptions={teachers}
        classroomOptions={classrooms}
        subjectOptions={subjectOptions}
        periodsConfig={periodsConfig}
        showEnglishTrack={isModuleEnabled(settings.modules.disabled, "eie")}
      />
    </div>
  );
}
