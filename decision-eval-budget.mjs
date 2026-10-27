// Persistent call budget for the decision evaluation (ignored work/ folder).
// A call is reserved and written to disk BEFORE it is sent, so a crash or a
// failed attempt still counts. Shared caps (models list and retries included):
//   task 210674e21ca4 evaluation   Jev 60 · Claude 4
//   task c59b2fc3e06b follow-up    Jev +2 · Claude +1   (purpose prefix 'followup:')
//   backend integration (separate) Jev +2 · Claude +1   (only if it reserves here, prefix 'backend:')
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVAL_DIR = resolve(fileURLToPath(new URL('../../work/owner-concept/decision-eval/', import.meta.url)));
export const BUDGETS = Object.freeze({ jev: 60 + 2 + 2, claude: 4 + 1 + 1 });

export class BudgetExceeded extends Error {
  constructor(kind, used, limit) { super(`${kind} call budget exhausted (${used}/${limit})`); this.kind = kind; }
}

export function createLedger({ file = join(EVAL_DIR, 'ledger.json'), budgets = BUDGETS } = {}) {
  let state = null;
  const load = async () => {
    if (state) return state;
    try { state = JSON.parse(await readFile(file, 'utf8')); } catch { state = { jev: [], claude: [] }; }
    state.jev ??= []; state.claude ??= [];
    return state;
  };
  const save = async () => {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 1)}\n`, 'utf8');
    await rename(tmp, file);
  };
  return {
    async used(kind) { return (await load())[kind].length; },
    async remaining(kind) { return budgets[kind] - (await load())[kind].length; },
    /** Reserves one call; returns an `done(outcome)` updater. Throws BudgetExceeded without sending. */
    async reserve(kind, purpose) {
      const s = await load();
      if (s[kind].length >= budgets[kind]) throw new BudgetExceeded(kind, s[kind].length, budgets[kind]);
      const entry = { n: s[kind].length + 1, purpose, at: new Date().toISOString(), outcome: 'pending' };
      s[kind].push(entry);
      await save();
      return async outcome => { entry.outcome = outcome; await save(); };
    },
    async snapshot() { const s = await load(); return { jev: s.jev.length, claude: s.claude.length, budgets }; },
  };
}
