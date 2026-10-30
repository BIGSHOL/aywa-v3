// 2.0 슬랙 부품: 미리보기 링크만 현재 연습 자료 주소로 바꾼다.
"use client";

import type { ReactNode } from "react";
import type { ActivityOption } from "@/features/slack/activity-catalog";
import { renderActivity, renderNotification } from "@/features/slack/render";
import type { SlackRule } from "@/features/slack/rules";
import { moneyFacts } from "@/features/slack/money-facts";
import { SAMPLE_ACTIVITY_FACTS, SAMPLE_EXPENSE_META, SAMPLE_NOTIFICATIONS, SAMPLE_RECIPIENTS } from "@/features/slack/samples";

/**
 * 규칙 미리보기 — **실제 발송과 같은 조립 함수**(render.ts)로 가상 데이터를 조립해 슬랙 말풍선처럼 보여 준다.
 * 형식(짧게/자세히)·호출·멘션을 바꾸면 바로 바뀐다. 슬랙 서식 중 쓰는 것만 옮긴다: `*굵게*` · `_기울임_` · `>인용 줄` · `<url|글자>` · `<@U…>` · `<!here>`.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*[^*\n]+\*)|<(https?:[^|>]+)\|([^>]+)>|<@([A-Z0-9]+)>|<!(here|channel)>|(?:^|(?<=\s))_([^_\n]+)_(?=\s|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(unescape(text.slice(last, m.index)));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<strong key={k}>{unescape(m[1].slice(1, -1))}</strong>);
    else if (m[3]) out.push(<span key={k} className="text-primary">{unescape(m[3])}</span>);
    else if (m[4]) out.push(<span key={k} className="bg-primary-soft text-primary rounded px-0.5">@박지현</span>);
    else if (m[5]) out.push(<span key={k} className="bg-amber-soft text-foreground rounded px-0.5 font-medium">@{m[5]}</span>);
    else if (m[6]) out.push(<em key={k} className="text-text-dim">{unescape(m[6])}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(unescape(text.slice(last)));
  return out;
}
/** 고정 예시 시각 — `new Date()`면 서버·브라우저 렌더가 분 경계에서 갈려 하이드레이션이 깨진다([[#108]]). */
const SAMPLE_AT = new Date("2026-09-28T15:37:00+09:00");
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function MessagePreview({ rule, activityOptions }: { rule: SlackRule; activityOptions: ActivityOption[] }) {
  const style = { template: rule.template, appUrl: window.location.origin, ping: rule.ping };
  const key = rule.typeKeys[0];
  let body: string;
  if (!key) body = "";
  else if (rule.source === "notification") {
    const s = SAMPLE_NOTIFICATIONS[key] ?? { title: "알림", body: "", link: "/" };
    const who = rule.mentionRecipients ? ["<@U000PREVIEW>"] : rule.template === "detailed" ? SAMPLE_RECIPIENTS : [];
    body = renderNotification({ type: key, title: s.title, body: s.body, link: s.link, createdAt: SAMPLE_AT }, style, who).body;
  } else {
    const o = activityOptions.find((a) => a.key === key);
    body = renderActivity(
      {
        label: o?.label ?? "활동",
        opaque: o?.grade === "opaque",
        targetLabel: null,
        category: o?.category,
        facts: SAMPLE_ACTIVITY_FACTS,
        // 실제 발송과 같게 — 지출결의서는 분류·지출일·금액이 붙는다(다른 돈 계열은 undefined).
        moneyFacts: o?.grade === "opaque" ? moneyFacts(key, SAMPLE_EXPENSE_META) : undefined,
        actorName: "박지현",
        createdAt: SAMPLE_AT,
      },
      style,
    ).body;
  }

  return (
    <div className="border-line bg-card rounded-xl border p-3">
      <p className="text-text-dim mb-2 text-xs">미리보기 · 가상 데이터{rule.typeKeys.length > 1 ? ` · 고른 ${rule.typeKeys.length}종 중 첫 번째` : ""}</p>
      {body ? (
        <div className="flex gap-2.5">
          <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-bold">a</div>
          <div className="text-foreground min-w-0 text-sm leading-relaxed">
            <p>
              <strong>aywa</strong>
              <span className="bg-bg-soft text-text-dim ml-1.5 rounded px-1 text-xs">앱</span>
            </p>
            {body.split("\n").map((line, i) =>
              line.startsWith(">") ? (
                <p key={i} className="text-text-dim break-words pl-3">
                  {inline(line.slice(1), String(i))}
                </p>
              ) : (
                <p key={i} className="break-words">
                  {inline(line, String(i))}
                </p>
              ),
            )}
            {rule.timing === "digest" ? <p className="text-text-dim mt-1 text-xs">요약으로만 — 모아 두었다가 정한 시각에 한 통으로 보냅니다.</p> : null}
          </div>
        </div>
      ) : (
        <p className="text-text-faint text-sm">보낼 것을 고르면 여기에 실제 모양이 보입니다.</p>
      )}
    </div>
  );
}
