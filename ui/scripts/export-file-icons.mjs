import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIconSet, iconToSVG } from "@iconify/utils";
import iconSet from "@iconify-json/vscode-icons/icons.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "file-icons");

const TARGETS = {
  dir: ["default-folder"],
  file: ["default-file"],
  js: ["file-type-js", "file-type-js-official"],
  ts: ["file-type-typescript", "file-type-typescript-official"],
  json: ["file-type-json", "file-type-json-official", "file-type-light-json"],
  yaml: ["file-type-yaml", "file-type-yaml-official", "file-type-light-yaml"],
  md: ["file-type-markdown"],
  py: ["file-type-python"],
  go: ["file-type-go", "file-type-go-gopher", "file-type-go-white"],
  rs: ["file-type-rust", "file-type-light-rust"],
  java: ["file-type-java"],
  sql: ["file-type-sql", "file-type-mysql", "file-type-pgsql"],
  sh: ["file-type-shell", "file-type-nushell"],
  docker: ["file-type-docker"],
  html: ["file-type-html", "file-type-antlers-html"],
  xml: ["file-type-xml", "file-type-wxml"],
  css: ["file-type-css"],
  vue: ["file-type-vue"]
};

function pickIconName(allNames, candidates) {
  for (const candidate of candidates) {
    const found = allNames.find((name) => name === candidate);
    if (found) return found;
  }
  return "";
}

function toSvg(data) {
  const render = iconToSVG(data, { height: "20", width: "20" });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${render.attributes.viewBox}" width="${render.attributes.width}" height="${render.attributes.height}" fill="currentColor">${render.body}</svg>\n`;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const icons = new Map();
  parseIconSet(iconSet, (name, data) => {
    if (!name || !data) return;
    icons.set(name, data);
  });
  const allNames = Array.from(icons.keys());

  const exported = {};
  for (const [key, patterns] of Object.entries(TARGETS)) {
    const picked = pickIconName(allNames, patterns);
    if (!picked) continue;
    const icon = icons.get(picked);
    if (!icon) continue;
    const svg = toSvg(icon);
    fs.writeFileSync(path.join(OUT_DIR, `${key}.svg`), svg, "utf8");
    exported[key] = picked;
  }

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
  console.log(`Exported ${Object.keys(exported).length} icons to ${OUT_DIR}`);
}

main();
