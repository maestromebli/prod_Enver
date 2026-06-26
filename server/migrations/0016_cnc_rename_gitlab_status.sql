-- Перейменування статусів GitLab → ЧПК (без плутанини з GibLab).

UPDATE constructive_packages SET status = 'sent_to_cnc' WHERE status = 'sent_to_gitlab';
UPDATE cnc_jobs SET status = 'sent_to_cnc' WHERE status = 'sent_to_gitlab';

UPDATE role_permissions
SET permissions_json = (
  (permissions_json::jsonb - 'canSendToGitlab')
  || jsonb_build_object(
    'canSendToCnc',
    COALESCE((permissions_json::jsonb->'canSendToGitlab')::boolean, role IN ('admin', 'production'))
  )
)::text;
