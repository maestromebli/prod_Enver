-- Корінь папок проєктів і підпапки для контексту ШІ-зіставлення з логами станка
ALTER TABLE machine_config ADD COLUMN IF NOT EXISTS projects_root_path TEXT NOT NULL DEFAULT '';
ALTER TABLE machine_config ADD COLUMN IF NOT EXISTS ai_source_subfolders_json TEXT NOT NULL DEFAULT '["meta.json","giblab","kdt"]';
