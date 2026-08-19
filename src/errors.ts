export const TERMINAL_ERROR_CODES = new Set(["GEO_REJECTED"]);

export function isTerminalError(errorCode: string): boolean {
  return TERMINAL_ERROR_CODES.has(errorCode);
}

export function classifyMessage(errorCode: string, errorMessage: string): string {
  const text = `${errorCode} ${errorMessage}`.toLowerCase();
  if (
    text.includes("geo") ||
    text.includes("113") ||
    text.includes("reject-code") ||
    text.includes("geographic")
  ) {
    return "GEO_REJECTED";
  }
  if (text.includes("upload")) {
    return "UPLOAD_FAILED";
  }
  return errorCode || "YTDLP_EXIT";
}
