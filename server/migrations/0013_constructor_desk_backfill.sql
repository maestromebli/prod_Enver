-- Позиції замовлень «Новий» / «У конструктиві», які ще не в черзі конструктора
UPDATE positions p
SET
  current_stage = 'constructor',
  constructor_desk_queued_at = COALESCE(p.constructor_desk_queued_at, now())
FROM orders o
WHERE p.position_status NOT IN ('Архів', 'Скасовано')
  AND (p.order_id = o.id OR (p.order_id IS NULL AND p.order_number = o.order_number))
  AND trim(coalesce(o.status, '')) IN ('Новий', 'У конструктиві')
  AND p.constructor_desk_queued_at IS NULL
  AND p.constructor_user_id IS NULL
  AND p.constructor_assigned_at IS NULL
  AND trim(coalesce(p.constructor_name, '')) = ''
  AND (
    NOT COALESCE(p.has_constructive_file, FALSE)
    OR coalesce(p.cutting_status, 'Не розпочато') = 'Не розпочато'
  );
