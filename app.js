const state = {
  productImage: null,
  styleReferenceImage: null,
  resultDataUrl: "",
  isLoading: false,
};

const labels = {
  style: {
    modern: "现代简约",
    cream_luxury: "轻奢暖居",
    italian: "意式极简",
    japandi: "侘寂日式",
    scandinavian: "北欧自然",
    french: "法式复古",
    loft: "都市 Loft",
    coastal: "海岸度假",
    custom: "自定义风格",
  },
  view: {
    wide: "远景图",
    mid: "中近景",
    close: "近景",
    model: "模特",
  },
  placement: {
    auto: "自动找位",
    replace: "替换座位",
    wall: "靠墙",
    corner: "角落",
  },
  scale: {
    natural: "自然尺度",
    hero: "商品主角",
    compact: "空间展示",
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
  styleReferenceMeta: document.querySelector("#styleReferenceMeta"),
  productName: document.querySelector("#productName"),
  productDescription: document.querySelector("#productDescription"),
  placementNotes: document.querySelector("#placementNotes"),
  imageSize: document.querySelector("#imageSize"),
  aspectRatio: document.querySelector("#aspectRatio"),
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
  summaryPlacement: document.querySelector("#summaryPlacement"),
  summarySpec: document.querySelector("#summarySpec"),
};

const fileLimit = 8 * 1024 * 1024;
const defaultMetaText = {
  productImage: "PNG / JPG / WEBP，8MB 以内",
  styleReferenceImage: "可选，PNG / JPG / WEBP，8MB 以内",
};

function setMessage(message, isError = false) {
  elements.messageText.textContent = message || "等待上传产品图";
  elements.messageText.classList.toggle("is-error", isError);
}

function getCheckedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      reject(new Error("仅支持 PNG、JPG/JPEG、WEBP 图片。"));
      return;
    }
    if (file.size > fileLimit) {
      reject(new Error("单张参考图请控制在 8MB 以内。"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, name: file.name, size: file.size });
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

function resetResult() {
  state.resultDataUrl = "";
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
      meta.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    } else {
      preview.removeAttribute("src");
      tile.classList.remove("has-image");
      meta.textContent = defaultMetaText[key];
    }
    if (key === "productImage") {
      resetResult();
      setMessage(image ? "产品图已作为外观基准锁定，可以生成。" : "");
      updatePreviewTitle();
    } else {
      setMessage(image ? "房间风格参考图已添加，仅用于风格参考。" : "");
    }
    updateSummary();
  } catch (error) {
    input.value = "";
    state[key] = null;
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
  elements.generateButton.disabled = isLoading;
  elements.generateButton.classList.toggle("is-loading", isLoading);
  elements.loadingMask.classList.toggle("visible", isLoading);
  updatePreviewTitle();
}

function isCustomStyle() {
  return getCheckedValue("sceneStyle") === "custom";
}

function getSceneLabel() {
  const styleLabel = labels.style[getCheckedValue("sceneStyle")] || "选择风格";
  return state.styleReferenceImage ? `${styleLabel} + 参考图` : styleLabel;
}

function updateStyleReferenceState() {
  const customStyle = isCustomStyle();
  elements.styleReferenceMeta.textContent = state.styleReferenceImage
    ? `${state.styleReferenceImage.name} · ${formatFileSize(state.styleReferenceImage.size)}`
    : customStyle
      ? "必传，上传后按参考图自定义风格"
      : defaultMetaText.styleReferenceImage;
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
  const productName = elements.productName.value.trim();
  const viewLabel = labels.view[getCheckedValue("viewType")] || "远景图";
  const placementLabel = labels.placement[getCheckedValue("placementStrategy")] || "自动找位";
  const scaleLabel = labels.scale[getCheckedValue("scaleIntent")] || "自然尺度";

  elements.summaryProduct.textContent = state.productImage ? productName || state.productImage.name : "未上传";
  elements.summaryScene.textContent = getSceneLabel();
  elements.summaryView.textContent = viewLabel;
  elements.summaryPlacement.textContent = `${placementLabel} · ${scaleLabel}`;
  elements.summarySpec.textContent = `${elements.imageSize.value} · ${elements.aspectRatio.value}`;
}

