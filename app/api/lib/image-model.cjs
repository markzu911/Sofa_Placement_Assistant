const { AppError, fetchWithTimeout } = require("./_runtime.cjs");
const { extractGeneratedImage } = require("./_shared.cjs");
const { GoogleGenAI } = require("@google/genai");

const GEMINI_TIMEOUT_MS = 88000;

function withTimeout(promise, timeoutMs = GEMINI_TIMEOUT_MS, message = "Gemini 请求超时（88s），已为保存结果预留时间，请稍后重试。") {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AppError(message, 504)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function buildSdkGenerateRequest({ ai, geminiRequest }) {
  const config = geminiRequest.config || geminiRequest.generationConfig || {};
  return {
    model: ai.model,
    contents: geminiRequest.contents,
    config: {
      imageConfig: config.imageConfig,
      safetySettings: config.safetySettings || geminiRequest.safetySettings,
    },
  };
}

function buildSdkTextRequest({ ai, geminiRequest }) {
  const config = geminiRequest.config || geminiRequest.generationConfig || {};
  return {
    model: ai.model,
    contents: geminiRequest.contents,
    config: {
      safetySettings: config.safetySettings || geminiRequest.safetySettings,
    },
  };
}

function toOpenAiImageContent(inlineData) {
  const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
  return {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${inlineData.data}`,
      detail: "auto",
    },
  };
}

function buildGatewayMessages(geminiRequest) {
  const content = [];
  const contents = Array.isArray(geminiRequest.contents) ? geminiRequest.contents : [geminiRequest.contents];

  for (const item of contents) {
    const parts = item && Array.isArray(item.parts) ? item.parts : [];
    for (const part of parts) {
      if (part && part.text) {
        content.push({ type: "text", text: String(part.text) });
      }

      const inlineData = part && (part.inlineData || part.inline_data);
      if (inlineData && inlineData.data) {
        content.push(toOpenAiImageContent(inlineData));
      }
    }
  }

  if (!content.length) {
    throw new AppError("Gemini 请求内容为空。", 400);
  }

  return [{ role: "user", content }];
}

function readGatewayText(message) {
  const content = message && message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part) return "";
      if (typeof part === "string") return part;
      if (part.type === "text" && part.text) return String(part.text);
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function collectGatewayImageCandidates(value, output = []) {
  if (!value || typeof value !== "object") return output;

  if (typeof value.url === "string") output.push(value.url);
  if (typeof value.b64_json === "string") output.push(`data:image/png;base64,${value.b64_json}`);
  if (typeof value.data === "string" && /^[A-Za-z0-9+/=]+$/.test(value.data)) {
    output.push(`data:${value.mediaType || value.mimeType || "image/png"};base64,${value.data}`);
  }

  const imageUrl = value.image_url || value.imageUrl;
  if (typeof imageUrl === "string") output.push(imageUrl);
  if (imageUrl && typeof imageUrl.url === "string") output.push(imageUrl.url);
  if (value.source && typeof value.source.data === "string") {
    output.push(`data:${value.source.media_type || value.source.mediaType || "image/png"};base64,${value.source.data}`);
  }

  if (Array.isArray(value.images)) {
    for (const image of value.images) collectGatewayImageCandidates(image, output);
  }
  if (Array.isArray(value.content)) {
    for (const part of value.content) collectGatewayImageCandidates(part, output);
  }

  return output;
}

async function normalizeImageToDataUrl(imageValue) {
  const value = String(imageValue || "");
  if (value.startsWith("data:image/")) return value;
  if (!/^https?:\/\//i.test(value)) return "";

  const response = await fetchWithTimeout(
    value,
    { method: "GET" },
    GEMINI_TIMEOUT_MS,
    "AI Gateway 图片读取超时（120s）",
  );
  if (!response.ok) {
    throw new AppError(`AI Gateway 图片读取失败：${response.status}`, 502);
  }
  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function extractGatewayGeneratedImage(responseJson) {
  const message = responseJson && responseJson.choices && responseJson.choices[0] && responseJson.choices[0].message;
  const candidates = collectGatewayImageCandidates(message);
  for (const candidate of candidates) {
    const dataUrl = await normalizeImageToDataUrl(candidate);
    if (dataUrl) {
      const mimeType = dataUrl.slice(5, dataUrl.indexOf(";"));
      return { mimeType, dataUrl, text: readGatewayText(message) };
    }
  }

  throw new AppError("Vercel AI Gateway 没有返回图片，请检查模型是否支持 Image Gen。", 502);
}

function getErrorMessage(responseJson, responseText) {
  if (responseJson && responseJson.error) {
    if (typeof responseJson.error === "string") return responseJson.error;
    if (responseJson.error.message) return responseJson.error.message;
  }
  return responseText || "上游接口无错误详情";
}

async function readJsonOrRaw(response) {
  const responseText = await response.text();
  try {
    return {
      responseJson: responseText ? JSON.parse(responseText) : {},
      responseText,
    };
  } catch {
    return {
      responseJson: { raw: responseText },
      responseText,
    };
  }
}

async function callNativeGemini({ ai, geminiRequest }) {
  try {
    const client = new GoogleGenAI({ apiKey: ai.apiKey });
    const response = await withTimeout(client.models.generateContent(buildSdkGenerateRequest({ ai, geminiRequest })));
    return extractGeneratedImage(response);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "Gemini 生图失败。", 502);
  }
}

function extractNativeText(response) {
  if (!response) return "";
  if (typeof response.text === "string") return response.text.trim();
  if (typeof response.text === "function") {
    try {
      const value = response.text();
      if (typeof value === "string") return value.trim();
    } catch {
      return "";
    }
  }

  const candidates = response && Array.isArray(response.candidates) ? response.candidates : [];
  const textParts = [];
  for (const candidate of candidates) {
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (part && part.text) textParts.push(String(part.text));
    }
  }
  return textParts.join("\n").trim();
}

async function callNativeGeminiText({ ai, geminiRequest, timeoutMs }) {
  try {
    const client = new GoogleGenAI({ apiKey: ai.apiKey });
    const response = await withTimeout(
      client.models.generateContent(buildSdkTextRequest({ ai, geminiRequest })),
      timeoutMs || 18000,
      "Gemini 图片分析超时，已跳过分析继续生成。",
    );
    return extractNativeText(response);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "Gemini 图片分析失败。", 502);
  }
}

async function callVercelAiGateway({ ai, geminiRequest }) {
  const imageConfig = geminiRequest.generationConfig && geminiRequest.generationConfig.imageConfig;
  const response = await fetchWithTimeout(
    `${ai.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ai.model,
        messages: buildGatewayMessages(geminiRequest),
        modalities: ["text", "image"],
        stream: false,
        imageConfig,
        providerOptions: {
          google: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig,
          },
        },
      }),
    },
    GEMINI_TIMEOUT_MS,
    "Vercel AI Gateway 请求超时（110s）",
  );

  const { responseJson, responseText } = await readJsonOrRaw(response);
  if (!response.ok) {
    throw new AppError(`Vercel AI Gateway 返回 ${response.status}: ${getErrorMessage(responseJson, responseText)}`, response.status || 502);
  }

  return extractGatewayGeneratedImage(responseJson);
}

