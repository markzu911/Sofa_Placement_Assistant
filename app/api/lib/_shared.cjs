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
const MAX_ANALYSIS_CHARS = 5000;
const MAX_CHAT_INSTRUCTION_CHARS = 1400;

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

const STYLE_PRESETS = {
  custom:
    "别墅豪宅客厅：以用户房间参考图为准，保留空间层高、墙面材质、窗户位置、采光方向、地面材质、吊灯、背景墙和整体豪宅氛围。",
};

const STYLE_LABELS = {
  custom: "别墅豪宅客厅",
};

const VIEW_LABELS = {
  villa_wide: "豪宅客厅广角斜侧视角",
  wide: "豪宅客厅广角斜侧视角",
  mid: "豪宅客厅自然中景",
  close: "大型沙发材质近景",
};

const VIEW_RULES = {
  villa_wide:
    "豪宅客厅广角斜侧视角：镜头高度约 1.3 米，24mm 室内建筑摄影镜头，从客厅斜侧方拍摄，完整展示大型沙发组合、客厅开阔感、前中后景空间层次、地毯/茶几/窗户/背景墙关系。沙发为画面核心，不能缩得过小，也不能拍成局部特写。",
  wide:
    "豪宅客厅广角斜侧视角：镜头高度约 1.3 米，24mm 室内建筑摄影镜头，从客厅斜侧方拍摄，完整展示大型沙发组合、客厅开阔感、前中后景空间层次、地毯/茶几/窗户/背景墙关系。沙发为画面核心，不能缩得过小，也不能拍成局部特写。",
  mid:
    "豪宅客厅自然中景：保持同一别墅空间和沙发组合结构，镜头略靠近，沙发占画面主要面积，同时保留地毯、茶几、背景墙、窗户采光和空间层高线索。",
  close:
    "大型沙发材质近景：保持同一别墅空间和沙发组合结构，镜头靠近展示面料纹理、坐垫分割、靠包、扶手和转角结构，同时保留局部客厅环境、真实阴影和地面接触。",
};

const PRODUCT_FIDELITY_RULES = [
  "【产品还原逻辑】",
  "1. 产品参考图中的大型沙发是最高优先级，必须严格还原沙发的组合方式、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、面料纹理、颜色和整体轮廓。",
  "2. 不允许改变沙发模块结构，不允许随意增删转角、贵妃位、脚踏或单椅，不允许把 L 型、U 型、弧形、组合模块改成另一个款式。",
  "3. 允许根据别墅空间比例做真实尺度匹配和等比例缩放，但产品设计必须保持不变；沙发不能过小、不能像贴图、不能漂浮、不能穿模。",
  "4. 生成前必须把产品参考图提炼成产品身份指纹：组合方向、转角关系、贵妃位朝向、模块数量、每个坐垫和靠包分割、扶手高度与厚度、底座/脚部、缝线、褶皱、材质纹理和主色。最终图必须逐项匹配。",
  "5. 产品可以接受房间自然光影响产生合理明暗、阴影、反射和材质微变化，但不得换色、换材质、换比例、换轮廓、减少模块或增加不存在的组件。",
].join("\n");

const ROOM_FUSION_RULES = [
  "【房间融合逻辑】",
  "1. 房间参考图用于锁定别墅空间的层高、墙面材质、窗户位置、采光方向、地面材质、吊灯、背景墙和整体豪宅氛围。",
  "2. 沙发必须自然融入空间，符合别墅客厅、大平层、豪宅样板间的大尺度陈列逻辑。",
  "3. 注意大件家具与墙面、地毯、茶几、窗户之间的真实距离和透视关系；地面接触、遮挡关系、投影方向、环境反射必须真实。",
  "4. 允许进行摄影级软装整理、曝光和色温优化，让空间更高级通透；禁止改变房间核心结构、窗位、墙地面材质、背景墙方向和主采光逻辑。",
  "5. 空间高级但不能抢产品：墙面、灯具、茶几、绿植、艺术品和地毯只服务沙发展示，不得遮挡沙发主要结构。",
].join("\n");

const CAMERA_RULES = [
  "【生成角度】",
  "生成豪宅客厅广角斜侧视角，镜头高度约 1.3 米，24mm 室内建筑摄影镜头。",
  "完整展示大型沙发组合、客厅开阔感和空间层次；画面需要有前景、中景、远景关系，透视稳定，垂直线自然，沙发比例真实。",
].join("\n");

const IMAGE_QUALITY_RULES = [
  "【画面要求】",
  "高端别墅软装摄影，真实豪宅样板间，电影级自然光，宽敞通透，沙发为画面核心，空间高级但不抢产品，8K，真实阴影，真实材质。",
].join("\n");

const NEGATIVE_RULES = [
  "【禁止】",
  "不要文字，不要水印，不要额外 Logo，不要拼图，不要分屏，不要夸张变形，不要把沙发缩得过小，不要改变产品原始设计。",
  "不要生成产品海报、棚拍图、白底图、局部特写图、平面拼贴、前后对比图或多视角排版。",
  "不要加入人物、人体局部或倒影人物。",
].join("\n");

