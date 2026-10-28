// 2.0 (print)/enrollment/[id]/print/page.tsx — 조회·브랜딩 해석만 호스트 자료로 바꾼 인수인계서.
import { useEffect } from "react";
import type { ConsultationAudioReport, ConsultationDetail } from "@/features/enrollment/server/queries";
import { RichText } from "@/components/rich-text";
import { normalizeAiListText } from "@/features/enrollment/report-normalize";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";
import type { TenantSettings } from "@/features/owner/settings-types";

// 과목 라벨은 print_payload 스냅샷에 이미 한글로 동결돼 있어 별도 맵이 필요 없다(과목 하드코딩 금지).
export type EnrollmentPrintData = {
  consult: ConsultationDetail & { aiAnalysis: NonNullable<ConsultationDetail['aiAnalysis']> };
  printHeader: string;
  profile: Pick<TenantSettings['profile'], 'name' | 'branchLabel' | 'representativeName' | 'phone' | 'email' | 'address' | 'bizRegNo'>;
  logoSrc: string | null;
  sealSrc: string | null;
  latePolicy: string | null;
};

export function EnrollmentPrintPage({ data }: { data: EnrollmentPrintData }) {
  const { consult, profile, printHeader, logoSrc, sealSrc, latePolicy } = data;
  // 인쇄 전에는 기본 스크롤을 두고, 남은 내용이 있는 방향에만 페이드를 표시한다.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.embed-main');
    const doc = document.querySelector<HTMLElement>('.print-portrait');
    if (!el || !doc) return;
    el.classList.add('scrollbar-hide');
    const update = () => {
      const top = el.scrollTop > 1 ? 14 : 0;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? 14 : 0;
      el.style.maskImage = top || bottom
        ? `linear-gradient(to bottom, ${top ? 'transparent' : 'black'} 0, black ${top}px, black calc(100% - ${bottom}px), ${bottom ? 'transparent' : 'black'} 100%)`
        : '';
    };
    const resize = new ResizeObserver(update);
    resize.observe(el); resize.observe(doc);
    el.addEventListener('scroll', update, { passive: true });
    update();
    return () => { resize.disconnect(); el.removeEventListener('scroll', update); el.classList.remove('scrollbar-hide'); el.style.maskImage = ''; };
  }, [consult.id]);
  const academyName = profile.name || NEUTRAL_ACADEMY_NAME;
  const contactLine = [
    profile.representativeName ? `대표 ${profile.representativeName}` : "",
    profile.phone,
    profile.email,
  ]
    .filter(Boolean)
    .join(" · ");
  const p = consult.aiAnalysis.printPayload;
  // ⚠️ 상담일은 **화면과 똑같은 순서**로 해석한다(enrollment/[id] 상세: f.consultationDate ?? consulted_at).
  //   ① consultation_date = 사람이 편집하는 상담일(date). 이게 진실이다.
  //   ② payload 동결값 — 녹음 경로 payload엔 아예 없고(PrintPayload 주석 참조), 2026-07-23 이전에
  //      만들어진 분석은 여기에 consulted_at(정렬용 레코드 타임스탬프)이 굳어 있다.
  //   ③ 상담 행 타임스탬프 폴백. payload만 믿으면 녹음 경로에서 "Invalid Date"가 찍힌다.
  // ①을 맨 앞에 두는 게 핵심 — 그래야 3월 상담을 7월에 입력한 건도 화면과 인쇄물이 같은 날짜를 말한다.
  const consultedAtRaw = consult.fields.consultationDate ?? p.consultedAt ?? consult.consultedAt;
  const consultedDate = consultedAtRaw
    ? new Date(consultedAtRaw).toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
  const recommendedClasses = p.recommendedClasses ?? [];

  return (
    <>
      <style>{'@media print {.embed-main { height: auto !important; overflow: visible !important; padding: 0 !important; mask-image: none !important; }}'}</style>
      <div className="print-portrait mx-auto max-w-[210mm] bg-white px-12 py-10 text-black print:p-0">
      <PrintActions embedded />

      <header className="border-b-2 border-black/80 pb-4">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- 인쇄물 외부 이미지(최적화 불필요)
          <img src={logoSrc} alt={academyName} className="mb-3 h-12 w-auto object-contain" />
        ) : null}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] tracking-[0.25em] uppercase">
            {printHeader}
          </p>
          <p className="font-mono text-[10px] text-black/60">
            #{consult.id.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">신입생 인수인계서</h1>
        <p className="mt-1 text-sm text-black/70">
          첫 수업 전 담임에게 전달 · 보관용 1부 · 학부모 전달용 1부
        </p>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
        <Row label="학생명" value={p.prospect.name} bold />
        <Row label="학년 · 학교" value={`${p.prospect.grade ?? "—"} · ${p.prospect.school ?? "—"}`} />
        <Row
          label="학부모"
          value={`${p.prospect.parentName ?? "—"} (${p.prospect.parentPhone ?? "—"})`}
        />
        <Row label="상담일" value={consultedDate} />
        <Row label="상담사" value={p.consultantName ?? "—"} />
        {/* 녹음 경로엔 diagnosis가 없다 — 그 경우 이 줄을 빼고 아래 AudioReportSections가 본문을 채운다. */}
        {p.diagnosis ? <Row label="종합 수준" value={p.diagnosis.level} bold /> : null}
      </section>

      <hr className="my-6 border-black/20" />

      <Section title="학부모 요구사항">
        <p className="text-sm leading-relaxed">{p.parentRequest ?? "—"}</p>
      </Section>

      {p.learningHistory ? (
        <Section title="학습 이력">
          <dl className="space-y-1.5 text-sm">
            {p.learningHistory.prevAcademy ? (
              <Detail label="이전 학원" value={p.learningHistory.prevAcademy} />
            ) : null}
            {p.learningHistory.lastScore ? (
              <Detail label="최근 성적" value={p.learningHistory.lastScore} />
            ) : null}
            {p.learningHistory.weakSubjects?.length ? (
              <Detail label="약점 단원" value={p.learningHistory.weakSubjects.join(", ")} />
            ) : null}
          </dl>
        </Section>
      ) : null}

      {(p as unknown as { audioReport?: ConsultationAudioReport }).audioReport ? (
        <AudioReportSections
          report={
            (p as unknown as { audioReport: ConsultationAudioReport }).audioReport
          }
        />
      ) : p.diagnosis && p.learningPlan ? (
        <>
          <Section title="AI 진단 요약">
            <p className="text-sm leading-relaxed">{p.diagnosis.summary}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold tracking-wide uppercase">강점</p>
                <ul className="mt-1 list-disc pl-5">
                  {p.diagnosis.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide uppercase">약점</p>
                <ul className="mt-1 list-disc pl-5">
                  {p.diagnosis.weaknesses.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <Section title="학습 계획">
            <div className="grid grid-cols-3 gap-x-6 text-sm">
              <Plan label="즉시 (4주)" items={p.learningPlan.immediate} />
              <Plan label="이번 학기" items={p.learningPlan.semester} />
              <Plan label="장기" items={p.learningPlan.longTerm} />
            </div>
          </Section>
        </>
      ) : null}

      {recommendedClasses.length > 0 ? (
        <Section title="추천 반">
          <ul className="space-y-1 text-sm">
            {recommendedClasses.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span className="text-black/40">▸</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="담임 메모">
        <div className="border border-black/30">
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8" />
        </div>
      </Section>

      {latePolicy ? (
        <Section title="수납 정책 안내">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{latePolicy}</p>
        </Section>
      ) : null}

      <footer className="mt-10 flex items-end justify-between gap-6 border-t border-black/20 pt-4 text-[10px] text-black/60">
        <div className="flex items-end gap-4">
          {sealSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- 인쇄물 외부 이미지(최적화 불필요)
            <img src={sealSrc} alt="직인" className="size-16 shrink-0 object-contain" />
          ) : null}
          <div className="space-y-0.5">
            <p className="font-semibold text-black/80">
              {academyName}
              {profile.branchLabel ? ` · ${profile.branchLabel}` : ""}
            </p>
            {contactLine ? <p>{contactLine}</p> : null}
            {profile.address ? <p>{profile.address}</p> : null}
            {profile.bizRegNo ? <p>사업자등록번호 {profile.bizRegNo}</p> : null}
          </div>
        </div>
        <p className="shrink-0 text-right font-mono">
          GENERATED{" "}
          {new Date(consult.aiAnalysis.generatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
        </p>
      </footer>
      </div>
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-20 shrink-0 text-xs font-semibold tracking-wide text-black/60 uppercase">
        {label}
      </dt>
      <dd className={`text-sm ${bold ? "font-bold" : ""}`}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // ⚠️ 통짜 break-inside-avoid 금지(인쇄 규약) — AI 리포트 12섹션·수납정책 등 임의 길이 콘텐츠를 감싸므로
    // 섹션 통째 avoid면 페이지 경계에서 다음 장으로 밀려 하단 대공백. 제목 고아만 방지(break-after-avoid).
    <section className="mt-6">
      <h2 className="text-xs font-bold tracking-[0.15em] uppercase break-after-avoid">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-black/60">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AudioReportSections({ report }: { report: ConsultationAudioReport }) {
  // list=나열형 섹션 → 불릿. 웹 상세(enrollment/[id]/page.tsx)와 동일 분류로 인쇄도 같은 형식.
  const sections: { key: keyof ConsultationAudioReport; label: string; list?: boolean }[] = [
    { key: "consultationType", label: "상담 성격" },
    { key: "summary", label: "상담 요약" },
    { key: "familyBackground", label: "가정 배경" },
    { key: "parentConcerns", label: "학부모 걱정", list: true },
    { key: "parentQuestions", label: "학부모 질문", list: true },
    { key: "parentRequests", label: "학부모 요청", list: true },
    { key: "parentSatisfaction", label: "학부모 만족도" },
    { key: "studentTraits", label: "학생 특이사항", list: true },
    { key: "teacherResponse", label: "상담자 대응", list: true },
    { key: "salesPoints", label: "상담사 세일즈 포인트", list: true },
    { key: "agreements", label: "합의 사항", list: true },
    { key: "followUps", label: "후속 조치", list: true },
    { key: "warnings", label: "주의 신호", list: true },
  ];
  return (
    <>
      {sections.map(({ key, label, list }) => {
        const body = report[key];
        if (typeof body !== "string" || !body.trim()) return null;
        // 리스트 섹션 후보정. 단일 항목 병합 시 bulletize를 꺼 콤마분할(병합 되돌림) 회피.
        const normalized = list ? normalizeAiListText(body) : body;
        const asList = !!list && normalized.includes("\n");
        return (
          <Section key={key} title={label}>
            <RichText text={normalized} bulletize={asList} className="space-y-1 text-sm leading-relaxed" />
          </Section>
        );
      })}
      {report.conversationFlow && report.conversationFlow.length > 0 ? (
        <Section title="상담 흐름 수형도">
          <ul className="space-y-1 text-sm leading-relaxed">
            {flattenFlow(report.conversationFlow).map((n, i) => (
              <li key={i} style={{ paddingLeft: `${n.depth * 14}px` }}>
                <span className="font-semibold">{n.topic}</span>
                {n.summary ? <span className="text-gray-600"> — {n.summary}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/** 수형도 트리 → 깊이 있는 평면 목록(인쇄용, 순수). */
function flattenFlow(
  nodes: NonNullable<ConsultationAudioReport["conversationFlow"]>,
  depth = 0,
  out: { topic: string; summary: string; depth: number }[] = [],
): { topic: string; summary: string; depth: number }[] {
  for (const n of nodes) {
    out.push({ topic: n.topic, summary: n.summary, depth });
    if (n.children && n.children.length > 0) flattenFlow(n.children, depth + 1, out);
  }
  return out;
}

function Plan({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide uppercase">{label}</p>
      <ul className="mt-1 list-disc pl-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
