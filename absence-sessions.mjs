// 2.0 최근 결석과 같은 단위: 정정 반영 결석 칸을 원생·반·수업일로 접는다.
// 호출부는 유효한 결석 칸만 넘긴다. 교시별 원본은 cells에 남겨 담당·메모·후속 기록을 합칠 수 있다.
export function groupAbsenceSessions(rows) {
  const bySession = new Map();
  for (const [index, row] of rows.entries()) {
    const studentId = row.student_id ?? row.studentId;
    const classId = row.class_id ?? row.classId;
    const date = row.session_date ?? row.date ?? row.d;
    if (!studentId) throw new TypeError('결석 수업에 원생 ID가 필요합니다.');
    const key = date ? JSON.stringify([studentId, classId ?? null, date]) : JSON.stringify(['unpaired', index]);
    const session = bySession.get(key);
    if (session) session.cells.push(row);
    else bySession.set(key, { ...row, studentId, classId: classId ?? null, date, cells: [row] });
  }
  return [...bySession.values()];
}
