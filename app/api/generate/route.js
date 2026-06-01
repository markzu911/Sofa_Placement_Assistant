import runtimeLib from "../lib/_runtime.cjs";
import { getAiRuntimeConfig } from "../lib/ai-config.js";
import imageModel from "../lib/image-model.cjs";
import saas from "../lib/_saas.cjs";
import shared from "../lib/_shared.cjs";

const {
  DEFAULT_MODEL,
  buildGeminiRequest,
  buildSofaAnalysisRequest,
} = shared;
const {
  buildResultFileName,
  getToolContext,
  hasToolContext,
  imageBufferFromDataUrl,
  saveResultImageToSaas,
  verifyBeforeGenerate,
} = saas;
const { callImageModel, callTextModel } = imageModel;
const { AppError, createLogger, createRequestId } = runtimeLib;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYNC_RESPONSE_BUDGET_MS = 112000;
const SAVE_RESULT_MIN_BUDGET_MS = 18000;
const ANALYSIS_TIMEOUT_MS = 18000;

function isRenderableImageUrl(value) {
  return /^(https?:|data:image\/|\/)/i.test(String(value || ""));
}

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
      sceneType: payload.sceneType,
      viewType: payload.viewType,
      includeModel: payload.includeModel,
      aspectRatio: payload.aspectRatio,
      imageSize: payload.imageSize,
    });

    logger.log("generate.start");

    if (!hasToolContext(toolContext)) {
      throw new AppError("缺少 SaaS 用户上下文，请从平台入口打开工具。", 400);
    }

    buildGeminiRequest(payload);
    const analysisRequest = buildSofaAnalysisRequest(payload);
    await verifyBeforeGenerate(toolContext, logger);

    let sofaAnalysis = "";
    if (!payload.retryMode) {
      const analysisStartedAt = Date.now();
      logger.log("analysis.start");
      try {
        sofaAnalysis = await callTextModel({
          ai,
          geminiRequest: analysisRequest,
          timeoutMs: ANALYSIS_TIMEOUT_MS,
        });
        logger.log("analysis.success", {
          durationMs: Date.now() - analysisStartedAt,
          analysisLength: sofaAnalysis.length,
        });
      } catch (error) {
        logger.log("analysis.skip", {
          level: "warn",
          durationMs: Date.now() - analysisStartedAt,
          errorMessage: error.message,
        });
      }
    }

    const geminiRequest = buildGeminiRequest({
      ...payload,
      sofaAnalysis,
    });

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
    const remainingBudgetMs = SYNC_RESPONSE_BUDGET_MS - (Date.now() - requestStartedAt);
    if (remainingBudgetMs < SAVE_RESULT_MIN_BUDGET_MS) {
      logger.log("saas.save.skip", {
        level: "warn",
        durationMs: Date.now() - requestStartedAt,
        fileSize: buffer.byteLength,
        errorMessage: "剩余同步时间不足，跳过保存以避免网关 504。",
      });
      return json({
        model,
        mimeType,
        text: image.text,
        dataUrl: image.dataUrl,
        url: image.dataUrl,
        fileName: buildResultFileName(payload, mimeType),
        fileSize: buffer.byteLength,
        savedToRecords: false,
        image: {
          url: image.dataUrl,
          fileName: buildResultFileName(payload, mimeType),
          fileSize: buffer.byteLength,
          savedToRecords: false,
        },
        warning: "图片已生成，但本次模型耗时较长，为避免 504 未同步保存到我的图片。",
      });
    }

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

    const resultUrl = isRenderableImageUrl(savedImage.url) ? savedImage.url : image.dataUrl;

    return json({
      model,
      mimeType,
      text: image.text,
      dataUrl: resultUrl,
      recordId: savedImage.recordId,
      url: resultUrl,
      fileName: savedImage.fileName,
      fileSize: savedImage.fileSize,
      savedToRecords: savedImage.savedToRecords,
      image: {
        ...savedImage,
        url: resultUrl,
      },
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 400;
    const errorMessage =
      typeof error.message === "string" && error.message !== "[object Object]"
        ? error.message
        : "生成失败，请稍后重试。";
    logger.log("generate.fail", {
      level: "error",
      durationMs: Date.now() - requestStartedAt,
      errorMessage,
    });
    return json({ error: errorMessage, requestId }, statusCode);
  }
}
