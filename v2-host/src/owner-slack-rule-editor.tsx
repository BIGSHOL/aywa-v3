// 2.0 슬랙 부품: 미리보기 링크만 현재 연습 화면 주소로 바꾼다.
"use client";

import { useId, useState, useTransition } from "react";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { ACTIVITY_CATEGORIES, type ActivityOption } from "@/features/slack/activity-catalog";
import { FORWARD_EVENT_OPTIONS } from "@/features/slack/events";
import { targetLabel, type SlackRule } from "@/features/slack/rules";
import { EyIcon } from "@/components/icons/aywa-icons";
import { deleteSlackRule, saveSlackRule, sendSlackRuleSample } from "@/features/slack/server/rule-actions";
import { ChipField } from "@/app/(shell)/owner/_components/slack/chip-field";
import { MessagePreview } from "./owner-slack-message-preview";
import { ActorRow, Row, RuleOptions } from "@/app/(shell)/owner/_components/slack/rule-options";
import { TargetPicker, type ChannelOption } from "@/app/(shell)/owner/_components/slack/target-picker";

/**
 * 규칙 한 줄 — 접힌 줄 = 켜기 · 이름 · 종류 · 요약(무엇을 N종 · 어디로 · 언제), 누르면 그 자리에서 편집 칸이 펼쳐진다
 * (원장 2026-09-28 *"슬랙 규칙을 게시판화 시켜서 너무 크게 보드처럼 보이지 않게. 깔끔하게."*).
 * 펼친 칸 = 이름·보낼 거리 · 무엇을 · 누가 · 어디로 · 모양 · 언제 · 빼기 · 미리보기 · 저장/샘플/삭제. 새 규칙은 펼친 채로 시작한다.
 * 접힌 줄의 켜기 스위치는 **바로 저장**한다(편집 칸을 열지 않고 끄고 켜게) — 저장 안 된 변경이 있으면 편집 칸에서 함께 저장.
 */
const NOTIF_GROUPS = [...new Set(FORWARD_EVENT_OPTIONS.map((o) => o.group))].map((g) => ({ id: g, label: g }));
const NOTIF_OPTIONS = FORWARD_EVENT_OPTIONS.map((o) => ({ key: o.type, label: o.label, group: o.group }));

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-60 ${on ? "bg-primary" : "bg-line-strong"}`}
    >
      <span className={`size-5 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

type Props = {
  initial: SlackRule;
  channels: ChannelOption[];
  staff: { id: string; name: string }[];
  activityOptions: ActivityOption[];
  onSaved: (rule: SlackRule) => void;
  onDeleted: () => void;
};

