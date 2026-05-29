const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = path.join(ROOT, ".env");
const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;

  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || /\s/.test(key)) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.split(" #")[0].trim();
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 20 * 1024 * 1024);
const MAX_INPUT_IMAGE_BYTES = Number(process.env.MAX_INPUT_IMAGE_BYTES || 15 * 1024 * 1024);

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

const STYLE_PRESETS = {
  modern: "现代简约：干净线条、自然留白、暖白与木色平衡，空间通透。",
  cream_luxury: "轻奢暖居：浅米白、暖灰、金属细节，柔和棚拍质感。",
  italian: "意式极简：低饱和石材、深浅对比、克制高级的家具陈列。",
  japandi: "侘寂日式：天然木、亚麻、低矮家具、安静柔和的居住氛围。",
  scandinavian: "北欧自然：明亮采光、浅木地板、绿植点缀、舒适生活感。",
  french: "法式复古：线脚墙面、柔和窗光、复古地毯与精致软装。",
  loft: "都市 Loft：微水泥、黑色金属、开放式空间，硬朗但有生活温度。",
  coastal: "海岸度假：浅色织物、藤编、自然光、蓝绿色点缀，清爽松弛。",
  custom: "自定义风格：以参考图 2 的房间风格为主，提取其色调、材质、光线、软装气质和整体氛围。",
};

const VIEW_PRESETS = {
  wide:
    "CAMERA VIEW = FAR / TRUE WIDE COMMERCIAL ROOM SHOT / 远景商品空间图。Camera distance tier: FAR, clearly across the room from the product, roughly 5-7 meters away or equivalent interior-photography distance. Keep the product at the same photographed yaw, pitch, visible sides, and perspective cues from reference image 1. Pull the virtual camera clearly farther back along that same viewing direction, then render a wider original room around the product, but keep this a product-led ecommerce image rather than a real-estate room panorama. This must not look like a medium shot or close shot. Show broad floor area in front of and around the product, wall/floor junction, at least one full wall or large wall section, nearby rug/table/window/door cues, and the product's placement relationship to the room. At least 72% of the image area should be room context and negative space. The full product should be visible, readable, and roughly 8-16% of the image area; its bounding box must not exceed about 30% of the image width or 34% of the image height. Place the product near the lower-middle/center seating zone with generous breathing room on all sides, not cropped, not pushed to a corner or edge. Do not create distance by scaling, warping, changing product pose, or pasting a cutout over a background. Besides the reference product, do not add any sofa, recliner, armchair, lounge chair, chaise, bench, ottoman, pouf, dining chair, stool, or any other seating-shaped furniture anywhere in the room.",
  mid:
    "CAMERA VIEW = MEDIUM PRODUCT-IN-ROOM SHOT / 中景。Camera distance tier: MEDIUM, roughly 2.5-4 meters away or equivalent room-distance product photography. Keep the product at the same photographed yaw, pitch, visible sides, and perspective cues from reference image 1. Use a realistic room-distance camera on that same viewing direction. The exact product is the main subject, fully visible, with enough surrounding floor, rug, coffee table, wall, and decor cues to prove it is naturally placed. The product should occupy roughly 28-42% of the image area; its bounding box should be about 44-62% of the image width or height. This must be clearly closer than the far view and clearly farther than the close view. Do not enlarge the product body, change product pose, or composite a foreground cutout; use camera distance, lens choice, and framing only.",
  close:
    "CAMERA VIEW = CLOSE COMMERCIAL DETAIL SHOT / 近景。Camera distance tier: CLOSE, roughly 1-2 meters away or equivalent detail/product close-up distance. Keep the product at the same photographed yaw, pitch, visible sides, and perspective cues from reference image 1. Move the virtual camera closer along that same viewing direction, keeping the SKU identity and real proportions intact. Emphasize material, cushions, armrests, seams, legs, and lighting while still showing floor contact or a small amount of real room context. The product should occupy roughly 58-78% of the image area; its bounding box should fill about 70-90% of the image width or height. This must be clearly closer than the medium view. Controlled edge cropping is allowed only if the SKU identity, seat count, main silhouette, material, armrests, cushion structure, and source-photo pose remain readable; it must not become an abstract partial object or change physical size, category, seat count, or source-photo pose.",
};

const ASPECT_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "3:2", "2:3", "5:4", "4:5"]);
const IMAGE_SIZES = new Set(["2K", "4K"]);
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function readJsonBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("请求体过大，请压缩参考图后重试。"));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("请求 JSON 无效。"));
      }
    });

    req.on("error", reject);
  });
}

function parseDataUrl(value, label) {
  if (!value) return null;
  const dataUrl = typeof value === "string" ? value : value.dataUrl;
  if (typeof dataUrl !== "string" || !dataUrl.includes(",")) return null;

  const [header, data] = dataUrl.split(",", 2);
  if (!header.startsWith("data:") || !header.includes(";base64")) {
    throw new Error(`${label} 图片数据无效，请重新上传。`);
  }

  const mimeType = header.slice(5).split(";")[0].trim().toLowerCase();
  if (!MIME_TYPES.has(mimeType)) {
    throw new Error(`${label} 仅支持 PNG、JPG/JPEG、WEBP。`);
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new Error(`${label} 图片数据无效，请重新上传。`);
  }
  if (Buffer.byteLength(data, "base64") > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`${label} 超过 15MB，请压缩后重试。`);
  }

  return { mimeType, data };
}

function buildQualityLine(imageSize) {
  if (imageSize === "4K") {
    return "[QUALITY: 4K Ultra HD, photorealistic commercial interior photography, sharp focus, high dynamic range, extremely detailed upholstery texture, realistic shadows and material response.]";
  }
  return "[QUALITY: 2K UHD, high definition commercial interior photography, clean lighting, sharp product texture, realistic shadows and coherent perspective.]";
}

