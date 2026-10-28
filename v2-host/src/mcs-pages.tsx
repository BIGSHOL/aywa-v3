// 2.0 강사 시트 · 수학(MCS) 반별(app/(shell)/mcs/page.tsx) · 선생님별(app/(shell)/mcs/teachers/page.tsx)의 조립 — 서버 컴포넌트라 그대로
// 못 불러와서, 서버가 하던 조회는 /api/v2/mcs(Docker 복사본, v2-screen-mcs.mjs)가 하고 여기서는 두 page.tsx의 본문을 **글자 그대로** 옮겼다
// (조회 결과 res · previewProgressMap을 받는 자리만 다르다 — verify-v2-screen-mcs.mjs가 글자를 대조한다).
import { EmbedLink } from "@/components/embed-link";
import { PeriodNav } from "@/components/period-nav";
import { shiftMonth, kstMonth } from "@/lib/date-kst";
import type { MathLandingResult, MathClassCard } from "@/features/math-sheets/server/landing";
import type { TeacherGroup, TeacherStudentRow } from "@/features/math-sheets/server/teacher-roster";
import { groupMathCardsByTeacher, splitLandingByTrack } from "@/features/math-sheets/landing-tracks";
import { McsViewSwitch } from "@/features/math-sheets/components/mcs-view-switch";
import { roadmapStatusLabel } from "@/features/math-sheets/lib/roadmap-status";
import { averageProgress } from "@/features/math-sheets/lib/teacher-average";
import landingStyles from "@/app/(shell)/mcs/landing.module.css";
import teacherStyles from "@/app/(shell)/mcs/teachers/teachers.module.css";

const EMPTY_TEXT: Record<string, string> = {
  "no-classes": "활성 수학 반이 없습니다.",
  "no-scoped-classes": "담당하는 수학 반이 없습니다.",
  "no-month-classes": "이 달에 수업이 있는 수학 반이 없습니다.",
};

