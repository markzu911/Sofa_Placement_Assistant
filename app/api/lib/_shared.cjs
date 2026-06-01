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
  custom: "自定义场景：原始房间场景是必须优先保持的场景身份来源，需要尽量保持原图的空间结构、门窗、墙地面、已有物品、材质、采光、相机视角和整体氛围，只把产品自然放入合理位置。",
};

const VIEW_PRESETS = {
  wide:
    "VIEW = 远景 / WIDE. 远景表示房间可见度最大、视野最广，能看到完整或接近完整的房间关系、墙地交界、窗/电视/茶几/通道等空间线索。相机可选择符合房间透视的自然机位和角度，不必固定原图角度，但必须围绕分析确定的合理落位拍摄。产品完整可读，约占画面 8-18%，不要超过画面宽度 32% 或高度 36%。不得为了远景而随意移动、缩放、贴图或悬浮产品。",
  mid:
    "VIEW = 中景 / MEDIUM. 中景表示相对距离商品更近、视野比远景稍小，重点呈现产品与周边茶几、地毯、窗光、原有家具和通道的协调关系。相机角度可多样，但必须符合房间透视、地面平面和分析落位。产品约占画面 22-38%，边界约占画面宽或高 36-58%。不得把中景做成孤立产品照或随意居中摆拍。",
  close:
    "VIEW = 近景 / CLOSE. 近景表示镜头更靠近商品，视野最小，用来突出材质、坐垫、扶手、靠背、缝线、脚架/底座、功能把手和光影细节。相机角度可以根据商品和房间自然选择，但仍必须发生在分析确定的合理摆放位置，不能把产品挪到不属于场景的位置。产品约占画面 55-82%，需保留地面接触、接触阴影和少量真实环境信息。可轻微裁切边缘，但不能丢失品类、座位数、主体轮廓和关键卖点。",
};

const NATURAL_INTERIOR_COMPOSITION =
  "Use believable interior photography: straight verticals, consistent floor plane, correct horizon height, realistic lens, natural light direction, contact shadows, reflected light, and coherent sharpness/noise. Wide/medium/close control field of view and distance to the product; camera angle may vary as long as it respects the room perspective, furniture layout, walking clearance, and analysis-based placement.";

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

function normalizeAnalysisText(value) {
  return String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2200);
}

