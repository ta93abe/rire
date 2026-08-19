import { describe, expect, it } from "vitest";
import { buildObjectKeys, isRadikoTimeshiftUrl, toJstKeyTimestamp } from "../src/r2-key";

describe("toJstKeyTimestamp", () => {
  it("keeps an explicit JST offset", () => {
    expect(toJstKeyTimestamp("2025-10-12T14:00:00+09:00")).toBe("2025-10-12T140000+09:00");
  });

  it("converts UTC to JST", () => {
    expect(toJstKeyTimestamp("2025-10-12T05:00:00.000Z")).toBe("2025-10-12T140000+09:00");
  });
});

describe("buildObjectKeys", () => {
  it("puts identity in the path instead of the title", () => {
    const keys = buildObjectKeys({
      stationId: "FMT",
      programId: "10002831",
      startedAt: "2025-10-12T14:00:00+09:00",
    });
    expect(keys.r2Key).toBe("radio/FMT/10002831/2025/10/2025-10-12T140000+09:00.m4a");
    expect(keys.r2JsonKey).toBe("radio/FMT/10002831/2025/10/2025-10-12T140000+09:00.json");
  });

  it("rejects unsafe path parts", () => {
    expect(() =>
      buildObjectKeys({
        stationId: "../etc",
        programId: "1",
        startedAt: "2025-10-12T14:00:00+09:00",
      }),
    ).toThrow(/stationId/);
  });
});

describe("isRadikoTimeshiftUrl", () => {
  it("accepts timeshift hash URLs", () => {
    expect(isRadikoTimeshiftUrl("https://radiko.jp/#!/ts/FMT/20251012140000")).toBe(true);
  });

  it("accepts share URLs", () => {
    expect(isRadikoTimeshiftUrl("https://radiko.jp/share/?sid=FMT&t=20250528142747")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(isRadikoTimeshiftUrl("https://example.com/#!/ts/FMT/1")).toBe(false);
  });
});
