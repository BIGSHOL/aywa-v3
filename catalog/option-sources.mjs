// 카탈로그 필드 선택지의 출처 — 2.0 코드의 열거값을 TS AST로 그대로 읽는다(값·라벨을 손으로 적지 않는다).
// kind: record(키 → 라벨 문자열) · recordLabel(키 → { label }) · array(문자열 배열, 값 = 라벨) · objects(객체 배열의 valueKey·labelKey).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { repoRoot } from './scan-source.mjs';

const require = createRequire(join(repoRoot, 'package.json'));
const ts = require('typescript');

export const OPTION_SOURCES = {
  attendanceStatus: { file: 'src/features/attendance/intake/absence-intake.ts', name: 'ATTENDANCE_STATUS_LABEL', kind: 'record' },
  enrollmentOutcome: { file: 'src/features/enrollment/server/queries.ts', name: 'OUTCOME_LABEL', kind: 'record' },
  consultationPath: { file: 'src/features/enrollment/form-config.ts', name: 'CONSULTATION_PATHS', kind: 'array' },
  consultationCategory: { file: 'src/features/consultations/labels.ts', name: 'CONSULTATION_CATEGORY_LABEL', kind: 'record' },
  consultationAudience: { file: 'src/features/consultations/labels.ts', name: 'CONSULTATION_AUDIENCE_LABEL', kind: 'record' },
  withdrawalReason: { file: 'src/features/withdrawals/types.ts', name: 'REASON_LABEL', kind: 'record' },
  leaveType: { file: 'src/features/payroll/server/actions.ts', name: 'LEAVE_TYPES', kind: 'array' },
  approvalForm: { file: 'src/features/approvals/types.ts', name: 'APPROVAL_FORM_LABEL', kind: 'record' },
  expenseCategory: { file: 'src/features/approvals/types.ts', name: 'EXPENSE_CATEGORIES', kind: 'array' },
  incomeCategory: { file: 'src/features/approvals/types.ts', name: 'INCOME_CATEGORIES', kind: 'array' },
  assetStatus: { file: 'src/features/inventory/status.ts', name: 'ASSET_STATUS_LABEL', kind: 'record' },
  auditResult: { file: 'src/features/inventory/audit-result.ts', name: 'AUDIT_RESULT_LABEL', kind: 'record' },
  shuttleSeason: { file: 'src/features/shuttle/types.ts', name: 'SEASON_LABEL', kind: 'record' },
  shuttleDirection: { file: 'src/features/shuttle/types.ts', name: 'DIRECTION_LABEL', kind: 'record' },
  boardingStatus: { file: 'src/features/shuttle/types.ts', name: 'BOARDING_STATUS_LABEL', kind: 'record' },
  supportStatus: { file: 'src/features/support/types.ts', name: 'SUPPORT_STATUS_META', kind: 'recordLabel' },
  makeupReason: { file: 'src/features/makeups/status.ts', name: 'MAKEUP_REASON', kind: 'record' },
  makeupAction: { file: 'src/features/makeups/status.ts', name: 'MAKEUP_ACTION', kind: 'record' },
  onboardingItem: { file: 'src/features/newcomers/onboarding-items.ts', name: 'ONBOARDING_ITEMS', kind: 'objects', valueKey: 'key', labelKey: 'label' },
  videoLedgerStatus: { file: 'src/features/video-homework/components/round-editor.tsx', name: 'LEDGER_STATUS_OPTIONS', kind: 'objects', valueKey: 'value', labelKey: 'label' },
  weekday: { file: 'src/features/classes/overlap.ts', name: 'DAY_LABEL_KO', kind: 'record' },
  staffTaskKind: { file: 'src/features/staff-tasks/kinds.ts', name: 'TASK_KINDS', kind: 'recordLabel' },
  staffTaskFilter: { file: 'src/features/staff-tasks/kinds.ts', name: 'TASK_FILTER_LABEL', kind: 'record' },
  ownerFace: { file: 'src/features/owner/tabs.ts', name: 'OWNER_FACES', kind: 'objects', valueKey: 'key', labelKey: 'label' },
  studentStatus: { file: 'src/features/students/status/status-labels.ts', name: 'STUDENT_STATUS_LABEL', kind: 'record' },
  integrationSub: { file: 'src/app/(shell)/owner/_components/integrations-face.tsx', name: 'LABEL', kind: 'record' },
  slackCategory: { file: 'src/features/slack/activity-catalog.ts', name: 'ACTIVITY_CATEGORIES', kind: 'objects', valueKey: 'id', labelKey: 'label' },
};

const textOf = node => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};
const unwrap = node => {
  let n = node;
  while (n && (ts.isAsExpression(n) || ts.isSatisfiesExpression?.(n) || ts.isParenthesizedExpression(n) || ts.isTypeAssertionExpression?.(n))) n = n.expression;
  return n;
};
const propName = (p, sf) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : p.name?.getText(sf));

/** 출처 하나를 읽어 [{ value, label }]로 돌려준다. 못 찾으면 예외. */
export function extractOptions(id) {
  const src = OPTION_SOURCES[id];
  if (!src) throw new Error(`알 수 없는 선택지 출처: ${id}`);
  const file = join(repoRoot, src.file);
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let init = null;
  const visit = node => {
    if (init) return;
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === src.name) init = unwrap(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!init) throw new Error(`${src.file}에서 ${src.name}을 찾지 못했다`);
  const out = [];
  if (src.kind === 'record' || src.kind === 'recordLabel') {
    if (!ts.isObjectLiteralExpression(init)) throw new Error(`${src.name}이 객체가 아니다`);
    for (const p of init.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = propName(p, sf);
      let label = null;
      if (src.kind === 'record') label = textOf(p.initializer, sf);
      else if (ts.isObjectLiteralExpression(p.initializer)) {
        const lp = p.initializer.properties.find(q => ts.isPropertyAssignment(q) && propName(q, sf) === 'label');
        label = lp ? textOf(lp.initializer, sf) : null;
      }
      if (key && label) out.push({ value: key, label });
    }
  } else if (src.kind === 'array') {
    if (!ts.isArrayLiteralExpression(init)) throw new Error(`${src.name}이 배열이 아니다`);
    for (const el of init.elements) { const v = textOf(el, sf); if (v) out.push({ value: v, label: v }); }
  } else if (src.kind === 'objects') {
    if (!ts.isArrayLiteralExpression(init)) throw new Error(`${src.name}이 배열이 아니다`);
    for (const el of init.elements) {
      const o = unwrap(el);
      if (!ts.isObjectLiteralExpression(o)) continue;
      const get = k => { const p = o.properties.find(q => ts.isPropertyAssignment(q) && propName(q, sf) === k); return p ? textOf(p.initializer, sf) : null; };
      const v = get(src.valueKey), l = get(src.labelKey);
      if (v && l) out.push({ value: v, label: l });
    }
  }
  if (!out.length) throw new Error(`${src.name}에서 선택지를 읽지 못했다`);
  return out;
}
