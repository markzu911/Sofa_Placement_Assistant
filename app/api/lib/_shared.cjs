const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
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
    ? "MODEL OPTION: REQUIRED. Add exactly one adult lifestyle model. The final image is invalid if no human model is visible. The model may sit naturally on the product, lean lightly on one armrest, stand beside it, read, or interact gently with it, but must match the scene lighting and perspective, must be scaled correctly for the selected camera distance, must not hide the product's key silhouette, armrests, cushions, legs, seams, material, color, or seat count, and must feel secondary to the product."
    : "MODEL OPTION: Do not add any people, bodies, hands, faces, or human figures.";
  const styleReferenceLine = hasStyleReferenceImage
    ? "Reference image 2 is a loose room-style reference only: borrow its color palette, material mood, lighting quality, decor taste, and overall atmosphere. Do not copy, preserve, or reconstruct the exact room, layout, furniture positions, architecture, windows, walls, floor plan, camera angle, or perspective from reference image 2. Do not use reference image 2 as a background plate, target room, or second layer for image compositing."
    : "No room-style reference image is provided.";

  return [
    "ROLE: You are a senior ecommerce furniture image editor, interior stylist, and room-layout designer.",
    "TASK: Render one unified photorealistic commercial image of the exact furniture product from reference image 1 inside a physically plausible interior scene.",
    buildQualityLine(imageSize),
    "This is a single-pass scene rendering task, not a two-image cutout, masking, matting, collage, or background-replacement task.",
    "",
    "HIGHEST PRIORITY SELECTED OUTPUT CONTRACT:",
    viewLine,
    modelLine,
    "If any instruction conflicts with this selected view contract or model contract, the selected output contract wins.",
    "",
    "CRITICAL PRODUCT IDENTITY LOCK:",
    "Reference image 1 is the immutable source of truth for the furniture product.",
    "Treat the product in reference image 1 as a locked ecommerce SKU, not a design inspiration. Reconstruct it as a 1:1 product match inside the new scene.",
    "First infer the photographed product angle from reference image 1: camera height, yaw/rotation, pitch, visible sides, horizon cues, lens perspective, and the floor-contact direction if visible.",
    "The final render must preserve that source-photo product pose and photographed viewing angle. Keep the same front/side relationship, visible faces, silhouette orientation, armrest/backrest perspective, leg/base perspective, and product-facing direction.",
    "先识别参考图 1 的真实产品类型和真实尺寸级别：它是单人椅就必须仍是单人椅，是双人位就必须仍是双人位，是多人位/转角/柜体/桌几就必须保持同一类别。严禁为了适配房间把产品改成更宽、更窄、更高、更矮、更多座位、更少座位或其他品类。",
    "先识别参考图 1 的已拍摄角度：镜头高度、左右朝向、俯仰、可见正面/侧面、透视方向和落地关系。最终远景、中景、近景都必须沿用这个产品拍摄角度进行整图渲染，而不是把产品抠出来贴到另一张房间图上。",
    "Keep the product category, physical size class, seat count, width-to-height ratio, volume/mass, design, silhouette, armrest shape, back height, cushion count, cushion thickness, seam lines, piping, legs, upholstery material, fabric texture, color, pattern, proportions, and decorative details unchanged.",
    "The product's physical dimensions are locked by reference image 1. You may only change its apparent image size through camera distance and perspective. Do not reinterpret a single chair/recliner as a loveseat, sectional, bench, or any wider multi-seat product.",
    "Do not redesign, recolor, reupholster, simplify, beautify, replace, resize its physical footprint, widen it, narrow it, make it taller or lower, non-uniformly stretch or squash, warp, round off, add tufting, remove seams, add pillows that hide the product, change cushion count, change seat count, change leg style, change arm style, or invent missing product details.",
    "Allowed changes only: camera-distance/framing differences for wide/mid/close views, physically plausible perspective harmonization around the locked source-photo angle, environment lighting, contact shadows, reflections, and occlusion required to place the exact product naturally in the scene.",
    "If the requested room/style conflicts with product fidelity, product fidelity wins. The final product must look like the same physical SKU from reference image 1, with no visible product-design or physical-size changes.",
    "",
    "SCENE:",
    `生成一个符合此风格的新室内场景：${styleLine}`,
    styleReferenceLine,
    "Create a new, original, physically plausible room layout around the locked source-photo angle of the product. Do not treat reference image 2 as a target room for image compositing.",
    "Do not insert the product first and decorate around it as a flat layer. Render the product and room as one coherent photographed scene with shared perspective, lighting, shadows, grain, depth of field, and occlusion.",
    "从一开始就围绕参考图 1 的产品已拍摄角度设计真实、可居住的房间布局，不要先生成背景再把产品贴到前景。参考图 1 的产品必须是画面里的主产品，不要在它后方或旁边再生成另一个同类主产品。",
    "",
    "ROOM INTEGRATION RULES:",
    "Before rendering, silently perform a layout feasibility analysis: identify the product's source-photo camera angle, usable floor plane, horizon line, vanishing direction, wall/floor junctions, window and door openings, furniture grouping, rug position, coffee table clearance, walking paths, and the product's real-world size class from reference image 1.",
    "Decide the room geometry and product position only after that analysis. Build the room's vanishing lines, floor plane, furniture scale, and camera height to support the product's locked photographed angle instead of forcing the product into a mismatched background.",
    "Pick a believable seating zone where this exact product size class can physically fit, face a sensible focal point or conversation area, align with the rug/coffee table/wall axis, and leave enough clearance around doors, windows, tables, lamps, and walking paths.",
    "Determine apparent on-image product area from camera distance, lens perspective, and room measurement cues such as door height, window height, coffee table dimensions, rug width, floor tile/plank rhythm, nearby chairs, and camera distance. Preserve the product's real physical size class, seat count, and source-photo viewing angle from reference image 1.",
    "产品在画面里看起来远或近，只能来自相机远近、镜头视角和透视关系；产品本体的真实宽度、高度、深度、座位数量、扶手/靠背/脚架比例不能被改变。",
    "产品左右朝向、可见面和透视角度必须跟参考图 1 的已拍摄角度一致；远景、中景、近景只改变镜头距离和取景范围，不重新旋转产品、不换视角、不用抠图贴片制造景别。",
    "If the initially obvious location would require changing the product's physical size, seat count, width, height, footprint, or source-photo viewing angle, reject it internally and choose a different room position or camera-distance framing along the same photographed angle before rendering.",
    "If the initially obvious location would look cramped, block circulation, collide with furniture, float, or feel pasted in, reject it internally and choose a better location before rendering.",
    "Do not place the product arbitrarily in the center, pasted into the foreground, or in front of another main seat.",
    "Do not stretch, squash, warp, widen, narrow, enlarge the physical footprint, or shrink the physical footprint while fitting it into the scene.",
    "Place the product so it does not feel out of place: match the room's camera distance, furniture measurement cues, floor perspective, seating group spacing, and visual hierarchy while preserving the product's locked physical dimensions.",
    "The product must sit on the floor plane with believable perspective, contact shadows, occlusion, and real-world size relationship. Its base/feet must touch the floor and align with the room's vanishing lines.",
    "Match the product lighting to the scene: direction, softness, color temperature, shadow density, reflections, and ambient fill should make the product feel photographed in the same room.",
    "Keep at least a realistic walking path around the product. Do not block doors, windows, coffee tables, side tables, lamps, or existing seating in an impossible way.",
    "If the product is replacing an existing seat, remove or fully replace that old seat. Do not show duplicate or overlapping products.",
    "Do not place the product directly in front of another couch, armchair, or large seat. Do not leave a background same-category product behind it.",
    "For all views, the reference product must be the only seating object in the image. Use rugs, coffee tables, side tables, lamps, plants, curtains, shelving, artwork, windows, wall details, doors, and floor texture for room context. Besides the reference product, do not generate any sofa, recliner, armchair, lounge chair, chaise, bench, ottoman, pouf, dining chair, stool, or background seating group.",
    "The product should belong to a seating group: align it with the rug, coffee table, wall, or conversation area. Its position should look selected by an interior designer, not centered just because it is the product.",
    "Do not paste the product as a foreground sticker. It must feel intentionally placed by an interior designer.",
    "",
    "COMPOSITION:",
    viewLine,
    "STRICT VIEW-DISTANCE LADDER:",
    "Far/wide view = across-room distance: product is small-to-medium in frame, with major floor and wall context visible. Medium view = normal product-in-room distance: product is dominant but fully contextualized. Close view = detail distance: product fills most of the frame and shows material/cushion detail.",
    "Never render far/wide as a medium shot. Never render medium as a close shot. Never render close as a far room shot. The three view types must be visually and spatially distinct even when using the same source-photo product angle.",
    "严格区分远景/中景/近景：远景是真正拉远的全空间商品图，产品外框不得超过画面宽约 30% 或高约 34%，要有明显地面留白、墙地交界和房间动线；中景是常规商品入室图，产品外框约占画面宽高 44-62%；近景是材质细节图，产品外框约占画面宽高 70-90%。",
    "The selected view is a camera-distance and framing choice based on the original photographed product angle. Keep the product's physical size class and source-photo pose locked to reference image 1; do not create wide/mid/close views by resizing, rotating, reposing, or compositing the product.",
    "远景、中景、近景的区别只来自沿着已拍摄角度的摄影机远近、镜头视角、构图裁切和可见环境范围。产品真实宽高深、座位数量、扶手/靠背/坐垫比例、脚架、整体体量、左右朝向和可见面必须完全保持参考图 1 的同一件产品。",
    "远景要真的拉开镜头，看清产品在房间里的合理位置、地面留白、墙地交界和动线，但仍然必须是商品主图，不是空房展示图；产品不能被放到画面边角，不能被裁切，除参考产品外画面里不能出现任何沙发、躺椅、扶手椅、餐椅、凳子、脚凳或其他座椅类家具。中景要完整展示产品并保留足够场景参照；近景要突出材质细节但仍保持产品完整身份和落地关系。任何景别都不能把单人产品变成多人产品，不能把产品本体放大/缩小/旋转/重新取景来制造景别。",
    modelLine,
    `输出规格：${imageSize}，画幅比例 ${aspectRatio}，单张成图。`,
    "",
    "QUALITY RULES:",
    "Photorealistic commercial photography, correct perspective, believable real-world size relationship, natural contact shadow, coherent lighting, consistent depth of field, no watermark, no text, no price tag, no logo overlay, no duplicate product, no malformed furniture, no extra random products covering the furniture product.",
    "Reject bad layout internally: a wide view that still looks like a medium/close shot, product occupying too much of a wide-view frame, a medium view that looks like a close-up, a close view that looks like a room-wide view, missing required model when model option is selected, any additional seating furniture besides the reference product, floating product, wrong floor contact, mismatched perspective, pasted-in foreground object, cutout edges, halo, alpha matte artifacts, inconsistent grain/resolution, product whose physical size class, width, height, footprint, source-photo angle, or seat count differs from reference image 1, product placed where it could not physically fit, impossible overlap with coffee table, blocked circulation path, inconsistent lighting, or furniture that ignores the room perspective.",
    "Final self-check before output: the product style, physical size class, footprint, proportions, photographed angle, visible sides, and seat count are unchanged; the chosen placement is spatially reasonable; the room perspective supports the product angle; and the result looks like one naturally staged furniture photo rather than a cutout pasted into a scene.",
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
    { text: buildPrompt(payload, hasStyleReferenceImage) },
    { text: "Reference image 1: exact furniture product and source photographed angle. Preserve this SKU identity, product category, physical size class, footprint, proportions, seat count, pose, visible sides, and viewing angle above all other instructions." },
    { inlineData: { mimeType: productImage.mimeType, data: productImage.data } },
  ];

  if (hasStyleReferenceImage) {
    parts.push(
      { text: "Reference image 2: room style reference only. Use it for mood, palette, materials, lighting, and decor taste; do not copy the original room structure, layout, camera angle, perspective, or use it as a compositing background." },
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
    safetySettings: SAFETY_SETTINGS,
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