/** mcs/page.tsx `McsLandingPage`의 그리기 — 서버 조회 결과를 받는다. */
export function McsLandingPage({ res, previewProgressMap }: { res: MathLandingResult; previewProgressMap: boolean }) {
  const styles = landingStyles;
  if (!res.ok) return <div className={styles.surface}><header className={styles.heading}><h2>수학 강사 시트</h2></header><p className={styles.empty}>{res.error}</p></div>;
  const { data } = res;
  const thisMonth = kstMonth();
  const hrefFor = (value: string) => `/mcs?month=${value}`;
  const panels = splitLandingByTrack(data.cards);
  const written = data.cards.reduce((sum, card) => sum + card.written, 0);
  const shown = data.cards.reduce((sum, card) => sum + card.shown, 0);
  const pct = shown ? Math.round(written / shown * 100) : null;
  return (
    <div className={styles.surface}>
      <header className={styles.heading}>
        <div><h2>수학 강사 시트</h2><p>반별 수업 기록과 학생 진도를 한곳에서 확인하세요.</p></div>
        <div className={styles.headingTools}><McsViewSwitch active="classes" />
        <PeriodNav label={data.monthLabel} prevHref={hrefFor(shiftMonth(data.month, -1))} nextHref={hrefFor(shiftMonth(data.month, 1))} currentHref={hrefFor(thisMonth)} relation={data.month === thisMonth ? "current" : data.month < thisMonth ? "past" : "future"} prevAriaLabel="이전 달" nextAriaLabel="다음 달" currentTitle="눌러서 이번 달로" /></div>
      </header>
      <div className={styles.summary}>
        <div className={styles.summaryCount}><span>이번 달 수업</span><strong>{data.cards.length}<small>개 반</small></strong></div>
        <div className={styles.summaryProgress}>
          <div><span>전체 기록 작성률</span><strong data-complete={pct === 100 || undefined}>{pct == null ? "—" : `${pct}%`}</strong></div>
          {pct != null ? <><Progress value={pct} label="전체 기록 작성률" /><small>{written.toLocaleString()} / {shown.toLocaleString()}건 작성</small></> : <small>아직 작성 대상 기록이 없습니다.</small>}
        </div>
        <div className={styles.summaryAction}>
          <p>반을 선택하면<br /> 학생별 진도와 목표가 열립니다.</p>
          {previewProgressMap ? <EmbedLink href="/mcs/progress-map">진도맵(시안) <span aria-hidden>↗</span></EmbedLink> : null}
        </div>
      </div>
      {data.emptyReason ? <p className={styles.empty}>{EMPTY_TEXT[data.emptyReason] ?? "표시할 반이 없습니다."}</p> : (
        <div className={panels ? styles.panels : styles.singlePanel}>
          {(panels ?? [{ key: data.cards[0]?.isSpecial ? "special" : "regular", label: data.cards[0]?.isSpecial ? "특강" : "정규", cards: data.cards }]).map((panel) => (
            <section key={panel.key} className={styles.panel}>
              <header className={styles.panelHeading}><h3>{panel.label}<span>{panel.cards.length}반</span></h3><WrittenSummary cards={panel.cards} /></header>
              <div className={styles.teacherGroups}>
                {groupMathCardsByTeacher(panel.cards).map((group) => (
                  <section key={group.teacherName} className={styles.teacherGroup}>
                    <header className={styles.teacherHeading}><h4>{group.teacherName}</h4><span>{group.cards.length}개 반</span></header>
                    <div className={styles.rows}>
                      {group.cards.map((card) => (
                        <EmbedLink key={card.classId} href={`/mcs/${card.classId}/month?month=${data.month}`} className={styles.row}>
                          <span className={styles.classInfo}>
                            <strong title={card.className}>{card.className}</strong>
                            <span title={card.extraTitle ?? undefined}>수업 {card.dayCount}일 <i>·</i> 학생 {card.studentCount}명{card.extraCount > 0 ? ` +${card.extraCount}` : ""}<i>·</i>{card.learningTrack === "supplement" ? "복습 심화" : "정규 진도"}</span>
                          </span>
                          <span className={styles.writing}>
                            {card.elapsedDays === 0 ? <span className={styles.noRecords}>아직 수업 전</span> : card.shown === 0 ? <span className={styles.noRecords}>출결 기록 없음</span> : (
                              <><span className={styles.writingLabel}><span>{card.written}/{card.shown} <small>작성</small></span><b data-complete={card.pct === 100 || undefined}>{card.pct}%</b></span><Progress value={card.pct} label={`${card.className} 기록 작성률`} /></>
                            )}
                          </span>
                          <span className={styles.arrow} aria-hidden>›</span>
                        </EmbedLink>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = landingStyles;
function Progress({ value, label }: { value: number; label: string }) {
  return <span className={styles.progress} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span data-complete={value === 100 || undefined} style={{ width: `${value}%` }} /></span>;
}
function WrittenSummary({ cards }: { cards: readonly MathClassCard[] }) {
  const written = cards.reduce((sum, card) => sum + card.written, 0), shown = cards.reduce((sum, card) => sum + card.shown, 0);
  if (!shown) return null;
  return <span className={styles.panelSummary}>{written}/{shown}건 <b>{Math.round(written / shown * 100)}%</b></span>;
}

// ── mcs/teachers/page.tsx ─────────────────────────────────────────────────────────────────────────────────────────────
/** mcs/teachers/page.tsx `McsTeachersPage`의 그리기 — 서버 조회 결과를 받는다. */
export function McsTeachersPage({ res }: { res: { ok: true; groups: TeacherGroup[]; today: string } | { ok: false; error: string } }) {
  const styles = teacherStyles;
  return (
    <div className={styles.surface}>
      <header className={styles.heading}>
        <div>
          <h2>수학 강사 시트 · 선생님별</h2>
          <p>선생님이 맡은 학생과 교재 3개월 진행입니다. 학생을 누르면 상세가 열립니다.</p>
        </div>
        <McsViewSwitch active="teachers" />
      </header>
      {!res.ok ? (
        <p className={styles.empty}>{res.error}</p>
      ) : res.groups.length === 0 ? (
        <p className={styles.empty}>담당하는 수학 반 학생이 없습니다.</p>
      ) : (
        <>
          <Average label="전체 평균" students={res.groups.flatMap((g) => g.students)} />
          {/* 선생님이 많아 처음엔 **접어 둔다**(원장 *"접기기능으로 휠 안내려도 다른쌤 볼수있도록"*) — 머리 줄만으로
              이름·학생 수·평균이 보이고, 누르면 학생 목록이 펼쳐진다. */}
          <div className={styles.groups}>
            {res.groups.map((g) => (
              <details key={g.teacherName} className={styles.group}>
                <summary>
                  <h3>{g.teacherName}</h3>
                  <span>학생 {g.students.length}명</span>
                  <Average students={g.students} />
                  <i aria-hidden>›</i>
                </summary>
                <ul>
                  {g.students.map((s) => <Row key={s.studentId} s={s} />)}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 평균 진행률(3개월 기준) — 진도를 읽은 학생만으로 낸 평균이라 몇 명 기준인지 같이 적는다. */
function Average({ students, label }: { students: readonly TeacherStudentRow[]; label?: string }) {
  const styles = teacherStyles;
  const { pct, counted } = averageProgress(students);
  return (
    <span className={label ? styles.total : styles.avg} title={pct == null ? "진도를 읽은 학생이 없습니다" : `진도를 읽은 ${counted}명의 3개월 진행률 평균`}>
      {label ? <small>{label}</small> : null}
      <b>{pct == null ? "—" : `${pct}%`}</b>
      {pct == null ? null : <small>{counted}명 기준</small>}
      {pct == null ? null : <span className={styles.bar}><i style={{ width: `${pct}%` }} /></span>}
    </span>
  );
}

function Row({ s }: { s: TeacherStudentRow }) {
  const styles = teacherStyles;
  const w = s.window;
  const pct = w && w.done != null ? Math.round((w.done / Math.max(1, w.total)) * 100) : null;
  return (
    <li>
      <EmbedLink href={`/mcs/${s.classId}/month?student=${s.studentId}`} className={styles.row}>
        <span className={styles.who}>
          <strong>{s.name}{s.bookName ? <em className={styles.bookName}>{s.bookName}</em> : null}</strong>
          <small>{[s.school, s.grade].filter(Boolean).join(" ")} · {s.className}</small>
        </span>
        {w ? (
          <span className={styles.book} title={w.name}>
            <span className={styles.count}><b>{w.done ?? "—"}</b>/{w.total}차시<small>3개월 기준</small></span>
            <span className={styles.bar}><i style={{ width: `${pct ?? 0}%` }} /></span>
          </span>
        ) : (
          <span className={styles.none}>교재 주문 기록 없음</span>
        )}
        <span className={styles.status} data-tone={s.status ?? undefined}>
          {s.status ? roadmapStatusLabel({ status: s.status, difference: s.difference }) : "—"}
        </span>
        <span className={styles.arrow} aria-hidden>›</span>
      </EmbedLink>
    </li>
  );
}
