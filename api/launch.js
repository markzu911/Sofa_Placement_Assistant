const { readJsonBody, sendJson } = require("./_shared");
const { getToolContext, hasToolContext, launchTool } = require("./_saas");
const { AppError } = require("./_runtime");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const context = getToolContext(payload);
    if (!hasToolContext(context)) {
      sendJson(res, 400, { error: "缺少 userId 或 toolId。" });
      return;
    }

    const launch = await launchTool(context);
    sendJson(res, 200, launch);
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 400;
    sendJson(res, statusCode, { error: error.message || "启动工具失败。" });
  }
};
