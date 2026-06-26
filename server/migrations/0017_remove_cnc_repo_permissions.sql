-- Прибрано інтеграцію з Git-репозиторієм (GitLab API) для доставки на ЧПК.

UPDATE role_permissions
SET permissions_json = (permissions_json::jsonb - 'canSendToCnc' - 'canSendToGitlab')::text;
