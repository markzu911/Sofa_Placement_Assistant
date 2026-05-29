const DEFAULT_SAAS_ORIGIN = "https://aibigtree.com";
const { AppError, fetchWithTimeout } = require("./_runtime");

const SAAS_TIMEOUT_MS = 20000;
const OSS_TIMEOUT_MS = 60000;
const LOCAL_SAAS_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function pickString(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    throw new AppError("SaaS 平台地址无效。", 400);
  }
}

function getEndpointOrigin(endpoint) {
  const raw = String(endpoint || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    return new URL(raw).origin;
  } catch {
    throw new AppError("SaaS 接口地址无效。", 400);
  }
}

function isAllowedSaasOrigin(origin) {
  const url = new URL(origin);
  if (url.origin === new URL(DEFAULT_SAAS_ORIGIN).origin) return true;
  return LOCAL_SAAS_HOSTNAMES.has(url.hostname);
}

function getSaasOrigin(context = {}, endpoint = "") {
  const contextOrigin = normalizeOrigin(context.saasOrigin);
  const endpointOrigin = getEndpointOrigin(endpoint);
  const origin = contextOrigin || endpointOrigin || DEFAULT_SAAS_ORIGIN;

  if (endpointOrigin && endpointOrigin !== origin) {
    throw new AppError("SaaS 接口地址与平台域名不一致。", 400);
  }
  if (!isAllowedSaasOrigin(origin)) {
    throw new AppError("SaaS 接口地址不被允许。", 400);
  }

  return origin;
}

function getToolContext(payload = {}) {
  const saas = payload.saas && typeof payload.saas === "object" ? payload.saas : {};
  const userId = pickString(payload, ["userId", "userid", "user_id", "uid"]) || pickString(saas, ["userId", "userid", "user_id", "uid"]);
  const toolId = pickString(payload, ["toolId", "toolid", "tool_id"]) || pickString(saas, ["toolId", "toolid", "tool_id"]);

  return {
    userId,
    toolId,
    saasOrigin:
      pickString(payload, ["saasOrigin", "saas_origin", "origin"]) ||
      pickString(saas, ["saasOrigin", "saas_origin", "origin"]),
    launchUrl: pickString(payload, ["launchUrl", "launch_url"]) || pickString(saas, ["launchUrl", "launch_url"]),
    verifyUrl: pickString(payload, ["verifyUrl", "verify_url"]) || pickString(saas, ["verifyUrl", "verify_url"]),
    consumeUrl: pickString(payload, ["consumeUrl", "consume_url"]) || pickString(saas, ["consumeUrl", "consume_url"]),
    uploadTokenUrl:
      pickString(payload, ["uploadTokenUrl", "upload_token_url", "directTokenUrl"]) ||
      pickString(saas, ["uploadTokenUrl", "upload_token_url", "directTokenUrl"]),
    uploadCommitUrl:
      pickString(payload, ["uploadCommitUrl", "upload_commit_url", "commitUrl"]) ||
      pickString(saas, ["uploadCommitUrl", "upload_commit_url", "commitUrl"]),
  };
}

function hasToolContext(context) {
  return Boolean(context && context.userId && context.toolId);
}

function buildToolBody(context) {
  return {
    userId: context.userId,
    toolId: context.toolId,
  };
}

function buildSaasUrl(context, pathname) {
  if (/^https?:\/\//i.test(pathname)) {
    const url = new URL(pathname);
    getSaasOrigin(context, pathname);
    return url.toString();
  }

  const path = String(pathname || "").startsWith("/") ? pathname : `/${pathname}`;
  return `${getSaasOrigin(context)}${path}`;
}

async function readJsonResponse(res, defaultStatusCode = 400) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }

  if (!res.ok || data.success === false) {
    throw new AppError(data.error || data.message || `SaaS 请求失败: ${res.status}`, defaultStatusCode);
  }

  return data;
}

async function postSaas(context, pathname, body, options = {}) {
  const defaultStatusCode = options.defaultStatusCode || 400;
  try {
    const res = await fetchWithTimeout(
      buildSaasUrl(context, pathname),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      options.timeoutMs || SAAS_TIMEOUT_MS,
      options.timeoutMessage || "SaaS 请求超时",
    );
    return readJsonResponse(res, defaultStatusCode);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "SaaS 请求失败", 502);
  }
}

async function launchTool(context) {
  return postSaas(context, context.launchUrl || "/api/tool/launch", buildToolBody(context), {
    timeoutMessage: "SaaS 启动接口超时",
  });
}

