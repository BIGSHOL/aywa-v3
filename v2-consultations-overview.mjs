// 담임 상담 현황은 2.0 homeroomStats의 같은 대상·상담 판정 결과를 표로 투영한다.
const rate = (self, target) => target ? Math.round(self / target * 100) : null;
const shownRate = value => value === null ? '—' : `${value}%`;
const current = teacher => teacher.months.at(-1) ?? { target: 0, self: 0, other: 0 };
const meanRate = (months, count) => months.length > count ? shownRate(rate(months.slice(-count - 1, -1).reduce((n, x) => n + x.self, 0), months.slice(-count - 1, -1).reduce((n, x) => n + x.target, 0))) : '—';
const href = params => `#v2-consultations?${new URLSearchParams(params)}`;
const monthName = month => `${Number(month.slice(5))}월`;
const status = cell => cell === 'self' ? '본인 상담 완료' : cell === 'other' ? '다른 직원만 상담' : '미상담';

export function consultationOverview(stats, { program = '', teacher = '', actor = '' } = {}) {
  const month = stats.months.at(-1), groups = stats.programTeachers ?? [];
  const chosen = groups.find(g => g.key === program);
  const selected = chosen?.teachers.find(t => t.id === teacher);
  const title = `${monthName(month)} 담임 상담 이행률`;
  const root = { label: '원생상담', href: '#v2-consultations' };
  const path = [root, ...(chosen ? [{ label: chosen.label, href: teacher ? href({ program }) : null }] : []), ...(selected ? [{ label: selected.name }] : [])];
  if (selected) {
    const index = stats.months.length - 1;
    return { period: month, title: `${selected.name} 담임 원생`, purpose: '이번 달 상담이 필요한 원생과 마지막 상담일을 확인합니다.', path,
      summary: `${chosen.label} · 대상 ${current(selected).target}명 · 본인 상담 ${current(selected).self}명 · 미완료 ${current(selected).target - current(selected).self}명`,
      columns: [{ key: 'name', label: '원생' }, { key: 'grade', label: '학년' }, { key: 'status', label: '이번 달' }, { key: 'last', label: '마지막 본인 상담' },
        { key: 'prev1', label: '지난달' }, { key: 'prev2', label: '2개월 전' }, { key: 'prev3', label: '3개월 전' }],
      rows: selected.students.map(s => ({ href: href({ v2path: '/consultations', studentId: s.id, ...(actor ? { actor } : {}) }),
        cells: { name: s.name, grade: s.grade || '—', status: { text: status(s.cells[index]), tone: s.cells[index] === 'self' ? 'high' : 'low' },
          last: s.lastSelf || '—', prev1: index > 0 ? status(s.cells[index - 1]) : '—', prev2: index > 1 ? status(s.cells[index - 2]) : '—',
          prev3: index > 2 ? status(s.cells[index - 3]) : '—' } })),
      note: '원생을 누르면 해당 원생의 상담 목록이 열립니다. 지난달 칸은 담임 상담 현황이 시작된 2026년 10월부터 표시합니다.' };
  }
  const visible = chosen ? [chosen] : groups;
  const totals = Object.fromEntries(groups.map(g => [g.key, g.teachers.reduce((a, t) => ({ target: a.target + current(t).target, self: a.self + current(t).self }), { target: 0, self: 0 })]));
  const all = Object.values(totals).reduce((a, t) => ({ target: a.target + t.target, self: a.self + t.self }), { target: 0, self: 0 });
  const lastDay = new Date(Date.UTC(Number(stats.today.slice(0, 4)), Number(stats.today.slice(5, 7)), 0)).getUTCDate();
  const summary = [`${monthName(month)} 이행률 — 전체 ${shownRate(rate(all.self, all.target))}`, ...groups.map(g => `${g.label} ${shownRate(rate(totals[g.key].self, totals[g.key].target))}`),
    `남은 날 ${lastDay - Number(stats.today.slice(8, 10))}일`].join(' · ');
  const rows = visible.flatMap(g => g.teachers.map(t => {
    const m = current(t), percent = rate(m.self, m.target), missing = t.students.filter(s => s.cells.at(-1) !== 'self');
    return { group: g.label, href: href({ program: g.key, teacher: t.id, ...(actor ? { actor } : {}) }),
      cells: { name: t.name, classes: t.classNames.join(', '), target: m.target, self: m.self, other: m.other, missing: m.target - m.self,
        rate: { text: shownRate(percent), tone: percent !== null && percent < 100 ? 'low' : 'high' },
        w1: t.weekly[0], w2: t.weekly[1], w3: t.weekly[2], w4: t.weekly[3], w5: t.weekly[4],
        prev: meanRate(t.months, 1), three: meanRate(t.months, 3) },
      ...(missing.length ? { action: { kind: 'guide', key: `${g.key}:${t.id}`, label: '지도 요청' }, missingNames: missing.map(s => s.name), missingIds: missing.map(s => s.id), teacherId: t.id, program: g.key } : {}) };
  })).sort((a, b) => groups.findIndex(g => g.label === a.group) - groups.findIndex(g => g.label === b.group) ||
    (Number.parseFloat(a.cells.rate.text) || 0) - (Number.parseFloat(b.cells.rate.text) || 0) || String(a.cells.name).localeCompare(String(b.cells.name), 'ko'));
  return { period: month, title, purpose: '각 과 담임이 담당 원생을 월 1회 상담했는지 확인하고, 필요한 선생님에게 지도를 요청합니다.', path,
    summary, columns: [{ key: 'name', label: '강사' }, { key: 'classes', label: '담임 반' }, { key: 'target', label: '상담 대상 원생' },
      { key: 'self', label: '이번 달 본인 상담' }, { key: 'other', label: '다른 사람 상담' }, { key: 'missing', label: '미상담' }, { key: 'rate', label: '이행률' },
      ...[1, 2, 3, 4, 5].map(i => ({ key: `w${i}`, label: `${i}주` })), { key: 'prev', label: '지난달' }, { key: 'three', label: '3개월' }],
    rows, filters: [{ label: '프로그램', options: [{ label: '전체', href: '#v2-consultations', current: !chosen }, ...groups.map(g => ({ label: g.label,
      href: href({ program: g.key, ...(actor ? { actor } : {}) }), current: g.key === chosen?.key }))] }],
    note: `주별 칸은 이번 달 대상 원생의 담임 본인 상담 건수입니다(1~7일, 8~14일, 15~21일, 22~28일, 29일~말일). 3개월은 종료한 세 달이 모이면 표시합니다.${stats.retired?.classes ? ` 퇴사 담임의 반 ${stats.retired.classes}개는 제외했습니다.` : ''}` };
}
