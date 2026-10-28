// Stand-in for claude.exe in verify-claude-bridge.mjs. Never contacts anything.
// It records what it received (argv, env, stdin) into its working directory and
// picks a behaviour from a FAKE:<mode> marker in stdin.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
if (argv[0] === 'auth') {
  const status = existsSync('auth.json') ? JSON.parse(readFileSync('auth.json', 'utf8')) : { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', email: 'hidden@example.invalid' };
  process.stdout.write(JSON.stringify(status));
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const mode = input.match(/FAKE:([a-z-]+)/)?.[1] || 'ok';
  appendFileSync('calls.log', `${mode}\n`);
  writeFileSync(`pid-${mode}.txt`, String(process.pid));
  writeFileSync(`record-${mode}.json`, JSON.stringify({ argv, stdin: input, env: process.env, cwd: process.cwd() }));
  const done = output => { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: '', modelUsage: { 'fake-model': {} }, ...output })); };
  const answer = (structured_output) => done({ structured_output });
  switch (mode) {
    case 'hang': setInterval(() => {}, 1000); return;
    case 'tree': { // a descendant that also holds the output pipe and is not in Node's job object
      const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });
      writeFileSync('pid-tree-grandchild.txt', String(grandchild.pid)); setInterval(() => {}, 1000); return;
    }
    case 'flood': process.stdout.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000); return;
    case 'garbage': process.stdout.write('not json at all'); return;
    case 'auth': done({ subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' }); process.exitCode = 1; return;
    case 'rate': done({ is_error: true, result: 'Claude AI usage limit reached|1760000000' }); process.exitCode = 1; return;
    case 'crash': process.stderr.write('fatal: sk-ant-api03-SECRETVALUE at C:\\Users\\someone\\private\\trace.txt'); process.exit(3); return;
    case 'noschema': done({ result: '그냥 문장입니다.' }); return;
    case 'claim': answer({ answer: '보호자에게 안내 문자를 발송했습니다.', issueIds: ['billing'], suggestedTask: null }); return;
    case 'loose': answer({ answer: '정리했습니다만 확인이 필요합니다.', issueIds: ['billing', 'evil', 'billing', 'tasks'], suggestedTask: { title: '가'.repeat(200), body: '확인 부탁드립니다.' }, extra: 'drop me' }); return;
    case 'english': answer({ answer: 'OK', issueIds: [], suggestedTask: null }); return;
    case 'slow': setTimeout(() => answer({ answer: '천천히 답했습니다. 10월 잔액은 기록 기준입니다.', issueIds: [], suggestedTask: null }), 400); return;
    // 정리된 답(머리말·핵심 숫자·근거·확인할 일·바로 가기) — 없는 근거 번호(99)·없는 목적지(ws:evil)는 서버가 걸러야 한다.
    default: answer({ headline: '10월 남은 금액은 ⟦50,000원⟧입니다.', keyFacts: [{ label: '남은 금액', value: '50,000원', change: '+50,000원', tone: 'bad', ref: 5 }],
      points: [{ text: '남은 금액이 있는 청구는 ⟦1건⟧입니다. 다만 수납액은 누적 금액입니다.', refs: [6, 99] }], checks: ['남은 청구 ⟦1건⟧ 확인'], table: null,
      links: ['ws:billing', 'ws:evil'], issueIds: ['billing'], suggestedTask: { title: '수납 잔액 확인', body: '남은 금액이 있는 청구를 확인해 주세요.', area: 'ws:billing', recordQueries: ['홍길동'] } });
  }
});
