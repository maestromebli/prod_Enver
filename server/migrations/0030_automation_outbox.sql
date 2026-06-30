-- Черга webhook автоматизації + журнал подій для метрик.

CREATE TABLE IF NOT EXISTS automation_webhook_outbox (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  target_url TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_outbox_pending
  ON automation_webhook_outbox (next_retry_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS automation_event_log (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  entity_type TEXT,
  entity_id BIGINT,
  outcome TEXT NOT NULL,
  detail_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_event_log_created
  ON automation_event_log (created_at DESC);
