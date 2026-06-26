-- Кілька файлів ЧПК на позицію: тип матеріалу та декор для кожного файлу пакета.

ALTER TABLE constructive_package_files
  ADD COLUMN IF NOT EXISTS material_type TEXT NOT NULL DEFAULT '';

ALTER TABLE constructive_package_files
  ADD COLUMN IF NOT EXISTS material_decor TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_constructive_package_files_cnc
  ON constructive_package_files(package_id, kind)
  WHERE kind = 'cnc_file';
