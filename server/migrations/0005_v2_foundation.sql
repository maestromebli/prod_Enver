-- ENVER v2: сесії, operator_sessions, позиції, архів замовлень.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON sessions(token_hash) WHERE token_hash IS NOT NULL;

ALTER TABLE operator_sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE operator_sessions ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE operator_sessions ADD COLUMN IF NOT EXISTS pause_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE operator_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_operator_sessions_open
  ON operator_sessions(operator_id, stage_key) WHERE finished_at IS NULL;

ALTER TABLE positions ADD COLUMN IF NOT EXISTS constructor_status TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS install_status TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS material TEXT NOT NULL DEFAULT '';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_address TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS install_at TIMESTAMPTZ;

-- Послідовність для positions.id (нові записи без MAX(id)+1)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'positions_id_seq'
  ) THEN
    CREATE SEQUENCE positions_id_seq;
    PERFORM setval(
      'positions_id_seq',
      GREATEST(COALESCE((SELECT MAX(id) FROM positions), 0), 1)
    );
    ALTER TABLE positions ALTER COLUMN id SET DEFAULT nextval('positions_id_seq');
    ALTER SEQUENCE positions_id_seq OWNED BY positions.id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_positions_folder_key ON positions(folder_key) WHERE folder_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_positions_current_stage ON positions(current_stage) WHERE current_stage <> '';
CREATE INDEX IF NOT EXISTS idx_orders_archived ON orders(is_archived);
