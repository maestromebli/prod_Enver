-- Замовлення з Excel (об'єкти). Ідемпотентно: ON CONFLICT оновлює назву об'єкта.

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-40', 'Кухня Бориспіль (Людмила)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-88', 'Оптимісто полиці', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-123', 'ЖК Парк Резиденс/Олег ВВ', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-11', 'Галактика меблі', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-12', 'Галактика камінь', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-54', 'Кухня Паша', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-72', 'Файна Таун Олег (NSD)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-83', 'Клініка Коновальця (Павло)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-94', 'ЖК Варшавський плюс Меблі (Інорем)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-94/1', 'ЖК Варшавський плюс Стільниця (Інорем)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-97', 'Кухня на Юрківську SD', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-97/1', 'Cтільниця на Юрківську SD', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-98', 'ЖК Грейт 358 Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-100', 'Вітя Грушецький', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-105', 'ЖК Юніт Хоум ВВ', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-114', 'ЖК Манхеттен (Кириленко)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-122', 'ЖК Грейт 193 Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('Е-127', 'Кухня на Родини Крістерів', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-04', 'Олексій Чапаївка', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-06', 'Зінченко меблі', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-09', 'Меблі на Юрківську', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-09/1', 'Камінь на Юрківську', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-10', 'ЖК Автограф/Валентин (+ % ВВ)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-11', 'ЖК Автограф/Роберт', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-12', 'Грейт 357 Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-16', 'Осокорки 2 частина', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-18', 'Манхеттен Максим', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-19', 'ЖК Метрополіс SD', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-19/1', 'ЖК Метрополіс стільниці SD', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-20', 'Кухня Мая', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-23', 'Васильківська кв.38 (Чапаївка)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-24', 'Васильківська кв.48 (Чапаївка)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-25', 'Меблі Малашенко Іванків', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-28', 'Спальні/ Руликів', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-29', 'Передпокій/ Тарас', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-31', 'Санвузол/ вул. Ігорівська', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-32', 'Шафи ЖК Республіка ВВ', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-33', 'ЖЕ Нивки парк 3к (Чапаївка)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-35', 'Шафа на Ігорівську', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-36', 'ЖК LIKOGRAD/Strokova Design', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-38', 'Осокорки/спальня', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-39', 'Фасади в Ніццу МА', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-40', 'Офісні меблі на Рильського', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-41', 'ЖК Аристократ/Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-42', 'Полиця на кухню/ Чайка (запуск без авансу)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-43', 'Манхеттен Максим/Панелі+пенали', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-44', 'Іванковичі/Стелаж в спальню 1 етап Domindesign', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-45', 'Офіс на Берестейському (Таня Чапаївка)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-47', 'ЖК Грейт 357 (2ч)/ Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-48', 'ЖК Республіка кв 123/ Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-49', 'ЖК Окленд/ Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-50', 'ЖК Грейт 310/ Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-51', 'ЖК Шевченківский/Драгомарецька', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-52', 'Санвузол на Юрківську SD РЕЗЕРВ', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-53', 'Шафи 2ч/вул. Ігорівська Кирило', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-54', 'Меблі для офісу Еспанадна', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-55', 'Офіс Резидент Концпт Хаус Інорем', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-56', 'ЖК Файна Таун/Константин ВВ', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-56/1', 'Стільниця ЖК Файна Таун/Константин ВВ', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-58', 'Дитяча ЖК LIKOGRAD/Strokova Design', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-58/1', 'Стільниці ЖК LIKOGRAD/Strokova Design', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-59', 'Меблі Іванків/ Людмила', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-60', 'Меблі офісні Чорнобиль РЕЗЕРВ', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-61', 'ТВ Зона Зінаїда', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-62', 'Мельничук', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-63', 'Кухня Крюківщина', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-64', 'ЖК ГрінВіль/меблі (Катерина Дрозд)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-64/1', 'ЖК ГрінВіль/стільниця', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();

INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
VALUES ('ЕМ-65', 'ЖК Тетріс Холл (Таня Ранкова)', '', '', '', '', '', '', '')
ON CONFLICT (order_number) DO UPDATE SET object = EXCLUDED.object, updated_at = now();
