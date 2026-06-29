-- Коди операцій Bazis з .project для сканування фізичних етикеток (0010x002x1).

ALTER TABLE constructive_parts
  ADD COLUMN IF NOT EXISTS bazis_operation_codes TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE constructive_part_instances
  ADD COLUMN IF NOT EXISTS bazis_operation_code TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_constructive_parts_bazis_ops
  ON constructive_parts USING GIN (bazis_operation_codes);

CREATE INDEX IF NOT EXISTS idx_constructive_part_instances_bazis_op
  ON constructive_part_instances (bazis_operation_code)
  WHERE bazis_operation_code <> '';
