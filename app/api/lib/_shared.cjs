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
  modern: "现代简约：干净线条、克制配色、简洁墙面和自然采光，房间空间清爽有秩序。",
  cream_luxury: "轻奢风：精致材质、金属或石材点缀、干净高级的线条和明亮通透的采光。",
  italian: "奶油风：低饱和奶油色、柔和墙面、圆润软装和温暖细腻的自然光。",
  japandi: "寂宅风：安静留白、微水泥或自然肌理、低饱和色彩和沉静克制的空间感。",
  scandinavian: "北欧风：浅木色、白墙、柔和织物、自然光和轻盈温暖的居家氛围。",
  french: "新中式：木质格栅、雅致留白、东方比例、温润材质和含蓄的装饰细节。",
  loft: "都市 Loft：微水泥、黑色金属、开放式空间，硬朗但有生活温度。",
  coastal: "海岸度假：浅色织物、藤编、自然光、蓝绿色点缀，清爽松弛。",
  custom: "自定义房间：原始房间场景是必须优先保持的场景身份来源，需要尽量保持原图的空间结构、门窗、墙地面、已有物品、材质、采光、相机视角和整体氛围，只把用户上传的沙发自然放入合理位置。",
};

const VIEW_PRESETS = {
  wide:
    "VIEW = 远景 / WIDE. 远景图是镜头视角要求，不是沙发摆放位置要求。使用较广角的室内远景构图，完整呈现房间布局、主要家具关系和沙发所在的窗边/阳台采光区固定位置。沙发完整可读，约占画面宽度 20%-35%，必须能看到墙地交界线、窗边/阳台采光证据和主要家具关系；不得为了远景而改变沙发落位、实体尺寸或朝向逻辑。",
  mid:
    "VIEW = 中近景 / MEDIUM. 中近景是镜头距离和取景范围要求，不是把沙发挪到更显眼位置。必须先让沙发固定落在窗边、落地窗边、阳台门边或阳台采光区，再让相机靠近这个落位寻找能展示沙发正面或三分之二正面的角度。沙发约占画面宽度 40%-60%，仍要保留地面、墙地交界线、窗框/阳台门/窗帘/阳光落点等至少一种采光证据，不能拍成孤立产品照。",
  close:
    "VIEW = 近景 / CLOSE. 近景只允许通过镜头更靠近、焦距变化或收紧取景来突出沙发材质、坐垫、扶手、靠背、缝线、脚架和光影细节。沙发仍必须停留在同一个窗边/阳台采光区主落位，不能被搬到普通墙边、房间中央、通道或纯背景前。沙发约占画面宽度 65%-85%，允许环境更少，但必须保留明确的窗边/阳台/自然光证据。",
};

const VIEW_LABELS = {
  wide: "远景 / WIDE",
  mid: "中近景 / MEDIUM",
  close: "近景 / CLOSE",
};

const VIEW_ONLY_CONTRACTS = {
  wide:
    "SELECTED VIEW ONLY = 远景 / WIDE. Generate a room-overview image. The room must be highly visible, and the sofa must stay in the locked daylight placement beside a window, floor-to-ceiling glass, balcony door, or balcony daylight zone. Include broad floor area, wall/floor relationships, fixed landmarks, and clear daylight evidence. Ignore medium-view and close-view bullets in the analysis.",
  mid:
    "SELECTED VIEW ONLY = 中近景 / MEDIUM. Generate a medium-close image. The camera is closer to the locked sofa placement than wide view, but the image must still show enough floor, room scale, and window/balcony/daylight evidence to prove the sofa did not move. The sofa is the subject, but not an isolated catalog cutout. Ignore wide-view and close-view bullets in the analysis.",
  close:
    "SELECTED VIEW ONLY = 近景 / CLOSE. Generate a close sofa-focused image. The camera is nearest to the sofa, with the sofa filling most of the frame and showing upholstery/material/seams/armrest/backrest/cushion details. Keep enough room context to prove it remains in the same window/balcony daylight placement: floor contact, contact shadow, window frame, curtains, balcony edge, strong natural light, or partial fixed landmarks. Ignore wide-view and medium-view bullets in the analysis.",
};

