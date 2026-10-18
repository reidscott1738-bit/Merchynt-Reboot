/** Errors carry a user-presentable message; anything else is reported generically. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "forbidden" | "invalid" | "conflict" | "not_configured" | "rate_limited" | "external" = "invalid",
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what = "Record") => new AppError(`${what} not found`, "not_found");
export const forbidden = (msg = "You do not have permission to do that") => new AppError(msg, "forbidden");
export const invalid = (msg: string, details?: unknown) => new AppError(msg, "invalid", details);
export const notConfigured = (msg: string) => new AppError(msg, "not_configured");

/** Errors from providers that are worth retrying. */
export class TransientError extends Error {
  constructor(message: string, public retryAfterMs?: number) {
    super(message);
  }
}
