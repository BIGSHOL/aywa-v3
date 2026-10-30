// 강사평가 현황은 저장된 직원 포트폴리오 월간 점수만 읽는다. 체크리스트 평가 점수와 섞지 않는다.
const SUBJECTS = [{ key: 'english', label: '영어 통합' }, { key: 'math', label: '수학' }, { key: 'other', label: '과목 미분류' }];
const href = params => `#v2-class-review${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
const shown = n => Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1);
const score = (value, max) => value !== null && value !== undefined && max !== null && max !== undefined && Number.isFinite(Number(value)) && Number.isFinite(Number(max)) && Number(max) > 0 ? `${shown(value)} / ${shown(max)}점` : '—';
const percent = (n, d) => d ? `${Math.round(n / d * 100)}%` : '—';
const previousMonth = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).toISOString().slice(0, 7);
const leaf = teacher => href({ v2path: '/class-review', tab: 'portfolio', teacher });

export function subjectKeys(row, settings, fallback = []) {
  const source = Array.isArray(row.subjects) && row.subjects.length ? row.subjects : Array.isArray(row.user_subjects) && row.user_subjects.length ? row.user_subjects : fallback;
  const names = new Map((settings.operations.subjects ?? []).map(s => [s.key, s.label]));
  const keys = new Set();
  for (const raw of source) {
    const value = `${raw} ${names.get(raw) ?? ''}`;
    if (/english|eie|영어/i.test(value)) keys.add('english');
    if (/math|수학/i.test(value)) keys.add('math');
  }
  return keys.size ? [...keys] : ['other'];
}

function comparable(current, previous) {
  if (!current?.evaluation || !previous?.evaluation || current.knownMax !== previous.knownMax) return false;
  return JSON.stringify(current.evaluation) === JSON.stringify(previous.evaluation);
}

export async function portfolioOverview({ sql, tenantId, settings, params }) {
  const [latest] = await sql`select max(month) as latest_month from public.teacher_portfolio_months where tenant_id=${tenantId} and closed_at is not null`;
  const month = latest?.latest_month ?? null;
  if (!month) return { title: '강사평가 현황', purpose: '마감된 평가월의 점수와 항목 근거를 확인합니다.', path: [{ label: '강사평가' }],
    columns: [{ key: 'name', label: '과목' }], rows: [], empty: '아직 마감된 평가월이 없습니다.' };
  const rows = await sql`select p.teacher_id::text id, p.month, p.total, p.subjects, p.payload, p.closed_at::text closed_at,
    u.display_name name, u.subjects user_subjects from public.teacher_portfolio_months p
    left join public.users u on u.id=p.teacher_id and u.tenant_id=${tenantId}
    where p.tenant_id=${tenantId} and p.month=${month} order by u.display_name, p.teacher_id`;
  const ids = rows.map(r => r.id);
  const prevMonth = previousMonth(month);
  const [previous, others] = ids.length ? await Promise.all([
    sql`select teacher_id::text id, payload from public.teacher_portfolio_months where tenant_id=${tenantId} and month=${prevMonth} and teacher_id=any(${ids}::uuid[])`,
    sql`select teacher_id::text id, subjects from public.teacher_portfolio_months where tenant_id=${tenantId} and month<>${month}
      and teacher_id=any(${ids}::uuid[]) order by month desc`,
  ]) : [[], []];
  const prevById = new Map(previous.map(r => [r.id, r.payload]));
  const otherById = new Map();
  for (const r of others) if (!otherById.has(r.id) && r.subjects?.length) otherById.set(r.id, r.subjects);
  const groups = new Map(SUBJECTS.map(s => [s.key, []]));
  for (const row of rows) for (const key of subjectKeys(row, settings, otherById.get(row.id) ?? [])) groups.get(key).push(row);
  const chosenSubject = SUBJECTS.find(s => s.key === params.subject);
  const selected = chosenSubject && groups.get(chosenSubject.key).find(r => r.id === params.teacher);
  const root = { label: '강사평가', href: href({}) };
  const path = [chosenSubject ? root : { label: '강사평가' }, ...(chosenSubject ? [{ label: chosenSubject.label, href: selected ? href({ subject: chosenSubject.key }) : null }] : []),
    ...(selected ? [{ label: selected.name || '이름 없음' }] : [])];
  let columns, output;
  if (!chosenSubject) {
    columns = [{ key: 'name', label: '과목' }, { key: 'closed', label: `${month} 마감 / 평가` }, { key: 'rate', label: '마감률' }, { key: 'range', label: '마감 점수 범위 / 만점' }];
    output = SUBJECTS.filter(s => groups.get(s.key).length).map(s => {
      const list = groups.get(s.key), closed = list.filter(r => r.closed_at), maxima = new Set(closed.map(r => r.payload?.knownMax));
      const values = closed.filter(r => r.total !== null).map(r => Number(r.total)).filter(Number.isFinite);
      const range = !values.length ? '—' : maxima.size !== 1 ? '만점이 달라 개별 확인' : `${shown(Math.min(...values))}~${shown(Math.max(...values))} / ${shown([...maxima][0])}점`;
      return { href: href({ subject: s.key }), cells: { name: s.label, closed: `${closed.length} / ${list.length}명`, rate: percent(closed.length, list.length), range } };
    });
  } else if (!selected) {
    columns = [{ key: 'name', label: '강사' }, { key: 'status', label: '마감' }, { key: 'score', label: '총점 / 만점' },
      { key: 'change', label: '전월 대비' }, { key: 'missing', label: '자료 없음' }];
    output = [...groups.get(chosenSubject.key)].sort((a, b) => Number(!!b.closed_at) - Number(!!a.closed_at) ||
      (a.closed_at && b.closed_at ? Number(a.total) / Number(a.payload?.knownMax || Infinity) - Number(b.total) / Number(b.payload?.knownMax || Infinity) : 0) ||
      String(a.name).localeCompare(String(b.name), 'ko')).map(r => {
      const p = r.payload ?? {}, prev = prevById.get(r.id), items = Array.isArray(p.items) ? p.items : [];
      const missing = items.filter(item => item.missing && !item.off), uncounted = items.filter(item => item.uncounted && !item.off);
      const lowItems = items.filter(item => !item.off && !item.missing && !item.uncounted && Number.isFinite(item.value) && item.max > 0 && item.value / item.max < 0.7);
      const low = !!r.closed_at && p.knownMax > 0 && r.total / p.knownMax < 0.7 && !missing.length && !uncounted.length;
      const delta = comparable(p, prev) && r.total !== null && prev?.total !== null && Number.isFinite(Number(r.total)) && Number.isFinite(Number(prev?.total)) ? shown(Number(r.total) - Number(prev.total)) : '—';
      return { teacherId: r.id, month, lowItems: lowItems.map(i => `${i.label || i.id} ${score(i.value, i.max)}`),
        href: href({ subject: chosenSubject.key, teacher: r.id }),
        cells: { name: r.name || '이름 없음', status: r.closed_at ? '마감' : '마감 대기',
          score: r.closed_at ? { text: score(r.total, p.knownMax), tone: low ? 'low' : '' } : '—', change: r.closed_at ? delta : '—',
          missing: r.closed_at ? `${missing.length}개` : '—' },
        action: r.closed_at && !low ? null : { kind: low ? 'guide' : 'closing', key: r.id, label: low ? '지도 요청' : '마감 확인' } };
    });
  } else {
    const p = selected.payload ?? {}, prev = prevById.get(selected.id), closed = !!selected.closed_at;
    columns = [{ key: 'name', label: '평가 항목' }, { key: 'score', label: '점수 / 배점' }, { key: 'raw', label: '원래 수치' },
      { key: 'status', label: '상태' }, { key: 'previous', label: '전월 같은 항목' }];
    output = closed ? (Array.isArray(p.items) ? p.items : []).map(item => {
      const old = comparable(p, prev) ? prev.items?.find(x => x.id === item.id && x.max === item.max && x.label === item.label) : null;
      return { href: leaf(selected.id), cells: { name: item.label || item.id, score: item.off ? '제외' : score(item.value, item.max),
        raw: item.raw === null || item.raw === undefined ? '—' : `${item.raw}${item.unit || ''}`,
        status: item.off ? '제외' : item.uncounted ? '계산 전' : item.missing ? '자료 없음' : '확정', previous: old && !old.off ? score(old.value, old.max) : '—' } };
    }) : [];
  }
  const closedCount = rows.filter(r => r.closed_at).length;
  return { period: month, title: selected ? `${selected.name || '강사'} ${month} 평가 항목` : chosenSubject ? `${chosenSubject.label} ${month} 강사 평가` : `${month} 강사평가 현황`,
    purpose: '마감된 점수와 항목 근거를 확인하고 필요한 지도를 요청합니다.', path, columns, rows: output,
    summary: `마감 ${closedCount} / 평가 ${rows.length}명 · 마감 대기 ${rows.length - closedCount}명`,
    empty: selected && !selected.closed_at ? '평가가 마감된 뒤 항목을 볼 수 있습니다.' : undefined,
    note: selected ? selected.closed_at ? `전월 같은 항목은 설정과 배점이 같을 때만 표시합니다. 항목을 누르면 직원 포트폴리오가 열립니다. 열린 뒤 ${month}을 골라 같은 달의 근거를 확인해 주세요.` : '이 강사의 평가가 아직 마감되지 않았습니다.'
      : '마감 전 점수는 순위와 범위에 넣지 않습니다. 총점과 만점의 70%를 비교하되 자료 없음·계산 전 항목이 있으면 지도 판단에서 제외합니다.' };
}
