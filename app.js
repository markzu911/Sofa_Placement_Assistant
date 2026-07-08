const state = {
  productImage: null,
  styleReferenceImage: null,
  resultDataUrl: "",
  resultMeta: null,
  modalDataUrl: "",
  modalFileName: "",
  history: [],
  isLoading: false,
  sofaAnalysis: "",
  sofaAnalysisSignature: "",
  analysisAbortController: null,
  analysisError: false,
  isAnalyzing: false,
  activeBriefTab: "params",
  chatMessages: [
    {
      role: "assistant",
      content: "上传产品图后，可以直接描述拍摄角度、景别和风格；我会保持产品 100% 还原，并按合理落位生成。",
    },
  ],
  chatExtraInstruction: "",
  chatIsBusy: false,
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

const labels = {
  style: {
    modern: "现代简约",
    cream_luxury: "轻奢风",
    italian: "奶油风",
    japandi: "寂宅风",
    scandinavian: "北欧风",
    french: "新中式",
    loft: "都市 Loft",
    coastal: "海岸度假",
    custom: "自定义房间",
  },
  view: {
    wide: "远景图",
    mid: "中景",
    close: "近景",
  },
  model: {
    false: "无模特",
    true: "添加模特",
  },
};

const elements = {
  form: document.querySelector("#generateForm"),
  productInput: document.querySelector("#productImage"),
  styleReferenceInput: document.querySelector("#styleReferenceImage"),
  productDrop: document.querySelector("#productDrop"),
  styleReferenceDrop: document.querySelector("#styleReferenceDrop"),
  productPreview: document.querySelector("#productPreview"),
  styleReferencePreview: document.querySelector("#styleReferencePreview"),
  productMeta: document.querySelector("#productMeta"),
  styleReferenceTitle: document.querySelector("#styleReferenceTitle"),
  styleReferenceHint: document.querySelector("#styleReferenceHint"),
  styleReferenceMeta: document.querySelector("#styleReferenceMeta"),
  imageSize: document.querySelector("#imageSize"),
  aspectRatio: document.querySelector("#aspectRatio"),
  analyzeButton: document.querySelector("#analyzeButton"),
  generateButton: document.querySelector("#generateButton"),
  downloadButton: document.querySelector("#downloadButton"),
  modalDownloadButton: document.querySelector("#modalDownloadButton"),
  modalCloseButton: document.querySelector("#modalCloseButton"),
  imageModal: document.querySelector("#imageModal"),
  imageModalBackdrop: document.querySelector("#imageModalBackdrop"),
  imageModalStage: document.querySelector("#imageModalStage"),
  modalImage: document.querySelector("#modalImage"),
  resultImage: document.querySelector("#resultImage"),
  emptyState: document.querySelector("#emptyState"),
  loadingMask: document.querySelector("#loadingMask"),
  previewStage: document.querySelector("#previewStage"),
  previewFrame: document.querySelector("#previewFrame"),
  previewTitle: document.querySelector("#previewTitle"),
  messageText: document.querySelector("#messageText"),
  modelName: document.querySelector("#modelName"),
  apiStatus: document.querySelector("#apiStatus"),
  summaryProduct: document.querySelector("#summaryProduct"),
  summaryScene: document.querySelector("#summaryScene"),
  summaryView: document.querySelector("#summaryView"),
  summaryModel: document.querySelector("#summaryModel"),
  summarySpec: document.querySelector("#summarySpec"),
  analysisStatus: document.querySelector("#analysisStatus"),
  analysisText: document.querySelector("#analysisText"),
  briefTabs: document.querySelector("#briefTabs"),
  briefTabButtons: document.querySelectorAll("[data-brief-tab]"),
  paramsPane: document.querySelector("#paramsPane"),
  chatPane: document.querySelector("#chatPane"),
  chatLog: document.querySelector("#chatLog"),
  chatInput: document.querySelector("#chatInput"),
  chatSendButton: document.querySelector("#chatSendButton"),
  chatGenerateButton: document.querySelector("#chatGenerateButton"),
  chatQuickActions: document.querySelectorAll("[data-chat-prompt]"),
  historyPanel: document.querySelector("#historyPanel"),
  historyList: document.querySelector("#historyList"),
  historyCount: document.querySelector("#historyCount"),
};

const fileLimit = 8 * 1024 * 1024;
const generateBodyMaxBytes = 900 * 1024;
const generateRequestTimeoutMs = 112000;
const requestImageTargetBytes = 320 * 1024;
const requestImageMaxDimension = 1600;
const requestImageMinDimension = 720;
const analysisPromptVersion = "locked-camera-placement-v8";
const defaultMetaText = {
  productImage: "产品图，PNG / JPG / WEBP，8MB 以内",
  styleReferenceImage: "可选，PNG / JPG / WEBP，8MB 以内",
};
const validSceneStyles = new Set(Object.keys(labels.style));
const validViewTypes = new Set(Object.keys(labels.view));
const validAspectRatios = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "3:2", "2:3", "5:4", "4:5"]);
const validImageSizes = new Set(["2K", "4K"]);

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
  elements.messageText.textContent = message || "等待上传产品图";
  elements.messageText.classList.toggle("is-error", isError);
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
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("图片压缩失败，请更换图片后重试。"));
        }
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
  if (!sourceWidth || !sourceHeight) {
    throw new Error("图片尺寸无效，请更换图片后重试。");
  }

  const sourceMax = Math.max(sourceWidth, sourceHeight);
  const initialMax = Math.min(sourceMax, requestImageMaxDimension);
  const dimensionSteps = [
    initialMax,
    1400,
    1200,
    1000,
    860,
    requestImageMinDimension,
    sourceMax,
  ]
    .filter((value) => value > 0 && value <= sourceMax)
    .filter((value, index, values) => values.indexOf(value) === index);
  const qualities = [0.86, 0.78, 0.7, 0.62, 0.54];
  let best = null;

  for (const maxDimension of dimensionSteps) {
    const scale = Math.min(1, maxDimension / sourceMax);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器不支持图片压缩，请更换浏览器后重试。");
    }
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

  if (!best) {
    throw new Error("图片压缩失败，请更换图片后重试。");
  }

  return {
    dataUrl: await blobToDataUrl(best),
    name: file.name,
    size: best.size,
    originalSize: file.size,
  };
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

