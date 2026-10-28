// next/headers 자리 — 요청 쿠키·머리글이 없다(로그인 · 지점 보기 · 다른 강사 보기 쿠키 없음 = 2.0의 평소 요청과 같은 갈래). 쓰기는 흉내 밖.
import { UnsupportedShape } from '../postgrest.mjs';
const jar = { get: () => undefined, getAll: () => [], has: () => false, set: () => { throw new UnsupportedShape('쿠키 쓰기'); }, delete: () => { throw new UnsupportedShape('쿠키 지우기'); } };
export const cookies = async () => jar;
export const headers = async () => new Headers();
export const draftMode = async () => ({ isEnabled: false });