async function callVercelAiGatewayText({ ai, geminiRequest, timeoutMs }) {
  const response = await fetchWithTimeout(
    `${ai.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ai.model,
        messages: buildGatewayMessages(geminiRequest),
        modalities: ["text"],
        stream: false,
        providerOptions: {
          google: {
            responseModalities: ["TEXT"],
          },
        },
      }),
    },
    timeoutMs || 18000,
    "Vercel AI Gateway 图片分析超时，已跳过分析继续生成。",
  );

  const { responseJson, responseText } = await readJsonOrRaw(response);
  if (!response.ok) {
    throw new AppError(`Vercel AI Gateway 返回 ${response.status}: ${getErrorMessage(responseJson, responseText)}`, response.status || 502);
  }

  const message = responseJson && responseJson.choices && responseJson.choices[0] && responseJson.choices[0].message;
  return readGatewayText(message);
}

async function callImageModel({ ai, geminiRequest }) {
  if (ai.provider === "vercel-ai-gateway") {
    return callVercelAiGateway({ ai, geminiRequest });
  }
  return callNativeGemini({ ai, geminiRequest });
}

async function callTextModel({ ai, geminiRequest, timeoutMs }) {
  if (ai.provider === "vercel-ai-gateway") {
    return callVercelAiGatewayText({ ai, geminiRequest, timeoutMs });
  }
  return callNativeGeminiText({ ai, geminiRequest, timeoutMs });
}

module.exports = {
  GEMINI_TIMEOUT_MS,
  callImageModel,
  callTextModel,
};
