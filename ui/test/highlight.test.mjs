import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguageForFilename, highlightCodeAuto } from "../src/highlight.js";

test("highlightCodeAuto highlights by known filename extension", () => {
  const outTs = highlightCodeAuto("const answer: number = 42;", "main.ts");
  assert.match(outTs, /hljs/);
  assert.match(outTs, /number/);

  const outPy = highlightCodeAuto("def run():\n    return 1\n", "tool.py");
  assert.match(outPy, /hljs/);
  assert.match(outPy, /def|return/);
});

test("highlightCodeAuto falls back to auto for unknown extension", () => {
  const out = highlightCodeAuto("SELECT 1;", "notes.unknownext");
  assert.match(out, /hljs/);
});

test("highlightCodeAuto supports Dockerfile name without extension", () => {
  const out = highlightCodeAuto("FROM node:20-alpine\nRUN echo ok\n", "Dockerfile");
  assert.match(out, /hljs/);
  assert.match(out, /FROM|RUN/);
});

test("detectLanguageForFilename resolves common file names", () => {
  assert.equal(detectLanguageForFilename("app/main.ts"), "typescript");
  assert.equal(detectLanguageForFilename("Dockerfile"), "dockerfile");
  assert.equal(detectLanguageForFilename("notes.unknown"), "");
});
