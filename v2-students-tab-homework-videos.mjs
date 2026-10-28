// 원생 상세 '숙제 영상' 탭 자료 — 2.0 homework-videos-tab.tsx(HomeworkVideosTab) · homework-video-links.tsx(HomeworkVideoLinks)가 서버에서 읽던 값을 Docker 복사본에서.
// · videos = getStudentHomeworkVideos — 영상 원장 뷰(homework_video_ledger_videos — 없으면 student_homework_videos) · 게시 시각 내림차순(빈 값 뒤) + id ·
//   2.0 dedupeHomeworkVideos(같은 영상 두 줄 접기). 🔴 연습 화면은 영상을 재생하지 않는다 — Drive 파일 번호를 비워 보낸다(재생 단추가 서지 않고
//   Drive 미리보기·썸네일 주소를 부르지 않는다 · 목록·상태·출처는 그대로).
// · uploadLog = getStudentUploadLog — 최근 30일(기준 = 복사본을 뜬 순간) · 30건 · 그 학생 링크의 업로드 시도. 진단 칸은 2.0 readUploadDiagnostics.
// · links = HomeworkVideoLinks의 loadRows — 지금 다니는 반 중 살아 있는 제출 링크(끊지 않음 · 만료 전 · 보고서 링크는 그 보고서가 그대로일 때만)가 있는 반.
//   올리기 사이트 주소(siteUrl)는 운영 주소라 싣지 않는다 · 쓸 수 있는 학원 판정은 ClassNote 스위치와 표 유무까지(Drive 연결은 비밀값이라 보지 않는다).
// 읽기 전용 · 바깥 호출 없음.
import { createHash } from 'node:crypto';

const MODULES = { videos: 'features/students/homework-videos.ts', diag: 'features/video-submit/upload-diagnostics.ts', gate: 'features/owner/classnote-gate.ts',
  elig: 'features/enrollments/eligibility.ts', dk: 'lib/date-kst.ts' };
let modsP = null;
const mods = (load) => (modsP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries).catch((e) => { modsP = null; throw e; }));

const exists = async (sql, name) => (await sql`select to_regclass(${`public.${name}`}) is not null yes`)[0].yes;

/** getStudentHomeworkVideos — { ready, rows }(rows = HomeworkVideo · 연습 화면은 drive_file_id를 비운다). */
export async function readHomeworkVideos(sql, t, id, M) {
  const source = (await exists(sql, 'homework_video_ledger_videos')) ? 'homework_video_ledger_videos' : (await exists(sql, 'student_homework_videos')) ? 'student_homework_videos' : null;
  if (!source) return { ready: false, rows: [] };
  const cols = sql.frag`id::text id, subject, to_json(posted_at)#>>'{}' posted_at, to_json(created_at)#>>'{}' created_at, comment_id::float8 comment_id,
      status, drive_file_id, bytes::float8 bytes, to_json(uploaded_at)#>>'{}' uploaded_at, md5, source`;
  const rows = source === 'homework_video_ledger_videos'
    ? await sql`select ${cols} from public.homework_video_ledger_videos where tenant_id=${t} and student_id=${id} order by posted_at desc nulls last, id`
    : await sql`select ${cols} from public.student_homework_videos where tenant_id=${t} and student_id=${id} order by posted_at desc nulls last, id`;
  // 연습 화면 = 재생 없음 — 파일 번호를 비워 보낸다(접기는 원래 값으로 끝낸 뒤).
  return { ready: true, rows: M.videos.dedupeHomeworkVideos(rows).map((r) => ({ ...r, drive_file_id: null })) };
}

