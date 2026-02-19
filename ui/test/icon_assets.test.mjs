import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ICON_DIR = path.resolve(__dirname, "../public/file-icons");
const MANIFEST_PATH = path.join(ICON_DIR, "manifest.json");

const REQUIRED_KEYS = [
  "dir",
  "file",
  "js",
  "ts",
  "json",
  "yaml",
  "md",
  "py",
  "go",
  "rs",
  "java",
  "sql",
  "sh",
  "docker",
  "html",
  "xml",
  "css",
  "vue"
];

test("icon assets manifest has all required keys", () => {
  assert.equal(fs.existsSync(MANIFEST_PATH), true, "manifest.json missing");
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(raw);
  for (const key of REQUIRED_KEYS) {
    assert.equal(typeof manifest[key], "string", `missing key in manifest: ${key}`);
    assert.ok(manifest[key].length > 0, `empty icon value in manifest: ${key}`);
  }
});

test("each required icon svg file exists and is non-empty", () => {
  for (const key of REQUIRED_KEYS) {
    const filePath = path.join(ICON_DIR, `${key}.svg`);
    assert.equal(fs.existsSync(filePath), true, `missing icon file: ${key}.svg`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 40, `icon file too small/empty: ${key}.svg`);
  }
});
