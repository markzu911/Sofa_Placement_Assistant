import runtimeLib from "../lib/_runtime.cjs";
import { getAiRuntimeConfig } from "../lib/ai-config.js";
import imageModel from "../lib/image-model.cjs";
import saas from "../lib/_saas.cjs";
import shared from "../lib/_shared.cjs";

const { DEFAULT_MODEL } = shared;
const { getToolContext } = saas;
const { callTextModel } = imageModel;
const { AppError, createLogger, createRequestId } = runtimeLib;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAT_TIMEOUT_MS = 28000;
const MAX_MESSAGES = 12;

const STYLE_VALUES = ["custom"];
const VIEW_VALUES = ["villa_wide", "wide", "mid", "close"];
const RATIO_VALUES = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "3:2", "2:3", "5:4", "4:5"];

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

function clean(value) {
  return String(value || "").trim();
}

function getChatModel(ai) {
  const model = clean(process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_TEXT_MODEL || process.env.AI_GATEWAY_CHAT_MODEL);
  if (model) {
    if (ai.provider === "vercel-ai-gateway" && !model.includes("/")) return `google/${model}`;
    return model;
  }
  return ai.provider === "vercel-ai-gateway" ? "google/gemini-2.5-flash" : "gemini-2.5-flash";
}

function getCurrentConfig(payload = {}) {
  const config = payload.currentConfig && typeof payload.currentConfig === "object" ? payload.currentConfig : {};
  const imageSize = clean(config.imageSize).toUpperCase();
  return {
    sceneStyle: STYLE_VALUES.includes(clean(config.sceneStyle)) ? clean(config.sceneStyle) : "custom",
    viewType: VIEW_VALUES.includes(clean(config.viewType)) ? clean(config.viewType) : "villa_wide",
    aspectRatio: RATIO_VALUES.includes(clean(config.aspectRatio)) ? clean(config.aspectRatio) : "16:9",
    imageSize: ["2K", "4K", "8K"].includes(imageSize) ? imageSize : "8K",
    includeModel: false,
  };
}