/** getStudentUploadLog — { ready, rows }(HomeworkUploadAttempt). 표가 없거나 못 읽으면 ready=false(2.0과 같다). */
export async function readUploadLog(sql, t, id, M, at) {
  const since = new Date(at.getTime() - 30 * 86_400_000);
  const rows = await sql.soft((sp) => sp`select u.id::text id, to_json(u.created_at)#>>'{}' created_at, to_json(u.completed_at)#>>'{}' completed_at, u.status, u.video_id::text video_id,
      u.bytes::float8 bytes, u.route->>'homeworkDate' homework_date, u.client_diagnostics, c.class_name
    from public.homework_video_link_uploads u join public.homework_video_links l on l.id = u.link_id
      left join public.classes c on c.id = l.class_id
    where u.tenant_id=${t} and l.student_id=${id} and u.created_at >= ${since} order by u.created_at desc limit 30`, null);
  if (!rows) return { ready: false, rows: [] };
  return { ready: true, rows: rows.map((r) => ({ id: r.id, createdAt: r.created_at, completedAt: r.completed_at, status: r.status, hasVideo: !!r.video_id,
    bytes: Number(r.bytes), className: r.class_name ?? '반 정보 없음', homeworkDate: r.homework_date, diagnostics: M.diag.readUploadDiagnostics(r.client_diagnostics) })) };
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex'); // 2.0 hashSubmitToken

/** HomeworkVideoLinks의 loadRows — { rows, siteUrl } 또는 null(쓸 수 없는 학원 · 조회 실패 — 이 구역만 빠진다). */
export async function readLinkRows(base, sql, t, id, M, today, at, enrollments) {
  if (!M.gate.classnoteModuleOn(base.settings)) return null;
  try {
    // videoSubmitSchemaReady — 링크 표 · 업로드 표 · 영상 출처 칸.
    const [ready] = await sql`select to_regclass('public.homework_video_links') is not null and to_regclass('public.homework_video_link_uploads') is not null
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='student_homework_videos' and column_name='source_ref') yes`;
    if (!ready.yes) return null;
    // activeLinkSummary — 끊지 않았고 아직 안 끝난 링크(만료가 늦은 순 · 200) · 보고서 링크는 그 보고서가 그대로일 때만.
    const links = await sql`select l.id::text id, l.class_id::text class_id, l.origin, l.report_id::text report_id, l.report_share_hash, to_json(l.expires_at)#>>'{}' expires_at,
        r.share_token, r.revoked_at is not null report_revoked, r.classnote_status, r.id is not null report_found
      from public.homework_video_links l left join public.lesson_reports r on r.id = l.report_id and r.tenant_id = ${t}
      where l.tenant_id=${t} and l.student_id=${id} and l.revoked_at is null and l.expires_at > ${at} order by l.expires_at desc limit 200`;
    const stands = (l) => l.origin !== 'report' || (!!l.report_id && !!l.report_share_hash && l.report_found && !l.report_revoked
      && !String(l.classnote_status ?? '').startsWith('recall') && typeof l.share_token === 'string' && sha256(l.share_token) === l.report_share_hash);
    const summary = new Map();
    for (const l of links.filter(stands)) {
      const prev = summary.get(l.class_id);
      summary.set(l.class_id, { count: (prev?.count ?? 0) + 1, lastExpiresAt: prev?.lastExpiresAt ?? l.expires_at });
    }
    const rows = new Map();
    for (const e of enrollments) {
      if (!e.classId || rows.has(e.classId) || M.elig.isEnrollmentEndedOn(e.endDate, today, e.isTransferred)) continue;
      const active = summary.get(e.classId);
      if (!active?.count) continue;
      const until = M.dk.formatShortKoreanDate(M.dk.kstDateOf(new Date(Date.parse(active.lastExpiresAt) - 1)) ?? '');
      rows.set(e.classId, { classId: e.classId, className: e.className, count: active.count, until });
    }
    return { rows: [...rows.values()], siteUrl: null };
  } catch (error) {
    console.warn(`[원생 상세] 숙제 영상 링크 구역: ${error?.message ?? error}`);
    return null;
  }
}

export async function loadTab(ctx) {
  const { base, sql, t, id, today } = ctx;
  const M = await mods(ctx.importV2), at = base.clock.at;
  const enrollments = await ctx.readStudentEnrollments(base, id);
  return {
    videos: await readHomeworkVideos(sql, t, id, M),
    uploadLog: await readUploadLog(sql, t, id, M, at),
    links: await readLinkRows(base, sql, t, id, M, today, at, enrollments),
    settings: { operations: { subjects: ctx.settings.operations.subjects } },
  };
}
