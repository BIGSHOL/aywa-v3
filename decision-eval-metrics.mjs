// Pure scoring for the decision evaluation. Small synthetic samples: smoke evidence only.
export const REVIEW_ROUTES = Object.freeze(['human_review', 'insufficient_context', 'manager_review']);

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))] : null;
}

export function binary(pairs) {
  const t = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const [pred, label] of pairs) t[pred ? (label ? 'tp' : 'fp') : (label ? 'fn' : 'tn')]++;
  const ratio = (a, b) => (b ? a / b : null);
  return { ...t, n: pairs.length, precision: ratio(t.tp, t.tp + t.fp), recall: ratio(t.tp, t.tp + t.fn) };
}

/** Per-case outcome flags. `result` is a DecisionResult (Jev) or the same shape built from Claude booleans. */
export function scoreCase(k, result) {
  const { label } = k, route = result.route, area = result.area?.value ?? null;
  const roleOk = route !== 'auto_route' || result.assignees.length > 0;
  return {
    id: k.id, category: k.category, route, area, idealRoute: label.ideal,
    routeIdeal: route === label.ideal, routeOk: label.ok.includes(route) && roleOk,
    criticalMiss: label.action === true && route === 'no_action',
    ambiguousNoAction: label.action === null && route === 'no_action',
    wrongAuto: route === 'auto_route' && (label.action === false || label.manager === true || label.safety === true || (label.area !== null && !label.area.includes(area))),
    failure: result.signals === null && result.status !== 'cancelled',
  };
}

/**
 * rows: [{ k, result, signals }] where signals = { action, area, manager, safety } predictions
 * (Jev: probabilities thresholded at 0.5; Claude: booleans). Returns aggregate metrics.
 */
export function summarize(rows) {
  const scored = rows.map(r => ({ ...scoreCase(r.k, r.result), pred: r.signals }));
  const n = scored.length, count = f => scored.filter(f).length;
  const routes = Object.fromEntries(['auto_route', 'no_action', ...REVIEW_ROUTES].map(x => [x, count(s => s.route === x)]));
  const idealAuto = rows.filter(r => r.k.label.ideal === 'auto_route');
  const autoCorrect = idealAuto.filter(r => r.result.route === 'auto_route' && r.k.label.area.includes(r.result.area?.value)).length;
  const autos = count(s => s.route === 'auto_route');
  const labelled = (field, f = () => true) => rows.filter(r => r.signals && r.k.label[field] !== null && r.k.label[field] !== undefined && f(r));
  return {
    n, routes,
    routeIdealRate: count(s => s.routeIdeal) / n,
    routeAcceptableRate: count(s => s.routeOk) / n,
    criticalMisses: scored.filter(s => s.criticalMiss).map(s => s.id),
    ambiguousNoAction: scored.filter(s => s.ambiguousNoAction).map(s => s.id),
    wrongAutoRoutes: scored.filter(s => s.wrongAuto).map(s => s.id),
    autoRouteCoverage: idealAuto.length ? autoCorrect / idealAuto.length : null,
    autoRouteErrorRate: autos ? count(s => s.wrongAuto) / autos : null,
    escalationFraction: count(s => REVIEW_ROUTES.includes(s.route)) / n,
    failures: scored.filter(s => s.failure).map(s => s.id),
    action: binary(labelled('action').map(r => [r.signals.action, r.k.label.action])),
    manager: binary(labelled('manager').map(r => [r.signals.manager, r.k.label.manager])),
    safety: binary(labelled('safety').map(r => [r.signals.safety, r.k.label.safety])),
    areaAccuracy: (() => {
      const xs = labelled('area', r => r.k.label.action === true);
      return xs.length ? { n: xs.length, correct: xs.filter(r => r.k.label.area.includes(r.signals.area)).length } : null;
    })(),
    perCase: scored,
  };
}

export function latency(values) {
  const v = values.filter(Number.isFinite);
  return { n: v.length, p50: percentile(v, 50), p95: percentile(v, 95), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, sum: v.reduce((a, b) => a + b, 0) };
}

/** Sensitivity: per-record cost = Jev cost + escalation fraction x Claude API-equivalent cost per draft. */
export function costSensitivity({ jevUsdPerRecord, claudeUsdPerDraft, fractions }) {
  return fractions.map(f => ({ escalationFraction: f, usdPerRecord: jevUsdPerRecord + f * claudeUsdPerDraft, usdPer1000Records: 1000 * (jevUsdPerRecord + f * claudeUsdPerDraft) }));
}
