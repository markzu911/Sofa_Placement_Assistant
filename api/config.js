const { DEFAULT_MODEL, MAX_BODY_BYTES, sendJson } = require("./_shared");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  sendJson(res, 200, {
    model,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    maxBodyBytes: MAX_BODY_BYTES,
  });
};
