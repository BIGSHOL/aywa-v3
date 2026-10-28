// 2.0 pure rules used by the exit insight (INSIGHT-EXITS.md): the same functions the 2.0 app runs, imported from
// eywa src/ through v2-ts-hooks.mjs — withdrawal reason labels, bookkeeping-exit test, the teacher-evaluation churn
// model behind 퇴원관리 '담당강사' and 시간표 X, special-lecture rule, the merged-student test and consultation labels. Read-only; no IO.
import { register } from 'node:module';

const SRC = new URL('../../src/', import.meta.url);
let loading = null;

export function loadV2() {
  loading ??= (async () => {
    register('./v2-ts-hooks.mjs', import.meta.url, { data: { src: SRC.href } });
    const at = path => import(new URL(path, SRC).href);
    const [types, detail, bulk, reasonKey, overlay, churnModel, context, students, config, special, merged, window, consult] = await Promise.all([
      at('features/withdrawals/types.ts'), at('features/withdrawals/reason-detail.ts'), at('features/withdrawals/system-bulk.ts'),
      at('features/withdrawals/reason-key.ts'), at('features/withdrawals/exit-overlay-teachers.ts'),
      at('features/teacher-portfolio/model/churn-model.ts'), at('features/teacher-portfolio/model/context.ts'),
      at('features/teacher-portfolio/model/students.ts'), at('features/teacher-portfolio/evaluation/config.ts'),
      at('features/classes/special-lecture.ts'), at('features/students/status/merged.ts'), at('features/withdrawals/window.ts'),
      at('features/consultations/labels.ts'),
    ]);
    return Object.freeze({
      REASON_LABEL: types.REASON_LABEL, normalizeReason: types.normalizeReason, reasonDisplay: types.reasonDisplay,
      reasonDetailOf: detail.reasonDetailOf, detailFor: detail.detailFor,
      isCleanupExit: bulk.isCleanupExit, isBookkeepingOnlyExit: bulk.isBookkeepingOnlyExit, isSystemBulkWithdrawal: bulk.isSystemBulkWithdrawal,
      reasonKeyOf: reasonKey.reasonKeyOf, endedWithExit: reasonKey.endedWithExit, exitDayOf: reasonKey.exitDayOf,
      churnMonthOf: overlay.churnMonthOf, churnTeachersOf: overlay.churnTeachersOf, OVERLAY_LOOKBACK_DAYS: overlay.OVERLAY_LOOKBACK_DAYS,
      buildChurnModel: churnModel.buildChurnModel, buildHomeroomOwner: context.buildHomeroomOwner, buildStudentTracking: students.buildStudentTracking,
      resolveEvaluationConfig: config.resolveEvaluationConfig, DEFAULT_EVALUATION_CONFIG: config.DEFAULT_EVALUATION_CONFIG,
      isSpecialLecture: special.isSpecialLecture, isMergedStudent: merged.isMergedStudent, withdrawalMonthWindow: window.withdrawalMonthWindow,
      CONSULTATION_CATEGORY_LABEL: consult.CONSULTATION_CATEGORY_LABEL,
    });
  })();
  return loading;
}
