-- Діагностичний report.json після B3D-конвертації

ALTER TABLE order_3d_assets
  ADD COLUMN IF NOT EXISTS report_storage_path TEXT;
