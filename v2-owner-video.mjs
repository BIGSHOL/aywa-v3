// 학원 설정 연동/숙제영상 드라이브: 2.0 getVideoDriveSettingsView의 저장된 값만 조회.
// Google OAuth·Drive 폴더 확인은 바깥 요청이므로 이 화면에서는 실행하지 않는다.
export async function loadOwnerVideo(sql, t, viewer) {
  const cols = await sql`select table_name, column_name from information_schema.columns where table_schema='public'
    and table_name in ('homework_video_drive_settings', 'homework_video_drive_roots', 'homework_video_drive_connections')`;
  const fields = table => new Set(cols.filter(c => c.table_name === table).map(c => c.column_name));
  const settingCols = fields('homework_video_drive_settings');
  const rootCols = fields('homework_video_drive_roots');
  const connCols = fields('homework_video_drive_connections');
  const ready = settingCols.size > 0;
  const accountReady = ready && settingCols.has('connection_id') && connCols.size > 0;
  const base = { accountReady, enabled: false, folderName: null, version: null, source: 'none',
    hasConnection: false, accountEmail: null, accountStatus: null };
  let setting = base;
  if (ready) {
    const [row] = accountReady
      ? await sql`select enabled, root_folder_id, version::text version, connection_id::text connection_id
          from public.homework_video_drive_settings where tenant_id=${t}`
      : await sql`select enabled, root_folder_id, version::text version
          from public.homework_video_drive_settings where tenant_id=${t}`;
    if (row) {
      const connectionId = accountReady ? row.connection_id : null;
      const [account] = connectionId
        ? await sql`select email, status from public.homework_video_drive_connections where tenant_id=${t} and id=${connectionId}::uuid`
        : [];
      setting = { ...base, source: 'saved', version: row.version ?? null, hasConnection: !!account,
        accountEmail: account?.email ?? null, accountStatus: account ? account.status === 'ready' ? 'ready' : 'needs_reauth' : null };
      if (row.enabled && row.root_folder_id && rootCols.size > 0 && (!connectionId || account)) {
        const [root] = accountReady && rootCols.has('connection_id')
          ? await sql`select tenant_id::text tenant_id, connection_id::text connection_id, folder_name
              from public.homework_video_drive_roots where root_folder_id=${row.root_folder_id}`
          : await sql`select tenant_id::text tenant_id, folder_name
              from public.homework_video_drive_roots where root_folder_id=${row.root_folder_id}`;
        if (root?.tenant_id === t && (root.connection_id ?? null) === connectionId)
          setting = { ...setting, enabled: true, folderName: root.folder_name || null };
      }
    }
  }
  return { setting, readOnly: !['full', 'scoped'].includes(viewer.level('integration_settings')), oauthReady: false };
}
