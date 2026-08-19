import { NonRetryableError } from "cloudflare:workflows";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { recorderStub } from "../container";
import {
  finishAttempt,
  getSchedule,
  insertAttempt,
  insertRecording,
  nextAttemptNo,
  setScheduleStatus,
} from "../db";
import { classifyMessage, isTerminalError } from "../errors";
import { buildObjectKeys } from "../r2-key";
import type { Env, RecordingJobParams, ScheduleRow } from "../types";

export class RecordingJobWorkflow extends WorkflowEntrypoint<Env, RecordingJobParams> {
  async run(event: WorkflowEvent<RecordingJobParams>, step: WorkflowStep) {
    const scheduleId = event.payload.scheduleId;
    if (!scheduleId) {
      throw new NonRetryableError("scheduleId is required");
    }

    const schedule = await step.do("load-schedule", async () => {
      const row = await getSchedule(this.env.DB, scheduleId);
      if (!row) {
        throw new NonRetryableError(`schedule not found: ${scheduleId}`);
      }
      if (row.status === "succeeded") {
        return { ...row, alreadyDone: true as const };
      }
      return { ...row, alreadyDone: false as const };
    });

    if (schedule.alreadyDone) {
      return { ok: true, skipped: true, reason: "already succeeded" };
    }

    const attempt = await step.do("mark-attempt", async () => {
      const attemptNo = await nextAttemptNo(this.env.DB, scheduleId);
      const attemptId = crypto.randomUUID();
      await insertAttempt(this.env.DB, {
        id: attemptId,
        scheduleId,
        attemptNo,
        workflowInstanceId: event.instanceId,
      });
      await setScheduleStatus(this.env.DB, scheduleId, "recording");
      return { attemptId, attemptNo };
    });

    let result;
    try {
      result = await step.do(
        "run-container",
        {
          retries: { limit: 2, delay: "30 seconds", backoff: "exponential" },
          timeout: "30 minutes",
        },
        async () => {
          const keys = buildObjectKeys({
            stationId: schedule.station_id,
            programId: schedule.program_id,
            startedAt: schedule.started_at,
          });
          const recorded = await recorderStub(this.env).record({
            timeshiftUrl: schedule.timeshift_url,
            r2Key: keys.r2Key,
            stationId: schedule.station_id,
            programId: schedule.program_id,
            startedAt: schedule.started_at,
            endedAt: schedule.ended_at,
            simulate: event.payload.simulate === true,
          });
          if (!recorded.ok) {
            if (isTerminalError(recorded.errorCode)) {
              throw new NonRetryableError(`${recorded.errorCode}: ${recorded.errorMessage}`);
            }
            throw new Error(`${recorded.errorCode}: ${recorded.errorMessage}`);
          }
          return recorded;
        },
      );
    } catch (error) {
      await step.do("mark-failed", async () => {
        const message = error instanceof Error ? error.message : "container failed";
        const errorCode = classifyMessage("", message);
        await failAttempt(this.env, schedule, attempt.attemptId, errorCode, message);
      });
      throw error;
    }

    await step.do("finalize", async () => {
      await insertRecording(this.env.DB, {
        id: crypto.randomUUID(),
        scheduleId,
        programId: schedule.program_id,
        stationId: schedule.station_id,
        startedAt: schedule.started_at,
        r2Key: result.r2Key,
        r2JsonKey: result.r2JsonKey,
        bytes: result.bytes,
        durationSec: result.durationSec,
      });
      await finishAttempt(this.env.DB, { id: attempt.attemptId, status: "succeeded" });
      await setScheduleStatus(this.env.DB, scheduleId, "succeeded");
      return { r2Key: result.r2Key };
    });

    return {
      ok: true,
      r2Key: result.r2Key,
      r2JsonKey: result.r2JsonKey,
      bytes: result.bytes,
      simulate: result.simulate,
    };
  }
}

export async function failAttempt(
  env: Env,
  schedule: ScheduleRow,
  attemptId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await finishAttempt(env.DB, {
    id: attemptId,
    status: "failed",
    errorCode,
    errorMessage,
  });
  await setScheduleStatus(
    env.DB,
    schedule.id,
    isTerminalError(errorCode) ? "skipped" : "failed",
  );
}
