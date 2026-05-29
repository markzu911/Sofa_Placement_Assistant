import { getAiRuntimeConfig } from "../lib/ai-config.js";
import shared from "../lib/_shared.cjs";

const { DEFAULT_MODEL, MAX_BODY_BYTES } = shared;

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
  const ai = getAiRuntimeConfig();
  return json({
    model: ai.model || DEFAULT_MODEL,
    provider: ai.provider,
    hasApiKey: Boolean(ai.apiKey),
    maxBodyBytes: MAX_BODY_BYTES,
  });
}
