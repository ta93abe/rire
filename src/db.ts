import type { ProgramRow, ScheduleRow, ScheduleStatus } from "./types";
import { FREE_WINDOW_MS } from "./types";

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export async function getProgram(
  db: D1Database,
  id: string,
): Promise<ProgramRow | null> {
  return db.prepare("SELECT * FROM programs WHERE id = ?").bind(id).first<ProgramRow>();
}

export async function insertProgram(
  db: D1Database,
  input: {
    id: string;
    stationId: string;
    title: string;
    defaultDurationMin?: number | null;
  },
): Promise<void> {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO programs (id, station_id, title, default_duration_min, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.stationId,
      input.title,
      input.defaultDurationMin ?? null,
      ts,
      ts,
    )
    .run();
}

export async function listPrograms(db: D1Database): Promise<ProgramRow[]> {
  const { results } = await db.prepare("SELECT * FROM programs ORDER BY title").all<ProgramRow>();
  return results ?? [];
}

export async function getSchedule(
  db: D1Database,
  id: string,
): Promise<ScheduleRow | null> {
  return db
    .prepare("SELECT * FROM recording_schedules WHERE id = ?")
    .bind(id)
    .first<ScheduleRow>();
}

export async function insertSchedule(
  db: D1Database,
  input: {
    id: string;
    programId: string;
    stationId: string;
    startedAt: string;
    endedAt: string;
    timeshiftUrl: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recording_schedules
        (id, program_id, station_id, started_at, ended_at, timeshift_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      input.id,
      input.programId,
      input.stationId,
      input.startedAt,
      input.endedAt,
      input.timeshiftUrl,
      nowIso(),
    )
    .run();
}

export async function listSchedules(db: D1Database): Promise<ScheduleRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM recording_schedules ORDER BY started_at DESC")
    .all<ScheduleRow>();
  return results ?? [];
}

export async function setScheduleStatus(
  db: D1Database,
  id: string,
  status: ScheduleStatus,
): Promise<void> {
  await db
    .prepare("UPDATE recording_schedules SET status = ? WHERE id = ?")
    .bind(status, id)
    .run();
}

function parseInstant(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.parse(iso.replace(" ", "T")) : ms;
}

export function classifyDue(endedAt: string, now = new Date()): "future" | "due" | "expired" {
  const endedMs = parseInstant(endedAt);
  if (Number.isNaN(endedMs) || endedMs > now.getTime()) {
    return "future";
  }
  if (now.getTime() - endedMs > FREE_WINDOW_MS) {
    return "expired";
  }
  return "due";
}

export async function listDueAndExpire(
  db: D1Database,
  now = new Date(),
): Promise<ScheduleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM recording_schedules
       WHERE status IN ('pending', 'failed')
       ORDER BY ended_at ASC`,
    )
    .all<ScheduleRow>();

  const due: ScheduleRow[] = [];

  for (const row of results ?? []) {
    const ended = classifyDue(row.ended_at, now);
    if (ended === "future") {
      continue;
    }
    if (ended === "expired") {
      await setScheduleStatus(db, row.id, "skipped");
      continue;
    }
    due.push(row);
  }
  return due;
}

export async function nextAttemptNo(db: D1Database, scheduleId: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COALESCE(MAX(attempt_no), 0) AS max_no FROM recording_attempts WHERE schedule_id = ?",
    )
    .bind(scheduleId)
    .first<{ max_no: number }>();
  return (row?.max_no ?? 0) + 1;
}

export async function insertAttempt(
  db: D1Database,
  input: {
    id: string;
    scheduleId: string;
    attemptNo: number;
    workflowInstanceId: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recording_attempts
        (id, schedule_id, attempt_no, status, workflow_instance_id, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    )
    .bind(input.id, input.scheduleId, input.attemptNo, input.workflowInstanceId, nowIso())
    .run();
}

export async function finishAttempt(
  db: D1Database,
  input: {
    id: string;
    status: "succeeded" | "failed";
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE recording_attempts
       SET status = ?, error_code = ?, error_message = ?, finished_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.status,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      nowIso(),
      input.id,
    )
    .run();
}

export async function insertRecording(
  db: D1Database,
  input: {
    id: string;
    scheduleId: string;
    programId: string;
    stationId: string;
    startedAt: string;
    r2Key: string;
    r2JsonKey: string;
    bytes: number | null;
    durationSec: number | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recordings
        (id, schedule_id, program_id, station_id, started_at, r2_key, r2_json_key, bytes, duration_sec, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.scheduleId,
      input.programId,
      input.stationId,
      input.startedAt,
      input.r2Key,
      input.r2JsonKey,
      input.bytes,
      input.durationSec,
      nowIso(),
    )
    .run();
}

export async function listRecordings(db: D1Database) {
  const { results } = await db
    .prepare("SELECT * FROM recordings ORDER BY recorded_at DESC")
    .all();
  return results ?? [];
}

export async function latestAttemptErrorCode(
  db: D1Database,
  scheduleId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT error_code FROM recording_attempts
       WHERE schedule_id = ?
       ORDER BY attempt_no DESC
       LIMIT 1`,
    )
    .bind(scheduleId)
    .first<{ error_code: string | null }>();
  return row?.error_code ?? null;
}
