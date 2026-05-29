import shared from "./_shared.cjs";

const { DEFAULT_MODEL } = shared;

export const NATIVE_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const VERCEL_AI_GATEWAY_BASE = "https://ai-gateway.vercel.sh/v1";

function clean(value) {
  return String(value || "").trim();
}

function stripTrailingSlash(value) {
  return clean(value).replace(/\/+$/, "");
}

export function isVercelAiGatewayEnabled() {
  const provider = clean(process.env.GEMINI_PROVIDER || process.env.AI_PROVIDER).toLowerCase();
  if (provider === "vercel-ai-gateway" || provider === "vercel") return true;
  if (process.env.GEMINI_USE_AI_GATEWAY === "true") return true;
  return false;
}

export function normalizeGatewayModel(model) {
  const value = clean(model || DEFAULT_MODEL);
  if (value.includes("/")) return value;
  if (value === "gemini-3-pro-image-preview") return "google/gemini-3-pro-image";
  return `google/${value}`;
}

export function getAiRuntimeConfig() {
  if (isVercelAiGatewayEnabled()) {
    const model = normalizeGatewayModel(
      process.env.AI_GATEWAY_IMAGE_MODEL ||
        process.env.GEMINI_IMAGE_MODEL ||
        "google/gemini-3-pro-image",
    );

    return {
      provider: "vercel-ai-gateway",
      baseUrl: stripTrailingSlash(process.env.AI_GATEWAY_BASE_URL || VERCEL_AI_GATEWAY_BASE),
      apiKey: clean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
      model,
      missingKeyMessage:
        "未配置 AI_GATEWAY_API_KEY。请在 Vercel Environment Variables 添加 AI_GATEWAY_API_KEY，或配置 Vercel OIDC。",
    };
  }

  return {
    provider: "google-gemini-native",
    baseUrl: stripTrailingSlash(process.env.GEMINI_API_BASE_URL || NATIVE_GEMINI_API_BASE),
    apiKey: clean(process.env.GEMINI_API_KEY),
    model: clean(process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL),
    missingKeyMessage: "未配置 GEMINI_API_KEY。请在 Vercel 环境变量或本地 .env 中设置。",
  };
}
