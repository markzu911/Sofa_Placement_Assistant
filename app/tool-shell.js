import fs from "node:fs";
import path from "node:path";
import Script from "next/script";

const rootDir = process.cwd();

function readMainMarkup() {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const match = html.match(/<main class="app-root">[\s\S]*<\/main>/);
  if (!match) {
    throw new Error("页面模板缺少 app-root。");
  }
  return match[0];
}

function readClientScript() {
  return fs.readFileSync(path.join(rootDir, "app.js"), "utf8");
}

export default function ToolShell() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: readMainMarkup() }} />
      <Script id="villa-sofa-client" strategy="afterInteractive">
        {readClientScript()}
      </Script>
    </>
  );
}
