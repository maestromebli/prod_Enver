-- Позиції з пакетом конструктива мають has_constructive_file = TRUE (legacy-прапорець для handoff/ШІ).
UPDATE positions p
SET has_constructive_file = TRUE
WHERE NOT COALESCE(p.has_constructive_file, FALSE)
  AND EXISTS (SELECT 1 FROM constructive_packages cp WHERE cp.position_id = p.id);
