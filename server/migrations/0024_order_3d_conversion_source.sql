-- Джерело конвертації B3D (b3d_enver3_assembly, project_panels, python_b3d_converter, …)

ALTER TABLE order_3d_assets
  ADD COLUMN IF NOT EXISTS conversion_source TEXT;
