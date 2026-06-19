-- Дефолтні мережеві шляхи KDT / Log для порізки
UPDATE machine_config
SET
  log_path = E'\\\\192.168.1.203\\KDTsaw',
  parser_profile = 'kdt',
  projects_root_path = E'\\\\192.168.1.203\\Log',
  watch_enabled = TRUE
WHERE stage_key = 'cutting'
  AND COALESCE(log_path, '') = '';

UPDATE app_settings
SET value_json = (
  COALESCE(value_json::jsonb, '{}'::jsonb) || jsonb_build_object('rootPath', E'\\\\192.168.1.203\\Log')
)::text
WHERE key = 'folder_agent'
  AND COALESCE(value_json::jsonb->>'rootPath', '') IN ('', '\\\\NAS\\ENVER');