function buildPrompt(payload, hasStyleReferenceImage) {
  const styleKey = String(payload.sceneStyle || "modern");
  const viewKey = String(payload.viewType || "wide");
  const includeModel = Boolean(payload.includeModel);
  const aspectRatio = String(payload.aspectRatio || "1:1");
  const imageSize = String(payload.imageSize || "2K").toUpperCase();
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.modern;
  const viewLine = VIEW_PRESETS[viewKey] || VIEW_PRESETS.wide;
  const modelLine = includeModel
    ? "MODEL: Add exactly one adult lifestyle model. The model may sit naturally on the product, lean lightly on an armrest, or stand beside it. Keep the model secondary and do not cover key product details."
    : "MODEL: No people, bodies, hands, faces, or human figures.";
  const styleReferenceLine = hasStyleReferenceImage
    ? "Reference image 2 is ONLY a loose room-style reference. Borrow palette, material mood, lighting, decor taste, and atmosphere. Do not copy its exact room, layout, architecture, furniture positions, camera angle, or perspective."
    : "No room-style reference image is provided.";

  return [
    "TASK: Create one photorealistic ecommerce furniture placement image.",
    buildQualityLine(imageSize),
    "",
    "REFERENCE ORDER:",
    "Reference Image 1 = exact furniture product. It is the immutable product identity source.",
    hasStyleReferenceImage
      ? "Reference Image 2 = room style mood only. It is not a background plate."
      : "Only Reference Image 1 is provided.",
    "",
    "CRITICAL PRODUCT PRESERVATION:",
    "Keep Reference Image 1 product 100% identical: category, seat count, physical size class, proportions, silhouette, viewing angle, visible sides, armrests, backrest, cushion count, seams, legs/base, upholstery material, fabric texture, color, pattern, and details.",
    "Do not redesign, recolor, widen, narrow, stretch, squash, rotate, change seat count, change product category, add pillows that hide identity, or invent missing product details.",
    "Only change camera distance/framing, room environment, lighting integration, contact shadows, and natural occlusion needed to place the exact product in the room.",
    "",
    "SCENE:",
    `Create a new original interior scene in this style: ${styleLine}`,
    styleReferenceLine,
    "Render product and room as one coherent photographed scene with shared perspective, lighting, shadows, grain, depth of field, contact shadows, and floor contact.",
    "The product must be the only seating object. Do not add another sofa, recliner, armchair, chaise, bench, ottoman, dining chair, stool, or background seating group.",
    "Place the product in a believable seating zone with rug/table/window/wall/floor context and realistic walking clearance.",
    "",
    "COMPOSITION:",
    viewLine,
    "Keep the product's original photographed angle. Wide/mid/close must be created by camera distance and framing only, not by resizing or rotating the product.",
    modelLine,
    `Aspect ratio: ${aspectRatio}. Single image output.`,
    "",
    "NEGATIVE RULES: no text, no watermark, no price tag, no logo overlay, no duplicate product, no malformed furniture, no pasted cutout edge, no floating product, no mismatched perspective.",
    "Output the image only.",
  ].join("\n");
}

function buildGeminiRequest(payload) {
  const aspectRatio = String(payload.aspectRatio || "1:1");
  const imageSize = String(payload.imageSize || "2K").toUpperCase();

  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error("图片比例不在支持范围内。");
  }
  if (!IMAGE_SIZES.has(imageSize)) {
    throw new Error("分辨率只支持 2K 或 4K。");
  }

  const productImage = parseDataUrl(payload.productImage, "家具产品图");
  const styleReferenceImage = parseDataUrl(payload.styleReferenceImage, "房间风格参考图");
  const sceneStyle = String(payload.sceneStyle || "modern");

  if (!productImage) {
    throw new Error("为了尽量保持原产品样式不变，请先上传家具产品图。");
  }
  if (sceneStyle === "custom" && !styleReferenceImage) {
    throw new Error("已选择自定义风格，请上传房间风格参考图。");
  }

  const hasStyleReferenceImage = Boolean(styleReferenceImage);
  const parts = [
    { inlineData: { mimeType: productImage.mimeType, data: productImage.data } },
  ];

  if (hasStyleReferenceImage) {
    parts.push({ inlineData: { mimeType: styleReferenceImage.mimeType, data: styleReferenceImage.data } });
  }

  parts.push({ text: buildPrompt(payload, hasStyleReferenceImage) });

  return {
    contents: {
      parts,
    },
    config: {
      imageConfig: {
        aspectRatio,
      },
      safetySettings: SAFETY_SETTINGS,
    },
    generationConfig: {
      imageConfig: {
        aspectRatio,
      },
    },
  };
}

function extractGeneratedImage(response) {
  const candidates = response && Array.isArray(response.candidates) ? response.candidates : [];
  const textParts = [];

  for (const candidate of candidates) {
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (part.text) textParts.push(String(part.text));
      const inline = part.inlineData || part.inline_data;
      if (inline && inline.data) {
        const mimeType = inline.mimeType || inline.mime_type || "image/png";
        return {
          mimeType,
          dataUrl: `data:${mimeType};base64,${inline.data}`,
          text: textParts.join("\n").trim(),
        };
      }
    }
  }

  throw new Error("Gemini 没有返回图片，请换一张参考图或降低约束后重试。");
}

module.exports = {
  DEFAULT_MODEL,
  MAX_BODY_BYTES,
  buildGeminiRequest,
  extractGeneratedImage,
  readJsonBody,
  sendJson,
};
