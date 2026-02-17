import test from "node:test";
import assert from "node:assert/strict";
import { iconAssetForEntry, iconTokenForEntry } from "../src/file_icons.js";

test("iconTokenForEntry returns DIR for directories", () => {
  assert.deepEqual(iconTokenForEntry({ is_dir: true, name: "src" }), { token: "DIR", kind: "dir" });
});

test("iconTokenForEntry maps common extensions", () => {
  assert.deepEqual(iconTokenForEntry({ is_dir: false, name: "main.ts" }), { token: "TS", kind: "ts" });
  assert.deepEqual(iconTokenForEntry({ is_dir: false, name: "README.md" }), { token: "MD", kind: "md" });
  assert.deepEqual(iconTokenForEntry({ is_dir: false, name: "Dockerfile" }), { token: "DOCKER", kind: "docker" });
});

test("iconTokenForEntry falls back to FILE", () => {
  assert.deepEqual(iconTokenForEntry({ is_dir: false, name: "archive.bin" }), { token: "FILE", kind: "file" });
});

test("iconAssetForEntry returns public icon url", () => {
  const out = iconAssetForEntry({ is_dir: false, name: "main.ts" });
  assert.equal(out.token, "TS");
  assert.equal(out.kind, "ts");
  assert.match(out.src, /file-icons\/ts\.svg$/);
});
