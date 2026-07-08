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
  modern: "现代简约：清爽线条、克制配色、明亮自然光、低干扰软装。",
  cream_luxury: "轻奢风：精致材质、石材/金属细节、明亮通透、高级但不过度装饰。",
  italian: "奶油风：低饱和奶油色、圆润家具、柔和织物、温暖细腻自然光。",
  japandi: "寂宅风：留白、木质或微水泥肌理、低饱和色、安静克制。",
  scandinavian: "北欧风：浅木、白墙、柔和织物、自然采光、轻盈温暖。",
  french: "新中式：木质格栅、东方比例、温润材质、含蓄装饰。",
  loft: "都市 Loft：微水泥、黑色金属、开阔空间、硬朗但有生活温度。",
  coastal: "海岸度假：浅色织物、藤编或浅木、蓝绿色点缀、清爽自然光。",
  custom: "自定义房间：以用户房间图为准，保持原房间结构、门窗、墙地面、已有物品、材质、采光、透视和氛围。",
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

const VIEW_LABELS = {
  wide: "远景",
  mid: "中景",
  close: "近景",
};

const VIEW_RULES = {
  wide:
    "远景：这是拍摄距离和视角，不是摆放位置。相机退后或使用较广视角，产品仍在同一个锁定落位上，约占画面宽度 16%-28%。必须看见房间整体布局、主家具关系、地面承托、通道和采光来源；产品可以偏离中心。",
  mid:
    "中景：这是拍摄距离和视角，不是摆放位置。相机在房间内正常观看距离，围绕同一个锁定落位轻微换角度，产品约占画面宽度 28%-42%。产品是主要视觉点但仍处在环境中，必须保留主家具关系、地面、墙地关系、通道和自然光线索。不要拍成近景特写，也不要退成远景。",
  close:
    "近景：这是拍摄距离和视角，不是摆放位置。相机靠近同一个锁定落位，产品约占画面宽度 58%-76%，展示材质、轮廓、扶手/靠背/坐垫/脚架/缝线等细节。仍需保留局部房间、地面接触和相邻主家具或墙地线索，不能变成纯背景产品图。",
};

const PRODUCT_FIDELITY_RULES = [
  "产品还原最高优先级：Reference 产品必须 100% 作为款式身份来源。",
  "1. 必须保留产品的类型、整体轮廓、颜色、材质、纹理、分块、缝线、褶皱、扶手、靠背、坐垫、脚架/底座、五金/按钮和可见功能结构。",
  "2. 允许为了合理放入房间而等比例缩放产品实体尺寸，但不能改变产品比例、款式、颜色、材质和关键结构；不能把单人座椅/单人沙发改成双人沙发，不能改扶手/靠背/坐垫形状，不能生成相似但不同款。",
  "3. 产品可以随房间光照产生合理明暗、阴影和反射，但皮革/布料质感、主色和结构细节必须保持一致。",
  "4. 生成前必须把 Reference 产品提炼成产品身份指纹：数量、品类、整体外轮廓、正面/侧面比例、扶手形态、靠背高度、坐垫分块、脚架/底座、五金按钮、缝线、褶皱、颜色、材质和纹理。最终图必须逐项匹配，不允许只生成相似款。",
  "5. 禁止产品漂移：不能换颜色、换材质、换扶手、换靠背、增减坐垫、增减脚架、改变单人/多人属性、改变功能结构或把休闲椅/按摩椅/沙发互相混淆。",
].join("\n");

const ROOM_ADJUSTMENT_RULES = [
  "原房间处理原则：允许做合理的摄影级微整理，但不能改变房间身份。",
  "允许：轻微整理小物件、弱化杂乱、优化曝光/色温/光影、轻微调整小摆件位置、为了产品落地让极小杂物消失或移开。",
  "禁止：改变房型、墙地面、门窗位置、窗户数量、电视墙方向、主沙发/床/茶几/柜体等大件家具位置；禁止新增不必要大件家具；禁止为了摆放产品而重构房间。",
].join("\n");

