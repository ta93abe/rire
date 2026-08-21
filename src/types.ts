export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  RECORDER: DurableObjectNamespace;
  RECORDING_SCHEDULER: Workflow<Record<string, never>>;
  RECORDING_JOB: Workflow<RecordingJobParams>;
  RADIKO_EMAIL?: string;
  RADIKO_PASSWORD?: string;
  RIRE_API_TOKEN?: string;
}

export interface RecordingJobParams {
  scheduleId: string;
  simulate?: boolean;
}

export type ScheduleStatus =
  | "pending"
  | "queued"
  | "recording"
  | "succeeded"
  | "failed"
  | "skipped";

export interface ProgramRow {
  id: string;
  station_id: string;
  title: string;
  default_duration_min: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRow {
  id: string;
  program_id: string;
  station_id: string;
  started_at: string;
  ended_at: string;
  timeshift_url: string;
  status: ScheduleStatus;
  created_at: string;
}

export interface RecordRequest {
  timeshiftUrl: string;
  r2Key: string;
  stationId: string;
  programId: string;
  startedAt: string;
  endedAt: string;
  simulate?: boolean;
}

export interface Sidecar {
  title: string | null;
  station: string;
  duration: number | null;
  ytDlpId: string | null;
  sourceUrl: string;
  recordedAt: string;
  extractor: string | null;
}

export interface RecordSuccess {
  ok: true;
  r2Key: string;
  r2JsonKey: string;
  bytes: number;
  durationSec: number | null;
  extractor: string | null;
  simulate: boolean;
  sidecar: Sidecar;
}

export interface RecordFailure {
  ok: false;
  errorCode: string;
  errorMessage: string;
}

export type RecordResult = RecordSuccess | RecordFailure;

export const SHARED_RECORDER_NAME = "rire-recorder";

export const FREE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