function buildSofaAnalysisRequest(payload) {
  const productImage = parseDataUrl(payload.productImage, "家具产品图");
  const styleReferenceImage = parseDataUrl(payload.styleReferenceImage, "房间/场景参考图");
  const styleKey = String(payload.sceneStyle || "modern");
  const isCustomScene = styleKey === "custom" && Boolean(styleReferenceImage);
  const includeModel = Boolean(payload.includeModel);
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.modern;

  if (!productImage) {
    throw new Error("为了尽量保持原产品样式不变，请先上传家具产品图。");
  }
  if (styleKey === "custom" && !styleReferenceImage) {
    throw new Error("已选择自定义场景，请上传房间/场景参考图。");
  }

  const parts = [];
  if (isCustomScene) {
    parts.push({ inlineData: { mimeType: styleReferenceImage.mimeType, data: styleReferenceImage.data } });
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
  } else {
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
    if (styleReferenceImage) {
      parts.push({ inlineData: { mimeType: styleReferenceImage.mimeType, data: styleReferenceImage.data } });
    }
  }

  parts.push({
    text: [
      isCustomScene
        ? "请用中文输出结构化、可执行的自定义场景摆放分析。Reference Image 1 是必须尽量保持不变的原始房间场景；Reference Image 2 是必须保留外观的家具产品。"
        : "请用中文输出结构化、可执行的家具摆放分析。Reference Image 1 是必须保留外观的家具产品。",
      isCustomScene
        ? "请分析如何在尽量保持 Reference Image 1 原图场景不变的前提下，把 Reference Image 2 产品放到最合理的位置。"
        : styleReferenceImage
          ? "Reference Image 2 是房间/风格参考，只用于分析空间感、材质、光线、窗户/墙面线索和装修气质，不作为直接修改底图。"
          : "没有房间参考图，请结合家具特征和用户选择风格判断最合适的室内功能、房间结构和摆位。",
      `用户选择风格：${styleLine}`,
      "",
      "请严格按以下字段输出，内容要短但具体：",
      "1. 产品类型与体量：例如单人/双人/转角/躺椅/功能沙发、视觉重量、高低比例。",
      "2. 必须保留的视觉特征：颜色、材质、纹理、缝线、扶手、靠背、坐垫、脚架、脚踏、功能按钮、五金件、整体轮廓。",
      isCustomScene
        ? "3. 原图场景保留清单：列出必须保持不变的门窗、墙地面、天花、已有家具/软装/装饰、采光方向、相机高度、焦距感、透视和画面氛围。"
        : "3. 适配空间判断：不要使用用户预设空间，因为界面没有人工空间选择。请根据产品和参考图/风格自行判断最合理的室内空间功能、房间结构和氛围，并说明原因。",
      isCustomScene
        ? "4. 原图空间线索判断：提取可用地面、可用墙边/窗边/角落、通道、门柜开启区、已有家具关系、视觉中心和不应遮挡的位置。如果原图已有沙发、茶几、电视柜、窗户、地毯、绿植、边柜等，它们必须保持原样，不能被新增产品替换或改造。"
        : "4. 空间线索判断：如果有 Reference Image 2，请提取可用墙面、窗光、地面透视、通道、视觉中心和不应遮挡的位置；如果没有参考图，请基于产品比例、功能和风格自行推断房间结构。",
      "5. 摆放决策：不要套用固定候选位置。请给出 1 个主落位和 1 个备选落位，说明推荐落点、朝向、离墙/离窗/离茶几/离通道关系、比例尺度和原因；自定义场景下必须优先不破坏原图结构和已有物品关系，产品只能作为新增单件家具落在真实可用地面上，不能挡住电视、茶几、窗户、门柜开启区、主要通道或原有沙发。",
      isCustomScene
        ? "5.1 禁止落位：列出原图中不能摆放的位置，例如电视正前方、茶几上/茶几重叠区、主通道中央、窗户大面积遮挡区、原有沙发坐面/靠背上、柜门开启区、会造成过大比例的位置。"
        : null,
      "6. 远/中/近景延展：同一个摆放决策下，分别说明远景、中景、近景该如何拉开或靠近相机，而不是改变产品位置、比例或角度。",
      includeModel
        ? "6.1 模特摆放要求：用户选择添加模特，这是后续生成的硬性要求。请说明必须新增 1 位真实成人模特，且模特只能自然坐在新增产品上，身体重量落在坐垫上，不能坐原有沙发、不能站在旁边、不能遮挡产品主体卖点，并要匹配房间光照、比例和透视。"
        : "6.1 模特要求：用户未选择模特，不要新增人物、手、身体、倒影或人形轮廓。",
      "7. 透视与落地要求：相机高度、地面接触、阴影、反射、遮挡、避免穿模和动线阻挡。",
      "8. 生成时要避免的问题：列出最容易出错的点。",
      "只输出分析，不要输出问候、标题之外的解释，也不要要求用户补充信息。",
    ].join("\n"),
  });

  return {
    contents: {
      parts,
    },
    config: {
      safetySettings: SAFETY_SETTINGS,
    },
  };
}

