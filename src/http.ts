import { insertProgram, insertSchedule, listPrograms, listRecordings, listSchedules } from "./db";
import { isRadikoTimeshiftUrl } from "./r2-key";
import type { Env } from "./types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function unauthorized(): Response {
  return json({ ok: false, error: "unauthorized" }, 401);
}

function badRequest(error: string): Response {
  return json({ ok: false, error }, 400);
}

export function isAuthorized(request: Request, env: Env): boolean {
  const token = env.RIRE_API_TOKEN;
  if (!token) {
    return true;
  }
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

function needsAuth(method: string, pathname: string): boolean {
  if (pathname === "/health" && method === "GET") {
    return false;
  }
  if (pathname === "/" && method === "GET") {
    return false;
  }
  return true;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (needsAuth(method, pathname) && !isAuthorized(request, env)) {
    return unauthorized();
  }

  if (method === "GET" && pathname === "/") {
    return json({
      name: "rire",
      ok: true,
      docs: "/docs/research-2026-08.md",
      health: "/health",
    });
  }

  if (method === "GET" && pathname === "/health") {
    return json({ ok: true });
  }

  if (method === "GET" && pathname === "/programs") {
    return json({ ok: true, programs: await listPrograms(env.DB) });
  }

  if (method === "POST" && pathname === "/programs") {
    const body = await readJson(request);
    const stationId = asString(body.stationId);
    const title = asString(body.title);
    const id = asString(body.id) ?? crypto.randomUUID();
    if (!stationId || !title) {
      return badRequest("stationId and title are required");
    }
    const defaultDurationMin =
      typeof body.defaultDurationMin === "number" ? body.defaultDurationMin : null;
    try {
      await insertProgram(env.DB, { id, stationId, title, defaultDurationMin });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "insert failed" }, 409);
    }
    return json({ ok: true, id }, 201);
  }

  if (method === "GET" && pathname === "/schedules") {
    return json({ ok: true, schedules: await listSchedules(env.DB) });
  }

  if (method === "POST" && pathname === "/schedules") {
    const body = await readJson(request);
    const programId = asString(body.programId);
    const stationId = asString(body.stationId);
    const startedAt = asString(body.startedAt);
    const endedAt = asString(body.endedAt);
    const timeshiftUrl = asString(body.timeshiftUrl);
    if (!programId || !stationId || !startedAt || !endedAt || !timeshiftUrl) {
      return badRequest("programId, stationId, startedAt, endedAt, timeshiftUrl are required");
    }
    if (!isRadikoTimeshiftUrl(timeshiftUrl)) {
      return badRequest("timeshiftUrl must be a radiko timeshift or share URL");
    }
    if (Number.isNaN(Date.parse(startedAt)) || Number.isNaN(Date.parse(endedAt))) {
      return badRequest("startedAt and endedAt must be ISO-8601");
    }
    const id = asString(body.id) ?? crypto.randomUUID();
    try {
      await insertSchedule(env.DB, {
        id,
        programId,
        stationId,
        startedAt,
        endedAt,
        timeshiftUrl,
      });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "insert failed" }, 409);
    }
    return json({ ok: true, id }, 201);
  }

  if (method === "GET" && pathname === "/recordings") {
    return json({ ok: true, recordings: await listRecordings(env.DB) });
  }

  if (method === "POST" && pathname === "/jobs") {
    const body = await readJson(request);
    const scheduleId = asString(body.scheduleId);
    if (!scheduleId) {
      return badRequest("scheduleId is required");
    }
    const instance = await env.RECORDING_JOB.create({
      params: {
        scheduleId,
        simulate: body.simulate === true,
      },
    });
    return json({ ok: true, id: instance.id }, 202);
  }

  if (method === "POST" && pathname === "/scheduler/run") {
    const instance = await env.RECORDING_SCHEDULER.create();
    return json({ ok: true, id: instance.id }, 202);
  }

  return json({ ok: false, error: "not found" }, 404);
}
