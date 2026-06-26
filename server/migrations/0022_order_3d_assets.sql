-- 3D-моделі замовлення (оригінал .b3d + web .glb для перегляду)

CREATE TABLE IF NOT EXISTS order_3d_assets (
  id                      SERIAL PRIMARY KEY,
  order_id                INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  original_storage_path   TEXT NOT NULL,
  original_file_name      TEXT NOT NULL,
  original_file_type      TEXT NOT NULL,
  web_model_storage_path  TEXT,
  preview_storage_path    TEXT,
  status                  TEXT NOT NULL DEFAULT 'UPLOADED',
  error_message           TEXT,
  uploaded_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_3d_assets_order ON order_3d_assets(order_id);
CREATE INDEX IF NOT EXISTS idx_order_3d_assets_order_created ON order_3d_assets(order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_3d_conversion_jobs (
  id          SERIAL PRIMARY KEY,
  asset_id    INTEGER NOT NULL REFERENCES order_3d_assets(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_3d_jobs_asset ON order_3d_conversion_jobs(asset_id);
CREATE INDEX IF NOT EXISTS idx_order_3d_jobs_pending ON order_3d_conversion_jobs(status) WHERE status = 'pending';
