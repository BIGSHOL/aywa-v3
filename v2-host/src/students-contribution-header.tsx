import type { ReactNode } from "react";
import { ContributionLink as Link } from "@/features/student-contribution/components/student-contribution-scope";

const tabs = [
  { key: "students", label: "원생 기여도" },
  { key: "ontology", label: "학생 기록 연결" },
  { key: "referrals", label: "지난 소개 확인" },
] as const;

export function ContributionHeader({ studentId, title, description, active, canConfigure, actions }: {
  studentId: string; title: string; description: string; active: typeof tabs[number]["key"];
  canConfigure?: boolean; actions?: ReactNode;
}) {
  return <header className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2"><h1 className="text-xl font-bold tracking-tight">{title}</h1><p className="max-w-3xl text-sm leading-relaxed">{description}</p></div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
    <nav aria-label="원생 기여도 메뉴" className="flex flex-wrap gap-x-5 border-b border-line">
      {tabs.filter((tab) => canConfigure || tab.key !== "referrals").map((tab) => <Link key={tab.key}
        href={tab.key === "students" ? `/student-contribution/${studentId}` : `/student-contribution/${tab.key}`}
        aria-current={active === tab.key ? "page" : undefined}
        className={`border-b-2 px-1 pb-3 text-sm transition-colors focus-visible:outline-primary ${active === tab.key
          ? "border-primary font-bold text-primary" : "border-transparent hover:border-line-strong"}`}>{tab.label}</Link>)}
    </nav>
  </header>;
}
