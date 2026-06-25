-- Дані менеджера по позиції (єдине джерело для конструктива / закупки / виробництва)

ALTER TABLE orders ADD COLUMN IF NOT EXISTS default_delivery_address TEXT NOT NULL DEFAULT '';

ALTER TABLE positions ADD COLUMN IF NOT EXISTS delivery_address TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS delivery_contact_name TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS delivery_contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS position_deadline TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS measurement_date TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS installation_preferred_date TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS manager_data_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS manager_data_completed_at TIMESTAMPTZ;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS manager_data_completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS assignment_comment TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_positions_position_deadline ON positions(position_deadline)
  WHERE trim(position_deadline) <> '';

-- Права менеджерських даних
UPDATE role_permissions
SET permissions_json = (
  (permissions_json::jsonb || jsonb_build_object(
    'canEditPositionManagerData', role IN ('admin', 'production', 'manager'),
    'canScanParts', role IN ('admin', 'production', 'operator'),
    'canMap3dParts', role IN ('admin', 'production')
  ))::text
)
WHERE role IN ('admin', 'production', 'manager', 'operator');
