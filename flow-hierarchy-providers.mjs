// Provider transports for the hierarchy AI stages. Dev = Jev through the existing key adapter
// (OWNER_CONCEPT_TYPESAFE_KEY_FILE, TYPESAFE_API_KEY line only) and Claude through this PC's
// subscription CLI (`claude -p`, no tools/MCP/hooks, isolated runtime folder, no --bare, no API key).
// A production API transport is a future adapter behind the same interface; it is not wired here.
import { callSystemOne } from './decision-jev.mjs';
import { loadTypesafeKey } from './decision-key.mjs';
import { claudeArgs, createCliRunner, prepareRuntimeDir, DEFAULT_RUNTIME } from './decision-claude-cli.mjs';

export class ProviderError extends Error { constructor(code, message) { super(message); this.code = code; } }
// Transient failures may be retried once after a cooldown; everything else is final for that input.
export const TRANSIENT = new Set(['timeout', 'rate_limited', 'overloaded', 'network', 'http_error', 'busy', 'cli_failed', 'cancelled']);

/** Interface: { jev: { model, status(), decide({state, questions}, {signal}) }, claude: { status(), ask({schema, prompt, model, effort, input, timeoutMs}, {signal}) } }. */
export function createHierarchyProviders({ env = process.env, transport = env.OWNER_CONCEPT_HIERARCHY_TRANSPORT || 'cli', jevModel = 'jev-1.14.0', fetchImpl } = {}) {
  if (transport !== 'cli') throw new ProviderError('transport_disabled', '운영 API 전송은 아직 켜지 않았습니다(개발은 구독 CLI만).');
  let key = null, keyLoaded = false;
  const apiKey = async () => { if (!keyLoaded) { key = await loadTypesafeKey({ env }).catch(() => null); keyLoaded = true; } return key?.apiKey || null; };
  let runtime = null; const runners = new Map();
  const runner = async (schema, prompt, model, effort, timeoutMs) => {
    runtime ??= await prepareRuntimeDir(env.OWNER_CONCEPT_CLAUDE_RUNTIME || DEFAULT_RUNTIME);
    const id = `${model}|${effort}|${timeoutMs}|${prompt}|${JSON.stringify(schema)}`;
    if (!runners.has(id)) runners.set(id, createCliRunner({ cwd: runtime, timeoutMs, args: claudeArgs({ schema, systemPrompt: prompt, model, effort, maxBudgetUsd: 1 }) }));
    return runners.get(id);
  };
  return {
    transport,
    jev: {
      model: jevModel,
      status: async () => ((await apiKey()) ? 'ready' : 'unavailable'),
      async decide({ state, questions, timeoutMs = 8_000 }, { signal } = {}) {
        const k = await apiKey(); if (!k) throw new ProviderError('no_key', '판정 키가 설정되지 않음');
        try { return await callSystemOne({ state, questions, apiKey: k, model: jevModel, timeoutMs, signal, fetchImpl }); } catch (error) { throw new ProviderError(error.code || 'network', '판정 호출 실패'); }
      },
    },
    claude: {
      status: async () => 'ready', // the CLI checks the claude.ai subscription login before each run (every 15 min)
      async ask({ schema, prompt, model, effort, input, timeoutMs = 180_000 }, { signal } = {}) {
        try { const r = await (await runner(schema, prompt, model, effort, timeoutMs)).ask({ input: JSON.stringify(input), signal }); return { output: r.output, model: r.meta.models[0] || null, elapsedMs: r.meta.wallMs, usage: r.meta.usage, apiEquivalentUsd: r.meta.apiEquivalentUsd }; }
        catch (error) { throw new ProviderError(error.code || 'cli_failed', 'Claude 실행 실패'); }
      },
    },
  };
}
