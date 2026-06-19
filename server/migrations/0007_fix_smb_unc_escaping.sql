-- Виправлення UNC: у БД могло зберегтись \192.168.1.203Log замість \\192.168.1.203\Log
UPDATE machine_config
SET
  log_path = E'\\\\192.168.1.203\\KDTsaw',
  projects_root_path = E'\\\\192.168.1.203\\Log'
WHERE stage_key = 'cutting';

UPDATE app_settings
SET value_json = (
  COALESCE(value_json::jsonb, '{}'::jsonb) || jsonb_build_object('rootPath', E'\\\\192.168.1.203\\Log')
)::text
WHERE key = 'folder_agent';
