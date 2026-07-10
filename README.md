# 别墅大型沙发生图

面向别墅、大平层、豪宅客厅的大型沙发空间效果图生成工具。用户上传产品参考图和房间参考图后，应用会按高端软装摄影逻辑生成一张真实豪宅客厅效果图。

## 本地运行

先复制配置：

```bash
cp .env.example .env
```

在 `.env` 填入：

```env
GEMINI_API_KEY=你的 Gemini API Key
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
PORT=8002
HOST=0.0.0.0
```

启动：

```bash
npm run dev
```

本机打开 `http://127.0.0.1:8002`。本地测试不需要 SaaS `userId/toolId`，生成不会扣费，也不会保存到“我的图片”。

## SaaS 接入流程

- 页面从 SaaS `postMessage` 的 `SAAS_INIT` 或 URL 参数读取 `userId/toolId`。
- `/api/generate` 会先调用 SaaS `/api/tool/verify` 校验积分。
- Gemini 生成失败不会扣费，也不会上传任何图片。
- 结果图生成成功后，后端调用 `/api/tool/consume` 扣费。
- 扣费成功后，后端调用 `/api/upload/direct-token` 获取短期 OSS 上传地址。
- 后端把最终结果图二进制 `PUT` 到 OSS，再调用 `/api/upload/commit` 入库。
- 前端收到 `recordId/url/fileName/fileSize` 后预览图片。
- 用户上传的产品图和房间参考图只传给生成模型，不写入 SaaS OSS，也不进入“我的图片”。

## 生成逻辑

- 产品参考图是最高优先级，严格还原大型沙发的组合方式、转角结构、贵妃位方向、模块数量、坐垫分割、靠包数量、扶手形态、面料纹理、颜色和整体轮廓。
- 房间参考图锁定别墅空间层高、墙面材质、窗户位置、采光方向、地面材质、吊灯、背景墙和豪宅氛围。
- 默认生成豪宅客厅广角斜侧视角：镜头高度约 1.3 米，24mm 室内建筑摄影镜头，完整展示大型沙发组合、客厅开阔感和空间层次。
- 支持 16:9、4:3、3:2、1:1 画幅，以及 4K / 8K 质感选项。
- 页面保留简洁补充要求输入，可用于追加软装、光线、构图等自然语言要求，但不会覆盖产品 100% 还原约束。
