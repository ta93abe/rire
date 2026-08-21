import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { listDueAndExpire, latestAttemptErrorCode, setScheduleStatus } from "../db";
import { isTerminalError } from "../errors";
import type { Env, RecordingJobParams } from "../types";

export class RecordingSchedulerWorkflow extends WorkflowEntrypoint<Env> {
  async run(_event: WorkflowEvent<Record<string, never>>, step: WorkflowStep) {
    const due = await step.do("list-due", async () => {
      const rows = await listDueAndExpire(this.env.DB);
      const startable = [];
      for (const row of rows) {
        if (row.status === "failed") {
          const last = await latestAttemptErrorCode(this.env.DB, row.id);
          if (last && isTerminalError(last)) {
            await setScheduleStatus(this.env.DB, row.id, "skipped");
            continue;
          }
        }
        startable.push({
          id: row.id,
          stationId: row.station_id,
          endedAt: row.ended_at,
        });
      }
      return startable;
    });

    const started: string[] = [];
    for (const row of due) {
      const instanceId = await step.do(`start-${row.id}`, async () => {
        await setScheduleStatus(this.env.DB, row.id, "queued");
        const instance = await this.env.RECORDING_JOB.create({
          params: { scheduleId: row.id } satisfies RecordingJobParams,
        });
        return instance.id;
      });
      started.push(instanceId);
    }

    return { count: started.length, ids: started };
  }
}
