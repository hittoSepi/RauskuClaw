import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const DEV_LANGS = [
  "bash",
  "css",
  "dockerfile",
  "go",
  "java",
  "javascript",
  "json",
  "markdown",
  "python",
  "rust",
  "sql",
  "typescript",
  "xml",
  "yaml"
];

const EXT_TO_LANG = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  cjs: "javascript",
  mjs: "javascript",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  sql: "sql",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  yml: "yaml",
  yaml: "yaml"
};

export function detectLanguageForFilename(filename) {
  const name = String(filename || "").trim().toLowerCase();
  if (!name) return "";
  if (name.endsWith("dockerfile")) return "dockerfile";
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  const ext = name.slice(idx + 1);
  return EXT_TO_LANG[ext] || "";
}

export function highlightCodeAuto(source, filename = "") {
  const raw = String(source || "");
  const lang = detectLanguageForFilename(filename);
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value;
  }
  return hljs.highlightAuto(raw, DEV_LANGS).value;
}
