-- Посилання (URL) у файлах позиції без завантаження на диск
ALTER TABLE position_files ADD COLUMN IF NOT EXISTS external_url TEXT NOT NULL DEFAULT '';
