import runtimeLib from "../lib/_runtime.cjs";
import saas from "../lib/_saas.cjs";

const { AppError } = runtimeLib;
const { getToolContext, hasToolContext, launchTool } = saas;

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
  try {
    const payload = await readJsonPayload(request);
    const context = getToolContext(payload);
    if (!hasToolContext(context)) {
      return json({ error: "缺少 userId 或 toolId。" }, 400);
    }

    const launch = await launchTool(context);
    return json(launch);
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 400;
    return json({ error: error.message || "启动工具失败。" }, statusCode);
  }
}
