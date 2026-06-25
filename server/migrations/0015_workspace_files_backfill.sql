-- Backfill manager_* у position_files з legacy constructor_workspace_files (ідемпотентно).
-- Файли не копіюються на диск — лише посилання на той самий storage_path.

INSERT INTO position_files (
  position_id,
  kind,
  original_name,
  storage_path,
  mime,
  size_bytes,
  uploaded_by,
  created_at
)
SELECT
  cwf.position_id,
  CASE cwf.kind
    WHEN 'tech' THEN 'manager_appliance'
    WHEN 'measurements' THEN 'manager_measurement'
    WHEN 'manager_image' THEN 'manager_photo'
    ELSE 'manager_other'
  END,
  COALESCE(NULLIF(trim(cwf.original_name), ''), NULLIF(trim(cwf.label), ''), 'файл'),
  cwf.storage_path,
  COALESCE(NULLIF(trim(cwf.mime), ''), 'application/octet-stream'),
  cwf.size_bytes,
  cwf.uploaded_by,
  cwf.created_at
FROM constructor_workspace_files cwf
WHERE cwf.kind IN ('tech', 'measurements', 'manager_image', 'custom')
  AND COALESCE(trim(cwf.storage_path), '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM position_files pf
    WHERE pf.position_id = cwf.position_id
      AND pf.storage_path = cwf.storage_path
      AND pf.kind LIKE 'manager_%'
  );
