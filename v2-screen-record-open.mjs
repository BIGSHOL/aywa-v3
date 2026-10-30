// 기록 → 그 기록을 처리하는 화면(원장 10-30 "근거를 도대체 몇단계나 봐야하는거야"). 신호·업무·서랍·AI '볼 화면'이 모두
// #v2-record-open?family=&id= 한 주소로 들어오고, 여기서 원본 표를 한 번 읽어 2.0 화면 주소와 강조할 글자를 돌려준다.
// 2.0 상세 경로가 있으면 그 경로(기록 자체가 열린다), 목록 화면이면 그 기록이 보이는 조건 + 강조 글자(focus).
// 처리 화면이 없는 영역은 target=null → 화면이 작업 공간 기록 서랍으로 연다.
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const q = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString();
const at = (screen, params) => `#v2-${screen}${Object.keys(params).length ? `?${q(params)}` : ''}`;
const path = (screen, p) => at(screen, { v2path: p });
const day = v => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

// 원본 표 · 2.0 상세 경로가 그대로인 영역.
const DETAIL = {
  approvals: ['approval_documents', 'approvals', id => `/approvals/${id}`],
  enrollment: ['enrollment_consultations', 'enrollment', id => `/enrollment/${id}`],
  consultations: ['student_consultations', 'consultations', id => `/consultations/${id}`],
  students: ['students', 'students', id => `/students/${id}`],
  withdrawals: ['students', 'withdrawals', id => `/withdrawals/${id}`],
  meetings: ['meeting_minutes', 'meetings', id => `/meetings/${id}`],
  staff: ['users', 'staff', id => `/staff/${id}`],
  classes: ['classes', 'classes', id => `/classes/${id}`],
};

async function resolve(sql, t, family, id) {
  const one = async rows => (await rows)[0] ?? null;
  if (DETAIL[family]) {
    const [table, screen, route] = DETAIL[family];
    const hit = await one(sql`select 1 from ${sql('public.' + table)} where tenant_id=${t} and id=${id}`);
    return hit ? { target: path(screen, route(id)) } : null;
  }
  switch (family) {
    case 'withdrawal-reports': {
      if (await one(sql`select 1 from public.withdrawal_reports where tenant_id=${t} and id=${id}`)) return { target: path('withdrawal-reports', `/withdrawal-reports/${id}`) };
      if (await one(sql`select 1 from public.withdrawal_report_archives where tenant_id=${t} and id=${id}`)) return { target: path('withdrawal-reports', `/withdrawal-reports/archive/${id}`) };
      return null;
    }
    case 'attendance': { // 결석 한 칸 = 그날 그 반 출석부, 그 원생 줄
      const r = await one(sql`select a.session_date, a.class_id::text class_id, s.name from public.attendance_records a join public.students s on s.id=a.student_id and s.tenant_id=a.tenant_id
        where a.tenant_id=${t} and a.id=${id} and a.class_id is not null`);
      return r ? { target: path('attendance', `/attendance/${day(r.session_date)}/${r.class_id}`), focus: [r.name] } : null;
    }
    case 'makeups': { // 보강 예약 = 보강일 그 반 출석부(보강일 출결을 저장하면 2.0이 예약을 끝낸다), 그 원생 줄
      const r = await one(sql`select m.makeup_date, m.class_id::text class_id, s.name from public.makeup_reservations m join public.students s on s.id=m.student_id and s.tenant_id=m.tenant_id
        where m.tenant_id=${t} and m.id=${id} and m.class_id is not null`);
      return r ? { target: path('attendance', `/attendance/${day(r.makeup_date)}/${r.class_id}`), focus: [r.name] } : null;
    }
    case 'lesson-reports': { // 보고서 = 쓴 선생님의 원스크린 — 그날 · 그 반 · 그 원생(작성·발송을 하는 화면)
      const r = await one(sql`select l.report_date, l.class_id::text class_id, l.student_id::text student_id, coalesce(l.created_by, c.teacher_id)::text teacher
        from public.lesson_reports l left join public.classes c on c.id=l.class_id and c.tenant_id=l.tenant_id where l.tenant_id=${t} and l.id=${id}`);
      return r?.teacher ? { target: at('onescreen', { teacher: r.teacher, date: day(r.report_date), class: r.class_id, student: r.student_id }) } : null;
    }
    case 'billing': { // 청구서 = 수납 면, 그 청구월 · 그 원생 이름으로 걸러 맨 위에(세부 항목 펼침)
      const r = await one(sql`select i.period, s.name from public.invoices i join public.students s on s.id=i.student_id and s.tenant_id=i.tenant_id where i.tenant_id=${t} and i.id=${id}`);
      return r ? { target: at('billing', { period: String(r.period).slice(0, 7), q: r.name }), focus: [r.name], expand: true } : null;
    }
    case 'textbook-requests': { // 교재 요청 = 수납관리 › 교재(등록·납부·주문을 하는 곳), 그 원생 이름으로 걸러서
      const r = await one(sql`select student_name, book_name from public.textbook_orders where tenant_id=${t} and id=${id}`);
      return r ? { target: at('billing', { tab: 'textbooks', q: r.student_name }), focus: [r.student_name, r.book_name].filter(Boolean) } : null;
    }
    case 'expense-requests': {
      const hit = await one(sql`select 1 from public.expenses where tenant_id=${t} and id=${id}`);
      return hit ? { target: path('billing', `/billing/expenses/${id}`) } : null;
    }
    case 'video-homework': { // 영상 = 영상 제출 현황, 그 원생 이름으로 걸러서
      const r = await one(sql`select s.name from public.student_homework_videos v join public.students s on s.id=v.student_id and s.tenant_id=v.tenant_id where v.tenant_id=${t} and v.id=${id}
        union all select s.name from public.homework_video_ledger_videos v join public.students s on s.id=v.student_id and s.tenant_id=v.tenant_id where v.tenant_id=${t} and v.id=${id} limit 1`);
      return r ? { target: at('video-homework', { q: r.name }), focus: [r.name] } : null;
    }
    default: return null;
  }
}

export const screen = { id: 'record-open', label: '처리 화면 열기', order: 99,
  params: { family: /^[a-z][a-z-]{1,39}$/, id: UUID },
  async load({ sql, params, tenantId }) {
    if (!params.family || !params.id) return { target: null };
    const out = await resolve(sql, tenantId, params.family, params.id);
    return { target: out?.target ?? null, focus: out?.focus ?? [], expand: out?.expand === true };
  },
};
