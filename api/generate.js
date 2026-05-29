const {
  DEFAULT_MODEL,
  buildGeminiRequest,
  extractGeneratedImage,
  readJsonBody,
  sendJson,
} = require("./_shared");
const {
  buildResultFileName,
  getToolContext,
  hasToolContext,
  imageBufferFromDataUrl,
  saveResultImageToSaas,
  verifyBeforeGenerate,
} = require("./_saas");
const { AppError, createLogger, createRequestId, fetchWithTimeout } = require("./_runtime");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TIMEOUT_MS = 120000;

module.exports = async function handler(req, res) {
  const requestId = createRequestId();
  const requestStartedAt = Date.now();
  let logger = createLogger({ requestId });

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  if (!apiKey) {
    logger = createLogger({ requestId, model });
    logger.log("generate.fail", {
      level: "error",
      durationMs: Date.now() - requestStartedAt,
      errorMessage: "未配置 GEMINI_API_KEY",
    });
    sendJson(res, 500, { error: "未配置 GEMINI_API_KEY。请在 Vercel 环境变量或本地 .env 中设置。" });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const toolContext = getToolContext(payload);
    logger = createLogger({
      requestId,
      userId: toolContext.userId,
      toolId: toolContext.toolId,
      model,
      viewType: payload.viewType,
      includeModel: payload.includeModel,
      aspectRatio: payload.aspectRatio,
      imageSize: payload.imageSize,
    });

    logger.log("generate.start");

    if (!hasToolContext(toolContext)) {
      throw new AppError("缺少 SaaS 用户上下文，请从平台入口打开工具。", 400);
    }

    const geminiRequest = buildGeminiRequest(payload);
    await verifyBeforeGenerate(toolContext, logger);

    const geminiStartedAt = Date.now();
    logger.log("gemini.start");
    let image;
    try {
      const response = await fetchWithTimeout(
        `${GEMINI_API_BASE}/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(geminiRequest),
        },
        GEMINI_TIMEOUT_MS,
        "Gemini 请求超时（120s）",
      );

      const responseText = await response.text();
      let responseJson = {};
      try {
        responseJson = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseJson = { raw: responseText };
      }

      if (!response.ok) {
        const message = responseJson.error && responseJson.error.message ? responseJson.error.message : responseText;
        throw new AppError(`Gemini API 返回 ${response.status}: ${message}`, response.status || 502);
      }

      image = extractGeneratedImage(responseJson);
      logger.log("gemini.success", { durationMs: Date.now() - geminiStartedAt });
    } catch (error) {
      logger.log("gemini.fail", {
        level: "error",
        durationMs: Date.now() - geminiStartedAt,
        errorMessage: error.message,
      });
      throw error;
    }

    const { mimeType, buffer } = imageBufferFromDataUrl(image.dataUrl);
    const savedImage = await saveResultImageToSaas({
      context: toolContext,
      imageBuffer: buffer,
      mimeType,
      fileName: buildResultFileName(payload, mimeType),
      logger,
    });

    logger.log("generate.success", {
      durationMs: Date.now() - requestStartedAt,
      fileSize: savedImage.fileSize,
      recordId: savedImage.recordId,
    });

    sendJson(res, 200, {
      model,
      mimeType,
      text: image.text,
      dataUrl: savedImage.url,
      recordId: savedImage.recordId,
      url: savedImage.url,
      fileName: savedImage.fileName,
      fileSize: savedImage.fileSize,
      savedToRecords: savedImage.savedToRecords,
      image: savedImage,
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 400;
    logger.log("generate.fail", {
      level: "error",
      durationMs: Date.now() - requestStartedAt,
      errorMessage: error.message || "生成失败。",
    });
    sendJson(res, statusCode, { error: error.message || "生成失败。", requestId });
  }
};
