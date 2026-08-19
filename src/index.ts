import { RecorderContainer } from "./container";
import { handleRequest } from "./http";
import type { Env } from "./types";
import { RecordingJobWorkflow } from "./workflows/recording-job";
import { RecordingSchedulerWorkflow } from "./workflows/scheduler";

export { RecorderContainer, RecordingJobWorkflow, RecordingSchedulerWorkflow };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