function buildPrompt(payload, hasStyleReferenceImage) {
  const styleKey = String(payload.sceneStyle || "modern");
  const isCustomScene = styleKey === "custom" && hasStyleReferenceImage;
  const productReference = isCustomScene ? "Reference Image 2" : "Reference Image 1";
  const sceneReference = isCustomScene ? "Reference Image 1" : "Reference Image 2";
  const viewKey = String(payload.viewType || "wide");
  const includeModel = Boolean(payload.includeModel);
  const aspectRatio = String(payload.aspectRatio || "4:3");
  const imageSize = String(payload.imageSize || "2K").toUpperCase();
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.modern;
  const viewLine = VIEW_PRESETS[viewKey] || VIEW_PRESETS.wide;
  const modelLine = includeModel
    ? isCustomScene
      ? `MODEL REQUIRED: Add exactly one realistic adult lifestyle model on the newly inserted ${productReference} product. This is mandatory when the user selects model; an output without the seated model is invalid. The person must be visibly present, naturally seated with body weight on the seat cushion, thighs/hips in contact with the cushion, back or arm naturally supported by the product, and feet placed plausibly on the floor or footrest. The model must not sit on, replace, cover, or alter any existing furniture in ${sceneReference}. Keep the person secondary and do not let the body hide the product's silhouette, armrests, backrest, cushions, seams, controls, leather texture, legs/base, or overall identity.`
      : "MODEL REQUIRED: Add exactly one adult lifestyle model naturally interacting with the product. This is mandatory when the user selects model; an output without the model is invalid. The model must be sitting on the product or leaning back into it with realistic body contact, realistic anatomy, and secondary visual priority, never covering the product's core selling points such as silhouette, armrests, backrest, cushions, seams, material texture, buttons, metal details, or legs."
    : isCustomScene
      ? "MODEL: No new people, bodies, hands, faces, silhouettes, or reflections of people. Preserve the original room scene and integrate only the uploaded furniture product."
      : "MODEL: No people, bodies, hands, faces, silhouettes, reflections of people, or human figures. Create a clean furniture display image that highlights the product itself.";
  const styleReferenceLine = isCustomScene
    ? `${sceneReference} is the user's original room scene to preserve and is the PRIMARY image for scene identity. Keep its architecture, room layout, doors, windows, wall/floor/ceiling materials, existing furniture, decor objects, lighting direction, camera height, lens feel, perspective, color temperature, exposure, and atmosphere as unchanged as possible. Do not redesign the room, replace existing objects, add unrelated new decor, or move existing furniture; integrate ${productReference} product into a suitable usable position${includeModel ? " and add exactly one model seated on that inserted product" : ""}.`
    : hasStyleReferenceImage
      ? "Reference image 2 is ONLY a loose room-style reference. Borrow palette, material mood, lighting, decor taste, and atmosphere. Do not copy its exact room, layout, architecture, furniture positions, camera angle, or perspective."
    : "No room-style reference image is provided.";
  const seatingRuleLine = isCustomScene
    ? `CUSTOM SCENE SEATING RULE: ${sceneReference} may already contain sofas, chairs, benches, or other seating. Preserve every existing seating object exactly as part of the original scene. ${productReference} product is the only NEW seating object to add. Do not remove, replace, recolor, resize, remodel, duplicate, or transform any existing seating; do not add any additional new seating beyond the uploaded product.`
    : "The product must be the only seating object. Do not add another sofa, recliner, armchair, chaise, bench, ottoman, dining chair, stool, or background seating group.";
  const productPlacementLine = isCustomScene
    ? "CUSTOM SCENE PRODUCT PLACEMENT: Add the uploaded product as one new furniture item with realistic scale relative to the existing sofa, coffee table, window, TV cabinet, rug, plants, and floor tiles. It must sit on an available floor area, keep walkable clearance, and avoid blocking the TV, coffee table, window, door/cabinet openings, original sofa, or main traffic path. Match the original glossy floor reflections, contact shadows, light direction, perspective, sharpness, grain, and color temperature so the product does not look out of place."
    : "Place the product in a believable seating zone chosen by analysis, with rug/table/window/wall/floor context and realistic walking clearance.";
  const negativeRulesLine = isCustomScene
    ? "NEGATIVE RULES: no duplicate uploaded product, no wrong product, no changed product style/color/material/texture/seams/arms/back/cushions/footrest/buttons/hardware/outline, no removing or altering original room furniture, no changing existing sofa/chair/table/cabinet/window/wall/floor/ceiling/decor, no new unrelated furniture or decorations, no distorted human body, no messy background, no text, no watermark, no price tag, no logo overlay, no low resolution, no over-filtered look, no cartoon style, no malformed furniture, no pasted cutout edge, no floating product, no clipping, no deformation, no mismatched perspective, no oversized or undersized product, no blocking TV/coffee table/window/pathway."
    : "NEGATIVE RULES: no extra sofa, no duplicate product, no wrong product, no changed product style/color/material/texture/seams/arms/back/cushions/footrest/buttons/hardware/outline, no distorted human body, no messy background, no text, no watermark, no price tag, no logo overlay, no low resolution, no over-filtered look, no cartoon style, no rigid centered catalog staging, no malformed furniture, no pasted cutout edge, no floating product, no clipping, no deformation, no mismatched perspective.";
  const productIntegrationLine = isCustomScene
    ? `Integrate ${productReference} as a real newly placed object in ${sceneReference}. Preserve product identity, but adapt only its scene-facing perspective, light response, shadow, reflection, and tiny occlusion needed to make it physically belong in the original room.${includeModel ? " Also integrate exactly one realistic model seated on the inserted product with matching light, shadow, scale, and contact." : ""}`
    : `Integrate ${productReference} as a real product in a newly generated room. Preserve product identity, while adapting only perspective, light response, shadow, reflection, and tiny occlusion needed for physical realism.`;
  const sofaAnalysis = normalizeAnalysisText(payload.sofaAnalysis);

  return [
    "TASK: Create one photorealistic ecommerce furniture placement image.",
    buildQualityLine(imageSize),
    "",
    "REFERENCE ORDER:",
    isCustomScene
      ? "Reference Image 1 = original room scene to preserve. It is the immutable scene identity source and should dominate room layout, architecture, existing furniture, lighting, and camera perspective."
      : "Reference Image 1 = exact furniture product. It is the immutable product identity source.",
    isCustomScene
      ? "Reference Image 2 = exact furniture product. It is the immutable product identity source to add into the room."
      : hasStyleReferenceImage
      ? "Reference Image 2 = room style mood only. It is not a background plate."
      : "Only Reference Image 1 is provided.",
    includeModel
      ? "USER MODEL OPTION: The user selected 添加模特. The final image must include exactly one realistic adult model seated on the inserted product with real body contact."
      : "USER MODEL OPTION: The user selected 无模特. The final image must not include any person, body part, silhouette, or human reflection.",
    "",
    "CRITICAL PRODUCT PRESERVATION:",
    `Preserve ${productReference} product identity: category, single-item seat count, physical size class, proportions, silhouette, armrests, backrest, cushion layout, footrest, side controls, hardware, seams, legs/base, upholstery material, leather/fabric texture, color, wrinkles, and visible details.`,
    "Do not redesign, recolor, reupholster, widen, narrow, stretch, squash, change height, change seat count, change product category, change armrest/back/cushion structure, add pillows that hide identity, or invent missing product details.",
    productIntegrationLine,
    sofaAnalysis ? "" : null,
    sofaAnalysis ? "PRE-GENERATION SOFA AND PLACEMENT ANALYSIS:" : null,
    sofaAnalysis || null,
    sofaAnalysis ? `Treat the analysis above as the binding generation contract, including any user edits. Follow its main placement, backup placement, forbidden areas, scale notes, camera notes, and preservation list. Do not invent a different placement, ignore forbidden areas, or fall back to canned positions such as left/right third, wall-side, window-side, or corner-side unless the analysis explicitly chooses that location with visual reasoning. If the analysis text conflicts with the current USER MODEL OPTION or MODEL REQUIRED/MODEL rules, the current model option wins. ${productReference} remains the highest authority for exact product appearance.` : null,
    sofaAnalysis ? null : "Before generating, visually analyze the uploaded product and optional room reference, then choose the placement from product scale, facing direction, floor plane, wall/window/light cues, and walking clearance. Do not use a fixed left/right/wall/window/corner template.",
    "",
    "SCENE:",
    isCustomScene
      ? `CUSTOM SCENE MODE: Preserve ${sceneReference} as the original room scene. The result should look like ${productReference} naturally belongs in that exact room, not like a mismatched product cutout or a newly redesigned room.`
      : "No user-selected space type is provided. Infer the most suitable room type and room structure from the pre-generation analysis, uploaded product, optional room reference, and selected style.",
    isCustomScene
      ? `Keep the uploaded original room scene stable while matching this mode: ${styleLine}`
      : `Create a new original interior scene in this style: ${styleLine}`,
    styleReferenceLine,
    isCustomScene
      ? `For custom scene mode, keep the original scene stable: preserve doors, windows, wall/floor/ceiling junctions, existing furniture, decor, rugs, lamps, plants, artwork, curtains, visible openings, view outside windows, natural light, shadows, perspective, grain, sharpness, and color temperature. Do not add extra furniture or decorations beyond the uploaded product${includeModel ? " and the one required seated model" : ""}. Do not remove, repaint, remodel, crop away, or rearrange the original room elements unless tiny occlusion is physically required by the inserted product${includeModel ? " or the seated model" : ""}.`
      : null,
    "Automatically infer the space perspective, floor angle, horizon height, wall position, window position, light direction, furniture scale, and walking clearance from the placement analysis before placing the product.",
    "Place the product in the specific usable position implied by the analysis. Placement beats composition: do not move the product just to make the frame prettier.",
    "Render product and room as one coherent photographed scene with shared perspective, lighting, shadows, grain, depth of field, contact shadows, and floor contact.",
    seatingRuleLine,
    productPlacementLine,
    "The product must truly sit on the floor plane. Align legs/base with the floor, add grounded contact shadows under every support point, and prevent floating, sinking into the floor, clipping through walls/furniture, deformation, or scale distortion.",
    "",
    "COMPOSITION:",
    "VIEW MEANING: The selected wide/medium/close option controls field of view, camera distance, and image coverage. It must not override placement analysis, move the product to a different logical position, resize the product body, rotate it into an impossible angle, or turn it into a pasted cutout. Camera angle may be varied for a natural shot, but only if the angle still fits the room perspective, product placement, and walking clearance.",
    viewLine,
    NATURAL_INTERIOR_COMPOSITION,
    "Wide/mid/close must be created by camera distance and framing only, not by resizing the object. Product perspective may be minimally adjusted only to match the room floor plane and camera.",
    modelLine,
    `Aspect ratio: ${aspectRatio}. Single image output.`,
    "",
    negativeRulesLine,
    isCustomScene
      ? `CUSTOM SCENE NEGATIVE RULES: do not redesign the uploaded room, do not change doors/windows/walls/floor/ceiling/existing furniture/decor/light direction/camera perspective, do not add new unrelated furniture or decorations, do not make the product look out of place, oversized, undersized, pasted, floating, or mismatched with the room.${includeModel ? " Do not omit the model; do not place the model on the original sofa, floor, armrest, or beside the product; the model must be seated on the inserted product." : ""}`
      : null,
    "Output the image only.",
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

function buildGeminiRequest(payload) {
  const aspectRatio = String(payload.aspectRatio || "4:3");
  const imageSize = String(payload.imageSize || "2K").toUpperCase();

  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error("图片比例不在支持范围内。");
  }
  if (!IMAGE_SIZES.has(imageSize)) {
    throw new Error("分辨率只支持 2K 或 4K。");
  }

  const productImage = parseDataUrl(payload.productImage, "家具产品图");
  const styleReferenceImage = parseDataUrl(payload.styleReferenceImage, "房间/场景参考图");
  const sceneStyle = String(payload.sceneStyle || "modern");
  const isCustomScene = sceneStyle === "custom" && Boolean(styleReferenceImage);

  if (!productImage) {
    throw new Error("为了尽量保持原产品样式不变，请先上传家具产品图。");
  }
  if (sceneStyle === "custom" && !styleReferenceImage) {
    throw new Error("已选择自定义场景，请上传房间/场景参考图。");
  }

  const hasStyleReferenceImage = Boolean(styleReferenceImage);
  const parts = [];
  if (isCustomScene) {
    parts.push({ inlineData: { mimeType: styleReferenceImage.mimeType, data: styleReferenceImage.data } });
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
  } else {
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
    if (hasStyleReferenceImage) {
      parts.push({ inlineData: { mimeType: styleReferenceImage.mimeType, data: styleReferenceImage.data } });
    }
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
  buildSofaAnalysisRequest,
  extractGeneratedImage,
  readJsonBody,
  sendJson,
};