const ASPECT_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "3:2", "2:3", "5:4", "4:5"]);
const IMAGE_SIZES = new Set(["2K", "4K", "8K"]);
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

function normalizeAnalysisText(value) {
  return String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_ANALYSIS_CHARS);
}

function normalizeChatInstruction(value) {
  return String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHAT_INSTRUCTION_CHARS);
}

function getStyleKey(payload) {
  const key = String(payload.sceneStyle || "custom");
  return STYLE_PRESETS[key] ? key : "custom";
}

function getViewKey(payload) {
  const key = String(payload.viewType || "wide");
  return VIEW_RULES[key] ? key : "wide";
}

function validateBaseInputs(payload) {
  const productImage = parseDataUrl(payload.productImage, "产品图");
  const roomImage = parseDataUrl(payload.styleReferenceImage, "房间参考图");
  const styleKey = getStyleKey(payload);

  if (!productImage) {
    throw new Error("请先上传产品图片。");
  }
  if (styleKey === "custom" && !roomImage) {
    throw new Error("已选择自定义房间，请上传房间原图。");
  }

  return {
    productImage,
    roomImage,
    styleKey,
    isCustomRoom: styleKey === "custom" && Boolean(roomImage),
  };
}

function buildSofaAnalysisRequest(payload) {
  const { productImage, roomImage, styleKey, isCustomRoom } = validateBaseInputs(payload);
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.custom;

  const parts = [];
  if (isCustomRoom) {
    parts.push({ inlineData: { mimeType: roomImage.mimeType, data: roomImage.data } });
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
  } else {
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
    if (roomImage) {
      parts.push({ inlineData: { mimeType: roomImage.mimeType, data: roomImage.data } });
    }
  }

  parts.push({
    text: [
      "你是顶级别墅软装摄影师和高端家具视觉合成专家。请用中文输出一个可直接用于生图的别墅大型沙发空间分析。",
      isCustomRoom
        ? "输入顺序：Reference Image 1 是房间参考图；Reference Image 2 是产品参考图。产品参考图中的大型沙发优先级最高，房间参考图用于锁定豪宅客厅空间。"
        : roomImage
          ? "输入顺序：Reference Image 1 是产品参考图；Reference Image 2 是房间参考图。"
          : "输入顺序：Reference Image 1 是产品参考图。请创建真实可信的别墅豪宅客厅。",
      `用户选择：${styleLine}`,
      PRODUCT_FIDELITY_RULES,
      ROOM_FUSION_RULES,
      CAMERA_RULES,
      IMAGE_QUALITY_RULES,
      NEGATIVE_RULES,
      "",
      "请严格按以下 4 个标题输出，标题一字不差：",
      "产品还原清单：",
      "1. 沙发组合方式、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、底座/脚部、面料纹理、颜色和整体轮廓。",
      "2. 必须保持不变的产品身份指纹，以及允许的等比例尺度适配方式。",
      "房间融合清单：",
      "1. 房间参考图中必须保留的层高、墙面材质、窗户位置、采光方向、地面材质、吊灯、背景墙和豪宅氛围。",
      "2. 沙发与墙面、地毯、茶几、窗户、背景墙之间的真实距离、透视、遮挡和阴影关系。",
      "摄影生成策略：",
      "1. 采用豪宅客厅广角斜侧视角，镜头高度约 1.3 米，24mm 室内建筑摄影镜头。",
      "2. 说明前景、中景、远景如何组织，使大型沙发成为核心，同时保留客厅开阔感和空间层次。",
      "最终约束：",
      "1. 重申禁止文字、水印、Logo、拼图、分屏、夸张变形、沙发过小和改变产品原始设计。",
      "2. 重申不要人物，空间高级但不抢产品。",
      "只输出分析内容，不要问问题，不要输出额外说明。",
    ].join("\n"),
  });

  return {
    contents: { parts },
    config: { safetySettings: SAFETY_SETTINGS },
  };
}

