const test = require("node:test");
const assert = require("node:assert/strict");
const { generateComponentFiles } = require("../handlers/component");

test("generateComponentFiles returns Vue component by default", () => {
  const out = generateComponentFiles({});
  assert.equal(out.framework, "vue");
  assert.equal(out.language, "ts");
  assert.equal(out.component_name, "Component");
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].path, "Component.vue");
  assert.match(out.files[0].content, /<script setup lang="ts">/);
});

test("generateComponentFiles returns React jsx/tsx component", () => {
  const out = generateComponentFiles({
    framework: "react",
    language: "js",
    component_name: "DashboardCard"
  });
  assert.equal(out.framework, "react");
  assert.equal(out.language, "js");
  assert.equal(out.files[0].path, "DashboardCard.jsx");
  assert.match(out.files[0].content, /export function DashboardCard/);
});

test("generateComponentFiles validates input", () => {
  assert.throws(
    () => generateComponentFiles("bad"),
    /input must be an object/
  );
  assert.throws(
    () => generateComponentFiles({ framework: "svelte" }),
    /framework must be one of/
  );
  assert.throws(
    () => generateComponentFiles({ component_name: "bad-name" }),
    /component_name must match/
  );
});