function getImageSignature(image) {
  if (!image) return "";
  const dataUrl = String(image.dataUrl || "");
  return [
    image.name || "",
    image.size || 0,
    image.originalSize || 0,
    dataUrl.length,
    dataUrl.slice(0, 48),
    dataUrl.slice(-48),
  ].join("|");
}

function getAnalysisSignature() {
  return JSON.stringify({
    product: getImageSignature(state.productImage),
    styleReference: getImageSignature(state.styleReferenceImage),
    sceneStyle: getCheckedValue("sceneStyle"),
    includeModel: getCheckedValue("includeModel"),
    promptVersion: analysisPromptVersion,
  });
}

function getFreshSofaAnalysis() {
  if (!state.sofaAnalysis) return "";
  return state.sofaAnalysisSignature === getAnalysisSignature() ? state.sofaAnalysis : "";
}

function resetSofaAnalysis({ abort = true } = {}) {
  if (abort && state.analysisAbortController) {
    state.analysisAbortController.abort();
  }
  state.sofaAnalysis = "";
  state.sofaAnalysisSignature = "";
  state.analysisAbortController = null;
  state.analysisError = false;
  state.isAnalyzing = false;
  renderSofaAnalysis();
  updateActionState();
}

function shouldAnalyzePlacement() {
  if (!state.productImage) return false;
  if (isCustomStyle() && !state.styleReferenceImage) return false;
  return true;
}

function updateActionState() {
  const hasFreshAnalysis = Boolean(getFreshSofaAnalysis());
  elements.analyzeButton.disabled = state.isLoading || state.isAnalyzing || !shouldAnalyzePlacement();
  elements.generateButton.disabled = state.isLoading || state.isAnalyzing || !hasFreshAnalysis;
  const chatBusy = state.chatIsBusy || state.isLoading || state.isAnalyzing;
  if (elements.chatSendButton) {
    elements.chatSendButton.disabled = chatBusy || !elements.chatInput.value.trim();
  }
  if (elements.chatGenerateButton) {
    elements.chatGenerateButton.disabled = chatBusy || (!state.chatExtraInstruction && !elements.chatInput.value.trim());
    elements.chatGenerateButton.classList.toggle("is-loading", state.chatIsBusy || state.isLoading);
  }
}

