const state = {
  productImage: null,
  roomImage: null,
  resultDataUrl: "",
  resultMeta: null,
  modalDataUrl: "",
  modalFileName: "",
  history: [],
  isLoading: false,
  saas: {
    userId: "",
    toolId: "",
    saasOrigin: "",
    launchUrl: "",
    verifyUrl: "",
    consumeUrl: "",
    uploadTokenUrl: "",
    uploadCommitUrl: "",
    user: null,
    tool: null,
    launchLoaded: false,
  },
};

const elements = {
  form: document.querySelector("#generateForm"),
  productInput: document.querySelector("#productImage"),
  roomInput: document.querySelector("#roomImage"),
  productDrop: document.querySelector("#productDrop"),
  roomDrop: document.querySelector("#roomDrop"),
  productPreview: document.querySelector("#productPreview"),
  roomPreview: document.querySelector("#roomPreview"),
  productMeta: document.querySelector("#productMeta"),
  roomMeta: document.querySelector("#roomMeta"),
  aspectRatio: document.querySelector("#aspectRatio"),
  imageSize: document.querySelector("#imageSize"),
  extraInstruction: document.querySelector("#extraInstruction"),
  generateButton: document.querySelector("#generateButton"),
  downloadButton: document.querySelector("#downloadButton"),
  modalDownloadButton: document.querySelector("#modalDownloadButton"),
  modalCloseButton: document.querySelector("#modalCloseButton"),
  imageModal: document.querySelector("#imageModal"),
  imageModalBackdrop: document.querySelector("#imageModalBackdrop"),
  imageModalStage: document.querySelector("#imageModalStage"),
  modalImage: document.querySelector("#modalImage"),
  previewStage: document.querySelector("#previewStage"),
  previewFrame: document.querySelector("#previewFrame"),
  previewTitle: document.querySelector("#previewTitle"),
  resultImage: document.querySelector("#resultImage"),
  emptyState: document.querySelector("#emptyState"),
  loadingMask: document.querySelector("#loadingMask"),
  messageText: document.querySelector("#messageText"),
  modelName: document.querySelector("#modelName"),
  apiStatus: document.querySelector("#apiStatus"),
  historyPanel: document.querySelector("#historyPanel"),
  historyList: document.querySelector("#historyList"),
  historyCount: document.querySelector("#historyCount"),
};

const fileLimit = 8 * 1024 * 1024;
const requestImageTargetBytes = 360 * 1024;
const requestImageMaxDimension = 1800;
const requestImageMinDimension = 820;
const generateBodyMaxBytes = 1400 * 1024;
const generateRequestTimeoutMs = 112000;

const defaultMetaText = {
  productImage: "必传，锁定组合方式、转角、贵妃位、模块和面料",
  roomImage: "必传，锁定层高、墙面、窗位、采光和豪宅氛围",
};

function firstString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function getToolIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const index = parts.indexOf("ai-tool");
  if (index === -1 || !parts[index + 1]) return "";
  try {
    return decodeURIComponent(parts[index + 1]);
  } catch {
    return parts[index + 1];
  }
}

function getApiBasePath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const index = parts.indexOf("ai-tool");
  if (index !== -1 && parts[index + 1]) {
    return `/${parts.slice(0, index + 2).join("/")}/api`;
  }
  return "/api";
}

const apiBasePath = getApiBasePath();

function apiPath(path) {
  return `${apiBasePath}/${String(path || "").replace(/^\/+/, "")}`;
}

function setMessage(message, isError = false) {
  elements.messageText.textContent = message || "请先上传大型沙发产品图和别墅客厅房间图";
  elements.messageText.classList.toggle("is-error", Boolean(isError));
}

function getSaasContextFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const toolIdFromPath = getToolIdFromPath();
  const userId = params.get("userId") || params.get("userid") || params.get("user_id") || params.get("uid") || "";
  const toolId = params.get("toolId") || params.get("toolid") || params.get("tool_id") || toolIdFromPath || "";
  return {
    userId,
    toolId,
    saasOrigin:
      params.get("saasOrigin") ||
      params.get("saas_origin") ||
      (userId && toolId ? window.location.origin : ""),
    launchUrl: params.get("launchUrl") || params.get("launch_url") || "",
    verifyUrl: params.get("verifyUrl") || params.get("verify_url") || "",
    consumeUrl: params.get("consumeUrl") || params.get("consume_url") || "",
    uploadTokenUrl: params.get("uploadTokenUrl") || params.get("upload_token_url") || "",
    uploadCommitUrl: params.get("uploadCommitUrl") || params.get("upload_commit_url") || "",
  };
}

