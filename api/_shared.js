const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const DEFAULT_MODEL = "gemini-3-pro-image-preview";

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
  wide: "远景图：广角构图，完整展示房间结构、动线、沙发位置与周边家具关系。",
  mid: "中近景：三分之四视角，沙发为画面主体，同时保留墙面、地面与软装环境。",
  close: "近景：突出沙发原有面料、扶手、坐垫、缝线和光影质感，仍能看出真实场景。",
  model: "模特：一位成年生活方式模特自然坐靠或互动，模特不能遮挡沙发关键轮廓和细节。",
};

const PLACEMENT_PRESETS = {
  auto:
    "自动找位：先分析房间结构、地面透视、已有家具、茶几、窗户、门洞和主要动线，再选择最合理的沙发摆放位置。不要把产品随意放在画面正中央、贴到前景、或放在另一个沙发前面。",
  replace:
    "替换原座位：如果场景里已有沙发、扶手椅或主座位，把该家具替换为参考图 1 的沙发。旧家具不能与新产品重叠、穿帮或重复出现。",
  wall:
    "靠墙摆放：让沙发背部顺着墙面或主视觉轴线摆放，坐落在地面上，并与地毯、边几、茶几保持真实距离。",
  corner:
    "角落陈列：把沙发放在房间角落或窗边休闲区，保留开阔动线，不能遮挡门窗主要采光。",
};

const SCALE_PRESETS = {
  natural: "自然尺度：允许把产品整体等比例放大或缩小，以匹配真实家具尺寸、房间距离和镜头透视；产品不能过大压迫空间，也不能像贴纸一样悬浮。",
  hero: "商品主角：产品可以整体等比例放大得更醒目，但仍必须处于合理座位区，不能挡住茶几、窗户、门洞或主要动线。",
  compact: "空间展示：产品可以整体等比例稍微缩小，更多展示房间关系、地毯、墙面、茶几和周边软装。",
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

  return { mimeType, data };
}

