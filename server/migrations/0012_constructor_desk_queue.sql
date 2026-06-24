-- Черга столу конструктора: коли позиція передана головному конструктору на призначення

ALTER TABLE positions ADD COLUMN IF NOT EXISTS constructor_desk_queued_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_positions_constructor_desk_queue
  ON positions(constructor_desk_queued_at)
  WHERE constructor_desk_queued_at IS NOT NULL;