function updateSaasContext(context = {}) {
  const saas = context.saas && typeof context.saas === "object" ? context.saas : {};
  const userId = firstString(context.userId, context.userid, context.user_id, context.uid, saas.userId, saas.userid, saas.user_id, saas.uid);
  const toolId = firstString(context.toolId, context.toolid, context.tool_id, saas.toolId, saas.toolid, saas.tool_id);
  const saasOrigin = firstString(context.saasOrigin, context.saas_origin, context.origin, saas.saasOrigin, saas.saas_origin, saas.origin);
  if (userId) state.saas.userId = userId;
  if (toolId) state.saas.toolId = toolId;
  if (saasOrigin) state.saas.saasOrigin = saasOrigin;
  for (const key of ["launchUrl", "verifyUrl", "consumeUrl", "uploadTokenUrl", "uploadCommitUrl"]) {
    const snakeKey = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
    const value = firstString(context[key], context[snakeKey], saas[key], saas[snakeKey]);
    if (value) state.saas[key] = value;
  }
}

function hasSaasContext() {
  return Boolean(state.saas.userId && state.saas.toolId);
}

function getSaasRequestContext() {
  return {
    userId: state.saas.userId,
    toolId: state.saas.toolId,
    saasOrigin: state.saas.saasOrigin,
    launchUrl: state.saas.launchUrl,
    verifyUrl: state.saas.verifyUrl,
    consumeUrl: state.saas.consumeUrl,
    uploadTokenUrl: state.saas.uploadTokenUrl,
    uploadCommitUrl: state.saas.uploadCommitUrl,
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function readOriginalImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, name: file.name, size: file.size });
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片解析失败，请更换图片后重试。"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片压缩失败，请更换图片后重试。"));
      },
      type,
      quality,
    );
  });
}

async function compressImageForRequest(file) {
  if (file.size <= requestImageTargetBytes && /^image\/(jpeg|webp)$/i.test(file.type)) {
    return readOriginalImage(file);
  }

  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sourceMax = Math.max(sourceWidth, sourceHeight);
  const dimensions = [Math.min(sourceMax, requestImageMaxDimension), 1500, 1280, 1080, requestImageMinDimension]
    .filter((value) => value > 0 && value <= sourceMax)
    .filter((value, index, values) => values.indexOf(value) === index);
  const qualities = [0.86, 0.78, 0.7, 0.62, 0.54];
  let best = null;

  for (const maxDimension of dimensions) {
    const scale = Math.min(1, maxDimension / sourceMax);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持图片压缩，请更换浏览器后重试。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      best = blob;
      if (blob.size <= requestImageTargetBytes) {
        return {
          dataUrl: await blobToDataUrl(blob),
          name: file.name,
          size: blob.size,
          originalSize: file.size,
        };
      }
    }
  }

  if (!best) throw new Error("图片压缩失败，请更换图片后重试。");
  return {
    dataUrl: await blobToDataUrl(best),
    name: file.name,
    size: best.size,
    originalSize: file.size,
  };
}

function readFileAsDataUrl(file) {
  if (!file) return Promise.resolve(null);
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
    return Promise.reject(new Error("仅支持 PNG、JPG/JPEG、WEBP 图片。"));
  }
  if (file.size > fileLimit) {
    return Promise.reject(new Error("单张参考图请控制在 8MB 以内。"));
  }
  return compressImageForRequest(file);
}

function formatFileSize(size) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

function resetResult() {
  state.resultDataUrl = "";
  state.resultMeta = null;
  elements.resultImage.removeAttribute("src");
  elements.resultImage.classList.remove("visible");
  elements.emptyState.hidden = false;
  elements.downloadButton.disabled = true;
  elements.previewTitle.textContent = "等待生成";
  closeImageModal();
}

function updateActionState() {
  const ready = Boolean(state.productImage && state.roomImage);
  elements.generateButton.disabled = state.isLoading || !ready;
  updatePreviewAspectRatio();
  if (!state.isLoading) {
    if (ready) setMessage("参考图已就绪，可以生成。");
    else setMessage("请先上传大型沙发产品图和别墅客厅房间图");
  }
}

function updatePreviewAspectRatio() {
  const ratio = elements.aspectRatio.value || "16:9";
  elements.previewFrame.style.aspectRatio = ratio.replace(":", " / ");
}

