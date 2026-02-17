function getBaseName(pathOrName) {
  const raw = String(pathOrName || "");
  const parts = raw.split("/");
  return String(parts[parts.length - 1] || "").trim();
}

function getExt(name) {
  const lower = String(name || "").toLowerCase();
  if (!lower) return "";
  if (lower === "dockerfile" || lower.endsWith("dockerfile")) return "dockerfile";
  const idx = lower.lastIndexOf(".");
  if (idx < 0 || idx === lower.length - 1) return "";
  return lower.slice(idx + 1);
}

const EXT_TO_TOKEN = {
  js: "JS",
  jsx: "JS",
  cjs: "JS",
  mjs: "JS",
  ts: "TS",
  tsx: "TS",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  md: "MD",
  markdown: "MD",
  py: "PY",
  go: "GO",
  rs: "RS",
  java: "JAVA",
  sql: "SQL",
  sh: "SH",
  bash: "SH",
  zsh: "SH",
  dockerfile: "DOCKER",
  html: "HTML",
  htm: "HTML",
  xml: "XML",
  svg: "XML",
  css: "CSS",
  vue: "VUE"
};

const TOKEN_TO_ASSET = {
  DIR: "dir",
  FILE: "file",
  JS: "js",
  TS: "ts",
  JSON: "json",
  YAML: "yaml",
  MD: "md",
  PY: "py",
  GO: "go",
  RS: "rs",
  JAVA: "java",
  SQL: "sql",
  SH: "sh",
  DOCKER: "docker",
  HTML: "html",
  XML: "xml",
  CSS: "css",
  VUE: "vue"
};

export function iconTokenForEntry(entry) {
  if (entry?.is_dir) return { token: "DIR", kind: "dir" };
  const name = getBaseName(entry?.name || entry?.path || "");
  const ext = getExt(name);
  const token = EXT_TO_TOKEN[ext] || "FILE";
  return { token, kind: token.toLowerCase() };
}

export function iconAssetForEntry(entry) {
  const { token, kind } = iconTokenForEntry(entry);
  const asset = TOKEN_TO_ASSET[token];
  const base = (import.meta && import.meta.env && typeof import.meta.env.BASE_URL === "string")
    ? import.meta.env.BASE_URL
    : "/ui/";
  const src = asset ? `${base}file-icons/${asset}.svg` : "";
  return { token, kind, src };
}
