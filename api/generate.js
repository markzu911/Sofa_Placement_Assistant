const {
  DEFAULT_MODEL,
  buildGeminiRequest,
  extractGeneratedImage,
  readJsonBody,
  sendJson,
} = require("./_shared");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  if (!apiKey) {
    sendJson(res, 500, { error: "未配置 GEMINI_API_KEY。请在 Vercel 环境变量或本地 .env 中设置。" });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const geminiRequest = buildGeminiRequest(payload);
    const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(geminiRequest),
    });

    const responseText = await response.text();
    let responseJson = {};
    try {
      responseJson = responseText ? JSON.parse(responseText) : {};
    } catch {
      responseJson = { raw: responseText };
    }

    if (!response.ok) {
      const message = responseJson.error && responseJson.error.message ? responseJson.error.message : responseText;
      sendJson(res, response.status, { error: `Gemini API 返回 ${response.status}: ${message}` });
      return;
    }

    const image = extractGeneratedImage(responseJson);
    sendJson(res, 200, { model, ...image });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "生成失败。" });
  }
};
