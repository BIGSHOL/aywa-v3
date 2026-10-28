// ImportHubFace: kinds.ts의 도입 순서, importer 정의의 메뉴, 모듈·전체 권한 판정을 연습 호스트에 전달한다.
// 파일 서식/검사/반영 API는 연습 서버에 연결하지 않는다.
export const IMPORT_MENU = Object.freeze({
  students: 'students', staff: 'staff', classrooms: 'operations_settings', classes: 'classes',
  'enrollment-consultations': 'enrollment', 'student-consultations': 'consultations',
  attendance: 'attendance', invoices: 'billing', expenses: 'billing', textbooks: 'textbooks',
  calendar: 'calendar', shuttle: 'shuttle',
});

export async function loadOwnerImport(importV2, modules, disabled, viewer) {
  const { IMPORT_KINDS, IMPORT_META } = await importV2('features/excel-import/kinds.ts');
  return [...IMPORT_KINDS]
    .sort((a, b) => IMPORT_META[a].step - IMPORT_META[b].step)
    .map(kind => {
      const menu = IMPORT_MENU[kind];
      if (!menu) throw new Error(`가져오기 메뉴가 없습니다: ${kind}`);
      const moduleId = modules.moduleOfMenuKey(menu);
      return { kind, off: !!moduleId && !modules.isModuleEnabled(disabled, moduleId), allowed: viewer.level(menu) === 'full' };
    })
    .filter(row => !row.off)
    .map(({ kind, allowed }) => ({ kind, allowed }));
}