function buildGenerationPrompt(payload, hasRoomImage) {
  const styleKey = getStyleKey(payload);
  const viewKey = getViewKey(payload);
  const isCustomRoom = styleKey === "custom" && hasRoomImage;
  const styleLabel = STYLE_LABELS[styleKey] || STYLE_LABELS.custom;
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.custom;
  const viewLabel = VIEW_LABELS[viewKey] || VIEW_LABELS.wide;
  const viewRule = VIEW_RULES[viewKey] || VIEW_RULES.wide;
  const analysis = normalizeAnalysisText(payload.sofaAnalysis);
  const chatInstruction = normalizeChatInstruction(payload.extraInstruction || payload.chatInstruction);
  const resolution = String(payload.imageSize || "8K").toUpperCase();
  const ratio = String(payload.aspectRatio || "16:9");

  return [
    "你是顶级别墅软装摄影师和高端家具视觉合成专家。",
    "任务：根据上传的【产品参考图】和【房间参考图】，生成一张适合别墅、大平层、豪宅客厅的大型沙发空间效果图。",
    "生成结果必须是一张完整真实照片，不要做拼贴、产品详情页、棚拍背景、文字标注、logo、水印、边框、分屏或对比图。",
    "绝对优先级顺序：1 产品参考图中的大型沙发 100% 还原；2 房间参考图的豪宅空间身份和采光透视准确融合；3 以真实摄影机位生成；4 再做软装美化和画质提升。",
    isCustomRoom
      ? "输入顺序：Reference Image 1 是房间参考图；Reference Image 2 是产品参考图。"
      : hasRoomImage
        ? "输入顺序：Reference Image 1 是产品参考图；Reference Image 2 是房间参考图。"
        : "输入顺序：Reference Image 1 是产品参考图。",
    `空间定位：${styleLabel}。${styleLine}`,
    PRODUCT_FIDELITY_RULES,
    ROOM_FUSION_RULES,
    CAMERA_RULES,
    IMAGE_QUALITY_RULES,
    `当前景别：${viewLabel}。${viewRule}`,
    "摄影构图：以拍摄角度进行生成，像真实室内建筑摄影师站在豪宅客厅斜侧方取景。沙发可以略偏三分位，但必须是画面核心；需要看清完整大型沙发组合，又能看见客厅开阔尺度、背景墙、窗户采光、地毯/茶几和空间纵深。",
    "尺度和透视：根据房间层高、墙地线、窗户尺寸、茶几/地毯尺度推算大型沙发真实尺寸。沙发应有豪宅客厅里的大尺度陈列感，不能缩成小家具；也不能过大到堵死动线或压迫墙面。所有模块必须稳定落在地面或地毯上，有真实接触阴影、遮挡关系、环境光和材质反射。",
    "空间融合：优先保留房间参考图的墙地面、窗位、吊灯、背景墙、材质和采光方向。可以用更高级的软装、地毯、茶几、绿植或艺术品增强豪宅样板间质感，但这些元素不能抢走沙发视觉中心，不能遮挡沙发结构。",
    "产品边界：不允许为了适配房间而修改沙发组合方向、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、面料纹理、颜色和整体轮廓。生成相似款但结构不一致视为失败。",
    "人物规则：不要加入人物、手、人体局部、倒影人物或照片里的人。",
    NEGATIVE_RULES,
    `输出规格：${resolution}，画面比例 ${ratio}。`,
    "",
    "已确认的生成分析：",
    analysis || "请先自行判断产品结构指纹、房间豪宅空间特征、真实尺度、采光方向、透视关系和最佳摄影机位，再按以上规则生成。",
    chatInstruction
      ? [
          "",
          "用户补充要求：",
          chatInstruction,
          "用户补充要求只能影响软装氛围、光线、构图、材质细节强调和局部陈设；不得改变沙发款式、颜色、材质、结构、比例、模块数量、转角方向、贵妃位方向和整体轮廓。若补充要求与产品 100% 还原或房间参考图冲突，以产品还原和房间融合为准。",
        ].join("\n")
      : "",
    "",
    "最终自检：沙发组合方式、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、面料纹理、颜色和轮廓是否逐项匹配产品参考图；房间层高、墙面、窗位、采光、地面、吊灯、背景墙和豪宅氛围是否来自房间参考图；是否为 1.3 米机位、24mm 广角斜侧视角；沙发是否为画面核心且尺度真实；是否无文字、水印、Logo、拼图、分屏、夸张变形、人物和产品结构变更。任一项失败都必须重生成。",
  ].join("\n");
}

function buildGeminiRequest(payload) {
  const aspectRatio = String(payload.aspectRatio || "16:9");
  const imageSize = String(payload.imageSize || "8K").toUpperCase();

  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error("图片比例不在支持范围内。");
  }
  if (!IMAGE_SIZES.has(imageSize)) {
    throw new Error("分辨率只支持 2K、4K 或 8K。");
  }

  const { productImage, roomImage, isCustomRoom } = validateBaseInputs(payload);
  const parts = [];
  if (isCustomRoom) {
    parts.push({ inlineData: { mimeType: roomImage.mimeType, data: roomImage.data } });
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
  } else {
    parts.push({ inlineData: { mimeType: productImage.mimeType, data: productImage.data } });
    if (roomImage) {
      parts.push({ inlineData: { mimeType: roomImage.mimeType, data: roomImage.data } });
    }
  }
  parts.push({ text: buildGenerationPrompt(payload, Boolean(roomImage)) });

  return {
    contents: { parts },
    config: {
      imageConfig: { aspectRatio },
      safetySettings: SAFETY_SETTINGS,
    },
    generationConfig: {
      imageConfig: { aspectRatio },
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
