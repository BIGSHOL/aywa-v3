// `claude -p` on this PC's Claude subscription (local dev only) for decision drafts and
// the evaluation baseline. Mirrors claude-bridge.mjs safety (read-only reference there):
// fixed argv, request text via stdin only, tools/MCP/hooks/CLAUDE.md/sessions off,
// allowlisted env without API keys or provider switches, empty run folder outside the
// repo, and a claude.ai-subscription login check before any call. Never an API key.
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ClaudeCliError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => new ClaudeCliError(code, message);
export const DEFAULT_RUNTIME = 'F:/aywa-dev/claude-runtime';
export const MODELS = new Set(['sonnet', 'opus', 'haiku']);
export const EFFORTS = new Set(['low', 'medium', 'high']);

export function claudeArgs({ schema, systemPrompt, model = 'sonnet', effort = 'low', maxBudgetUsd = 0.5 }) {
  if (!MODELS.has(model) || !EFFORTS.has(effort) || !schema || !systemPrompt) throw new Error('Unsupported Claude settings');
  return ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--system-prompt', systemPrompt, '--model', model, '--effort', effort,
    '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--safe-mode', '--restricted', '--no-chrome',
    '--no-session-persistence', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--max-budget-usd', String(maxBudgetUsd)];
}

const WINDOWS_ENV = ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'PROGRAMDATA', 'ProgramFiles', 'PROGRAMFILES', 'ProgramFiles(x86)', 'ProgramW6432', 'SystemDrive', 'SYSTEMDRIVE', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
const POSIX_ENV = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];
/** Allowlist: ANTHROPIC_*, TYPESAFE_*, provider switches, CLAUDE_CONFIG_DIR and parent-session variables never pass. */
export function childEnv(source = process.env, platform = process.platform) {
  const env = {};
  for (const key of platform === 'win32' ? WINDOWS_ENV : POSIX_ENV) if (typeof source[key] === 'string') env[key] = source[key];
  if (platform === 'win32') { if (env.USERPROFILE) env.HOME = env.USERPROFILE; const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'; env.PATH = `${root}\\System32;${root}`; }
  else env.PATH = '/usr/bin:/bin';
  Object.assign(env, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' });
  return env;
}

const MARKERS = ['CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json', '.git'];
const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export async function prepareRuntimeDir(dir, { repo = repoRoot } = {}) {
  if (!dir || !isAbsolute(dir)) throw fail('runtime_unsafe', 'Claude 실행 폴더가 올바르지 않습니다');
  const target = resolve(dir), rel = relative(repo, target);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw fail('runtime_unsafe', 'Claude 실행 폴더가 저장소 안에 있습니다');
  await mkdir(target, { recursive: true });
  for (let current = target; ; current = dirname(current)) {
    const names = new Set(await readdir(current).catch(() => []));
    if (MARKERS.some(m => names.has(m))) throw fail('runtime_unsafe', 'Claude 실행 폴더 위에 설정 파일이 있습니다');
    if (current === parse(current).root) break;
  }
  return target;
}
export const defaultCliPath = (env = process.env) => env.OWNER_CONCEPT_CLAUDE_BIN
  || (process.platform === 'win32' ? join(env.USERPROFILE || 'C:\\Users\\Default', '.local', 'bin', 'claude.exe') : join(env.HOME || '/', '.local', 'bin', 'claude'));

function killTree(child) {
  const alive = () => child.exitCode === null && child.signalCode === null;
  const kill = () => { try { if (alive()) child.kill(); } catch { /* gone */ } };
  if (!alive()) return;
  if (process.platform === 'win32' && child.pid) {
    try { spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' }).on('error', kill).on('close', kill); return; } catch { /* fall back */ }
  }
  kill();
}

export function runProcess({ command, args, cwd, env, input, signal, timeoutMs, maxStdout = 1024 * 1024, settleMs = 3000 }) {
  return new Promise((resolveRun, rejectRun) => {
    if (signal?.aborted) return rejectRun(fail('cancelled', '요청이 취소되었습니다'));
    let child;
    try { child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return rejectRun(fail('cli_missing', 'Claude CLI를 찾지 못했습니다')); }
    let stdout = '', stderr = '', settled = false, outcome = null, forced = null;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forced); signal?.removeEventListener('abort', onAbort); error ? rejectRun(error) : resolveRun(value); };
    const settleSoon = () => { forced ??= setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(outcome, outcome ? undefined : { stdout, stderr, code: child.exitCode }); }, settleMs); };
    const stop = reason => { if (!outcome) outcome = reason; killTree(child); settleSoon(); };
    child.on('exit', settleSoon);
    const onAbort = () => stop(fail('cancelled', '요청이 취소되었습니다'));
    const timer = setTimeout(() => stop(fail('timeout', 'Claude 응답 시간 초과')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', e => finish(fail(e.code === 'ENOENT' || e.code === 'EACCES' ? 'cli_missing' : 'cli_failed', 'Claude 실행 실패')));
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => { stdout += c; if (stdout.length > maxStdout) stop(fail('invalid_output', 'Claude 출력이 너무 깁니다')); });
    child.stderr.on('data', c => { if (stderr.length < 65536) stderr += c; });
    child.on('close', code => finish(outcome, outcome ? undefined : { stdout, stderr, code }));
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}

const classify = text => /rate.?limit|usage limit|limit reached|\b429\b|overloaded|quota/i.test(text) ? fail('rate_limited', 'Claude 사용 한도에 도달했습니다')
  : /not logged in|\/login|authenticat|unauthori[sz]ed|\b401\b|oauth|credential/i.test(text) ? fail('auth_required', 'Claude 구독 로그인이 필요합니다') : fail('cli_failed', 'Claude 실행 실패');

// prefixArgs exists for tests (a fake CLI run by node); production passes none.
export function createCliRunner({ command = defaultCliPath(), prefixArgs = [], cwd, args, env = childEnv(), timeoutMs = 120_000 }) {
  let authCheckedAt = 0;
  const runner = {
    args: Object.freeze([...prefixArgs, ...args]),
    /** Not billed: reads the stored login. Only a claude.ai subscription (firstParty) passes. */
    async checkSubscription() {
      const { stdout } = await runProcess({ command, cwd, env, args: [...prefixArgs, 'auth', 'status', '--json'], input: '', timeoutMs: 20_000 });
      let s; try { s = JSON.parse(stdout); } catch { throw fail('auth_required', 'Claude 구독 로그인이 필요합니다'); }
      if (s.loggedIn !== true) throw fail('auth_required', 'Claude 구독 로그인이 필요합니다');
      if (s.authMethod !== 'claude.ai' || (s.apiProvider && s.apiProvider !== 'firstParty') || !s.subscriptionType) throw fail('subscription_required', 'Claude 구독 로그인으로만 사용합니다(API 키 금지)');
      authCheckedAt = Date.now();
      return { authMethod: s.authMethod, apiProvider: s.apiProvider || 'firstParty', subscriptionType: s.subscriptionType };
    },
    async ask({ input, signal }) {
      if (Date.now() - authCheckedAt > 15 * 60_000) await runner.checkSubscription();
      const started = Date.now();
      const { stdout, stderr, code } = await runProcess({ command, cwd, env, args: runner.args, input, signal, timeoutMs });
      let r; try { r = JSON.parse(stdout.trim()); } catch { throw code === 0 ? fail('invalid_output', 'Claude 출력 형식 오류') : classify(`${stdout}\n${stderr}`); }
      if (!r || typeof r !== 'object') throw fail('invalid_output', 'Claude 출력 형식 오류');
      if (r.is_error || code !== 0 || r.subtype !== 'success') throw classify(`${r.result ?? ''}\n${r.api_error_status ?? ''}\n${stderr}`);
      if (!r.structured_output || typeof r.structured_output !== 'object') throw fail('invalid_output', 'Claude 구조화 출력 없음');
      const u = r.usage ?? {};
      return { output: r.structured_output, meta: { wallMs: Date.now() - started, durationMs: r.duration_ms ?? null, apiMs: r.duration_api_ms ?? null,
        models: Object.keys(r.modelUsage || {}), apiEquivalentUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null,
        usage: { inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null, cacheReadTokens: u.cache_read_input_tokens ?? null, cacheWriteTokens: u.cache_creation_input_tokens ?? null } } };
    },
  };
  return runner;
}
