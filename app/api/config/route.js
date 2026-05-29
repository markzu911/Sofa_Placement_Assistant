import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_MODEL, MAX_BODY_BYTES } = require("../../../api/_shared.cjs");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  return json({
    model,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    maxBodyBytes: MAX_BODY_BYTES,
  });
}