const NATURAL_INTERIOR_COMPOSITION =
  "Use believable interior photography: straight verticals, consistent floor plane, correct horizon height, realistic lens, natural light direction, contact shadows, reflected light, and coherent sharpness/noise. Wide/medium-close/close control field of view and distance to the sofa; camera angle may vary only by moving the camera around the locked placement, while the sofa's physical floor zone, room-side, base contact point, facing direction, daylight evidence, and relationship to landmarks must remain consistent.";

const PLACEMENT_LOCK_LINE =
  "PHYSICAL PLACEMENT LOCK: First read the user's analysis and identify the single recommended 主落位 / main placement. That physical floor zone is locked. Use the main placement only; the backup/备选 placement is documentation and must not be used unless the analysis explicitly says the main placement is impossible. Across wide, medium-close, and close views, keep the sofa in the same daylight-side room zone and same relationship to fixed landmarks such as window, floor-to-ceiling glass, balcony door, curtains, wall edges, TV cabinet, existing sofa, coffee table, rug, cabinets, plants, floor tile seams, and walking path. Only the camera distance, field of view, crop, and slight camera angle may change. Do not relocate the sofa to a different empty area, do not switch to a different corner/side, and do not change the sofa's logical facing direction because of the selected view.";

const CUSTOM_SCENE_SPATIAL_FIT_LINE =
  "CUSTOM SCENE SPATIAL FIT HARD RULE: Treat the uploaded room as a real occupied room, not an empty staging set. The uploaded sofa may only be placed on a continuous unoccupied floor patch in the original room, with believable clearance for its full footprint and seated model if present. Prefer the existing window, floor-to-ceiling glass, balcony door, balcony, or visible natural-light side, but only when that daylight zone has enough space and does not crowd curtains/glass, block cabinet doors, interrupt walking paths, cover the original sofa, collide with a coffee table/rug, or require moving/removing original furniture. A placement is invalid if it would require adding a new window/balcony, moving original objects, covering original seating, blocking access to TV/coffee table/window/cabinet/path, or looking wedged into a leftover gap. If the analysis main placement describes such a cramped or colliding zone, spatial fit overrides the analysis: use the nearest larger open daylight-side floor zone that preserves all original objects and still matches the room perspective.";

const DESIGNER_PLACEMENT_LINE =
  "REAL INTERIOR DESIGNER PLACEMENT LOGIC: Before generating, behave like an interior designer on site. Identify windows/floor-to-ceiling glass/balcony/daylight side, TV wall, existing sofa, coffee table, rug, cabinets, doors, decor clusters, walking paths, and usable open floor. The uploaded sofa should be placed in a comfortable lounge/reading/daylight zone near a real window, floor-to-ceiling glass, balcony door, or balcony daylight area whenever such a zone exists. It must not block paths, cabinet doors, the TV view, original seating access, coffee table use, curtains/glass, or fixed decor. The sofa should face naturally toward the room center, coffee table, TV, or main seating group, usually angled about 15-45 degrees rather than squarely pasted to the camera. Never place the sofa in the exact center of a traffic path, directly in front of the TV, far from daylight, on top of existing furniture, or replacing/covering the original sofa.";

const FUSION_REALISM_LINE =
  "FUSION PRIORITY: The output must look like one coherent real interior photograph. Do not simply cut out and paste the sofa into the room image, and do not make a local patch/paint-over. Use the room image to analyze layout, perspective, materials, lighting, color temperature, exposure, lens feel, depth of field, noise, sharpness, shadows, reflections, and existing object relationships; then render a coherent room scene with the sofa physically belonging there. Match floor plane, wall-floor junction, vanishing points, contact shadows, glossy floor reflections if present, occlusion, light direction, daylight direction, and edge sharpness so the sofa and model do not look pasted or out of place.";

const MODEL_POSE_LINE =
  "MODEL POSE HARD RULE: If a model is requested, add exactly one realistic adult lifestyle model seated deeply on the inserted sofa. Hips and thighs must visibly press into the seat cushion, the back should be supported by the backrest, body weight must be on the cushion, and arms should rest naturally on armrests/lap or hold a small natural pose without hiding the sofa identity. Feet should rest on the floor with plausible knee bend and gravity unless the uploaded sofa clearly includes an extended chaise/footrest. No floating feet, no hovering hips, no standing beside it, no sitting on armrests, no perching on the front edge, no body detached from the sofa, no awkward limbs hiding cushions/arms/back. Keep the model secondary and preserve the sofa silhouette, cushions, armrests, seams, upholstery texture, legs/base, and scale.";

