// 현황표의 프로그램 묶음은 2.0 원생 프로그램 판정 한 곳을 사용한다.
export async function overviewPrograms(importV2, settings, modules) {
  const P = await importV2('features/students/enrollment/program.ts');
  const subjects = (settings.operations?.subjects || []).map(s => ({ key: s.key, label: s.label }));
  const eieOn = modules.isModuleEnabled(settings.modules?.disabled || [], 'eie');
  const order = [...P.visiblePrograms(eieOn)];
  const of = cls => {
    const key = P.programOf({ subject: cls.subject, englishTrack: cls.english_track ?? null }, subjects);
    return !eieOn && key === 'eie' ? 'injaewon' : key;
  };
  const label = key => key && order.includes(key) ? P.programLabel(key, subjects, eieOn) : '과목 모름';
  return { order, of, label };
}
