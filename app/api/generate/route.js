import runtimeLib from "../lib/_runtime.cjs";
import { getAiRuntimeConfig } from "../lib/ai-config.js";
import imageModel from "../lib/image-model.cjs";
import saas from "../lib/_saas.cjs";
import shared from "../lib/_shared.cjs";

const {
  DEFAULT_MODEL,
  buildGeminiRequest,
} = shared;
const {
  buildResultFileName,
  getToolContext,
  hasToolContext,
  imageBufferFromDataUrl,
  saveResultImageToSaas,
  verifyBeforeGenerate,
} = saas;
const { callImageModel } = imageModel;
const { AppError, createLogger, createRequestId } = runtimeLib;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function readJsonPayload(request) {
  try {
    return await request.json();
  } catch {
    throw new AppError("请求 JSON 无效。", 400);
  }
}

export async function POST(request) {
  const requestId = createRequestId();
  const requestStartedAt = Date.now();
  let logger = createLogger({ requestId });

  const ai = getAiRuntimeConfig();
  const model = ai.model || DEFAULT_MODEL;
  if (!ai.apiKey) {
    logger = createLogger({ requestId, model });
    logger.log("generate.fail", {
      level: "error",
      durationMs: Date.now() - requestStartedAt,
      errorMessage: ai.missingKeyMessage,
    });
    return json({ error: ai.missingKeyMessage }, 500);
  }

  try {
    const payload = await readJsonPayload(request);
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
      image = await callImageModel({ ai, geminiRequest });
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

    return json({
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
    return json({ error: error.message || "生成失败。", requestId }, statusCode);
  }
}
