import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configHandler = require("./api/config.js");
const generateHandler = require("./api/generate.js");
const launchHandler = require("./api/launch.js");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const text = require("node:fs").readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8002);
const HOST = process.env.HOST || "0.0.0.0";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function isApiRoute(pathname, name) {
  return new RegExp(`(^|/)api/${name}/?$`).test(pathname);
}

function resolveMountedPathname(pathname) {
  const match = /^\/ai-tool\/[^/]+\/?(.*)$/.exec(pathname);
  if (!match) return pathname;
  const nestedPath = match[1];
  return nestedPath ? `/${nestedPath}` : "/index.html";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (isApiRoute(url.pathname, "config")) {
    await configHandler(req, res);
    return;
  }
  if (isApiRoute(url.pathname, "generate")) {
    await generateHandler(req, res);
    return;
  }
  if (isApiRoute(url.pathname, "launch")) {
    await launchHandler(req, res);
    return;
  }

  const mountedPathname = resolveMountedPathname(url.pathname);
  const pathname = mountedPathname === "/" ? "/index.html" : mountedPathname;
  const filePath = path.resolve(__dirname, `.${pathname}`);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。请关闭旧服务，或在 .env 里改 PORT。`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`Sofa Placement Assistant running at http://127.0.0.1:${PORT}`);
  if (HOST === "0.0.0.0" || HOST === "::") {
    console.log(`LAN access enabled on this machine's network IP, for example http://192.168.50.70:${PORT}`);
  }
});
