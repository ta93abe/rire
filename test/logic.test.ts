import { describe, expect, it } from "vitest";
import { classifyDue } from "../src/db";
import { classifyMessage, isTerminalError } from "../src/errors";
import { isAuthorized } from "../src/http";
import type { Env } from "../src/types";

describe("classifyDue", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  it("marks future ends as not due", () => {
    expect(classifyDue("2026-08-19T13:00:00Z", now)).toBe("future");
  });

  it("marks recently ended programs as due", () => {
    expect(classifyDue("2026-08-19T11:00:00Z", now)).toBe("due");
  });

  it("expires the free 7-day window", () => {
    expect(classifyDue("2026-08-01T00:00:00Z", now)).toBe("expired");
  });
});

describe("errors", () => {
  it("treats geo rejection as terminal", () => {
    expect(isTerminalError("GEO_REJECTED")).toBe(true);
    expect(classifyMessage("YTDLP_EXIT", "GEO_REJECTED: radiko rejected this IP")).toBe(
      "GEO_REJECTED",
    );
  });
});

describe("isAuthorized", () => {
  const env = { RIRE_API_TOKEN: "secret" } as Env;

  it("allows all requests when no token is configured", () => {
    expect(isAuthorized(new Request("https://rire.test/"), { RIRE_API_TOKEN: undefined } as Env)).toBe(
      true,
    );
  });

  it("requires a bearer token when configured", () => {
    const authed = new Request("https://rire.test/jobs", {
      headers: { authorization: "Bearer secret" },
    });
    const anon = new Request("https://rire.test/jobs");
    expect(isAuthorized(authed, env)).toBe(true);
    expect(isAuthorized(anon, env)).toBe(false);
  });
});