async function handleFile(input, key, preview, tile, meta) {
  const file = input.files?.[0];
  try {
    const image = await readFileAsDataUrl(file);
    state[key] = image;
    if (image) {
      preview.src = image.dataUrl;
      tile.classList.add("has-image");
      meta.textContent = `${image.name} · ${formatFileSize(image.size)}`;
    } else {
      preview.removeAttribute("src");
      tile.classList.remove("has-image");
      meta.textContent = defaultMetaText[key];
    }
    resetResult();
    updateActionState();
  } catch (error) {
    input.value = "";
    state[key] = null;
    preview.removeAttribute("src");
    tile.classList.remove("has-image");
    meta.textContent = defaultMetaText[key];
    resetResult();
    setMessage(error.message, true);
  }
}

function setupDrop(tile, input) {
  ["dragenter", "dragover"].forEach((eventName) => {
    tile.addEventListener(eventName, (event) => {
      event.preventDefault();
      tile.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    tile.addEventListener(eventName, (event) => {
      event.preventDefault();
      tile.classList.remove("drag-over");
    });
  });
  tile.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  elements.generateButton.classList.toggle("is-loading", isLoading);
  elements.loadingMask.classList.toggle("visible", isLoading);
  elements.previewTitle.textContent = isLoading ? "正在生成" : state.resultDataUrl ? "生成完成" : "等待生成";
  updateActionState();
}

function buildVillaAnalysis() {
  const extra = elements.extraInstruction.value.trim();
  return [
    "别墅大型沙发空间效果图生成任务。",
    "产品参考图中的大型沙发是最高优先级：严格还原组合方式、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、面料纹理、颜色和整体轮廓。",
    "不允许改变沙发模块结构，不允许随意增删转角、贵妃位、脚踏或单椅；允许根据别墅空间比例做真实尺度匹配，但产品设计必须保持不变。",
    "房间参考图用于锁定别墅空间层高、墙面材质、窗户位置、采光方向、地面材质、吊灯、背景墙和豪宅氛围。",
    "沙发必须自然融入空间，符合别墅客厅的大尺度陈列逻辑，并注意与墙面、地毯、茶几、窗户之间的真实距离和透视关系。",
    "生成豪宅客厅广角斜侧视角，镜头高度约 1.3 米，24mm 室内建筑摄影镜头，完整展示大型沙发组合、开阔感和空间层次。",
    "画面要求：高端别墅软装摄影，真实豪宅样板间，电影级自然光，宽敞通透，沙发为画面核心，空间高级但不抢产品，真实阴影，真实材质。",
    "禁止：不要文字，不要水印，不要额外 Logo，不要拼图，不要分屏，不要夸张变形，不要把沙发缩得过小，不要改变产品原始设计。",
    extra ? `用户补充：${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPayload() {
  const saasContext = getSaasRequestContext();
  const extraInstruction = elements.extraInstruction.value.trim();
  return {
    productImage: state.productImage,
    styleReferenceImage: state.roomImage,
    sofaAnalysis: buildVillaAnalysis(),
    ...saasContext,
    saas: saasContext,
    sceneStyle: "custom",
    viewType: "villa_wide",
    includeModel: false,
    imageSize: elements.imageSize.value,
    aspectRatio: elements.aspectRatio.value,
    extraInstruction,
    chatInstruction: extraInstruction,
  };
}

async function readResponsePayload(response, fallbackMessage = "请求失败。") {
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = {};
  }
  if (response.ok) return result;
  const value = result?.error || result?.message || fallbackMessage;
  const message =
    typeof value === "string" && value.trim() && value !== "[object Object]"
      ? value
      : value && typeof value === "object"
        ? value.message || value.error || value.msg || JSON.stringify(value)
        : fallbackMessage;
  throw new Error(message);
}

function pickResultUrl(result) {
  const candidates = [result?.url, result?.dataUrl, result?.image?.url];
  for (const value of candidates) {
    if (typeof value === "string" && /^(https?:|data:image\/|\/)/i.test(value)) return value;
  }
  return "";
}

async function postGeneratePayload(payload) {
  const requestBody = JSON.stringify(payload);
  const requestBodyBytes = new Blob([requestBody]).size;
  if (requestBodyBytes > generateBodyMaxBytes) {
    throw new Error("图片请求体仍然过大，请换一张更小的产品图或房间图后重试。");
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), generateRequestTimeoutMs);
  try {
    const response = await fetch(apiPath("generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
      signal: controller.signal,
    });
    return await readResponsePayload(response, "生成失败。");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateImage(event) {
  event.preventDefault();
  const payload = buildPayload();
  if (!payload.productImage) {
    setMessage("请先上传大型沙发产品图。", true);
    return;
  }
  if (!payload.styleReferenceImage) {
    setMessage("请先上传别墅客厅房间图。", true);
    return;
  }

  setLoading(true);
  setMessage("正在生成豪宅客厅大型沙发空间图，最长等待约 112 秒");
  try {
    const result = await postGeneratePayload(payload);
    const resultUrl = pickResultUrl(result);
    if (!resultUrl) {
      throw new Error("图片已生成并入库，但接口未返回可预览地址，请在我的图片中查看。");
    }
    state.resultDataUrl = resultUrl;
    state.resultMeta = {
      recordId: result.recordId || result.image?.recordId || "",
      url: result.url || result.image?.url || resultUrl,
      fileName: result.fileName || result.image?.fileName || "",
      fileSize: result.fileSize || result.image?.fileSize || 0,
      savedToRecords: Boolean(result.savedToRecords || result.image?.savedToRecords),
    };
    elements.resultImage.src = resultUrl;
    elements.resultImage.classList.add("visible");
    elements.emptyState.hidden = true;
    elements.downloadButton.disabled = false;
    elements.previewTitle.textContent = "生成完成";
    addHistoryItem(resultUrl, state.resultMeta);
    if (result.warning) {
      setMessage(result.warning, true);
    } else if (state.resultMeta.savedToRecords) {
      setMessage("图片已生成并保存到我的图片。");
    } else {
      setMessage("图片已生成。");
    }
  } catch (error) {
    const isTimeoutAbort = error && error.name === "AbortError";
    setMessage(isTimeoutAbort ? "生成超时：前端已等待 112 秒，请稍后重试。" : error.message, true);
  } finally {
    setLoading(false);
  }
}

function addHistoryItem(dataUrl, meta = {}) {
  state.history.unshift({
    id: `${Date.now()}-${state.history.length}`,
    dataUrl,
    fileName: meta.fileName || "",
    createdAt: new Date(),
    aspectRatio: elements.aspectRatio.value,
    imageSize: elements.imageSize.value,
  });
  renderHistory();
}

function renderHistory() {
  elements.historyPanel.hidden = state.history.length === 0;
  elements.historyCount.textContent = `${state.history.length} 张`;
  elements.historyList.replaceChildren(
    ...state.history.map((item) => {
      const card = document.createElement("article");
      card.className = "history-card";

      const imageButton = document.createElement("button");
      imageButton.className = "history-image-button";
      imageButton.type = "button";
      imageButton.setAttribute("aria-label", "预览历史图片");
      imageButton.addEventListener("click", () => openImageModal(item.dataUrl, item.fileName));

      const image = document.createElement("img");
      image.src = item.dataUrl;
      image.alt = "历史生成结果";
      imageButton.appendChild(image);

      const body = document.createElement("div");
      body.className = "history-card-body";
      const title = document.createElement("strong");
      title.textContent = "豪宅沙发空间图";
      const meta = document.createElement("span");
      meta.textContent = `${item.imageSize} · ${item.aspectRatio}`;
      const downloadButton = document.createElement("button");
      downloadButton.className = "secondary-action history-download";
      downloadButton.type = "button";
      downloadButton.textContent = "下载";
      downloadButton.addEventListener("click", () => downloadImage(item.dataUrl, item.fileName));
      body.append(title, meta, downloadButton);
      card.append(imageButton, body);
      return card;
    }),
  );
}

function normalizeDownloadFileName(fileName) {
  const baseName = String(fileName || "").split("/").filter(Boolean).pop();
  return baseName || "";
}

function downloadImage(dataUrl = state.resultDataUrl, fileName = state.resultMeta?.fileName) {
  if (!dataUrl) return;
  const ratio = elements.aspectRatio.value.replace(":", "x");
  const size = elements.imageSize.value.toLowerCase();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = normalizeDownloadFileName(fileName) || `villa-sofa-${ratio}-${size}-${timestamp}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function openImageModal(dataUrl = state.resultDataUrl, fileName = state.resultMeta?.fileName || "") {
  if (!dataUrl) return;
  state.modalDataUrl = dataUrl;
  state.modalFileName = fileName;
  elements.modalImage.src = dataUrl;
  elements.imageModal.classList.add("visible");
  elements.imageModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  fitModalImage();
  elements.modalCloseButton.focus();
}

function closeImageModal() {
  elements.imageModal.classList.remove("visible");
  elements.imageModal.setAttribute("aria-hidden", "true");
  state.modalDataUrl = "";
  state.modalFileName = "";
  elements.modalImage.removeAttribute("src");
  elements.modalImage.style.removeProperty("--modal-image-width");
  elements.modalImage.style.removeProperty("--modal-image-height");
  document.body.classList.remove("modal-open");
}

function fitModalImage() {
  if (!elements.imageModal.classList.contains("visible")) return;
  const stageRect = elements.imageModalStage.getBoundingClientRect();
  const stageStyle = getComputedStyle(elements.imageModalStage);
  const horizontalPadding = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
  const verticalPadding = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
  const availableWidth = Math.max(1, stageRect.width - horizontalPadding);
  const availableHeight = Math.max(1, stageRect.height - verticalPadding);
  const naturalWidth = elements.modalImage.naturalWidth || 1;
  const naturalHeight = elements.modalImage.naturalHeight || 1;
  const ratio = naturalWidth / naturalHeight;
  let width = availableWidth;
  let height = width / ratio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }
  elements.modalImage.style.setProperty("--modal-image-width", `${Math.floor(width)}px`);
  elements.modalImage.style.setProperty("--modal-image-height", `${Math.floor(height)}px`);
}

async function loadConfig() {
  try {
    const response = await fetch(apiPath("config"));
    const config = await response.json();
    elements.modelName.textContent = config.hasApiKey ? "生成服务已连接" : "生成服务未配置";
    elements.apiStatus.textContent = config.hasApiKey ? "就绪" : "未配置";
    elements.apiStatus.classList.toggle("warn", !config.hasApiKey);
    if (!config.hasApiKey) {
      setMessage("请在 Vercel 环境变量或本地 .env 配置 GEMINI_API_KEY。", true);
    } else if (hasSaasContext()) {
      loadSaasLaunch();
    }
  } catch {
    elements.modelName.textContent = "生成服务检测失败";
    elements.apiStatus.textContent = "异常";
    elements.apiStatus.classList.add("warn");
  }
}

async function loadSaasLaunch() {
  if (!hasSaasContext()) return;
  try {
    const response = await fetch(apiPath("launch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getSaasRequestContext()),
    });
    const result = await readResponsePayload(response, "SaaS 启动失败。");
    if (!response.ok || result.success === false) {
      throw new Error(result.error || result.message || "SaaS 启动失败。");
    }
    state.saas.user = result.data?.user || null;
    state.saas.tool = result.data?.tool || null;
    state.saas.launchLoaded = true;
    if (state.saas.tool && Number.isFinite(Number(state.saas.tool.integral))) {
      setMessage(`SaaS 已连接，本次生成将消耗 ${state.saas.tool.integral} 积分。`);
    } else {
      setMessage("SaaS 已连接，生成成功后会保存到我的图片。");
    }
    updateActionState();
  } catch (error) {
    state.saas.launchLoaded = false;
    setMessage(error.message, true);
  }
}

function setupSaasBridge() {
  updateSaasContext(getSaasContextFromUrl());
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "SAAS_INIT") return;
    updateSaasContext({
      ...event.data,
      saasOrigin: event.data.saasOrigin || event.data.origin || event.origin,
    });
    loadSaasLaunch();
  });
}