export function RuleEditor({ initial, channels, staff, activityOptions, onSaved, onDeleted }: Props) {
  const [rule, setRule] = useState(initial);
  const [open, setOpen] = useState(!initial.id);
  const bodyId = useId();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const patch = (p: Partial<SlackRule>) => setRule((r) => ({ ...r, ...p }));
  const dirty = JSON.stringify(rule) !== JSON.stringify(initial);

  const run = (fn: () => Promise<{ error?: string; message?: string; rule?: SlackRule }>, after?: (r?: SlackRule) => void) => {
    if (pending) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.message) setMsg(res.message);
      if (res.error) setErr(res.error);
      else after?.(res.rule);
    });
  };
  const save = () =>
    run(
      () => saveSlackRule(rule),
      (r) => {
        if (!r) return;
        setRule(r);
        onSaved(r);
      },
    );
  const remove = () => {
    if (!rule.id) return onDeleted();
    if (window.confirm(`'${rule.name}' 규칙을 지울까요? 대기 중인 발송도 취소됩니다.`)) run(() => deleteSlackRule(rule.id, rule.name), () => onDeleted());
  };

  // 접힌 줄에서 켜고 끄기 = 바로 저장(편집 중이면 값만 바꾸고 아래 '저장'으로).
  const toggle = (v: boolean) => {
    if (open || dirty || !rule.id) return patch({ enabled: v });
    run(
      () => saveSlackRule({ ...rule, enabled: v }),
      (r) => {
        if (!r) return;
        setRule(r);
        onSaved(r);
      },
    );
  };

  const isNotif = rule.source === "notification";
  const groups = isNotif ? NOTIF_GROUPS : ACTIVITY_CATEGORIES;
  const options = isNotif ? NOTIF_OPTIONS : activityOptions.map((o) => ({ key: o.key, label: o.label, group: o.category, locked: o.grade === "forbid" }));
  const labelOf = new Map(options.map((o) => [o.key, o.label]));

  const summary = [
    rule.typeKeys.length ? `${isNotif ? "알림" : "활동"} ${rule.typeKeys.length}종` : "고른 것 없음",
    ...(rule.actorIds.length ? [`누가 ${rule.actorIds.length}명`] : []),
    rule.targets.length ? rule.targets.map(targetLabel).join(", ") : "보낼 곳 없음",
    // 방해금지는 '바로' 보낼 때만 적용된다(expand.ts `quiet = honorDnd && immediate`).
    rule.timing === "digest" ? `요약으로${rule.digestAt ? ` ${rule.digestAt}` : ""}` : `바로${rule.honorDnd ? " · 방해금지 지킴" : ""}`,
  ].join(" · ");

  return (
    <section aria-label={`슬랙 규칙 ${rule.name}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Switch on={rule.enabled} onChange={toggle} label={`${rule.name} 켜기`} disabled={pending && !open} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending && !open}
          aria-expanded={open}
          aria-controls={bodyId}
          className="hover:bg-bg-soft/60 flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1 text-left"
        >
          <span className={`shrink-0 text-sm font-bold ${rule.enabled ? "text-foreground" : "text-text-dim"}`}>{rule.name || "(이름 없음)"}</span>
          <span className="bg-bg-soft text-text-dim shrink-0 rounded-full px-2 py-0.5 text-xs">{isNotif ? "알림" : "활동 기록"}</span>
          <span className="text-text-dim min-w-0 truncate text-sm">{summary}</span>
          {dirty || !rule.id ? <span className="text-amber shrink-0 text-xs font-medium">{rule.id ? "저장 안 됨" : "새 규칙 · 저장 전"}</span> : null}
          <EyIcon name="chevronDown" size={14} className={`ml-auto shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {!open && (msg || err) ? (
        <p className={`px-4 pb-2 text-sm ${err ? "text-danger" : "text-primary"}`}>{err ?? msg}</p>
      ) : null}
      {open ? <div id={bodyId} className="bg-bg-soft/30 border-line border-t">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <input
          value={rule.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-label="규칙 이름"
          className="text-foreground border-line bg-card min-w-40 flex-1 rounded-lg border px-2 py-1 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {!rule.id ? (
          <ToolbarSegment label="보낼 거리">
            {(["activity", "notification"] as const).map((s) => (
              <ToolbarSegmentItem
                key={s}
                active={rule.source === s}
                onClick={() => patch({ source: s, typeKeys: [], mentionRecipients: false, targets: rule.targets.filter((t) => t.kind !== "recipient_dm") })}
              >
                {s === "activity" ? "활동 기록" : "알림"}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : null}
      </div>

      <div className="space-y-3 px-4 py-3">
        <Row label="무엇을">
          <ChipField
            items={rule.typeKeys.map((k) => ({ key: k, label: labelOf.get(k) ?? k }))}
            onRemove={(k) => patch({ typeKeys: rule.typeKeys.filter((x) => x !== k) })}
            empty="아직 고르지 않음"
            addLabel={isNotif ? "알림 고르기" : "활동 고르기"}
            picker={{
              title: isNotif ? "보낼 알림" : "보낼 활동 기록",
              description: isNotif
                ? "에이와 알림 벨에 뜨는 것과 같은 알림입니다."
                : "에이와에서 누가 무엇을 했는지(감사로그). 급여·이력서·근로계약·비밀번호는 보낼 수 없고, 돈 관련은 누가·무엇을만 보냅니다.",
              groups,
              options,
              picked: rule.typeKeys,
              onApply: (keys) => patch({ typeKeys: keys }),
            }}
          />
        </Row>
        <ActorRow rule={rule} patch={patch} staff={staff} />
        <Row label="어디로">
          <TargetPicker targets={rule.targets} onChange={(t) => patch({ targets: t })} channels={channels} staff={staff} allowRecipient={isNotif} />
        </Row>
        <RuleOptions rule={rule} patch={patch} staff={staff} />
        <MessagePreview rule={rule} activityOptions={activityOptions} />
      </div>

      <footer className="border-line flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        {dirty ? <span className="text-amber text-sm font-medium">저장 안 된 변경</span> : null}
        {msg ? <span className="text-primary text-sm">{msg}</span> : null}
        {err ? <span className="text-danger text-sm">{err}</span> : null}
        <Button variant="ghost" className="ml-auto" onClick={remove} disabled={pending}>
          삭제
        </Button>
        <Button
          variant="outline"
          onClick={() => (dirty ? setErr("바꾼 내용을 먼저 저장해 주세요 — 샘플은 저장된 규칙으로 보냅니다") : run(() => sendSlackRuleSample(rule.id)))}
          disabled={pending || !rule.id}
          title="고른 것 앞 3개를 실제 모양 + 가상 데이터로(1:1 대상은 나에게만)"
        >
          샘플 보내기
        </Button>
        <Button onClick={save} disabled={pending || (!dirty && !!rule.id)}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          저장
        </Button>
      </footer>
      </div> : null}
    </section>
  );
}