async function verifyBeforeGenerate(context, logger) {
  const startedAt = Date.now();
  logger?.log("saas.verify.start");
  try {
    const result = await postSaas(context, context.verifyUrl || "/api/tool/verify", buildToolBody(context), {
      timeoutMessage: "SaaS 积分校验超时",
      defaultStatusCode: 400,
    });
    logger?.log("saas.verify.success", { durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    logger?.log("saas.verify.fail", {
      level: "error",
      durationMs: Date.now() - startedAt,
      errorMessage: error.message,
    });
    throw error;
  }
}

function imageBufferFromDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
  if (!match) {
    throw new Error("生成结果图片数据无效。");
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionFromMimeType(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function buildResultFileName(payload, mimeType) {
  const viewType = String(payload.viewType || "wide").replace(/[^a-z0-9_-]/gi, "");
  const ratio = String(payload.aspectRatio || "1:1").replace(/[^0-9x:-]/gi, "").replace(":", "x");
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `furniture-placement-${viewType}-${ratio}-${timestamp}.${extensionFromMimeType(mimeType)}`;
}

async function saveResultImageToSaas({ context, imageBuffer, mimeType, fileName, logger }) {
  let startedAt = Date.now();
  logger?.log("saas.consume.start", { fileSize: imageBuffer.byteLength });
  try {
    await postSaas(context, context.consumeUrl || "/api/tool/consume", buildToolBody(context), {
      timeoutMessage: "SaaS 扣费接口超时",
      defaultStatusCode: 400,
    });
    logger?.log("saas.consume.success", {
      durationMs: Date.now() - startedAt,
      fileSize: imageBuffer.byteLength,
    });
  } catch (error) {
    logger?.log("saas.consume.fail", {
      level: "error",
      durationMs: Date.now() - startedAt,
      fileSize: imageBuffer.byteLength,
      errorMessage: error.message,
    });
    throw error;
  }

  startedAt = Date.now();
  logger?.log("upload.token.start", { fileSize: imageBuffer.byteLength });
  let token;
  try {
    token = await postSaas(
      context,
      context.uploadTokenUrl || "/api/upload/direct-token",
      {
        ...buildToolBody(context),
        source: "result",
        mimeType,
        fileName,
        fileSize: imageBuffer.byteLength,
      },
      {
        timeoutMessage: "SaaS 上传凭证接口超时",
        defaultStatusCode: 502,
      },
    );
  } catch (error) {
    logger?.log("upload.token.fail", {
      level: "error",
      durationMs: Date.now() - startedAt,
      fileSize: imageBuffer.byteLength,
      errorMessage: error.message,
    });
    throw error;
  }

  const uploadUrl = token.uploadUrl || token.ossUploadUrl;
  if (!uploadUrl) {
    const error = new AppError("SaaS 未返回 OSS 上传地址。", 502);
    logger?.log("upload.token.fail", {
      level: "error",
      fileSize: imageBuffer.byteLength,
      errorMessage: error.message,
    });
    throw error;
  }
  logger?.log("upload.token.success", {
    durationMs: Date.now() - startedAt,
    fileSize: imageBuffer.byteLength,
  });

  startedAt = Date.now();
  logger?.log("oss.put.start", { fileSize: imageBuffer.byteLength });
  try {
    const uploadRes = await fetchWithTimeout(
      uploadUrl,
      {
        method: token.method || "PUT",
        headers: token.headers || { "Content-Type": mimeType },
        body: imageBuffer,
      },
      OSS_TIMEOUT_MS,
      "OSS 上传超时",
    );
    if (!uploadRes.ok) {
      throw new AppError(`OSS 上传失败: ${uploadRes.status}`, 502);
    }
    logger?.log("oss.put.success", {
      durationMs: Date.now() - startedAt,
      fileSize: imageBuffer.byteLength,
    });
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError(error.message || "OSS 上传失败", 502);
    logger?.log("oss.put.fail", {
      level: "error",
      durationMs: Date.now() - startedAt,
      fileSize: imageBuffer.byteLength,
      errorMessage: appError.message,
    });
    throw appError;
  }

  startedAt = Date.now();
  logger?.log("upload.commit.start", { fileSize: imageBuffer.byteLength });
  let commit;
  try {
    commit = await postSaas(
      context,
      token.commitUrl || context.uploadCommitUrl || "/api/upload/commit",
      {
        ...buildToolBody(context),
        source: "result",
        objectKey: token.objectKey,
        fileSize: imageBuffer.byteLength,
      },
      {
        timeoutMessage: "SaaS 图片入库接口超时",
        defaultStatusCode: 502,
      },
    );
  } catch (error) {
    logger?.log("upload.commit.fail", {
      level: "error",
      durationMs: Date.now() - startedAt,
      fileSize: imageBuffer.byteLength,
      errorMessage: error.message,
    });
    throw error;
  }

  if (!commit.savedToRecords && !(commit.image && commit.image.savedToRecords)) {
    const error = new AppError(commit.error || "图片入库失败。", 502);
    logger?.log("upload.commit.fail", {
      level: "error",
      durationMs: Date.now() - startedAt,
      fileSize: imageBuffer.byteLength,
      errorMessage: error.message,
    });
    throw error;
  }

  const image = commit.image || {};
  const savedImage = {
    recordId: image.recordId || commit.recordId,
    url: image.url || commit.url || token.readUrl || token.publicUrl,
    fileName: image.fileName || commit.fileName || token.fileName || token.objectKey,
    fileSize: image.fileSize || imageBuffer.byteLength,
    savedToRecords: image.savedToRecords !== undefined ? image.savedToRecords : commit.savedToRecords,
  };

  logger?.log("upload.commit.success", {
    durationMs: Date.now() - startedAt,
    fileSize: savedImage.fileSize,
    recordId: savedImage.recordId,
  });

  return savedImage;
}

module.exports = {
  buildResultFileName,
  getSaasOrigin,
  getToolContext,
  hasToolContext,
  imageBufferFromDataUrl,
  launchTool,
  saveResultImageToSaas,
  verifyBeforeGenerate,
};
