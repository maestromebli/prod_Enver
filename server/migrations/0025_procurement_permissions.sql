-- Права закупівлі для існуючих ролей (merge у permissions_json)
UPDATE role_permissions
SET permissions_json = (
  (permissions_json::jsonb || jsonb_build_object(
    'canManageProcurement', role IN ('admin', 'production', 'manager')
  ))::text
)
WHERE role IN ('admin', 'production', 'manager', 'operator');