const ASPECT_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "3:2", "2:3", "5:4", "4:5"]);
const IMAGE_SIZES = new Set(["2K", "4K"]);
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_ANALYSIS_CHARS = 6000;

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
  return "[QUALITY: 2K UHD, high definition commercial interior photography, clean lighting, sharp sofa upholstery texture, realistic shadows and coherent perspective.]";
}

function normalizeAnalysisText(value) {
  return String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_ANALYSIS_CHARS);
}

function buildSofaAnalysisRequest(payload) {
  const productImage = parseDataUrl(payload.productImage, "沙发产品图");
  const styleReferenceImage = parseDataUrl(payload.styleReferenceImage, "房间参考图");
  const styleKey = String(payload.sceneStyle || "modern");
  const isCustomScene = styleKey === "custom" && Boolean(styleReferenceImage);
  const includeModel = Boolean(payload.includeModel);
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.modern;

  if (!productImage) {
    throw new Error("为了尽量保持原沙发样式不变，请先上传沙发产品图。");
  }
  if (styleKey === "custom" && !styleReferenceImage) {
    throw new Error("已选择自定义房间，请上传房间参考图。");
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
        ? "请用中文输出结构化、可执行的自定义房间沙发摆放分析。Reference Image 1 是必须尽量保持不变的原始房间；Reference Image 2 是必须保留外观的沙发产品。"
        : "请用中文输出结构化、可执行的沙发摆放分析。Reference Image 1 是必须保留外观的沙发产品。",
      isCustomScene
        ? "请分析如何在尽量保持 Reference Image 1 原房间不变的前提下，把 Reference Image 2 沙发放到最合理的位置。必须优先寻找原房间真实存在的窗边、落地窗边、阳台门边、阳台或自然光采光区。"
        : styleReferenceImage
          ? "Reference Image 2 是房间/风格参考，只用于分析空间感、材质、光线、窗户/阳台/墙面线索和装修气质，不作为直接修改底图。最终需要按用户选择风格创建虚拟房间并把沙发放在窗边或阳台采光区。"
          : "没有房间参考图，请结合沙发特征和用户选择风格创建一个真实可信的虚拟房间；虚拟房间必须有自然采光来源，并把沙发放在窗边或阳台采光区。",
      `用户选择风格：${styleLine}`,
      "",
      "请严格按以下字段输出，内容要短但具体：",
      "1. 沙发类型与体量：例如单人沙发、双人沙发、转角沙发、躺椅/贵妃、功能沙发；说明视觉重量、高低比例、坐深、扶手/靠背体量。",
      "2. 必须保留的沙发视觉特征：颜色、材质、纹理、缝线、扶手、靠背、坐垫、脚架、脚踏、功能按钮、五金件、整体轮廓和比例。",
      isCustomScene
        ? "3. 原房间保留清单：列出必须保持不变的门窗、墙地面、天花、已有家具/软装/装饰、采光方向、相机高度、焦距感、透视和画面氛围。严禁新增原图没有的窗户、阳台、门洞或大件家具。"
        : "3. 虚拟房间判断：根据沙发和风格判断最合理的室内空间功能、房间结构和氛围；房间必须有窗户、落地窗、阳台门或阳台等自然采光来源。",
      isCustomScene
        ? "4. 原房间空间线索判断：提取真实存在的窗户、落地窗、阳台门、阳台区域、阳光/自然光照射区、可用地面、通道、门柜开启区、已有家具关系、视觉中心和不应遮挡的位置。如果原图已有沙发、茶几、电视柜、窗户、地毯、绿植、边柜等，它们必须保持原样，不能被新增沙发替换或改造。"
        : "4. 虚拟房间空间线索：说明将创建哪些窗户/落地窗/阳台/阳台门、自然光方向、可用地面、通道、视觉中心和不应遮挡的位置；如果有 Reference Image 2，只提取风格和采光线索，不复制具体房间布局。",
      isCustomScene
        ? "4.1 可用地面排除表：先列出至少 3 个候选区域，并逐一判断“有效/无效”。必须优先排除窄缝和拥挤夹角：原有沙发与窗帘/窗户之间、原有沙发与茶几/地毯之间、空气净化器/绿植/装饰物旁边、主通道、电视观看动线、柜门开启区。沙发需要完整落地、留出坐下和通行空间；不满足则判为无效，不能当主落位。"
        : null,
      "5. 摆放决策：不要套用固定候选位置。请给出 1 个主落位和 1 个备选落位，说明推荐落点、朝向、离墙/离窗/离阳台/离茶几/离通道关系、比例尺度和原因。主落位必须优先在窗边、落地窗边、阳台门边、阳台区域或自然光采光区；自定义房间下只能使用原图真实存在的采光结构，严禁为了靠窗而新增窗户/阳台。备选落位只作为用户后续手动改分析时的参考，不能用于远/中近/近景自动切换。",
      isCustomScene
        ? "5.0 空间适配硬判断：主落位必须来自 4.1 中判为“有效”的连续空白地面，并且尽量靠近原有窗边/阳台采光区。不要把沙发硬塞到原有主沙发旁、窗帘边、空气净化器旁或茶几与沙发之间的剩余缝隙；这种位置即使有一点空地，也会显得格格不入，必须判为无效。"
        : null,
      "5.1 主落位锁定：用一句话写出后续所有景别必须复用的物理锚点，例如“锁定在某窗/阳台门/墙/地毯/地砖缝/茶几的左/右/前/后某片地面，朝向哪里，与哪些原有物体保持距离”。远景、中近景、近景只能改变镜头距离、视野和裁切，不能改变这个物理落位、房间侧位或朝向逻辑。",
      "5.2 朝向与使用关系：必须明确沙发正面朝向、与电视/茶几/主沙发/窗户/阳台/房间中心的关系。沙发通常应朝向房间中心、茶几、电视或主座位区，角度自然约 15-45 度；不能背对主要活动区，不能正对窗玻璃贴放，不能像摆拍道具一样只面向镜头。",
      isCustomScene
        ? "5.3 禁止落位：列出原图中不能摆放的位置，例如电视正前方、茶几上/茶几重叠区、主通道中央、窗户大面积遮挡区、原有沙发坐面/靠背上、柜门开启区、会造成过大比例的位置。"
        : null,
      "6. 远/中近/近景延展：必须基于同一个主落位锁定，分别用【远景】、【中近景】、【近景】三行说明该如何拉开或靠近相机、扩大或收窄视野、保留多少窗边/阳台采光证据，而不是改变沙发所在位置、房间侧位、朝向逻辑或换用备选落位。后续生成时只会启用用户当前选择的那一个景别，另外两个景别必须被忽略。",
      includeModel
        ? "6.1 模特摆放要求：用户选择添加模特，这是后续生成的硬性要求。请说明必须新增 1 位真实成人模特，且模特只能深坐在新增沙发上，臀部和大腿压在坐垫上，背部自然靠住靠背，脚放在地面或脚踏上，姿态生活化且受力真实；不能坐原有沙发、不能站在旁边、不能坐扶手或前沿、不能漂浮、不能遮挡沙发主体卖点，并要匹配房间光照、比例和透视。"
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
  const viewLabel = VIEW_LABELS[viewKey] || VIEW_LABELS.wide;
  const viewOnlyLine = VIEW_ONLY_CONTRACTS[viewKey] || VIEW_ONLY_CONTRACTS.wide;
  const modelLine = includeModel
    ? isCustomScene
      ? `MODEL REQUIRED: Add exactly one realistic adult lifestyle model on the newly inserted ${productReference} sofa. This is mandatory when the user selects model; an output without the seated model is invalid. ${MODEL_POSE_LINE} The model must not sit on, replace, cover, or alter any existing furniture in ${sceneReference}.`
      : `MODEL REQUIRED: Add exactly one adult lifestyle model naturally seated on the sofa. This is mandatory when the user selects model; an output without the model is invalid. ${MODEL_POSE_LINE}`
    : isCustomScene
      ? "MODEL: No new people, bodies, hands, faces, silhouettes, or reflections of people. Preserve the original room scene and integrate only the uploaded sofa."
      : "MODEL: No people, bodies, hands, faces, silhouettes, reflections of people, or human figures. Create a clean sofa placement image that highlights the sofa itself.";
  const styleReferenceLine = isCustomScene
    ? `${sceneReference} is the user's original room scene to preserve and is the PRIMARY image for scene identity. Keep its architecture, room layout, doors, windows, balcony/daylight structures, wall/floor/ceiling materials, existing furniture, decor objects, lighting direction, camera height, lens feel, perspective, color temperature, exposure, and atmosphere as unchanged as possible. Do not redesign the room, add new windows/balconies, replace existing objects, add unrelated new decor, or move existing furniture; integrate ${productReference} sofa into a suitable usable daylight-side position${includeModel ? " and add exactly one model seated on that inserted sofa" : ""}.`
    : hasStyleReferenceImage
      ? "Reference image 2 is ONLY a loose room-style reference. Borrow palette, material mood, lighting, decor taste, daylight/window feeling, and atmosphere. Do not copy its exact room, layout, architecture, furniture positions, camera angle, or perspective."
    : "No room-style reference image is provided; create a virtual room with clear natural light.";
  const seatingRuleLine = isCustomScene
    ? `CUSTOM SCENE SEATING RULE: ${sceneReference} may already contain sofas, chairs, benches, or other seating. Preserve every existing seating object exactly as part of the original scene. ${productReference} sofa is the only NEW seating object to add. Do not remove, replace, recolor, resize, remodel, duplicate, or transform any existing seating; do not add any additional new seating beyond the uploaded sofa.`
    : "The uploaded sofa must be the only prominent seating object. Do not add another competing sofa, recliner, armchair, chaise, bench, ottoman, dining chair, stool, or background seating group.";
  const productPlacementLine = isCustomScene
    ? "CUSTOM SCENE SOFA PLACEMENT: Add the uploaded sofa as one new furniture item with realistic scale relative to the existing sofa, coffee table, window, TV cabinet, rug, plants, and floor tiles. It must sit on an available floor area, keep walkable clearance, and avoid blocking the TV, coffee table, window, door/cabinet openings, original sofa, or main traffic path. If the original room has natural light from windows, floor-to-ceiling glass, balcony door, or balcony, prioritize a nearby daylight/lounge/reading zone only when it has enough continuous floor clearance and does not crowd curtains, glass, existing sofa, decor, or path. The sofa should face naturally toward room center, coffee table, TV, or existing seating group, angled about 15-45 degrees when appropriate. Match the original glossy floor reflections, contact shadows, light direction, perspective, sharpness, grain, and color temperature so the sofa does not look out of place."
    : "Place the sofa in a believable window/balcony daylight seating zone chosen by analysis, with rug/table/window/wall/floor context and realistic walking clearance.";
  const negativeRulesLine = isCustomScene
    ? "NEGATIVE RULES: no duplicate uploaded sofa, no wrong sofa, no changed sofa style/color/material/texture/seams/arms/back/cushions/footrest/buttons/hardware/outline, no removing or altering original room furniture, no changing existing sofa/chair/table/cabinet/window/wall/floor/ceiling/decor, no new windows, no new balcony, no new unrelated furniture or decorations, no distorted human body, no messy background, no text, no watermark, no price tag, no logo overlay, no low resolution, no over-filtered look, no cartoon style, no malformed furniture, no pasted cutout edge, no floating sofa, no clipping, no deformation, no mismatched perspective, no oversized or undersized sofa, no blocking TV/coffee table/window/pathway."
    : "NEGATIVE RULES: no extra competing sofa, no duplicate uploaded sofa, no wrong sofa, no changed sofa style/color/material/texture/seams/arms/back/cushions/footrest/buttons/hardware/outline, no placing sofa away from window/balcony/daylight zone, no distorted human body, no messy background, no text, no watermark, no price tag, no logo overlay, no low resolution, no over-filtered look, no cartoon style, no rigid centered catalog staging, no malformed furniture, no pasted cutout edge, no floating sofa, no clipping, no deformation, no mismatched perspective.";
  const productIntegrationLine = isCustomScene
    ? `Integrate ${productReference} as a real newly placed sofa in ${sceneReference}. Preserve sofa identity, but adapt only its scene-facing perspective, light response, shadow, reflection, and tiny occlusion needed to make it physically belong in the original room.${includeModel ? " Also integrate exactly one realistic model seated on the inserted sofa with matching light, shadow, scale, and contact." : ""}`
    : `Integrate ${productReference} as a real sofa in a newly generated room. Preserve sofa identity, while adapting only perspective, light response, shadow, reflection, and tiny occlusion needed for physical realism.`;
  const sofaAnalysis = normalizeAnalysisText(payload.sofaAnalysis);

  return [
    "TASK: Create one photorealistic ecommerce sofa placement image.",
    buildQualityLine(imageSize),
    "",
    "REFERENCE ORDER:",
    isCustomScene
      ? "Reference Image 1 = original room scene to preserve. It is the immutable scene identity source and should dominate room layout, architecture, existing furniture, lighting, and camera perspective."
      : "Reference Image 1 = exact sofa product. It is the immutable sofa identity source.",
    isCustomScene
      ? "Reference Image 2 = exact sofa product. It is the immutable sofa identity source to add into the room."
      : hasStyleReferenceImage
      ? "Reference Image 2 = room style mood only. It is not a background plate."
      : "Only Reference Image 1 is provided.",
    includeModel
      ? "USER MODEL OPTION: The user selected 添加模特. The final image must include exactly one realistic adult model seated on the inserted sofa with real body contact."
      : "USER MODEL OPTION: The user selected 无模特. The final image must not include any person, body part, silhouette, or human reflection.",
    `CURRENT SELECTED VIEW: ${viewLabel}. This is the only active camera-distance/view instruction for this generation request.`,
    "If the analysis contains separate wide / medium-close / close suggestions, use only the section matching CURRENT SELECTED VIEW and ignore the other two sections completely.",
    viewOnlyLine,
    "",
    "CRITICAL SOFA PRESERVATION:",
    `Preserve ${productReference} sofa identity: sofa category, seat count, physical size class, proportions, silhouette, armrests, backrest, cushion layout, footrest if present, hardware, seams, legs/base, upholstery material, leather/fabric texture, color, wrinkles, and visible details.`,
    "Do not redesign, recolor, reupholster, widen, narrow, stretch, squash, change height, change seat count, change sofa category, change armrest/back/cushion structure, add pillows that hide identity, or invent missing sofa details.",
    productIntegrationLine,
    "",
    "REFERENCE-STYLE GENERATION PRINCIPLES:",
    DESIGNER_PLACEMENT_LINE,
    FUSION_REALISM_LINE,
    includeModel ? MODEL_POSE_LINE : null,
    sofaAnalysis ? "" : null,
    sofaAnalysis ? "PRE-GENERATION SOFA AND PLACEMENT ANALYSIS:" : null,
    sofaAnalysis || null,
    sofaAnalysis ? `Treat the analysis above as the binding generation contract, including any user edits. Use the analysis main placement / 主落位 as the only physical placement only when it passes the spatial fit hard rules below. The backup/备选 placement is not allowed for normal generation and must not be selected just because the view is wide, medium-close, close, or composition looks nicer. For camera/view instructions, only the analysis bullet matching CURRENT SELECTED VIEW (${viewLabel}) is active; all other view bullets in the analysis are inactive. Follow the main placement, forbidden areas, scale notes, active camera notes, daylight evidence, and preservation list. Do not invent a different placement, ignore forbidden areas, or fall back to canned positions such as left/right third, wall-side, window-side, or corner-side unless the analysis explicitly chooses that location as the main placement with visual reasoning. If the analysis text conflicts with the current USER MODEL OPTION or MODEL REQUIRED/MODEL rules, the current model option wins. If the analysis conflicts with CUSTOM SCENE SPATIAL FIT HARD RULE, the spatial fit hard rule wins. ${productReference} remains the highest authority for exact sofa appearance.` : null,
    sofaAnalysis ? null : "Before generating, visually analyze the uploaded sofa and optional room reference, then choose the placement from sofa scale, facing direction, floor plane, wall/window/balcony/daylight cues, and walking clearance. Do not use a fixed left/right/wall/window/corner template.",
    PLACEMENT_LOCK_LINE,
    DESIGNER_PLACEMENT_LINE,
    isCustomScene ? CUSTOM_SCENE_SPATIAL_FIT_LINE : null,
    FUSION_REALISM_LINE,
    "",
    "SCENE:",
    isCustomScene
      ? `CUSTOM SCENE MODE: Preserve ${sceneReference} as the original room scene. The result should look like ${productReference} sofa naturally belongs in that exact room, not like a mismatched cutout or a newly redesigned room.`
      : "Virtual room mode: infer the most suitable room type and room structure from the pre-generation analysis, uploaded sofa, optional room mood reference, and selected style. The room must include a believable window, floor-to-ceiling glass, balcony door, or balcony daylight source.",
    isCustomScene
      ? `Keep the uploaded original room scene stable while matching this mode: ${styleLine}`
      : `Create a new original interior scene in this style: ${styleLine}`,
    styleReferenceLine,
    isCustomScene
      ? `For custom scene mode, keep the original scene stable: preserve doors, existing windows, wall/floor/ceiling junctions, existing furniture, decor, rugs, lamps, plants, artwork, curtains, visible openings, view outside windows, natural light, shadows, perspective, grain, sharpness, and color temperature. Do not add extra furniture or decorations beyond the uploaded sofa${includeModel ? " and the one required seated model" : ""}. Do not add new windows, balcony doors, balconies, glass walls, or daylight openings. Do not remove, repaint, remodel, crop away, or rearrange the original room elements unless tiny occlusion is physically required by the inserted sofa${includeModel ? " or the seated model" : ""}.`
      : null,
    "Automatically infer the space perspective, floor angle, horizon height, wall position, window/balcony position, light direction, sofa scale, and walking clearance from the placement analysis before placing the sofa.",
    "Place the sofa in the specific usable window/balcony/daylight position implied by the analysis. Placement beats composition: do not move the sofa just to make the frame prettier.",
    "Render sofa and room as one coherent photographed scene with shared perspective, lighting, shadows, grain, depth of field, contact shadows, and floor contact.",
    seatingRuleLine,
    productPlacementLine,
    isCustomScene ? "For custom scene mode, natural daylight-side placement is more important than sofa prominence: the sofa should look intentionally placed in a believable lounge/reading/use zone, never inserted into a narrow leftover gap merely because it is visible." : null,
    "The sofa must truly sit on the floor plane. Align legs/base with the floor, add grounded contact shadows under every support point, and prevent floating, sinking into the floor, clipping through walls/furniture, deformation, or scale distortion.",
    "",
    "COMPOSITION:",
    `ONLY GENERATE THIS VIEW: ${viewLabel}. Do not output a hybrid of wide/medium-close/close. Do not use camera-distance instructions from the other two view types.`,
    viewOnlyLine,
    "VIEW MEANING: The selected wide/medium-close/close option controls field of view, camera distance, and image coverage only. It must not override the placement lock, move the sofa to a different logical position, resize the sofa body, rotate it into an impossible angle, or turn it into a pasted cutout. Camera angle may be varied for a natural shot, but only by photographing the same locked physical placement from a believable camera position.",
    viewLine,
    NATURAL_INTERIOR_COMPOSITION,
    "Wide/medium-close/close must be created by camera distance, field of view, framing, and crop only, not by relocating or resizing the sofa. Sofa perspective may be minimally adjusted only to match the room floor plane and camera. The sofa's floor contact zone, daylight evidence, and relationship to nearby room landmarks must stay the same.",
    modelLine,
    `Aspect ratio: ${aspectRatio}. Single image output.`,
    "",
    negativeRulesLine,
    isCustomScene
      ? `CUSTOM SCENE NEGATIVE RULES: do not redesign the uploaded room, do not change doors/windows/walls/floor/ceiling/existing furniture/decor/light direction/camera perspective, do not add new windows/balconies/daylight openings or unrelated furniture/decorations, do not make the sofa look out of place, oversized, undersized, pasted, floating, or mismatched with the room.${includeModel ? " Do not omit the model; do not place the model on the original sofa, floor, armrest, or beside the inserted sofa; the model must be seated on the inserted sofa." : ""}`
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

  const productImage = parseDataUrl(payload.productImage, "沙发产品图");
  const styleReferenceImage = parseDataUrl(payload.styleReferenceImage, "房间参考图");
  const sceneStyle = String(payload.sceneStyle || "modern");
  const isCustomScene = sceneStyle === "custom" && Boolean(styleReferenceImage);

  if (!productImage) {
    throw new Error("为了尽量保持原沙发样式不变，请先上传沙发产品图。");
  }
  if (sceneStyle === "custom" && !styleReferenceImage) {
    throw new Error("已选择自定义房间，请上传房间参考图。");
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
