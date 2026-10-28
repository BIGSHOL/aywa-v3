// 2.0 화면 — 수납관리 · 수강료 계산기 면(calculator-panel.tsx: 계산기 · 수강료 단가 · 교재 단가표 · 공휴일 · 저장된 청구서)의 조회와 저장을 Docker 복사본에서 같은 결과로.
//  · 조회 = tuition-catalog-queries.ts getTuitionCatalogActive · getTuitionCatalogPage · getTuitionCatalogStats · getTuitionCategoryOptions ·
//    tuition-quote-queries.ts getQuotesPage · getQuoteById · catalog-queries.ts(교재 단가표 — v2-billing-textbooks.mjs와 같은 읽기) · 학원 설정
//  · 저장 = catalog-actions.ts(교재 단가표 4) · tuition-catalog-actions.ts(수강료 단가 5) · tuition-quote-actions.ts(견적 저장 · 삭제) — 게이트 = 수납 '전체'
// 폼 읽기(readForm · parseArr · won)는 2.0 서버 파일 안의 순수 함수라 원문 그대로 실행한다(v2-billing-pure.mjs). 쓰기는 사용자 역할(RLS)로.
import { pureFrom } from './v2-billing-pure.mjs';
import { readCatalogOptions, readCatalogPanel } from './v2-billing-textbooks.mjs';
import { readStudentOptions } from './v2-billing-invoices.mjs';
import { readBranding, audit, formOf, asViewer, billingAction, UUID_RE } from './v2-billing-common.mjs';