function setAnalysisText(value) {
  if ("value" in elements.analysisText) {
    elements.analysisText.value = value;
  } else {
    elements.analysisText.textContent = value;
  }
}

function renderSofaAnalysis() {
  const analysis = getFreshSofaAnalysis();
  setAnalysisText(
    analysis || "上传产品图后，先点击 AI 分析。分析完成并输出结果后，可以直接修改分析内容，再点击生成图片。",
  );
  elements.analysisStatus.textContent = state.isAnalyzing ? "分析中" : analysis ? "已完成" : state.analysisError ? "失败" : "待分析";
  elements.analysisStatus.classList.toggle("ready", Boolean(analysis));
  elements.analysisStatus.classList.toggle("error", Boolean(state.analysisError));
}

function handleAnalysisEdit() {
  const value = elements.analysisText.value.trim();
  state.sofaAnalysis = value;
  state.sofaAnalysisSignature = value ? getAnalysisSignature() : "";
  state.analysisError = false;
  elements.analysisStatus.textContent = value ? "已修改" : "待分析";
  elements.analysisStatus.classList.toggle("ready", Boolean(value));
  elements.analysisStatus.classList.remove("error");
  updateActionState();
}

async function analyzeSofaPlacement({ force = false } = {}) {
  if (!shouldAnalyzePlacement()) {
    const message = isCustomStyle() && !state.styleReferenceImage
      ? "自定义房间需要先上传房间参考图。"
      : "请先上传产品图。";
    state.analysisError = true;
    setMessage(message, true);
    renderSofaAnalysis();
    updateActionState();
    return "";
  }
  const signature = getAnalysisSignature();
  if (!force && state.sofaAnalysis && state.sofaAnalysisSignature === signature) {
    return state.sofaAnalysis;
  }

  if (state.analysisAbortController) {
    state.analysisAbortController.abort();
  }

  const controller = new AbortController();
  state.analysisAbortController = controller;
  state.isAnalyzing = true;
  state.analysisError = false;
  renderSofaAnalysis();
  updateActionState();
  setMessage("正在 AI 分析产品特征、房间采光、动线和最佳摆位...");

  try {
    const payload = {
      ...buildPayload(),
      viewType: undefined,
      imageSize: undefined,
      aspectRatio: undefined,
      sofaAnalysis: undefined,
    };
    const response = await fetch(apiPath("analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await readResponsePayload(response, "图片分析失败。");
    const sofaAnalysis = String(result.sofaAnalysis || result.analysis || "").trim();
    if (!sofaAnalysis) {
      throw new Error("AI 未返回有效摆位分析。");
    }
    state.sofaAnalysis = sofaAnalysis;
    state.sofaAnalysisSignature = signature;
    state.analysisError = false;
    renderSofaAnalysis();
    updateActionState();
    if (!state.isLoading) {
      setMessage("AI 摆位分析完成，可以生成图片。");
    }
    return sofaAnalysis;
  } catch (error) {
    if (error.name === "AbortError") return "";
    state.analysisError = true;
    renderSofaAnalysis();
    updateActionState();
    if (!state.isLoading) {
      setMessage(error.message || "AI 摆位分析失败，请重试。", true);
    }
    return "";
  } finally {
    if (state.analysisAbortController === controller) {
      state.analysisAbortController = null;
    }
    state.isAnalyzing = false;
    renderSofaAnalysis();
    updateActionState();
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

function getCheckedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
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
  closeImageModal();
  elements.emptyState.style.display = "grid";
  elements.downloadButton.disabled = true;
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
    if (key === "productImage") {
      resetResult();
      resetSofaAnalysis();
      setMessage(image ? "产品图已锁定，请先点击 AI 分析。" : "");
      updatePreviewTitle();
    } else {
      resetSofaAnalysis();
      setMessage(image ? "房间参考图已添加，请重新 AI 分析。" : "");
    }
    updateSummary();
    updateActionState();
  } catch (error) {
    input.value = "";
    state[key] = null;
    resetSofaAnalysis();
    preview.removeAttribute("src");
    tile.classList.remove("has-image");
    meta.textContent = defaultMetaText[key];
    setMessage(error.message, true);
    updateSummary();
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
  updatePreviewTitle();
  updateActionState();
}

function isCustomStyle() {
  return getCheckedValue("sceneStyle") === "custom";
}

function getSceneLabel() {
  const styleLabel = labels.style[getCheckedValue("sceneStyle")] || "选择风格";
  return state.styleReferenceImage ? `${styleLabel} + 房间图` : styleLabel;
}

function updateStyleReferenceState() {
  const customStyle = isCustomStyle();
  elements.styleReferenceMeta.textContent = state.styleReferenceImage
    ? `${state.styleReferenceImage.name} · ${formatFileSize(state.styleReferenceImage.size)}`
    : customStyle
      ? "必传，生成时保持原图场景"
      : defaultMetaText.styleReferenceImage;
  elements.styleReferenceTitle.textContent = customStyle ? "自定义房间原图" : "房间参考图";
  elements.styleReferenceHint.textContent = customStyle
    ? "保持原房间结构、门窗、墙地面、已有物品和光线，只把产品放到合理位置"
    : "普通风格会创建虚拟房间；参考图只提取色调、材质、光线和软装气质";
  elements.styleReferenceDrop.classList.toggle("is-required", customStyle);
  updatePreviewTitle();
  updateSummary();
}

function updatePreviewTitle() {
  if (state.isLoading) {
    elements.previewTitle.textContent = "正在生成";
    return;
  }
  if (state.resultDataUrl) {
    elements.previewTitle.textContent = "生成完成";
    return;
  }
  if (!state.productImage) {
    elements.previewTitle.textContent = "等待生成";
    return;
  }

  const viewLabel = labels.view[getCheckedValue("viewType")] || "预览";
  elements.previewTitle.textContent = `${getSceneLabel()} · ${viewLabel}`;
}

function updatePreviewRatio() {
  const [width, height] = elements.aspectRatio.value.split(":").map(Number);
  if (width && height) {
    elements.previewFrame.style.aspectRatio = `${width} / ${height}`;
    fitPreviewFrame(width, height);
  }
  updateSummary();
}

function fitPreviewFrame(ratioWidth, ratioHeight) {
  const stageRect = elements.previewStage.getBoundingClientRect();
  const stageStyle = getComputedStyle(elements.previewStage);
  const horizontalPadding = parseFloat(stageStyle.paddingLeft) + parseFloat(stageStyle.paddingRight);
  const verticalPadding = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom);
  const availableWidth = Math.max(1, stageRect.width - horizontalPadding);
  const availableHeight = Math.max(1, stageRect.height - verticalPadding);
  const ratio = ratioWidth / ratioHeight;

  let frameWidth = availableWidth;
  let frameHeight = frameWidth / ratio;
  if (frameHeight > availableHeight) {
    frameHeight = availableHeight;
    frameWidth = frameHeight * ratio;
  }

  elements.previewFrame.style.setProperty("--preview-frame-width", `${Math.floor(frameWidth)}px`);
  elements.previewFrame.style.setProperty("--preview-frame-height", `${Math.floor(frameHeight)}px`);
}

function fitPreviewFrameFromSelection() {
  const [width, height] = elements.aspectRatio.value.split(":").map(Number);
  if (width && height) {
    fitPreviewFrame(width, height);
  }
}

function updateSummary() {
  const viewLabel = labels.view[getCheckedValue("viewType")] || "远景图";
  const modelLabel = labels.model[getCheckedValue("includeModel")] || "无模特";
  elements.summaryProduct.textContent = state.productImage ? state.productImage.name : "未上传";
  elements.summaryScene.textContent = getSceneLabel();
  elements.summaryView.textContent = viewLabel;
  elements.summaryModel.textContent = modelLabel;
  elements.summarySpec.textContent = `${elements.imageSize.value} · ${elements.aspectRatio.value}`;
}

function getCurrentMeta() {
  return {
    scene: getSceneLabel(),
    view: labels.view[getCheckedValue("viewType")] || "远景图",
    model: labels.model[getCheckedValue("includeModel")] || "无模特",
    spec: `${elements.imageSize.value} · ${elements.aspectRatio.value}`,
  };
}

function buildPayload() {
  const saasContext = getSaasRequestContext();
  return {
    productImage: state.productImage,
    styleReferenceImage: state.styleReferenceImage,
    sofaAnalysis: getFreshSofaAnalysis(),
    ...saasContext,
    saas: saasContext,
    sceneStyle: getCheckedValue("sceneStyle"),
    viewType: getCheckedValue("viewType"),
    includeModel: getCheckedValue("includeModel") === "true",
    imageSize: elements.imageSize.value,
    aspectRatio: elements.aspectRatio.value,
    extraInstruction: state.chatExtraInstruction,
    chatInstruction: state.chatExtraInstruction,
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
  const message = getResponseMessage(result, fallbackMessage);
  if (response.status === 413) {
    throw new Error("图片请求体过大：已超过线上代理限制，请换一张更小的产品图或降低图片尺寸后重试。");
  }
  if (response.status === 504) {
    const error = new Error(message || "生成超时：模型处理超过网关等待时间，请调整分析内容或降低分辨率后重试。");
    error.status = 504;
    throw error;
  }
  if (response.status === 502) {
    throw new Error(message || "生成服务暂时不可用，请稍后重试。");
  }
  throw new Error(message);
}

function getResponseMessage(result, fallbackMessage) {
  const value = result?.error || result?.message || fallbackMessage;
  if (typeof value === "string" && value.trim() && value !== "[object Object]") return value;
  if (value && typeof value === "object") {
    return value.message || value.error || value.msg || JSON.stringify(value);
  }
  return fallbackMessage;
}

function pickResultUrl(result) {
  const candidates = [result?.url, result?.dataUrl, result?.image?.url];
  for (const value of candidates) {
    if (typeof value === "string" && /^(https?:|data:image\/|\/)/i.test(value)) return value;
  }
  return "";
}

function setBriefTab(tab) {
  const nextTab = tab === "chat" ? "chat" : "params";
  state.activeBriefTab = nextTab;
  elements.briefTabButtons.forEach((button) => {
    const isActive = button.dataset.briefTab === nextTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  elements.paramsPane.classList.toggle("is-active", nextTab === "params");
  elements.paramsPane.hidden = nextTab !== "params";
  elements.chatPane.classList.toggle("is-active", nextTab === "chat");
  elements.chatPane.hidden = nextTab !== "chat";
  if (nextTab === "chat") {
    renderChatMessages();
  }
}

function renderChatMessages() {
  if (!elements.chatLog) return;
  elements.chatLog.replaceChildren(
    ...state.chatMessages.map((message) => {
      const item = document.createElement("article");
      item.className = `chat-message ${message.role === "user" ? "is-user" : "is-assistant"}`;

      const label = document.createElement("span");
      label.className = "chat-role";
      label.textContent = message.role === "user" ? "你" : "AI";

      const body = document.createElement("p");
      body.textContent = message.content;

      item.append(label, body);
      return item;
    }),
  );
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function addChatMessage(role, content) {
  const text = String(content || "").trim();
  if (!text) return;
  state.chatMessages.push({ role, content: text });
  if (state.chatMessages.length > 18) {
    state.chatMessages = [state.chatMessages[0], ...state.chatMessages.slice(-17)];
  }
  renderChatMessages();
}

function setChatBusy(isBusy) {
  state.chatIsBusy = isBusy;
  elements.chatPane?.classList.toggle("is-busy", isBusy);
  updateActionState();
}

function getCurrentChatConfig() {
  return {
    sceneStyle: getCheckedValue("sceneStyle"),
    viewType: getCheckedValue("viewType"),
    includeModel: getCheckedValue("includeModel") === "true",
    imageSize: elements.imageSize.value,
    aspectRatio: elements.aspectRatio.value,
  };
}

function parseChatIntentFromText(rawText) {
  const raw = String(rawText || "");
  const actionMatch = raw.match(/\[ACTION\]\s*([\s\S]*)$/i);
  if (!actionMatch) return null;
  const actionText = actionMatch[1]
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(actionText);
  } catch {
    return null;
  }
}

function normalizeChatReply(result) {
  const reply = String(result?.reply || "").trim();
  if (reply) return reply;
  const raw = String(result?.raw || result?.text || "").trim();
  const replyMatch = raw.match(/\[REPLY\]\s*([\s\S]*?)(?=\n\s*\[ACTION\]|$)/i);
  return String(replyMatch?.[1] || "我已理解你的要求，可以继续调整参数或直接生成。").trim();
}

function updateChatExtraInstruction(instruction) {
  const value = String(instruction || "").trim();
  if (!value) return;
  const current = state.chatExtraInstruction.trim();
  if (current.includes(value)) return;
  state.chatExtraInstruction = (current ? `${current}\n${value}` : value).slice(-1400).trim();
}

function setRadioValue(name, value) {
  const input = Array.from(document.querySelectorAll(`input[name="${name}"]`)).find((item) => item.value === String(value));
  if (!input || input.checked) return false;
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function applyChatConfig(config = {}) {
  if (!config || typeof config !== "object") return;

  const sceneStyle = String(config.sceneStyle || "").trim();
  if (validSceneStyles.has(sceneStyle)) {
    setRadioValue("sceneStyle", sceneStyle);
  }

  const viewType = String(config.viewType || "").trim();
  if (validViewTypes.has(viewType)) {
    setRadioValue("viewType", viewType);
  }

  if (Object.prototype.hasOwnProperty.call(config, "includeModel")) {
    setRadioValue("includeModel", config.includeModel ? "true" : "false");
  }

  const imageSize = String(config.imageSize || "").toUpperCase();
  if (validImageSizes.has(imageSize) && elements.imageSize.value !== imageSize) {
    elements.imageSize.value = imageSize;
    elements.imageSize.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const aspectRatio = String(config.aspectRatio || "").trim();
  if (validAspectRatios.has(aspectRatio) && elements.aspectRatio.value !== aspectRatio) {
    elements.aspectRatio.value = aspectRatio;
    elements.aspectRatio.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function buildChatPayload() {
  const saasContext = getSaasRequestContext();
  return {
    messages: state.chatMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    currentConfig: getCurrentChatConfig(),
    currentAnalysis: getFreshSofaAnalysis(),
    currentExtraInstruction: state.chatExtraInstruction,
    hasProductImage: Boolean(state.productImage),
    hasRoomImage: Boolean(state.styleReferenceImage),
    ...saasContext,
    saas: saasContext,
  };
}

async function handleChatIntent(intent, fallbackInstruction) {
  const action = String(intent?.action || "none");
  const smartParams = intent?.smartParams && typeof intent.smartParams === "object" ? intent.smartParams : {};
  applyChatConfig(smartParams.config);
  updateChatExtraInstruction(smartParams.extraInstruction || fallbackInstruction);
  updateSummary();
  updatePreviewTitle();
  updateActionState();

  if (action === "analyze_image") {
    await analyzeSofaPlacement({ force: true });
    return;
  }

  if (action !== "generate_smart" || intent?.directGenerate !== true) {
    setMessage(action === "update_config" ? "对话参数已更新，可以继续调整或生成图片。" : "对话已记录。");
    return;
  }

  if (!state.productImage) {
    setMessage("请先上传产品图，才能保证产品 100% 还原。", true);
    return;
  }
  if (isCustomStyle() && !state.styleReferenceImage) {
    setMessage("自定义房间需要先上传房间原图。", true);
    return;
  }

  let analysis = getFreshSofaAnalysis();
  if (!analysis) {
    analysis = await analyzeSofaPlacement({ force: false });
  }
  if (!analysis) return;

  await generateImage({ preventDefault() {} });
}

async function sendChatMessage(textOverride = "", options = {}) {
  if (state.chatIsBusy) return;
  const sourceText = textOverride || elements.chatInput.value;
  let text = String(sourceText || "").trim();
  if (options.directGenerate && !/(生成|出图|做图|画一张|来一张|开始)/.test(text)) {
    text = text ? `${text}\n现在直接生成。` : "按当前对话要求直接生成。";
  }
  if (!text) return;

  addChatMessage("user", text);
  elements.chatInput.value = "";
  setChatBusy(true);
  setMessage("正在理解对话意图...");

  try {
    const response = await fetch(apiPath("chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatPayload()),
    });
    const result = await readResponsePayload(response, "AI 对话失败。");
    const reply = normalizeChatReply(result);
    const intent = result.action || parseChatIntentFromText(result.raw || result.text);
    addChatMessage("assistant", reply);
    await handleChatIntent(intent, text);
  } catch (error) {
    addChatMessage("assistant", error.message || "AI 对话失败，请稍后重试。");
    setMessage(error.message || "AI 对话失败，请稍后重试。", true);
  } finally {
    setChatBusy(false);
  }
}

async function postGeneratePayload(payload, timeoutMs) {
  const requestBody = JSON.stringify(payload);
  const requestBodyBytes = new Blob([requestBody]).size;
  if (requestBodyBytes > generateBodyMaxBytes) {
    throw new Error("图片请求体仍然过大，请换一张更小的产品图或参考图后重试。");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
  let payload = buildPayload();
  if (!payload.productImage) {
    setMessage("请先上传产品图。", true);
    return;
  }
  if (payload.sceneStyle === "custom" && !payload.styleReferenceImage) {
    setMessage("请选择自定义房间原图。", true);
    return;
  }
  if (!payload.sofaAnalysis) {
    setMessage("请先点击 AI 分析，并等待分析结果输出后再生成图片。", true);
    return;
  }
  setLoading(true);
  setMessage("正在按摄影视角生成房间效果图，最长等待约 112 秒");
  try {
    const result = await postGeneratePayload(payload, generateRequestTimeoutMs);
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
    const resultAnalysis = String(result.sofaAnalysis || "").trim();
    if (resultAnalysis) {
      state.sofaAnalysis = resultAnalysis;
      state.sofaAnalysisSignature = getAnalysisSignature();
      state.analysisError = false;
      renderSofaAnalysis();
    }
    elements.resultImage.src = resultUrl;
    elements.resultImage.classList.add("visible");
    elements.emptyState.style.display = "none";
    elements.downloadButton.disabled = false;
    addHistoryItem(resultUrl, state.resultMeta);
    if (result.warning) {
      setMessage(result.warning, true);
    } else if (state.resultMeta.savedToRecords) {
      setMessage("图片已生成并保存到我的图片");
    } else {
      setMessage("图片已生成");
    }
  } catch (error) {
    const isTimeoutAbort = error && error.name === "AbortError";
    setMessage(isTimeoutAbort ? "生成超时：前端已等待 112 秒，请稍后重试。" : error.message, true);
  } finally {
    setLoading(false);
  }
}

function addHistoryItem(dataUrl, meta = {}) {
  const item = {
    id: `${Date.now()}-${state.history.length}`,
    dataUrl,
    recordId: meta.recordId || "",
    fileName: meta.fileName || "",
    fileSize: meta.fileSize || 0,
    savedToRecords: Boolean(meta.savedToRecords),
    createdAt: new Date(),
    product: state.productImage?.name || "产品图",
    ...getCurrentMeta(),
  };
  state.history.unshift(item);
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

      const title = document.createElement("h3");
      title.textContent = item.scene;

      const meta = document.createElement("p");
      meta.textContent = `${item.view} · ${item.model} · ${item.spec}`;

      const product = document.createElement("p");
      product.className = "history-product";
      product.textContent = item.product;

      const footer = document.createElement("div");
      footer.className = "history-card-footer";

      const time = document.createElement("span");
      time.textContent = item.createdAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

      const downloadButton = document.createElement("button");
      downloadButton.className = "secondary-action history-download";
      downloadButton.type = "button";
      downloadButton.textContent = "下载";
      downloadButton.addEventListener("click", () => downloadImage(item.dataUrl, item.fileName));

      footer.append(time, downloadButton);
      body.append(title, meta, product, footer);
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
  const viewType = getCheckedValue("viewType");
  const ratio = elements.aspectRatio.value.replace(":", "x");
  const size = elements.imageSize.value.toLowerCase();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = normalizeDownloadFileName(fileName) || `furniture-placement-${viewType}-${ratio}-${size}-${timestamp}.png`;
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
    elements.modelName.textContent = `模型：${config.model}`;
    elements.apiStatus.textContent = config.hasApiKey ? "已配置" : "未配置";
    elements.apiStatus.classList.toggle("warn", !config.hasApiKey);
    if (!config.hasApiKey) {
      setMessage("请在 Vercel 环境变量或本地 .env 配置 GEMINI_API_KEY。", true);
    } else if (hasSaasContext()) {
      loadSaasLaunch();
    }
  } catch {
    elements.modelName.textContent = "模型：未知";
    elements.apiStatus.textContent = "异常";
    elements.apiStatus.classList.add("warn");
  }
}

function handleAnalyzeClick() {
  analyzeSofaPlacement({ force: true });
}

elements.productInput.addEventListener("change", () =>
  handleFile(elements.productInput, "productImage", elements.productPreview, elements.productDrop, elements.productMeta),
);
elements.styleReferenceInput.addEventListener("change", () =>
  handleFile(
    elements.styleReferenceInput,
    "styleReferenceImage",
    elements.styleReferencePreview,
    elements.styleReferenceDrop,
    elements.styleReferenceMeta,
  ),
);
document.querySelectorAll('input[name="sceneStyle"]').forEach((input) => {
  input.addEventListener("change", () => {
    resetSofaAnalysis();
    updateStyleReferenceState();
    updateActionState();
  });
});
document.querySelectorAll('input[name="viewType"]').forEach((input) => {
  input.addEventListener("change", () => {
    updatePreviewTitle();
    updateSummary();
  });
});
document.querySelectorAll('input[name="includeModel"]').forEach((input) => {
  input.addEventListener("change", () => {
    resetSofaAnalysis();
    updatePreviewTitle();
    updateSummary();
    setMessage("模特设置已变化，请重新 AI 分析后再生成图片。");
  });
});
elements.imageSize.addEventListener("change", updateSummary);
elements.aspectRatio.addEventListener("change", updatePreviewRatio);
elements.analyzeButton.addEventListener("click", handleAnalyzeClick);
elements.analysisText.addEventListener("input", handleAnalysisEdit);
elements.form.addEventListener("submit", generateImage);
elements.briefTabButtons.forEach((button) => {
  button.addEventListener("click", () => setBriefTab(button.dataset.briefTab));
});
elements.chatInput.addEventListener("input", updateActionState);
elements.chatInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    sendChatMessage();
  }
});
elements.chatSendButton.addEventListener("click", () => sendChatMessage());
elements.chatGenerateButton.addEventListener("click", () => sendChatMessage("", { directGenerate: true }));
elements.chatQuickActions.forEach((button) => {
  button.addEventListener("click", () => sendChatMessage(button.dataset.chatPrompt || ""));
});
elements.downloadButton.addEventListener("click", () => downloadImage());
elements.modalDownloadButton.addEventListener("click", () =>
  downloadImage(state.modalDataUrl || state.resultDataUrl, state.modalFileName || state.resultMeta?.fileName),
);
elements.modalCloseButton.addEventListener("click", closeImageModal);
elements.imageModalBackdrop.addEventListener("click", closeImageModal);
elements.modalImage.addEventListener("load", fitModalImage);
elements.resultImage.addEventListener("click", () => openImageModal());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.imageModal.classList.contains("visible")) {
    closeImageModal();
  }
});
if ("ResizeObserver" in window) {
  new ResizeObserver(fitPreviewFrameFromSelection).observe(elements.previewStage);
  new ResizeObserver(fitModalImage).observe(elements.imageModalStage);
} else {
  window.addEventListener("resize", fitPreviewFrameFromSelection);
  window.addEventListener("resize", fitModalImage);
}
setupDrop(elements.productDrop, elements.productInput);
setupDrop(elements.styleReferenceDrop, elements.styleReferenceInput);
setupSaasBridge();
setBriefTab("params");
renderChatMessages();
updateStyleReferenceState();
renderSofaAnalysis();
updatePreviewTitle();
updatePreviewRatio();
fitPreviewFrameFromSelection();
updateSummary();
updateActionState();
loadConfig();