const CUSTOM_ROOM_PLACEMENT_RULES = [
  "自定义房间摆放总原则：不要套用窗边模板，也不要把产品放到画面中心空地。先识别房间类型和主家具，再找真实使用关系。",
  "1. 先识别主家具和功能区：卧室看床、床头柜、衣柜和床边通道；客厅看已有沙发、茶几、电视墙、边几、窗帘和主通道；书房看书桌、书柜和阅读角。",
  "2. 产品必须和主家具形成合理关系：单人沙发、休闲椅、躺椅、懒人椅、按摩椅优先放在床边、床尾侧、已有沙发侧边、边几旁、阅读角或休闲区侧位；不能孤零零摆在客厅正中央、电视与沙发之间、茶几前方主通道、窗帘缝、柜门前或画面前景硬塞。",
  "3. 自然光只影响画面质量，不决定落位。窗边很挤、会挡窗帘/阳台/已有沙发/茶几/通道时，必须选择床边或主家具侧边等更合理位置。",
  "4. 产品朝向要服务使用关系：通常朝向床、茶几、电视、房间中心或主座位组，允许 15-45 度自然斜放；不要只为了面向镜头而背离房间使用逻辑。",
  "5. 主落位必须是连续可见地面，尺寸能容纳完整产品和模特坐姿；要留出通行、柜门开启、茶几使用和坐下起身空间。",
  "6. 一旦选定主落位，远景、中景、近景都必须使用同一物理落位、同一地面接触点、同一朝向逻辑和同一主家具关系；只能改变拍摄距离、镜头焦距、相机高度和轻微拍摄角度。",
].join("\n");

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
  const key = String(payload.sceneStyle || "modern");
  return STYLE_PRESETS[key] ? key : "modern";
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
  const includeModel = Boolean(payload.includeModel);
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.modern;

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
      "你是室内设计师和商业摄影指导。请用中文输出一个可直接用于生图的摆放分析。",
      isCustomRoom
        ? "输入顺序：Reference Image 1 是用户真实房间；Reference Image 2 是待放入房间的产品。必须以真实房间为准，不新增、不删除、不移动原房间的主要结构和已有物品。"
        : roomImage
          ? "输入顺序：Reference Image 1 是产品；Reference Image 2 是风格/房间参考，只提取风格、材质、色调、光线和空间气质，不复制具体房间。"
          : "输入顺序：Reference Image 1 是产品。请按用户选择的风格创建真实可信的虚拟房间。",
      `用户选择：${styleLine}`,
      PRODUCT_FIDELITY_RULES,
      includeModel ? "用户要求：可加入 1 位真实成人模特，必须自然坐/使用在产品上，比例和受力真实。" : "用户要求：不要加入人物、人体局部或倒影人物。",
      isCustomRoom ? ROOM_ADJUSTMENT_RULES : "",
      isCustomRoom ? CUSTOM_ROOM_PLACEMENT_RULES : "",
      "",
      "请严格按以下 4 个标题输出，标题一字不差：",
      "产品分析：",
      "1. 产品类型、体量、真实比例和适合展示的正面/三分之二角度。",
      "2. 判断产品最适合的真实使用场景和邻近主家具，例如床边、沙发边、阅读角、茶几旁、书桌旁或餐边区。",
      "3. 输出【产品身份指纹】：数量、品类、整体外轮廓、正面/侧面比例、扶手、靠背、坐垫、脚架/底座、五金/按钮、缝线、褶皱、颜色、材质和纹理。后续生图必须逐项匹配。",
      "4. 必须保留的外形、颜色、材质、纹理、结构、边缘、脚架/底座、缝线/五金等识别特征。",
      "房间分析：",
      isCustomRoom
        ? "1. 原房间保留清单：门窗、墙地面、天花、已有家具、软装、装饰物、采光方向、透视、相机高度和整体氛围。"
        : "1. 虚拟房间设定：房间功能、风格、墙地面、窗/阳台/自然光来源、必要家具和留白区域。",
      isCustomRoom
        ? "2. 主家具与功能区判断：明确这是卧室、客厅、书房或其他空间；指出床/已有沙发/茶几/电视/柜体/边几/窗帘/主通道的位置和使用关系。"
        : "2. 可用地面判断：规划一个自然采光好、不挡通道、不挡门柜、不挤压家具的产品落位区域。",
      isCustomRoom
        ? "3. 可用地面候选表：至少列出 3 个候选区域，逐个标为【有效】或【无效】并说明原因。必须优先评估床边、床尾侧、已有沙发侧边、边几旁、阅读角或主家具侧位；必须排除画面中心空地、电视与茶几之间、茶几前主通道、窗帘窄缝、柜门开启区和会覆盖已有家具的位置。"
        : "3. 可用地面候选表：至少列出 3 个候选区域，逐个标为【有效】或【无效】并说明原因。",
      "摆放决策：",
      "1. 给出 1 个主落位：必须从候选表里的【有效】区域选择。说明具体地面位置、朝向、与床/已有沙发/茶几/电视/窗帘/通道/墙面的关系、离墙或离家具的大致距离。",
      "2. 输出【落位锁定句】：用一句话固定产品的物理地面区域、朝向、相邻主家具、离墙/离主家具关系。后续远景、中景、近景必须复用这句话，不能换位置。",
      "3. 说明产品真实尺寸如何适配房间比例；允许等比例缩放到合理大小，但必须保留产品比例和样式 100%。说明为什么不会过大、过小、悬空、穿模或阻塞动线。",
      "4. 产品不必居中，也不要默认居中；优先选择主家具侧边、床边、床尾侧、已有沙发旁、边几旁或阅读角等真实使用位置。若窗边或画面中心不符合使用关系，必须明确排除。",
      "5. 禁止落位复述：列出本房间里不能放的位置，并特别说明为什么不能放在画面中心、主通道、电视和茶几之间、窗帘窄缝或已有家具上。",
      "摄影建议：",
      "1. 分别给出远景、中景、近景的拍摄建议：机位、镜头距离、相机高度、轻微拍摄角度、产品画面占比、需要保留的环境线索。三档只能改变拍摄距离、镜头焦距、相机高度和轻微角度，不能改变主落位、朝向逻辑和地面接触点。",
      "2. 说明光线、阴影、地面接触、遮挡关系、透视、景深和真实摄影质感要求。",
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
  const styleLabel = STYLE_LABELS[styleKey] || STYLE_LABELS.modern;
  const styleLine = STYLE_PRESETS[styleKey] || STYLE_PRESETS.modern;
  const viewLabel = VIEW_LABELS[viewKey] || VIEW_LABELS.wide;
  const viewRule = VIEW_RULES[viewKey] || VIEW_RULES.wide;
  const analysis = normalizeAnalysisText(payload.sofaAnalysis);
  const chatInstruction = normalizeChatInstruction(payload.extraInstruction || payload.chatInstruction);
  const needsModel = Boolean(payload.includeModel);
  const resolution = String(payload.imageSize || "2K").toUpperCase();
  const ratio = String(payload.aspectRatio || "4:3");

  return [
    "生成一张真实可信的室内摄影效果图，不要做拼贴、产品详情页、棚拍背景、文字标注、logo、水印或边框。",
    "绝对优先级顺序：1 产品样式 100% 还原；2 使用已确认的唯一合理落位；3 远景/中景/近景只改变拍摄距离、镜头焦距、相机高度和轻微角度；4 再做美化和摄影质感。",
    PRODUCT_FIDELITY_RULES,
    isCustomRoom
      ? "输入顺序：Reference Image 1 是用户真实房间；Reference Image 2 是待放入产品。最终图必须重新渲染成一张完整真实照片，但房间结构、门窗、墙地面、已有主要家具/物品、材质、采光方向、透视和氛围要保持原房间身份一致。"
      : hasRoomImage
        ? "输入顺序：Reference Image 1 是产品；Reference Image 2 是风格/房间参考。参考图只用于风格、材质、色调、光线和空间气质；请创建一个新的真实虚拟房间，不要照搬参考图布局。"
        : "输入顺序：Reference Image 1 是产品。请创建一个新的真实虚拟房间。",
    isCustomRoom
      ? [
          ROOM_ADJUSTMENT_RULES,
          "自定义房间核心：完全抛开旧的固定窗边模板，像室内设计师现场摆放。",
          "先识别房间类型和主家具，再把产品放到有真实使用关系的位置：卧室优先床边/床尾侧/床头侧；客厅优先已有沙发侧边、茶几侧边、边几旁、阅读角或休闲区侧位；书房优先书桌/书柜旁阅读位。",
          "自然光只是摄影加分项，不是落位命令。禁止把产品放在画面中心空地、电视和茶几之间、主通道、窗帘窄缝、柜门前、已有家具上或为了靠窗而挡住原房间功能。",
          "如果 Reference Image 2 是棕色单人躺椅/休闲椅/按摩椅，必须把它当作单人休闲座位处理：放在床边或主座位组侧边等合理休闲位，不能摆成客厅中央展示道具。",
        ].join("\n")
      : `虚拟房间核心：按“${styleLabel}”创建房间。${styleLine} 产品放在采光好、动线合理、能体现房间效果的位置，通常靠近窗、阳台或自然光区域，但不能挡通道、门柜或主要家具。`,
    "唯一落位锁定：从已确认的 AI 摆放分析中读取【主落位】和【落位锁定句】。最终只允许使用这个主落位；不要使用备选落位，不要因为当前是远景、中景或近景而换到另一个位置。",
    "比例和落地：根据房间地面平面、墙地交界线、门窗高度、已有家具尺度和透视估算真实尺寸。允许把产品等比例缩放到房间合理大小，但必须保持产品比例、款式和细节 100%。产品必须稳定落在地面或地毯上，有接触阴影、遮挡关系、反射/环境光和受力感；不能悬空、穿模、半透明、像贴纸或尺寸失真。",
    "构图原则：从摄影角度选择最好看的机位。产品不一定在画面中心，可以用三分法、前景/中景/背景层次、自然光方向和负空间展示产品所在房间的整体效果。",
    `当前景别：${viewLabel}。${viewRule}`,
    "远景/中景/近景的定义：它们只是拍摄距离、镜头焦距、相机高度和轻微角度变化。三档必须使用同一个物理主落位、同一地面接触点、同一朝向逻辑、同一相邻主家具关系。不能把产品从床边换到窗边，不能从沙发边换到客厅中间，不能为了近景把产品挪到镜头前。",
    "落位优先级高于构图：如果为了让产品更大、更正面或更靠窗会导致它离开床边/沙发边/阅读角等合理落位，必须保持落位，改相机角度和焦距。",
    needsModel
      ? "人物规则：加入且只加入 1 位真实成人模特，自然坐/使用在产品上，身体比例、受力、接触阴影和姿态真实，模特不能遮挡产品主要卖点。"
      : "人物规则：不要加入人物、手、人体局部、倒影人物或照片里的人。",
    `输出规格：${resolution}，画面比例 ${ratio}。`,
    "",
    "已确认的 AI 摆放分析：",
    analysis || "请先自行判断产品特征、房间采光、可用地面、动线和最佳摆位，再按以上规则生成。",
    chatInstruction
      ? [
          "",
          "用户对话补充要求：",
          chatInstruction,
          "对话补充要求只能影响拍摄角度、景别、焦段、软装氛围、光线、构图和局部细节强调；不得改变产品款式、颜色、材质、结构、比例、数量和锁定落位。若对话补充与产品 100% 还原或落位锁定冲突，以产品还原和落位锁定为准。",
        ].join("\n")
      : "",
    "",
    "最终自检：产品样式是否 100% 还原；产品是否只做等比例合理缩放；产品是否使用同一个锁定落位；当前景别是否只是拍摄距离/角度变化；房间是否只做合理微整理；产品位置是否贴近主家具使用关系、尺寸真实、看得见房间效果、像真实摄影。如果产品落在画面中心、主通道、电视茶几之间、窗帘窄缝、挡住已有家具，或为了景别换了位置，结果无效，必须重生成。",
  ].join("\n");
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