const CATALOG = 'features/billing/server/catalog-actions.ts', TUITION = 'features/billing/server/tuition-catalog-actions.ts', QUOTE = 'features/billing/server/tuition-quote-actions.ts';
let rulesPromise = null;
export function loadCalculatorRules(importV2) {
  rulesPromise ??= (async () => {
    const [tc, dbError] = await Promise.all([importV2('features/billing/tuition-catalog.ts'), importV2('lib/supabase/db-error.ts')]);
    const [cat, tui, quo, qq] = await Promise.all([
      pureFrom(CATALOG, ['readForm']),
      pureFrom(TUITION, ['readForm'], { normalizePricingMode: tc.normalizePricingMode }),
      pureFrom(QUOTE, ['parseArr', 'won']),
      pureFrom('features/billing/server/tuition-quote-queries.ts', ['asArray', 'num']),
    ]);
    return { tc, dbError, cat, tui, quo, qq };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}
const TS = (sql, col) => sql`to_json(${sql(col)})#>>'{}'`;
const num = v => (v == null ? 0 : Number(v));

// ── 조회 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getTuitionCatalogActive — 사용 중 단가(분류 → 이름) · 단가 종류는 normalizePricingMode. */
async function readTuitionActive(sql, t, X) {
  const rows = await sql`select id::text id, category, name, price, pricing_mode, note from public.tuition_catalog where tenant_id=${t} and is_active order by category asc, name asc, id`;
  return rows.map(r => ({ id: r.id, category: r.category, name: r.name, price: num(r.price), pricingMode: X.tc.normalizePricingMode(r.pricing_mode), note: r.note }));
}
/** 2.0 getTuitionCatalogPage({ q, category, pmode, active }, page, 50) · getTuitionCatalogStats · getTuitionCategoryOptions. */
async function readTuitionPrices(sql, t, X, env, sp) {
  const page = Math.max(1, Number(sp.cpage) || 1), from = (page - 1) * 50, category = sp.cat ?? 'all', pmode = sp.cpmode ?? 'all', active = sp.cactive ?? 'all';
  const term = sp.q ? sp.q.replace(/[%_,()]/g, ' ').trim() : '';
  const where = sql`tenant_id=${t} ${category !== 'all' ? sql`and category=${category}` : sql``}
    ${pmode === X.tc.PMODE_UNSET ? sql`and pricing_mode is null` : pmode !== 'all' ? sql`and pricing_mode=${pmode}` : sql``}
    ${active === 'active' ? sql`and is_active` : active === 'inactive' ? sql`and not is_active` : sql``}
    ${term ? sql`and (name ilike ${`%${term}%`} or category ilike ${`%${term}%`})` : sql``}`;
  const [rows, [{ n }], [st], cats] = await Promise.all([
    sql`select id::text id, category, name, price, pricing_mode, note, is_active from public.tuition_catalog where ${where} order by is_active desc, category asc, name asc, id offset ${from} limit 50`,
    sql`select count(*)::int n from public.tuition_catalog where ${where}`,
    sql`select count(*)::int total, count(*) filter (where is_active)::int active, count(*) filter (where is_active and pricing_mode is null)::int unset from public.tuition_catalog where tenant_id=${t}`,
    sql`select category from public.tuition_catalog where tenant_id=${t}`,
  ]);
  return {
    page: { rows: rows.map(r => ({ id: r.id, category: r.category, name: r.name, price: num(r.price), pricingMode: r.pricing_mode ?? null, note: r.note, isActive: r.is_active })), total: n },
    stats: { total: st.total, active: st.active, unset: st.unset },
    categories: X.tc.tuitionCategoryOptions(env.operations.subjects.map(s => s.label), cats.map(c => c.category ?? '')),
  };
}
/** 2.0 getQuotesPage({ q }, page, 50) — 작성 최신순 · 학생 이름·학교 검색. */
async function readQuotesPage(sql, t, X, sp) {
  const page = Math.max(1, Number(sp.qpage) || 1), from = (page - 1) * 50, term = sp.q ? sp.q.replace(/[%_,()]/g, ' ').trim() : '';
  const where = sql`tenant_id=${t} ${term ? sql`and (student_name ilike ${`%${term}%`} or school ilike ${`%${term}%`})` : sql``}`;
  const [rows, [{ n }]] = await Promise.all([
    sql`select id::text id, student_name, school, grade, consultant, courses, extras, total_amount, ${TS(sql, 'created_at')} created_at from public.tuition_quotes where ${where} order by created_at desc, id offset ${from} limit 50`,
    sql`select count(*)::int n from public.tuition_quotes where ${where}`,
  ]);
  return { rows: rows.map(r => ({ id: r.id, studentName: r.student_name, school: r.school, grade: r.grade, consultant: r.consultant, courseCount: X.qq.asArray(r.courses).length,
    extraCount: X.qq.asArray(r.extras).length, totalAmount: num(r.total_amount), createdAt: r.created_at })), total: n };
}
/** 2.0 getQuoteById(id) — 없으면 null. */
async function readQuote(sql, t, X, id) {
  if (!UUID_RE.test(id)) return null;
  const [d] = await sql`select id::text id, student_name, school, grade, consultant, start_date::text start_date, end_date::text end_date, courses, extras, discounts, total_amount,
    ${TS(sql, 'created_at')} created_at from public.tuition_quotes where tenant_id=${t} and id=${id}`;
  return d ? { id: d.id, studentName: d.student_name, school: d.school, grade: d.grade, consultant: d.consultant, startDate: d.start_date, endDate: d.end_date,
    courses: X.qq.asArray(d.courses), extras: X.qq.asArray(d.extras), discounts: X.qq.asArray(d.discounts), totalAmount: num(d.total_amount), createdAt: d.created_at } : null;
}

/** 계산기 면 자료 — 내부탭(csub)이 고르는 쪽만. settings = 화면이 읽는 학원 설정 칸(이름 · 로고 · 계좌 · 휴원일 · 모듈 · 프리셋 판정). */
export async function readCalculatorFace(sql, t, R, env, importV2, sp) {
  const X = await loadCalculatorRules(importV2), sub = ['prices', 'catalog', 'holidays', 'quotes'].includes(sp.csub) ? sp.csub : 'calculator';
  const [row] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
  const branding = await readBranding(sql, t, R);
  // isGenericTenant(settings)는 프리셋을 본다 — 2.0 resolveSettings와 같은 판정(presetOfStored).
  const settings = { profile: { name: branding.profile.name, logoUrl: null }, billing: branding.billing, operations: env.operations, modules: { disabled: env.disabled },
    preset: R.preset.presetOfStored(row?.data ?? null) };
  const out = { sub, settings, calculator: null, prices: null, catalog: null, quotes: null };
  if (sub === 'calculator') {
    const [catalog, textbooks, initial] = await Promise.all([readTuitionActive(sql, t, X), readCatalogOptions(sql, t), sp.qid ? readQuote(sql, t, X, sp.qid) : null]);
    out.calculator = { catalog, textbooks, initial };
  } else if (sub === 'prices') out.prices = await readTuitionPrices(sql, t, X, env, sp);
  else if (sub === 'catalog') out.catalog = await readCatalogPanel(sql, t, { q: sp.q ?? '', grade: sp.grade ?? 'all', active: sp.active ?? 'all', page: Math.max(1, Number(sp.page) || 1) });
  else if (sub === 'quotes') { const [page, students] = await Promise.all([readQuotesPage(sql, t, X, sp), readStudentOptions(sql, t)]); out.quotes = { page, students }; }
  return out;
}

// ── 저장 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const canManage = actor => !!actor && actor.billing === 'full'; // 2.0 accessLevelTenant(role, "billing") === "full"
const gate = (actor, denied) => (!actor ? { error: '로그인이 필요합니다' } : !canManage(actor) ? { error: denied } : null);

/** 행을 바꾸고 바뀐 줄을 돌려받는 쓰기 — 2.0 `.select(...)`처럼 0행이면 빈 배열(감사로그를 남기지 않는다). */
async function write(sql, actor, fn) { const r = await asViewer(sql, actor, fn); return { rows: r.data ?? [], error: r.error }; }

const catalogFns = {
  async createCatalogItem({ sql, t, importV2 }, actor, [, fd]) {
    const X = await loadCalculatorRules(importV2), f = X.cat.readForm(formOf(fd)), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    if (f.error) return { error: f.error };
    const { error } = await write(sql, actor, s => s`insert into public.textbook_catalog ${s({ tenant_id: t, title: f.title, book_detail: f.bookDetail, grade_level: f.gradeLevel, subject: f.subject, publisher: f.publisher, price: f.price })}`);
    if (error) return { error: error.message };
    await audit(sql, t, actor, 'textbook_catalog_create', 'textbook_catalog', null, f.title);
    return { ok: true };
  },
  async updateCatalogItem({ sql, t, importV2 }, actor, [, fd]) {
    const X = await loadCalculatorRules(importV2), form = formOf(fd), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(); if (!id) return { error: '교재 ID가 누락되었습니다' };
    const f = X.cat.readForm(form); if (f.error) return { error: f.error };
    const { rows, error } = await write(sql, actor, s => s`update public.textbook_catalog set ${s({ title: f.title, book_detail: f.bookDetail, grade_level: f.gradeLevel, subject: f.subject, publisher: f.publisher, price: f.price })} where id::text=${id} returning id`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'textbook_catalog_update', 'textbook_catalog', { itemId: id }, f.title);
    return { ok: true };
  },
  async deleteCatalogItem({ sql, t }, actor, [, fd]) {
    const form = formOf(fd), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(); if (!id) return { error: '교재 ID가 누락되었습니다' };
    const { rows, error } = await write(sql, actor, s => s`delete from public.textbook_catalog where id::text=${id} returning title`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'textbook_catalog_delete', 'textbook_catalog', { itemId: id }, rows[0].title ?? null);
    return { ok: true };
  },
  async toggleCatalogActive({ sql, t }, actor, [, fd]) {
    const form = formOf(fd), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(), next = String(form.get('next') ?? '') === 'true'; if (!id) return { error: '교재 ID가 누락되었습니다' };
    const { rows, error } = await write(sql, actor, s => s`update public.textbook_catalog set is_active=${next} where id::text=${id} returning title`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'textbook_catalog_toggle', 'textbook_catalog', { itemId: id, active: next }, rows[0].title ?? null);
    return { ok: true };
  },
};

const tuitionFns = {
  async createTuitionItem({ sql, t, importV2 }, actor, [, fd]) {
    const X = await loadCalculatorRules(importV2), f = X.tui.readForm(formOf(fd)), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    if (f.error) return { error: f.error };
    const { error } = await write(sql, actor, s => s`insert into public.tuition_catalog ${s({ tenant_id: t, category: f.category, name: f.name, price: f.price, pricing_mode: f.pricingMode, note: f.note })}`);
    if (error) return { error: error.message };
    await audit(sql, t, actor, 'tuition_catalog_create', 'tuition_catalog', { pricingMode: f.pricingMode }, f.name);
    return { ok: true };
  },
  async updateTuitionItem({ sql, t, importV2 }, actor, [, fd]) {
    const X = await loadCalculatorRules(importV2), form = formOf(fd), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(); if (!id) return { error: '항목 ID가 누락되었습니다' };
    const f = X.tui.readForm(form); if (f.error) return { error: f.error };
    const { rows, error } = await write(sql, actor, s => s`update public.tuition_catalog set ${s({ category: f.category, name: f.name, price: f.price, pricing_mode: f.pricingMode, note: f.note })} where id::text=${id} returning id`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'tuition_catalog_update', 'tuition_catalog', { itemId: id, pricingMode: f.pricingMode }, f.name);
    return { ok: true };
  },
  async deleteTuitionItem({ sql, t }, actor, [, fd]) {
    const form = formOf(fd), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(); if (!id) return { error: '항목 ID가 누락되었습니다' };
    const { rows, error } = await write(sql, actor, s => s`delete from public.tuition_catalog where id::text=${id} returning name`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'tuition_catalog_delete', 'tuition_catalog', { itemId: id }, rows[0].name ?? null);
    return { ok: true };
  },
  async setTuitionPricingMode({ sql, t, importV2 }, actor, [, fd]) {
    const X = await loadCalculatorRules(importV2), form = formOf(fd), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(); if (!id) return { error: '항목 ID가 누락되었습니다' };
    const pricingMode = X.tc.normalizePricingMode(String(form.get('pricing_mode') ?? ''));
    const { rows, error } = await write(sql, actor, s => s`update public.tuition_catalog set pricing_mode=${pricingMode} where id::text=${id} returning name`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'tuition_catalog_pricing_mode', 'tuition_catalog', { itemId: id, pricingMode }, rows[0].name ?? null);
    return { ok: true };
  },
  async toggleTuitionActive({ sql, t }, actor, [, fd]) {
    const form = formOf(fd), g = gate(actor, '단가표 관리 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(), next = String(form.get('next') ?? '') === 'true'; if (!id) return { error: '항목 ID가 누락되었습니다' };
    const { rows, error } = await write(sql, actor, s => s`update public.tuition_catalog set is_active=${next} where id::text=${id} returning name`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'tuition_catalog_toggle', 'tuition_catalog', { itemId: id, active: next }, rows[0].name ?? null);
    return { ok: true };
  },
};

const quoteFns = {
  async saveTuitionQuote({ sql, t, importV2 }, actor, [, fd]) {
    const X = await loadCalculatorRules(importV2), form = formOf(fd), g = gate(actor, '견적 저장 권한이 없습니다'); if (g) return g;
    const studentName = String(form.get('studentName') ?? '').trim(); if (!studentName) return { error: '학생 이름을 입력해주세요' };
    const courses = X.quo.parseArr(form.get('courses')); if (courses.length === 0) return { error: '수강 과목을 1개 이상 추가해주세요' };
    const row = { student_name: studentName, school: String(form.get('school') ?? '').trim() || null, grade: String(form.get('grade') ?? '').trim() || null,
      consultant: String(form.get('consultant') ?? '').trim() || null, start_date: String(form.get('startDate') ?? '').trim() || null, end_date: String(form.get('endDate') ?? '').trim() || null,
      courses: sql.json(courses), extras: sql.json(X.quo.parseArr(form.get('extras'))), discounts: sql.json(X.quo.parseArr(form.get('discounts'))), total_amount: X.quo.won(form.get('totalAmount')) };
    const quoteId = String(form.get('quoteId') ?? '').trim();
    if (quoteId) {
      const { rows, error } = await write(sql, actor, s => s`update public.tuition_quotes set ${s(row)} where id::text=${quoteId} and tenant_id=${t} returning id::text id`);
      if (error) return { error: X.dbError.humanizeDbError(error.message, '저장') };
      if (!rows.length) return { error: '저장할 견적을 찾지 못했습니다 — 목록에서 다시 열어주세요' };
      await audit(sql, t, actor, 'tuition_quote_save', 'tuition_quote', { quoteId: rows[0].id, mode: 'update', courseCount: courses.length }, studentName);
      return { ok: true, id: rows[0].id };
    }
    const { rows, error } = await write(sql, actor, s => s`insert into public.tuition_quotes ${s({ tenant_id: t, ...row })} returning id::text id`);
    if (error || !rows.length) return { error: X.dbError.humanizeDbError(error?.message ?? '', '저장') };
    await audit(sql, t, actor, 'tuition_quote_save', 'tuition_quote', { quoteId: rows[0].id, mode: 'create', courseCount: courses.length }, studentName);
    return { ok: true, id: rows[0].id };
  },
  async deleteTuitionQuote({ sql, t }, actor, [, fd]) {
    const form = formOf(fd), g = gate(actor, '견적 삭제 권한이 없습니다'); if (g) return g;
    const id = String(form.get('id') ?? '').trim(); if (!id) return { error: '견적 ID가 누락되었습니다' };
    const { rows, error } = await write(sql, actor, s => s`delete from public.tuition_quotes where id::text=${id} returning student_name`);
    if (error) return { error: error.message };
    if (rows.length) await audit(sql, t, actor, 'tuition_quote_delete', 'tuition_quote', { quoteId: id }, rows[0].student_name ?? null);
    return { ok: true };
  },
};

const formArgs = args => formOf(args[1]);
export const calculatorActions = Object.fromEntries([[CATALOG, catalogFns], [TUITION, tuitionFns], [QUOTE, quoteFns]]
  .flatMap(([module, fns]) => Object.entries(fns).map(([name, fn]) => [name, billingAction(module, 2, fn, formArgs)])));
