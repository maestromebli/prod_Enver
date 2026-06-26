-- Етап пакування видалено з workflow: колонку залишаємо для сумісності, статус — «Не потрібно».
UPDATE positions
SET packaging_status = 'Не потрібно'
WHERE packaging_status IS DISTINCT FROM 'Не потрібно';