function buildPayload() {
  return {
    productName: elements.productName.value.trim(),
    productDescription: elements.productDescription.value.trim(),
    productImage: state.productImage,
    styleReferenceImage: state.styleReferenceImage,
    sceneStyle: getCheckedValue("sceneStyle"),
    placementStrategy: getCheckedValue("placementStrategy"),
    scaleIntent: getCheckedValue("scaleIntent"),
    placementNotes: elements.placementNotes.value.trim(),
    viewType: getCheckedValue("viewType"),
    imageSize: elements.imageSize.value,
    aspectRatio: elements.aspectRatio.value,
  };
}

async function generateImage(event) {
  event.preventDefault();
  const payload = buildPayload();
  if (!payload.productImage) {
    setMessage("请先上传沙发产品图。", true);
    return;
  }
  if (payload.sceneStyle === "custom" && !payload.styleReferenceImage) {
    setMessage("请选择自定义风格参考图。", true);
    return;
  }

  setLoading(true);
  setMessage("");
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "生成失败。");
    }
    state.resultDataUrl = result.dataUrl;
    elements.resultImage.src = result.dataUrl;
    elements.resultImage.classList.add("visible");
    elements.emptyState.style.display = "none";
    elements.downloadButton.disabled = false;
    setMessage("图片已生成");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setLoading(false);
  }
}

function downloadImage() {
  if (!state.resultDataUrl) return;
  const viewType = getCheckedValue("viewType");
  const ratio = elements.aspectRatio.value.replace(":", "x");
  const size = elements.imageSize.value.toLowerCase();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const anchor = document.createElement("a");
  anchor.href = state.resultDataUrl;
  anchor.download = `sofa-placement-${viewType}-${ratio}-${size}-${timestamp}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function openImageModal() {
  if (!state.resultDataUrl) return;
  elements.modalImage.src = state.resultDataUrl;
  elements.imageModal.classList.add("visible");
  elements.imageModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  fitModalImage();
  elements.modalCloseButton.focus();
}

function closeImageModal() {
  elements.imageModal.classList.remove("visible");
  elements.imageModal.setAttribute("aria-hidden", "true");
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
    const response = await fetch("/api/config");
    const config = await response.json();
    elements.modelName.textContent = `模型：${config.model}`;
    elements.apiStatus.textContent = config.hasApiKey ? "已配置" : "未配置";
    elements.apiStatus.classList.toggle("warn", !config.hasApiKey);
    if (!config.hasApiKey) {
      setMessage("请在 Vercel 环境变量或本地 .env 配置 GEMINI_API_KEY。", true);
    }
  } catch {
    elements.modelName.textContent = "模型：未知";
    elements.apiStatus.textContent = "异常";
    elements.apiStatus.classList.add("warn");
  }
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
    updateStyleReferenceState();
  });
});
document.querySelectorAll('input[name="viewType"], input[name="placementStrategy"], input[name="scaleIntent"]').forEach((input) => {
  input.addEventListener("change", () => {
    updatePreviewTitle();
    updateSummary();
  });
});
elements.productName.addEventListener("input", updateSummary);
elements.placementNotes.addEventListener("input", updateSummary);
elements.imageSize.addEventListener("change", updateSummary);
elements.aspectRatio.addEventListener("change", updatePreviewRatio);
elements.form.addEventListener("submit", generateImage);
elements.downloadButton.addEventListener("click", downloadImage);
elements.modalDownloadButton.addEventListener("click", downloadImage);
elements.modalCloseButton.addEventListener("click", closeImageModal);
elements.imageModalBackdrop.addEventListener("click", closeImageModal);
elements.modalImage.addEventListener("load", fitModalImage);
elements.resultImage.addEventListener("click", openImageModal);
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
updateStyleReferenceState();
updatePreviewTitle();
updatePreviewRatio();
fitPreviewFrameFromSelection();
updateSummary();
loadConfig();
