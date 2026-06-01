import runtimeLib from "../lib/_runtime.cjs";
import { getAiRuntimeConfig } from "../lib/ai-config.js";
import imageModel from "../lib/image-model.cjs";
import saas from "../lib/_saas.cjs";
import shared from "../lib/_shared.cjs";

const { DEFAULT_MODEL, buildSofaAnalysisRequest } = shared;
const { getToolContext, hasToolContext } = saas;
const { callTextModel } = imageModel;
const { AppError, createLogger, createRequestId } = runtimeLib;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANALYSIS_TIMEOUT_MS = 22000;

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
    logger.log("analysis.fail", {
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
    });

    if (!hasToolContext(toolContext)) {
      throw new AppError("缺少 SaaS 用户上下文，请从平台入口打开工具。", 400);
    }

    const analysisRequest = buildSofaAnalysisRequest(payload);
    logger.log("analysis.start");

    const sofaAnalysis = await callTextModel({
      ai,
      geminiRequest: analysisRequest,
      timeoutMs: ANALYSIS_TIMEOUT_MS,
    });

    logger.log("analysis.success", {
      durationMs: Date.now() - requestStartedAt,
      analysisLength: sofaAnalysis.length,
    });

    return json({
      model,
      sofaAnalysis,
      analysis: sofaAnalysis,
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 400;
    const errorMessage =
      typeof error.message === "string" && error.message !== "[object Object]"
        ? error.message
        : "图片分析失败，请稍后重试。";
    logger.log("analysis.fail", {
      level: "error",
      durationMs: Date.now() - requestStartedAt,
      errorMessage,
    });
    return json({ error: errorMessage, requestId }, statusCode);
  }
}