function buildContextText(payload) {
  const config = getCurrentConfig(payload);
  const analysis = clean(payload.currentAnalysis);
  const extraInstruction = clean(payload.currentExtraInstruction);
  const saasInfo = payload.saasInfo && typeof payload.saasInfo === "object" ? payload.saasInfo : {};

  return [
    "【当前别墅大型沙发生图上下文】",
    `- 是否已有大型沙发产品参考图: ${payload.hasProductImage ? "是" : "否"}`,
    `- 是否已有别墅客厅房间参考图: ${payload.hasRoomImage ? "是" : "否"}`,
    `- 当前场景风格 sceneStyle: ${config.sceneStyle}`,
    `- 当前摄影景别 viewType: ${config.viewType}`,
    `- 当前画幅 aspectRatio: ${config.aspectRatio}`,
    `- 当前分辨率 imageSize: ${config.imageSize}`,
    "- 是否添加人物: 否",
    analysis ? `- 当前生成分析:\n${analysis.slice(0, 2400)}` : "- 当前生成分析: 暂无",
    extraInstruction ? `- 当前补充要求:\n${extraInstruction.slice(0, 900)}` : "- 当前补充要求: 暂无",
    saasInfo.context ? `- SaaS 页面上下文: ${clean(saasInfo.context)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMessages(payload, systemInstruction) {
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-MAX_MESSAGES) : [];
  const contents = [
    {
      role: "user",
      parts: [
        {
          text:
            systemInstruction +
            "\n\n" +
            buildContextText(payload) +
            "\n请记住以上上下文。下一步只判断用户最新对话意图，并严格按 [REPLY] 与 [ACTION] 输出。",
        },
      ],
    },
    {
      role: "model",
      parts: [
        {
          text:
            "收到。我会围绕大型沙发产品 100% 还原、别墅客厅房间融合、24mm 广角斜侧摄影和对话触发生图来返回可执行 ACTION JSON。",
        },
      ],
    },
  ];

  for (const message of messages) {
    const role = message && message.role === "assistant" ? "model" : "user";
    const text = clean(message && message.content).slice(0, 1800);
    if (!text) continue;
    contents.push({ role, parts: [{ text }] });
  }

  return contents;
}

function buildChatRequest(payload) {
  const systemInstruction = `你是顶级别墅软装摄影师、高端家具视觉合成专家和 AI 对话生图助手。你的任务不是直接生成图片，而是根据用户最新一句话、历史对话、上传状态和当前参数，判断下一步应该执行什么动作。

【核心约束】
- 输出必须只包含 [REPLY] 和 [ACTION] 两段。
- [REPLY] 写给用户，使用简洁自然的中文。
- [ACTION] 必须是完全合法 JSON，不允许注释、Markdown 或额外文字。
- 每轮回复必须针对最新用户请求，严禁复制历史回复。
- 领域只围绕别墅、大平层、豪宅客厅、大型沙发、软装摄影、房间融合和产品 100% 还原。
- 只要已有产品图，默认目标就是 100% 保留产品图里的大型沙发组合方式、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、面料纹理、颜色和整体轮廓。用户要求软装、光线、构图或拍摄角度时，只改变空间和摄影表达，不改变产品本身。
- 房间参考图用于锁定别墅空间层高、墙面材质、窗户位置、采光方向、地面材质、吊灯、背景墙和豪宅氛围。

【action 定义】
1. "analyze_image": 用户上传了产品图/房间图后要求分析，或明确要求判断产品结构、房间融合、尺度比例、摄影机位。
2. "generate_smart": 用户明确要求生成、出图、做图、画一张、来一张、直接生成、开始生成、按当前参数生成。
3. "update_config": 用户只是在修改画幅、质感、拍摄角度、光线、软装氛围、补充构图要求，但没有明确要求立即生成。
4. "none": 普通问答、引导上传、信息不足或闲聊。

【detectedImageType】
- "product": 大型沙发产品参考图。
- "room": 别墅客厅、豪宅客厅、大平层客厅、房间参考图。
- "none": 没有新图片或无法判断。

【sceneStyle 可选值】
custom=别墅豪宅客厅，以房间参考图为准。

【viewType 可选值】
villa_wide=豪宅客厅广角斜侧视角，镜头高度约 1.3 米，24mm 室内建筑摄影镜头，完整展示大型沙发组合、客厅开阔感和空间层次。
wide/mid/close 是兼容旧调用的可选值；如果用户没有明确要求，默认 villa_wide。

【directGenerate 规则】
- 用户明确说“生成/出图/做图/画一张/来一张/开始/直接生成/按当前参数生成”，directGenerate 必须为 true。
- 用户说“定制/配置/选择/确认参数/改成/换成/想要某风格”但没有要求开始，action 用 "update_config"，directGenerate 为 false。
- 如果缺少产品参考图，action 可以是 "none" 或 "update_config"，reply 要提醒先上传大型沙发产品图；不要假装可以 100% 还原。
- 如果缺少房间参考图，reply 要提醒上传别墅客厅房间图；不要改成虚构房间。

【smartParams.extraInstruction】
- 必须把用户最新要求整理成可追加到生图 prompt 的自然语言。
- 只要已有产品图，extraInstruction 必须包含“严格保持大型沙发产品图的组合方式、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、面料纹理、颜色和整体轮廓 100% 不变”的语义。
- 如果用户要求拍摄角度，要写成摄影语言，例如“镜头高度约 1.3 米，24mm 室内建筑摄影镜头，从豪宅客厅斜侧方拍摄，完整展示大型沙发组合和空间层次”。
- 用户补充要求只能影响软装氛围、光线、构图、材质细节强调和局部陈设；不得改变沙发产品设计和房间核心结构。

【输出格式】
[REPLY]
中文回复

[ACTION]
{
  "action": "analyze_image" | "generate_smart" | "update_config" | "none",
  "actionExplanation": "中文动作说明",
  "detectedImageType": "product" | "room" | "none",
  "directGenerate": true | false,
  "smartParams": {
    "config": {
      "sceneStyle": "custom",
      "viewType": "villa_wide" | "wide" | "mid" | "close",
      "aspectRatio": "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9" | "3:2" | "2:3" | "5:4" | "4:5",
      "imageSize": "2K" | "4K" | "8K",
      "includeModel": false
    },
    "extraInstruction": "可追加到生图 prompt 的自然语言"
  }
}`;

  return {
    contents: buildMessages(payload, systemInstruction),
    config: {
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    },
    generationConfig: {
      systemInstruction,
    },
    systemInstruction,
  };
}

function formatChatResult(rawText) {
  const raw = clean(rawText);
  const replyMatch = raw.match(/\[REPLY\]\s*([\s\S]*?)(?=\n\s*\[ACTION\]|$)/i);
  const actionMatch = raw.match(/\[ACTION\]\s*([\s\S]*)$/i);
  const reply = clean(replyMatch && replyMatch[1]) || "我已理解你的要求，可以继续调整参数或直接生成。";
  const actionText = clean(actionMatch && actionMatch[1]);
  let action = null;
  if (actionText) {
    try {
      action = JSON.parse(actionText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim());
    } catch {
      action = null;
    }
  }
  return {
    raw,
    reply,
    action,
    text: raw,
  };
}

export async function POST(request) {
  const requestId = createRequestId();
  const requestStartedAt = Date.now();
  let logger = createLogger({ requestId });

  const baseAi = getAiRuntimeConfig();
  const ai = {
    ...baseAi,
    model: getChatModel(baseAi) || baseAi.model || DEFAULT_MODEL,
  };

  if (!ai.apiKey) {
    logger = createLogger({ requestId, model: ai.model });
    logger.log("chat.fail", {
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
      model: ai.model,
    });

    logger.log("chat.start");
    const text = await callTextModel({
      ai,
      geminiRequest: buildChatRequest(payload),
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    const result = formatChatResult(text);

    logger.log("chat.success", {
      durationMs: Date.now() - requestStartedAt,
    });
    return json({
      model: ai.model,
      ...result,
    });
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 400;
    const errorMessage =
      typeof error.message === "string" && error.message !== "[object Object]"
        ? error.message
        : "AI 对话解析失败，请稍后重试。";
    logger.log("chat.fail", {
      level: "error",
      durationMs: Date.now() - requestStartedAt,
      errorMessage,
    });
    return json({ error: errorMessage, requestId }, statusCode);
  }
}
