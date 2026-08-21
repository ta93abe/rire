-- 番組マスタ。表示名はここ（パスには使わない）
CREATE TABLE programs (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL,
  title TEXT NOT NULL,
  default_duration_min INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recording_schedules (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id),
  station_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  timeshift_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'recording', 'succeeded', 'failed', 'skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (station_id, started_at)
);

CREATE INDEX idx_schedules_due
  ON recording_schedules (status, ended_at);

CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES recording_schedules(id),
  program_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  r2_json_key TEXT,
  bytes INTEGER,
  duration_sec INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (schedule_id)
);

CREATE TABLE recording_attempts (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES recording_schedules(id),
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed')),
  error_code TEXT,
  error_message TEXT,
  workflow_instance_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  UNIQUE (schedule_id, attempt_no)
);
