// 2.0 서버 전용 모듈(server-only)의 조립 본문을 브라우저에서 — 조회만 받아 온 자료(/api/v2/timetable)로 바꾸고 나머지는 원문 그대로.
// 원문: src/features/timetable/server/reserved-lines.ts `attachReservedLines` — verify-v2-screen-timetable.mjs가 `const studentById`부터
// 끝까지(+ byKeyPush·dowOfDate)를 2.0 원문과 글자 대조한다(타입·주석·공백만 뺀 비교).
import { toTimetableReservedLine, type MakeupReservation, type TimetableReservedLine } from '@/features/attendance/makeup-reservation';
import type { ReservedAttachResult, StrayReservedBlock } from '@/features/timetable/server/reserved-lines';
import { dateOfDowInWeek } from '@/features/timetable/lib/week';

type SlotLike = {
  id: string;
  classId: string;
  className?: string;
  dayOfWeek: string;
  teacherName?: string | null;
};
export type ReservationData = { reservations: MakeupReservation[]; students: { id: string; name: string; grade: string | null; school: string | null }[] };
const NO_STRAYS: readonly StrayReservedBlock[] = [];

export function attachReservedLines<T extends SlotLike>(
  slots: readonly T[],
  referenceDate: string,
  data: ReservationData,
): ReservedAttachResult<T & { reserved?: TimetableReservedLine[] }> {
  const classIds = [...new Set(slots.map((s) => s.classId).filter(Boolean))];
  if (classIds.length === 0) return { slots: [...slots], strays: NO_STRAYS };
  // ↓ 2.0: `await getReservationsInWeek(referenceDate, classIds)` — 서버가 그 주·예약 상태로 이미 좁혀 보냈다(이 반들만 남긴다).
  const wanted = new Set(classIds);
  const reservations = data.reservations.filter((r) => wanted.has(r.classId));
  if (reservations.length === 0) return { slots: [...slots], strays: NO_STRAYS };
  // ↓ 2.0: `fetchInChunks(students … id, name, grade, school)` — 서버가 예약 학생의 같은 칸을 보냈다.
  const students = data.students;
  const studentById = new Map(students.map((s) => [s.id, s]));
  // 반마다 ① 그 주 어느 날짜에 칸이 있나 ② 담임 이름(격자 열 키) ③ 반 이름(툴팁) — 새 조회 0건.
  const cellDates = new Set<string>();
  const teacherOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const s of slots) {
    const date = dateOfDowInWeek(referenceDate, s.dayOfWeek);
    if (date) cellDates.add(`${s.classId}|${date}`);
    const t = s.teacherName;
    if (t && t.trim() && !teacherOf.has(s.classId)) teacherOf.set(s.classId, t);
    if (s.className && !nameOf.has(s.classId)) nameOf.set(s.classId, s.className);
  }
  const byCell = new Map<string, TimetableReservedLine[]>();
  const strayByKey = new Map<string, StrayReservedBlock>();
  for (const r of reservations) {
    const stu = studentById.get(r.studentId);
    if (!stu) continue;
    const cellKey = `${r.classId}|${r.makeupDate}`;
    if (cellDates.has(cellKey)) {
      (byKeyPush(byCell, cellKey)).push(toTimetableReservedLine(r, stu));
      continue;
    }
    const teacherName = teacherOf.get(r.classId);
    if (!teacherName) continue;
    const dayOfWeek = dowOfDate(r.makeupDate);
    if (!dayOfWeek) continue;
    const key = `${teacherName}|${dayOfWeek}|${r.slotStart}|${r.slotEnd}`;
    const block =
      strayByKey.get(key) ??
      strayByKey
        .set(key, {
          key,
          teacherName,
          dayOfWeek,
          date: r.makeupDate,
          startTime: r.slotStart,
          endTime: r.slotEnd,
          lines: [],
        })
        .get(key)!;
    block.lines.push(toTimetableReservedLine(r, stu, { className: nameOf.get(r.classId) ?? null }));
  }
  const withLines =
    byCell.size === 0
      ? [...slots]
      : slots.map((s) => {
          const date = dateOfDowInWeek(referenceDate, s.dayOfWeek);
          const lines = date ? byCell.get(`${s.classId}|${date}`) : undefined;
          return lines ? { ...s, reserved: lines } : s;
        });
  return { slots: withLines, strays: strayByKey.size === 0 ? NO_STRAYS : [...strayByKey.values()] };
}

function byKeyPush(map: Map<string, TimetableReservedLine[]>, key: string): TimetableReservedLine[] {
  const cur = map.get(key);
  if (cur) return cur;
  const next: TimetableReservedLine[] = [];
  map.set(key, next);
  return next;
}

function dowOfDate(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const idx = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[idx] ?? null;
}
