const crypto = require("node:crypto");

const LOG_FIELDS = [
  "requestId",
  "event",
  "level",
  "durationMs",
  "userIdMasked",
  "toolId",
  "model",
  "viewType",
  "includeModel",
  "aspectRatio",
  "imageSize",
  "fileSize",
  "recordId",
  "errorMessage",
];

class AppError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function createRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function maskUserId(userId) {
  const value = String(userId || "");
  if (!value) return "";
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function createLogger(base = {}) {
  const startedAt = Date.now();
  const baseFields = {
    requestId: base.requestId || createRequestId(),
    userIdMasked: maskUserId(base.userId),
    toolId: base.toolId || "",
    model: base.model || "",
    viewType: base.viewType || "",
    includeModel: base.includeModel === undefined ? "" : Boolean(base.includeModel),
    aspectRatio: base.aspectRatio || "",
    imageSize: base.imageSize || "",
  };

  return {
    requestId: baseFields.requestId,
    child(extra = {}) {
      return createLogger({ ...baseFields, ...extra, requestId: baseFields.requestId });
    },
    log(event, extra = {}) {
      const level = extra.level || "info";
      const entry = {};
      for (const field of LOG_FIELDS) {
        if (field === "event") {
          entry[field] = event;
        } else if (field === "level") {
          entry[field] = level;
        } else if (field === "durationMs") {
          entry[field] = Number.isFinite(extra.durationMs) ? extra.durationMs : Date.now() - startedAt;
        } else if (field === "userIdMasked") {
          entry[field] = extra.userId ? maskUserId(extra.userId) : baseFields.userIdMasked;
        } else if (Object.prototype.hasOwnProperty.call(extra, field)) {
          entry[field] = extra[field];
        } else if (Object.prototype.hasOwnProperty.call(baseFields, field)) {
          entry[field] = baseFields[field];
        } else {
          entry[field] = "";
        }
      }

      const line = JSON.stringify(entry);
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    },
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000, timeoutMessage = "请求超时") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new AppError(timeoutMessage, 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  AppError,
  createLogger,
  createRequestId,
  fetchWithTimeout,
};
