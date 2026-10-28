// Particles after a pseudonym is replaced by a local name (exit-runtime.mjs renderKorean) — offline, no DB.
// node --test experiments/owner-concept/verify-exit-render.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderKorean, withParticle, NAME_MARK } from './exit-runtime.mjs';

const names = { 'T-1a2b3c4d': '김화영', 'T-00000001': '박선생', 'T-00000002': '김민수', 'C-0000000a': '고등M 중3 TP4G (~26.07.09)', 'C-0000000b': 'LT5', 'C-0000000c': '중등E_중1 TOP', 'S-0000000d': '김준우A', 'C-0000000e': '수학반', 'F-0000000f': '' };
const label = ref => (ref in names ? names[ref] : null);

test('particles follow the name, not the pseudonym', () => {
  assert.equal(renderKorean('T-1a2b3c4d는 현재 재직 중이 아닙니다', label), '김화영은 현재 재직 중이 아닙니다');
  assert.equal(renderKorean('T-1a2b3c4d가 맡은 반', label), '김화영이 맡은 반');
  assert.equal(renderKorean('T-00000002은 담임이었고 T-00000001를 거쳐', label), '김민수는 담임이었고 박선생을 거쳐');
  assert.equal(renderKorean('C-0000000a이 폐강되었고 C-0000000b은 이어졌으며 C-0000000c와 함께', label), '고등M 중3 TP4G (~26.07.09)가 폐강되었고 LT5는 이어졌으며 중등E_중1 TOP과 함께');
  assert.equal(renderKorean('S-0000000d이 C-0000000e로 옮겼고 C-0000000b으로', label), '김준우A가 수학반으로 옮겼고 LT5로');
  assert.equal(renderKorean('T-00000002이며 T-1a2b3c4d고 T-00000001였다', label), '김민수며 김화영이고 박선생이었다');
});
test('no particle, fact ids and unknown pseudonyms', () => {
  assert.equal(renderKorean('T-1a2b3c4d 선생님', label), '김화영 선생님');
  // the screen's bold mark wraps only the name; the particle still follows the name's last sound
  assert.equal(renderKorean('T-1a2b3c4d가 맡은 반', label, NAME_MARK), '⟦김화영⟧이 맡은 반');
  assert.equal(renderKorean('T-00000002이며 C-0000000e로', label, NAME_MARK), '⟦김민수⟧며 ⟦수학반⟧으로');
  assert.equal(renderKorean('근거 F-0000000f에 따라', label), '근거 에 따라');
  assert.equal(renderKorean('S-ffffffff는', label), 'S-ffffffff는');
  assert.equal(withParticle('수학반', '로'), '수학반으로'); assert.equal(withParticle('교실', '으로'), '교실로');
  assert.deepEqual(['중고E_중2 특별 Elsa', '고등E_고2 SKY', '중등E_초6 Jane', '중등E_중2 특별 Green', 'Kristine Driver'].map(n => withParticle(n, '는')), ['중고E_중2 특별 Elsa는', '고등E_고2 SKY는', '중등E_초6 Jane은', '중등E_중2 특별 Green은', 'Kristine Driver는']);
});
