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

const STYLE_LABELS = {
  modern: "现代简约",
  cream_luxury: "轻奢风",
  italian: "奶油风",
  japandi: "寂宅风",
  scandinavian: "北欧风",
  french: "新中式",
  loft: "都市 Loft",
  coastal: "海岸度假",
  custom: "自定义房间",
};

const VIRTUAL_STYLE_INSTRUCTIONS = {
  modern: "现代简约虚拟房间：干净利落的线条，白色、浅灰、木色等克制配色，少量必要家具，空间明亮通透。",
  cream_luxury: "轻奢风虚拟房间：精致材质、金属或石材点缀、干净高级的线条、明亮通透但不过度堆砌。",
  italian: "奶油风虚拟房间：低饱和奶油色、柔和墙面、圆润线条、温暖细腻的自然采光。",
  japandi: "寂宅风虚拟房间：安静留白、微水泥或自然肌理、低饱和色彩、克制家具和沉静空间感。",
  scandinavian: "北欧风虚拟房间：浅木色、白墙、柔和织物、自然光、简洁温暖的居家氛围。",
  french: "新中式虚拟房间：木质格栅、雅致留白、东方比例、温润材质和含蓄装饰，不要过度繁复。",
  loft: "都市 Loft 虚拟房间：微水泥、黑色金属、开阔空间和清晰窗光，硬朗但有生活温度。",
  coastal: "海岸度假虚拟房间：浅色织物、藤编或浅木、自然光、清爽蓝绿色点缀和松弛度假感。",
};

