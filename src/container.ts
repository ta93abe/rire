import { Container, getContainer } from "@cloudflare/containers";
import { buildObjectKeys } from "./r2-key";
import { SHARED_RECORDER_NAME, type Env, type RecordRequest, type RecordResult, type Sidecar } from "./types";

const RESULT_HEADER = "x-rire-result";

export class RecorderContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "20m";
  enableInternet = true;

  override onStart(): void {
    console.log("rire recorder container started");
  }

  override onStop(_params: { exitCode?: number; reason?: string }): void {
    console.log("rire recorder container stopped");
  }

  override onError(error: unknown): void {
    console.log("rire recorder container error", error);
  }

  async record(job: RecordRequest): Promise<RecordResult> {
    await this.startAndWaitForPorts({
      ports: [8080],
      startOptions: {
        enableInternet: true,
        envVars: {
          RADIKO_EMAIL: this.env.RADIKO_EMAIL ?? "",
          RADIKO_PASSWORD: this.env.RADIKO_PASSWORD ?? "",
        },
      },
      cancellationOptions: {
        portReadyTimeoutMS: 60_000,
      },
    });

    const response = await this.containerFetch("http://container/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timeshiftUrl: job.timeshiftUrl,
        r2Key: job.r2Key,
        stationId: job.stationId,
        programId: job.programId,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        simulate: job.simulate === true,
      }),
    });

    if (!response.ok) {
      const failure = await readFailure(response);
      return failure;
    }

    const meta = readResultHeader(response);
    if (!meta || meta.ok !== true) {
      return {
        ok: false,
        errorCode: "YTDLP_EXIT",
        errorMessage: "container returned no result metadata",
      };
    }

    const keys = buildObjectKeys({
      stationId: job.stationId,
      programId: job.programId,
      startedAt: job.startedAt,
    });

    const sidecar: Sidecar = {
      ...meta.sidecar,
      station: job.stationId,
      sourceUrl: job.timeshiftUrl,
    };

    try {
      if (!job.simulate && response.body) {
        await this.env.BUCKET.put(keys.r2Key, response.body, {
          httpMetadata: { contentType: "audio/mp4" },
        });
      }
      await this.env.BUCKET.put(keys.r2JsonKey, JSON.stringify(sidecar, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "r2 put failed";
      return { ok: false, errorCode: "UPLOAD_FAILED", errorMessage: message };
    }

    return {
      ok: true,
      r2Key: keys.r2Key,
      r2JsonKey: keys.r2JsonKey,
      bytes: meta.bytes,
      durationSec: meta.durationSec,
      extractor: meta.extractor,
      simulate: job.simulate === true,
      sidecar,
    };
  }
}

interface ContainerMeta {
  ok: true;
  bytes: number;
  durationSec: number | null;
  extractor: string | null;
  sidecar: Sidecar;
}

function readResultHeader(response: Response): ContainerMeta | null {
  const raw = response.headers.get(RESULT_HEADER);
  if (!raw) {
    return null;
  }
  try {
    const json = JSON.parse(atob(raw)) as ContainerMeta;
    if (json.ok !== true) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

async function readFailure(response: Response): Promise<RecordResult> {
  try {
    const json = (await response.json()) as {
      errorCode?: string;
      errorMessage?: string;
      error_code?: string;
      error_message?: string;
    };
    return {
      ok: false,
      errorCode: json.errorCode ?? json.error_code ?? "YTDLP_EXIT",
      errorMessage: json.errorMessage ?? json.error_message ?? `container HTTP ${response.status}`,
    };
  } catch {
    return {
      ok: false,
      errorCode: "YTDLP_EXIT",
      errorMessage: `container HTTP ${response.status}`,
    };
  }
}

export function recorderStub(env: Env) {
  return getContainer(
    env.RECORDER as unknown as DurableObjectNamespace<RecorderContainer>,
    SHARED_RECORDER_NAME,
  );
}