elements.productInput.addEventListener("change", () =>
  handleFile(elements.productInput, "productImage", elements.productPreview, elements.productDrop, elements.productMeta),
);
elements.roomInput.addEventListener("change", () =>
  handleFile(elements.roomInput, "roomImage", elements.roomPreview, elements.roomDrop, elements.roomMeta),
);
elements.form.addEventListener("submit", generateImage);
elements.extraInstruction.addEventListener("input", updateActionState);
elements.aspectRatio.addEventListener("change", updateActionState);
elements.imageSize.addEventListener("change", updateActionState);
elements.downloadButton.addEventListener("click", () => downloadImage());
elements.modalDownloadButton.addEventListener("click", () =>
  downloadImage(state.modalDataUrl || state.resultDataUrl, state.modalFileName || state.resultMeta?.fileName),
);
elements.modalCloseButton.addEventListener("click", closeImageModal);
elements.imageModalBackdrop.addEventListener("click", closeImageModal);
elements.modalImage.addEventListener("load", fitModalImage);
elements.resultImage.addEventListener("click", () => openImageModal());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.imageModal.classList.contains("visible")) closeImageModal();
});

if ("ResizeObserver" in window) {
  new ResizeObserver(fitModalImage).observe(elements.imageModalStage);
} else {
  window.addEventListener("resize", fitModalImage);
}

setupDrop(elements.productDrop, elements.productInput);
setupDrop(elements.roomDrop, elements.roomInput);
setupSaasBridge();
updateActionState();
loadConfig();