const VIEW_SCENE_LABELS = {
  wide: "远景图",
  mid: "中近景",
  close: "近景",
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
        ? "请用中文分析 Reference Image 1 房间图片和 Reference Image 2 沙发图片，并输出结构化、可执行的沙发摆放分析。分析逻辑必须以“沙发摆放”项目为准。"
        : "请用中文分析 Reference Image 1 沙发图片，并输出结构化、可执行的虚拟房间沙发摆放分析。分析逻辑必须以“沙发摆放”项目为准。",
      isCustomScene
        ? "房间图片分析要聚焦于：1. 空间布局和动线；2. 当前家具位置与尺寸关系；3. 墙面、地面、采光和装修风格；4. 明确窗户、落地窗、阳台门、阳台区域和阳光/自然光照射区的位置；5. 适合把沙发摆放到窗边或阳台采光区的具体落点、朝向、尺度建议；6. 需要避开的遮挡、门窗、柜体、插座或通道问题。严禁建议新增原图没有的窗户、落地窗、阳台门或阳台。"
        : styleReferenceImage
          ? "Reference Image 2 是房间/风格参考，只用于分析空间感、材质、光线、窗户/阳台/墙面线索和装修气质，不作为直接修改底图。最终需要按用户选择风格创建虚拟房间，并把沙发放在窗边、落地窗边、阳台门边或阳台采光区。"
          : "没有房间参考图，请结合沙发特征和用户选择风格创建一个真实可信的虚拟房间；虚拟房间必须有窗户、落地窗、阳台门或阳台等自然采光来源，并把沙发放在窗边或阳台采光区。",
      "沙发图片分析要聚焦于：1. 外形轮廓和类型；2. 材质、纹理、颜色；3. 扶手、靠背、坐垫、脚架、缝线等细节；4. 适配的家装风格；5. 在室内效果图中必须保留的视觉特征。",
      `用户选择风格：${styleLine}`,
      "",
      "请严格按以下字段输出，内容要短但具体，后续生图会把这段分析当作房间分析和沙发分析使用：",
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
      "9. 最终硬约束复述：沙发必须固定在窗边、落地窗边、阳台门边或阳台采光区；远景、中近景、近景只能改变镜头距离和取景，不能改变沙发物理落位。",
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

function buildReferenceSofaPrompt(payload, hasStyleReferenceImage) {
  const styleKey = String(payload.sceneStyle || "modern");
  const isCustomScene = styleKey === "custom" && hasStyleReferenceImage;
  const isVirtualRoom = !isCustomScene;
  const virtualStyle = STYLE_LABELS[styleKey] || STYLE_LABELS.modern;
  const selectedStyleInstruction = VIRTUAL_STYLE_INSTRUCTIONS[styleKey] || VIRTUAL_STYLE_INSTRUCTIONS.modern;
  const viewKey = String(payload.viewType || "wide");
  const scene = VIEW_SCENE_LABELS[viewKey] || VIEW_SCENE_LABELS.wide;
  const needsModel = Boolean(payload.includeModel);
  const resolution = String(payload.imageSize || "2K").toUpperCase();
  const ratio = String(payload.aspectRatio || "4:3");
  const analysis = normalizeAnalysisText(payload.sofaAnalysis);

  const globalRules = isVirtualRoom
    ? [
        `最高优先级全局规则：当前为虚拟房间模式，用户未上传必须保持的原始房间图片。以下 4 条规则适用于所有生成图片，无论用户选择远景图、中近景还是近景，都必须严格遵守；后续所有场景视角、构图、模特、比例和美化要求都不能覆盖这 4 条。`,
        `1. 房间生成方式：必须根据用户选择的“${virtualStyle}”创建一个新的虚拟室内房间，并让房间整体符合该风格：${selectedStyleInstruction} 虚拟房间需要真实、完整、可居住，不能像展板、拼贴、广告页或纯背景棚拍。`,
        "2. 沙发固定落位：沙发必须摆放在虚拟房间的窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光的位置，同时不能遮挡房间内的主要物品、门窗、柜体、通道、电视墙或关键家具。任何镜头视角、构图、展示正面、比例、动线或模特需求都不能改变沙发必须在窗边/阳台采光区的落位。",
        "3. 房间和沙发一致性：沙发必须保持和用户上传沙发图片一致，不得改变沙发外形、材质、颜色、比例、扶手、靠背、坐垫、脚架和缝线细节。虚拟房间可以按所选风格生成必要的墙面、地面、窗户、阳台、窗帘、灯光、柜体或少量软装，但不能新增与风格无关的多余物品，不能生成第二张沙发或其他抢主体的家具。",
        "4. 场景视角定义：远景图、中近景、近景表示的是机位、镜头距离、取景范围和视角，不表示把沙发摆放到远处或近处。可以选择最适合展示沙发正面和整体效果的机位与视角；但只能移动相机和改变取景，不能移动沙发落位。",
      ]
    : [
        "最高优先级全局规则：以下 4 条规则适用于所有生成图片，无论用户选择远景图、中近景还是近景，都必须严格遵守；后续所有场景视角、构图、模特、比例和美化要求都不能覆盖这 4 条。",
        "1. 房间生成方式：必须根据模型分析到的用户上传房间信息重新生成一个环境一致的房间场景，再把沙发自然融入其中；不允许直接把用户上传的房间原图当作底图进行局部修改、涂抹、覆盖、贴入沙发或简单拼贴，避免沙发生硬地贴在房间中。",
        "2. 沙发固定落位：沙发必须摆放在用户上传房间里真实存在的窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光的位置，同时不能遮挡房间内的主要物品、门窗、柜体、通道、电视墙或关键家具。任何镜头视角、构图、展示正面、比例、动线或模特需求都不能改变沙发必须在原房间已有窗边/阳台采光区的落位；严禁为了满足摆放要求而新增、移动、扩大或改造用户原图里没有的窗户、落地窗、阳台门或阳台。",
        "3. 房间和沙发一致性：房间和沙发必须保持和用户上传图片一致。严禁新增用户原图里没有的窗户、落地窗、阳台、阳台门、墙体、隔断、门洞、柱子、电视墙、家具、茶几、地毯、绿植、灯具、画作、摆件或其他物品；严禁为了方便摆放沙发而私自新增窗户或阳台；严禁改变房屋布局、墙体结构、门窗数量和位置、装修风格、已有家具位置、已有装饰物和其他可见物品。",
        "4. 场景视角定义：远景图、中近景、近景表示的是机位、镜头距离、取景范围和视角，不表示把沙发摆放到远处或近处。可以选择最适合展示沙发正面和整体效果的机位与视角，不必和用户上传房间图片的原始机位视角一致；但只能移动相机和改变取景，不能移动沙发落位，不能改变房间布局。",
      ];

  const viewInstructions = {
    远景图:
      "这是镜头视角要求，不是沙发摆放位置要求。使用较广角的室内远景构图，完整呈现房间布局、主要家具关系和沙发所在的窗边/阳台采光区固定位置；可以调整拍摄机位，不必复刻用户原图机位，但沙发必须展示正面或正面三分之二视角，不能只展示侧面。",
    中近景:
      "这是镜头视角要求，不是沙发摆放位置要求。中近景只允许参考产品场景图的镜头距离、低到中等机位、正面轻微偏侧角度和沙发画面占比，不能参考其中的摆放位置或室内内容。必须先把用户上传的沙发固定落在目标房间的窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光的位置，再让相机去这个窗边/阳台位置寻找最适合展示沙发正面的角度；严禁为了让沙发成为主体而把沙发挪到房间中央、通道、普通墙边、远离窗户/阳台的墙边或其他非采光区域。中近景画面必须同时满足两件事：第一，沙发是主体并展示正面或轻微三分之二正面；第二，画面里必须清楚看见沙发紧邻窗户/阳台的证据，例如窗框、落地窗边缘、阳台门边、窗帘、窗台、阳光从窗边落到沙发旁地面，或沙发背后/侧边紧邻主要采光面。若为了中近景构图导致看不见窗边/阳台证据，必须放宽取景或调整相机角度，不能移动沙发。",
    近景:
      "这是镜头视角要求，不是沙发摆放位置要求。近景是把镜头拉近、改变焦距或收紧取景范围，严格禁止为了做近景而把沙发往画面前方、房间中央、通道或不合理位置移动。沙发仍必须放在窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光的位置，不能放到房间其他位置。近景可以参考单人沙发产品场景图的角度和距离：低到中等机位、正面或轻微三分之二正面视角、沙发占画面主体、距离较近，能清楚看到沙发正面轮廓、靠背、扶手、坐垫和材质细节；严格禁止生成只展示侧面、背面或侧后方的沙发。近景画面即使裁得更紧，也必须保留明确的窗边/阳台落位证据。",
  };

  const framingBoundaries = {
    远景图:
      "远景图硬性构图边界：相机距离约 4-6 米或等效广角室内视角，沙发只占画面宽度约 20%-35%，必须能看到完整沙发、较完整房间布局、墙地交界线、窗边/阳台采光区和主要家具关系。禁止把沙发拍成产品主体特写，禁止让沙发占满画面或裁掉过多环境。",
    中近景:
      "中近景硬性构图边界：相机距离约 2-3 米或等效标准镜头视角，沙发占画面宽度约 40%-60%，必须完整或接近完整地显示单人沙发，允许沙发成为主体，但画面仍要保留约 25%-45% 的真实房间环境作为比例参照，包括地面、墙地交界线、窗框/阳台门/窗帘/自然光证据中的至少一种。中近景禁止两种错误：不能像远景一样看到大面积全屋、沙发很小；也不能像近景一样只剩沙发和少量背景、裁掉扶手/靠背/地面参照或看不出房间尺度。",
    近景:
      "近景硬性构图边界：相机距离约 0.8-1.5 米或等效较近视角，沙发占画面宽度约 65%-85%，重点展示正面轮廓、扶手、靠背、坐垫、材质和缝线细节。允许环境更少，但仍要保留窗边/阳台采光证据。禁止拍成远景或中近景那样展示大面积房间，禁止沙发显得很小。",
  };

  return [
    ...globalRules,
    `视角解释：本次用户选择的“${scene}”只表示最终效果图的镜头视角、取景范围、焦距感和构图远近，不表示沙发要摆在远处、中间或近处，也不表示对房间图片做简单放大、裁切或缩小。无论选择远景、中近景还是近景，沙发的唯一合法落位都是窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光的位置。切换场景时可以切换相机机位和镜头视角，${isVirtualRoom ? "虚拟房间没有上传机位，可以自由选择最适合展示沙发的机位" : "不必完全按照用户上传房间图片的原始机位"}，但必须找到最适合展示沙发正面的机位。尤其选择中近景或近景时，只能通过把镜头拉近、改变相机机位、调整焦距或收紧取景范围来形成更近的画面效果，严格禁止把沙发往近处放、往画面前景挪、放到房间中央或放到任何不在窗边/阳台采光区的位置。`,
    needsModel
      ? "模特图规则：用户选择需要模特，模特必须真实坐在沙发上，身体重量要落在坐垫上，臀部、大腿和沙发坐面之间要有明确接触关系，姿态要符合坐姿，不能站在旁边、靠在旁边、坐在扶手上、漂浮在沙发上方，或者只是出现在沙发附近。"
      : "模特图规则：用户选择不需要模特，画面中不要添加人物或人体局部。",
    isVirtualRoom
      ? `生成原则：当前没有用户上传的房间图片，必须按“${virtualStyle}”重新创建一个真实可信的虚拟室内房间；房间可以包含该风格必要的窗户、阳台、墙面、地面、窗帘、灯光、柜体或少量软装，但必须让用户上传的沙发自然融入其中。`
      : "生成原则：绝对不要把用户上传的房间图片当作底图直接修改、覆盖、局部涂抹或贴入沙发。房间图片只用于分析空间布局、家具关系、装修风格、材质和采光；最终效果图必须根据这些分析结果重新生成一个环境一致的房间场景，再把沙发自然融入进去。",
    isVirtualRoom
      ? `虚拟房间风格硬性限制：房间必须清楚呈现“${virtualStyle}”风格，整体空间、材质、色彩和光照都要符合该风格。允许生成必要的房间背景元素，但不得生成第二张沙发、无关大件家具、广告文字、产品分栏、展示海报或抢占主体的装饰。`
      : "房间一致性硬性限制：无论用户选择远景、中近景还是近景，都不能改变用户上传房间的布局、基本样式、装修风格、墙地面关系、门窗位置、已有家具位置、已有装饰物和主要空间结构。严禁生成原房间里不存在的窗户、落地窗、阳台门、阳台、墙体、隔断、门洞、柱子、电视墙、大件家具、茶几、地毯、绿植、灯具、挂画、摆件或其他物品；也不能删除、移动或大幅改造原房间中已经存在的主要门窗、墙体、柜体、家具和其他可见物品。窗户/阳台只能来自用户上传房间原本就有的结构，不能为了把沙发放到窗边或阳台边而凭空生成新的窗户、阳台、窗景或采光墙。",
    "沙发一致性硬性限制：生成图中的沙发必须和用户上传的沙发图片保持一致，包括整体外形、比例、正面轮廓、扶手形态、靠背高度、坐垫结构、材质纹理、颜色、脚架和缝线细节。严禁生成另一款沙发、改变沙发类型、改变主要结构、改变颜色材质，或只保留大致风格。",
    "沙发展示角度硬性限制：无论远景、中近景还是近景，都必须展示沙发正面或轻微三分之二正面，让用户能看清正面轮廓、靠背、扶手、坐垫和主体材质。严格禁止只展示沙发侧面、背面、侧后方，或让沙发主体被角度遮挡到无法判断正面特征。",
    "比例尺寸硬性限制：生成前必须根据房间地面平面、墙地交界线、门窗高度、柜体/茶几/已有家具尺寸和透视关系估算真实比例。沙发的宽度、高度、坐深和扶手尺度必须符合真实沙发与房间的比例，不能过大到压迫房间、遮挡过多已有家具或占满通道，也不能过小像儿童椅或装饰摆件。中近景和近景可以让沙发在画面中更突出，但只能通过相机更近、焦距变化或取景更紧实现，不能放大沙发实体尺寸。",
    isVirtualRoom
      ? "强制摆放规则：无论用户选择远景、中近景还是近景，这条摆放规则都必须遵守，镜头视角只能改变拍摄机位和取景范围，不能改变沙发的固定落位。沙发必须放在虚拟房间的窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光照射的位置，画面中必须能看出它紧邻窗户、阳台或主要采光面，严禁出现在房间中央、通道、电视前方、柜门前方、远离窗户/阳台的墙边、暗角或任何不靠近采光面的地方。"
      : "强制摆放规则：无论用户选择远景、中近景还是近景，这条摆放规则都必须遵守，镜头视角只能改变拍摄机位和取景范围，不能改变沙发的固定落位。沙发必须放在用户上传房间里真实存在的窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光照射的位置，画面中必须能看出它紧邻原房间已有窗户、阳台或主要采光面。严禁为了让沙发看起来靠窗或靠阳台而在原房间普通墙面上新增窗户、落地窗、阳台门、阳台、窗景、玻璃墙或新的自然光开口。",
    isVirtualRoom
      ? "核心要求：生成结果必须像真实室内摄影，而不是产品棚拍、广告拼贴或纯背景图。沙发需要被重新渲染进虚拟房间环境中，相机机位可以为了更好展示沙发适度调整高度、焦距、朝向和构图，但虚拟房间风格、材质、采光方向和整体空间关系必须统一。"
      : "核心要求：生成结果必须像真实室内摄影，而不是把沙发抠图后贴到房间照片上。沙发需要被重新渲染进原房间环境中。相机机位不必完全照搬用户房间图，可以为了更好展示沙发适度调整高度、焦距、朝向和构图，但房间结构、装修风格、材质、采光方向和整体空间关系必须保持一致。",
    "落地要求：必须先判断房间地面平面和墙地交界线，再把沙发底部、脚架或底座稳定放在地面或地毯上。沙发与地面之间必须有真实接触点、接触阴影、环境遮挡和受力感，严禁悬空、漂浮、穿模、半透明、错位或像贴纸一样覆盖在画面上。",
    "融合要求：沙发边缘不能有硬抠图边、发光边、白边、锯齿边或不一致清晰度；沙发的亮部、暗部、投影方向、地面反射和被家具遮挡的关系都要跟房间一致。必要时让沙发局部被原有家具或空间结构自然遮挡，以增强真实感。",
    isVirtualRoom
      ? "请基于用户上传的沙发图片和选择的虚拟房间风格，生成一张真实可信的室内沙发摆放效果图。"
      : "请基于第一张房间图片和第二张沙发图片，生成一张真实可信的室内沙发摆放效果图。",
    isVirtualRoom
      ? "摆放逻辑必须像真实室内设计师在虚拟房间里布置：先创建符合风格的窗边、落地窗边、阳台门边或阳台采光区，再把沙发放在这个采光区附近，并保持朝向自然、方便使用；不要把沙发放在房间中央、通道中央、电视前方、柜门前方、远离窗户/阳台的位置或其他非采光区域。"
      : "摆放逻辑必须像真实室内设计师在现场布置：先判断房间窗户、阳台、电视墙、通道、已有沙发/茶几/柜体的位置，再选择窗边或阳台采光区内的落位。若房间有大窗户、落地窗或阳台，必须把沙发放在窗边、阳台边或有阳光/自然光的采光区附近，并保持朝向自然、方便使用；不要把沙发放在房间中央、通道中央、电视前方、柜门前方、远离窗户/阳台的位置或其他非采光区域。",
    "沙发必须真实落在地面或地毯上，底部与地面有稳定接触，不能悬空、漂浮、穿模、压到茶几或与墙体家具不合理重叠。必须生成符合房间光源方向的接触阴影、地面反射、遮挡关系和透视比例，让沙发像原本就在这个房间里，而不是简单贴图。",
    "请把沙发融入房间环境：远景、中近景、近景都是镜头语言，不是摆放位置。生成图不要求完全匹配原图相机视角，近景时尤其可以换到更适合展示沙发正面的机位，但必须保持与房间环境一致的空间逻辑、布局关系、装修风格、光照关系、曝光、色温、窗边自然光、高光和阴影；沙发边缘要自然，不能有抠图感、硬边、发光边或不一致的清晰度。",
    isVirtualRoom
      ? "只需要把这张沙发自然放入虚拟房间中，房间背景元素必须服务于所选风格和空间真实感，不要添加抢主体的其他新家具或额外道具。"
      : "只需要把这张沙发自然放入房间中，不要添加任何其他新家具、新软装、新装饰物或额外道具。",
    `场景视角：${scene}。${viewInstructions[scene] || viewInstructions.远景图}`,
    `镜头距离和取景分级：${framingBoundaries[scene] || framingBoundaries.远景图}`,
    "三档视角必须明显区分：远景图=看房间整体与沙发落位；中近景=沙发是主体但仍能看出房间尺度和窗边/阳台环境；近景=看沙发细节和质感。当前选择哪一档，就必须严格落在该档，不要生成相邻档位的画面。",
    `目标清晰度：${resolution}。画面比例：${ratio}。`,
    isVirtualRoom
      ? `严格按“${virtualStyle}”创建虚拟房间；将沙发自然摆放到窗边或阳台采光区的固定位置，比例、透视、阴影和光照必须真实。`
      : "严格保留房间原有结构、门窗、墙地面、采光、装修风格和已有物品；将沙发自然摆放到窗边或阳台采光区的固定位置，比例、透视、阴影和光照必须真实。",
    "严格参考沙发图片的外形、材质、颜色、扶手、靠背、坐垫、脚架和缝线细节，不要生成不相关的新沙发；必须优先选择能展示沙发正面的机位，不能只展示侧面。",
    needsModel
      ? isVirtualRoom
        ? "除这张沙发、一位真实坐在沙发上的模特和必要的虚拟房间背景元素之外，不要新增抢主体的其他家具或道具；模特不得改变房间和沙发主体。用户选择需要模特时，画面中必须出现一位完整、真实、自然坐在沙发上的模特，不能缺失模特，不能只出现局部身体。"
        : "除这张沙发和一位真实坐在沙发上的模特之外，不要新增茶几、地毯、抱枕、绿植、灯具、画作或其他任何物体；模特不得改变房间和沙发主体。用户选择需要模特时，画面中必须出现一位完整、真实、自然坐在沙发上的模特，不能缺失模特，不能只出现局部身体。"
      : isVirtualRoom
        ? "除这张沙发和必要的虚拟房间背景元素之外，不要新增抢主体的其他家具、人物或额外道具。"
        : "除这张沙发之外，不要新增茶几、地毯、抱枕、绿植、灯具、画作、人物或其他任何物体。",
    "不要添加文字、水印、logo、边框、拼贴版式或说明标注。",
    "",
    `房间分析与沙发分析：${analysis || "未提供分析文本；请先自行根据参考图片进行房间和沙发分析，再严格执行以上规则。"}`,
    "",
    "最终不可违背校验：以上房间分析和沙发分析只作为参考，不能覆盖本段最终规则。如果分析文本中出现把沙发放到房间中央、通道、电视前、柜门前、远离窗户/阳台的位置，必须忽略该建议。",
    isVirtualRoom
      ? `最终场景校验：当前用户选择的是“${scene}”。无论是远景图、中近景还是近景，最终图都必须让沙发固定落在窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光的位置；如果沙发没有摆放在窗边或阳台采光区，结果无效。`
      : `最终场景校验：当前用户选择的是“${scene}”。无论是远景图、中近景还是近景，最终图都必须让沙发固定落在用户上传房间原本存在的窗边、落地窗边、阳台门边或阳台区域内有阳光/自然光的位置；如果沙发没有摆放在原房间已有窗边或阳台采光区，结果无效。如果画面为了证明沙发靠窗/靠阳台而出现用户原图没有的窗户、落地窗、阳台门、阳台、窗景或新的采光开口，结果同样无效。`,
    "中近景特别校验：如果当前场景是中近景，严禁把沙发挪到更方便构图的房间中央或其他位置；必须保持沙发在窗边/阳台采光区，只能移动相机、改变焦距、改变镜头朝向或裁切画面来形成中近景。中近景必须是介于远景和近景之间的半身环境式视距：沙发明显成为主体但不能占满画面，必须完整或接近完整可见，不能裁掉主要扶手、靠背或坐垫；画面仍要保留地面、墙地交界线、窗边/阳台证据和少量房间环境作为比例参照。",
    "近景特别校验：如果当前场景是近景，严禁把沙发从窗边/阳台采光区挪到房间中央、普通墙边、通道、暗角或任何不靠窗不靠阳台的位置。近景只能让相机靠近已经固定在窗边/阳台采光区的沙发，不能让沙发靠近镜头。画面中必须至少保留一种明确证据证明沙发在窗边或阳台边：可见窗框、落地窗边缘、阳台门边、窗帘、阳光照射地面、强自然光从沙发侧后方进入，或沙发背后/侧边紧邻主要采光面。",
    scene === "中近景"
      ? isVirtualRoom
        ? "当前场景就是中近景：请从已经摆在虚拟房间窗边或阳台采光区的沙发正前方略偏侧、低到中等机位、较近距离拍摄，让沙发成为主体；同时必须保留窗框、落地窗边缘、阳台门边、窗帘或强自然光落在沙发旁地面的证据。最重要的是，沙发必须仍然摆在虚拟房间的窗边或阳台采光区，镜头去找沙发，不能把沙发移到镜头前。"
        : "当前场景就是中近景：请从已经摆在用户房间窗边或阳台采光区的沙发正前方略偏侧、低到中等机位、较近距离拍摄，让沙发成为主体；同时必须保留原房间已有窗户、落地窗边缘、阳台门边、窗帘或强自然光落在沙发旁地面的证据。最重要的是，沙发必须仍然摆在用户房间的窗边或阳台采光区，镜头去找沙发，不能把沙发移到镜头前，也不能新增原图没有的窗户或阳台。"
      : "",
    scene === "近景"
      ? isVirtualRoom
        ? "当前场景就是近景：请从已经摆在虚拟房间窗边或阳台采光区的沙发正前方略偏侧靠近拍摄，保留窗框、窗帘、阳台门边或强自然光证据；不能把沙发移动到更方便拍摄的墙边、房间中央或纯背景前。"
        : "当前场景就是近景：请从已经摆在用户房间窗边或阳台采光区的沙发正前方略偏侧靠近拍摄，保留原房间已有窗户、窗帘、阳台门边或强自然光证据；不能把沙发移动到更方便拍摄的墙边、房间中央或纯背景前，也不能新增原图没有的窗户或阳台。"
      : "",
    "落位优先级校验：窗边/阳台采光区落位的优先级高于中近景构图、高于近景构图、高于沙发占画面比例、高于展示角度。为了保证窗边/阳台落位，可以让中近景或近景稍微更宽、保留更多窗边背景或让相机角度更灵活；绝不能为了中近景或近景效果而改变沙发落位。",
    "比例校验：如果沙发尺寸相对门窗、墙地交界线、柜体、茶几或已有家具显得过大或过小，结果无效；必须重新按真实沙发与房间尺度生成。",
    isVirtualRoom
      ? `最终虚拟房间校验：所有视角都必须是“${virtualStyle}”虚拟房间，房间必须真实完整、有自然采光，并让沙发位于窗边或阳台采光区。若结果像广告拼贴、产品详情页、纯背景棚拍，或复制参考图中的文字/分栏/双沙发/人物/具体家具，则结果无效，必须按所选风格重新生成。`
      : "最终房间一致性校验：所有视角都必须保持用户上传房间的原始布局、门窗数量和位置、墙体结构、装修风格、已有家具、已有装饰物和其他可见物品。若结果出现原图没有的窗户、落地窗、阳台门、阳台、窗景、采光开口、墙体、门洞、家具、茶几、地毯、绿植、灯具、画作、摆件或其他新增物品，或缺失/移动/改造原图已有主要物品，则结果无效，必须按原房间重新生成。不能为了让沙发符合窗边/阳台摆放规则而私自新增或改造窗户/阳台；只能把沙发摆到原房间已有的窗边或阳台边。",
    needsModel
      ? "最终模特校验：用户已选择“需要模特”，最终图必须出现一位真实完整的模特，并且模特必须自然坐在这张沙发上，臀部和大腿与坐垫有明确接触，身体重量落在沙发上。若画面没有模特、只有人体局部、模特站在旁边、靠在旁边、漂浮、坐在扶手上或没有与坐垫真实接触，则结果无效，必须重新生成带有坐在沙发上的模特。"
      : "最终人物校验：用户选择“不需要模特”，最终图中不得出现人物、人体局部、倒影人物或照片里的人。",
  ].filter(Boolean).join("\n");
}

function buildPrompt(payload, hasStyleReferenceImage) {
  return buildReferenceSofaPrompt(payload, hasStyleReferenceImage);
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
