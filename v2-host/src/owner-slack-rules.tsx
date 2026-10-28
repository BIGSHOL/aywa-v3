// 2.0 슬랙 부품: 미리보기 링크만 현재 연습 화면 주소로 바꾼다.
"use client";

import { useEffect, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_PRESETS, withoutCoveredKeys } from "@/features/slack/role-presets";
import type { ActivityOption } from "@/features/slack/activity-catalog";
import { emptyRule, RULE_PRESETS, SLACK_MAX_RULES, type SlackRule } from "@/features/slack/rules";
import { listSlackChannels } from "@/features/slack/server/connection-actions";
import { Button } from "@/components/ui/button";
import { RuleEditor } from "./owner-slack-rule-editor";
import type { ChannelOption } from "@/app/(shell)/owner/_components/slack/target-picker";

/**
 * 규칙 목록 — 규칙마다 무엇을·어디로·어떻게·언제. 추가는 빈 규칙 또는 프리셋(빈 규칙에서 350종을 고르게 하지 않는다).
 * 채널 목록은 카드가 뜬 뒤 한 번 불러온다(외부 API를 첫 페인트에서 기다리지 않게, [[#76]]).
 */
type Row = { key: string; rule: SlackRule };
let seq = 0;
const newKey = () => `new-${++seq}`;

export function RulesSection({
  initialRules,
  staff,
  activityOptions,
}: {
  initialRules: SlackRule[];
  staff: { id: string; name: string }[];
  activityOptions: ActivityOption[];
}) {
  const [rows, setRows] = useState<Row[]>(() => initialRules.map((r) => ({ key: r.id, rule: r })));
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [channelErr, setChannelErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listSlackChannels().then((r) => {
      if (!alive) return;
      if (r.error) setChannelErr(r.error);
      setChannels(r.channels ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  const add = (rule: SlackRule) => {
    setNote(null);
    setRows((prev) => [...prev, { key: newKey(), rule }]);
  };
  // 역할별 기본 세팅 — 규칙 1~2개를 한꺼번에(원장 2026-09-28). 이미 1:1로 보내는 알림은 빼고(두 번 가지 않게), 한도를 넘는 만큼은 버린다.
  const addMany = (adding: SlackRule[]) => {
    const { rules, dropped } = withoutCoveredKeys(adding, rows.map((r) => r.rule));
    const room = Math.max(0, SLACK_MAX_RULES - rows.length);
    setRows((prev) => [...prev, ...rules.slice(0, room).map((rule) => ({ key: newKey(), rule }))]);
    setNote(
      [
        dropped ? `이미 저장·켜진 다른 규칙이 1:1로 보내는 알림 ${dropped}종은 뺐습니다(같은 알림이 두 번 가지 않게).` : "",
        rules.length > room ? `규칙 한도(${SLACK_MAX_RULES}개)를 넘어 ${rules.length - room}개는 넣지 못했습니다.` : "",
      ]
        .filter(Boolean)
        .join(" ") || null,
    );
  };
  const full = rows.length >= SLACK_MAX_RULES;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-foreground text-sm font-bold">규칙</p>
        <span className="text-text-dim text-xs">규칙마다 무엇을 · 어디로 · 어떻게 · 언제 보낼지 정합니다. 같은 일이 여러 규칙에 걸리면 각각 보냅니다.</span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button disabled={full} className="ml-auto" />}>
            규칙 추가
            <EyIcon name="chevronDown" size={14} className="opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-64">
            <DropdownMenuItem onClick={() => add(emptyRule("activity"))}>빈 규칙 — 활동 기록</DropdownMenuItem>
            <DropdownMenuItem onClick={() => add(emptyRule("notification"))}>빈 규칙 — 알림</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>역할별 기본 세팅</DropdownMenuLabel>
            {ROLE_PRESETS.map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => addMany(p.build(activityOptions))}>
                {p.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>용도별</DropdownMenuLabel>
            {RULE_PRESETS.map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => add(p.build())}>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {note ? <p className="text-text-dim text-xs">{note}</p> : null}
      {channelErr ? <p className="text-danger text-xs">채널 목록을 못 불러왔습니다: {channelErr}</p> : null}
      {rows.length === 0 ? <p className="text-text-dim text-sm">아직 규칙이 없습니다 — &lsquo;규칙 추가&rsquo;에서 프리셋으로 시작해 보세요.</p> : null}
      {rows.length > 0 ? <div className="border-border bg-card divide-line divide-y rounded-xl border">
      {rows.map((row) => (
        <RuleEditor
          key={row.key}
          initial={row.rule}
          channels={channels}
          staff={staff}
          activityOptions={activityOptions}
          onSaved={(saved) => setRows((prev) => prev.map((r) => (r.key === row.key ? { key: row.key, rule: saved } : r)))}
          onDeleted={() => {
            setNote(null);
            setRows((prev) => prev.filter((r) => r.key !== row.key));
          }}
        />
      ))}
      </div> : null}
    </div>
  );
}
