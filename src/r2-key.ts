const ID_RE = /^[A-Za-z0-9._-]+$/;

export function assertSafePathPart(value: string, label: string): string {
  if (!ID_RE.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return value;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 放送開始時刻を JST のオブジェクトキー断片にする（オフセットをキーに含める） */
export function toJstKeyTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid startedAt: ${iso}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((item) => item.type === type);
    if (!part) {
      throw new Error(`missing date part ${type}`);
    }
    return part.value;
  };

  const year = get("year");
  const month = pad(Number(get("month")));
  const day = pad(Number(get("day")));
  const hour = pad(Number(get("hour")));
  const minute = pad(Number(get("minute")));
  const second = pad(Number(get("second")));
  return `${year}-${month}-${day}T${hour}${minute}${second}+09:00`;
}

export function buildObjectKeys(input: {
  stationId: string;
  programId: string;
  startedAt: string;
}): { r2Key: string; r2JsonKey: string; year: string; month: string } {
  const stationId = assertSafePathPart(input.stationId, "stationId");
  const programId = assertSafePathPart(input.programId, "programId");
  const stamp = toJstKeyTimestamp(input.startedAt);
  const year = stamp.slice(0, 4);
  const month = stamp.slice(5, 7);
  const base = `radio/${stationId}/${programId}/${year}/${month}/${stamp}`;
  return {
    r2Key: `${base}.m4a`,
    r2JsonKey: `${base}.json`,
    year,
    month,
  };
}

export function isRadikoTimeshiftUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  if (parsed.hostname !== "radiko.jp" && parsed.hostname !== "www.radiko.jp") {
    return false;
  }
  const hash = parsed.hash;
  const path = parsed.pathname;
  if (hash.startsWith("#!/ts/") || hash.startsWith("#/ts/")) {
    return true;
  }
  if (path === "/share/" || path === "/share") {
    return parsed.searchParams.has("sid") && parsed.searchParams.has("t");
  }
  return false;
}
