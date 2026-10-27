// Fake `claude` executable for verify-decision-engine.mjs. Never contacts any service.
// argv: [...prefix, 'auth','status','--json'] -> login JSON; '--fake-auth=api' simulates an API-key login.
// stdin MODE:hang -> never exits; MODE:bad -> invalid JSON; otherwise a success result.
const args = process.argv.slice(2);
if (args.includes('auth')) {
  const api = args.includes('--fake-auth=api');
  process.stdout.write(JSON.stringify(api ? { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }
    : { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }));
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  if (input.includes('MODE:hang')) { setInterval(() => {}, 1000); return; }
  if (input.includes('MODE:bad')) { process.stdout.write('not json'); return; }
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, duration_api_ms: 900, total_cost_usd: 0.0123,
    usage: { input_tokens: 1500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: { 'claude-sonnet-fake': {} },
    structured_output: { explanation: '설명입니다.', nextAction: null, missingInfo: [], routeConcern: 'none',
      envHasProviderSecrets: Object.keys(process.env).some(k => /^(ANTHROPIC|TYPESAFE|CLAUDE_CONFIG|CLAUDE_CODE_USE)/.test(k)),
      argsHadBare: args.includes('--bare'), stdinBytes: Buffer.byteLength(input) },
  }));
});