function buildPrompt(payload, hasStyleReferenceImage) {
  const productName = String(payload.productName || "").trim();
  const productDescription = String(payload.productDescription || "").trim();
  const styleKey = String(payload.sceneStyle || "modern");
  const viewKey = String(payload.viewType || "wide");
  const placementKey = String(payload.placementStrategy || "auto");
  const scaleKey = String(payload.scaleIntent || "natural");
  const placementNotes = String(payload.placementNotes || "").trim();
  const aspectRatio = String(payload.aspectRatio || "1:1");
  const imageSize = String(payload.imageSize || "2K").toUpperCase();
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.modern;
  const viewLine = VIEW_PRESETS[viewKey] || VIEW_PRESETS.wide;
  const placementLine = PLACEMENT_PRESETS[placementKey] || PLACEMENT_PRESETS.auto;
  const scaleLine = SCALE_PRESETS[scaleKey] || SCALE_PRESETS.natural;
  const styleReferenceLine = hasStyleReferenceImage
    ? "Reference image 2 is a loose room-style reference only: borrow its color palette, material mood, lighting quality, decor taste, and overall atmosphere. Do not copy, preserve, or reconstruct the exact room, layout, furniture positions, architecture, windows, walls, floor plan, camera angle, or perspective from reference image 2."
    : "No room-style reference image is provided.";

  return [
    "ROLE: You are a senior ecommerce furniture image editor, interior stylist, and room-layout designer.",
    "TASK: Integrate the sofa from reference image 1 into a physically plausible interior scene and output one photorealistic commercial image.",
    "",
    "CRITICAL PRODUCT IDENTITY LOCK:",
    "Reference image 1 is the immutable source of truth for the sofa product.",
    "Treat the product in reference image 1 as a locked ecommerce SKU, not a design inspiration. Reconstruct it as a 1:1 product match inside the new scene.",
    "Keep the sofa design, silhouette, armrest shape, back height, cushion count, cushion thickness, seam lines, piping, legs, upholstery material, fabric texture, color, pattern, proportions, and decorative details unchanged.",
    "You may uniformly scale the entire product larger or smaller to fit the room naturally, but you must preserve its internal proportions and exact design.",
    "Do not redesign, recolor, reupholster, simplify, beautify, replace, non-uniformly stretch or squash, warp, round off, add tufting, remove seams, add pillows that hide the product, change cushion count, change leg style, change arm style, or invent missing product details.",
    "Product name and product fidelity notes are only auxiliary annotations for features that are unclear in reference image 1. They must never override or alter the visible product appearance in reference image 1.",
    "Allowed changes only: uniform product scaling, camera angle adaptation, physically plausible perspective correction, environment lighting, contact shadows, reflections, and occlusion required to place the exact product naturally in the scene.",
    "If the requested room/style conflicts with product fidelity, product fidelity wins. The final sofa must look like the same physical sofa/SKU from reference image 1, with no visible product-design changes.",
    "",
    "SCENE:",
    `生成一个符合此风格的新室内场景：${styleLine}`,
    styleReferenceLine,
    "Create a new, original, physically plausible room layout for the product. Do not treat reference image 2 as a target room for image compositing.",
    "从一开始就围绕参考图 1 的沙发设计真实、可居住的房间布局，不要先生成背景再把沙发贴到前景。参考图 1 的沙发必须是房间里的主沙发，不要在它后方或旁边再生成另一个主沙发。",
    "",
    "ROOM LAYOUT AND PLACEMENT RULES:",
    "Before rendering, silently analyze the floor plane, horizon line, vanishing direction, wall/floor junctions, furniture grouping, window/door openings, rug position, coffee table clearance, and walking paths.",
    placementLine,
    scaleLine,
    "Scale and place the product so it does not feel out of place: match the room's camera distance, furniture scale, floor perspective, seating group spacing, and visual hierarchy.",
    placementNotes ? `用户额外摆放要求：${placementNotes}` : "用户额外摆放要求：无。",
    "The sofa must sit on the floor plane with believable perspective, contact shadows, occlusion, and scale. Its base/feet must touch the floor and align with the room's vanishing lines.",
    "Match the product lighting to the scene: direction, softness, color temperature, shadow density, reflections, and ambient fill should make the product feel photographed in the same room.",
    "Keep at least a realistic walking path around the sofa. Do not block doors, windows, coffee tables, side tables, lamps, or existing seating in an impossible way.",
    "If the sofa is replacing an existing seat, remove or fully replace that old seat. Do not show duplicate or overlapping sofas.",
    "Do not place the sofa directly in front of another couch, armchair, or large seat. Do not leave a background sofa behind the product unless it is clearly a separate distant chair and does not compete with the product.",
    "The sofa should belong to a seating group: align it with the rug, coffee table, wall, or conversation area. Its position should look selected by an interior designer, not centered just because it is the product.",
    "Do not paste the sofa as a foreground sticker. It must feel intentionally placed by an interior designer.",
    "",
    "COMPOSITION:",
    viewLine,
    productName ? `产品名称：${productName}` : "产品名称：未填写；不要根据默认品类或名称猜测产品外观，只以参考图 1 为准。",
    `产品还原要点：${productDescription || "无额外文字要点；严格以参考图 1 的可见外观为准"}。`,
    `输出规格：${imageSize}，画幅比例 ${aspectRatio}，单张成图。`,
    "",
    "QUALITY RULES:",
    "Photorealistic commercial photography, correct perspective, realistic scale, natural contact shadow, coherent lighting, consistent depth of field, no watermark, no text, no price tag, no logo overlay, no duplicate sofa, no malformed furniture, no extra random products covering the sofa.",
    "Reject bad layout internally: floating product, wrong floor contact, mismatched scale, pasted-in foreground object, product that feels too large or too small for the room, impossible overlap with coffee table, blocked circulation path, inconsistent lighting, or furniture that ignores the room perspective.",
    "Final self-check before output: the product style is unchanged, the product is only uniformly scaled if needed, and the result looks like a naturally staged furniture photo rather than a cutout pasted into a scene.",
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

  const productImage = parseDataUrl(payload.productImage, "沙发产品图");
  const styleReferenceImage = parseDataUrl(payload.styleReferenceImage, "房间风格参考图");
  const sceneStyle = String(payload.sceneStyle || "modern");

  if (!productImage) {
    throw new Error("为了尽量保持原产品样式不变，请先上传沙发产品图。");
  }
  if (sceneStyle === "custom" && !styleReferenceImage) {
    throw new Error("已选择自定义风格，请上传房间风格参考图。");
  }

  const hasStyleReferenceImage = Boolean(styleReferenceImage);
  const parts = [
    { text: buildPrompt(payload, hasStyleReferenceImage) },
    { text: "Reference image 1: exact sofa product. Preserve this SKU identity above all other instructions." },
    { inlineData: { mimeType: productImage.mimeType, data: productImage.data } },
  ];

  if (hasStyleReferenceImage) {
    parts.push(
      { text: "Reference image 2: room style reference only. Use it for mood, palette, materials, lighting, and decor taste; do not copy the original room structure or layout." },
      { inlineData: { mimeType: styleReferenceImage.mimeType, data: styleReferenceImage.data } },
    );
  }

  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize,
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
