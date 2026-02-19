const test = require("node:test");
const assert = require("node:assert/strict");
const { generateFrontpageLayout } = require("../handlers/layout");

test("generateFrontpageLayout returns structured layout plan", () => {
  const out = generateFrontpageLayout({
    title: "RauskuCloud",
    tone: "bold",
    audience: "engineering teams",
    primary_action: "Start Free",
    feature_count: 4
  });

  assert.equal(out.title, "RauskuCloud");
  assert.match(out.summary, /engineering teams/);
  assert.equal(out.style.tone, "bold");
  assert.equal(Array.isArray(out.sections), true);
  assert.equal(out.sections[0].id, "hero");
  const features = out.sections.find((s) => s.id === "features");
  assert.equal(features.items.length, 4);
});

test("generateFrontpageLayout defaults missing values", () => {
  const out = generateFrontpageLayout({});
  assert.equal(out.title, "Landing Page");
  assert.equal(out.style.tone, "professional");
  const features = out.sections.find((s) => s.id === "features");
  assert.equal(features.items.length, 3);
});

test("generateFrontpageLayout validates input", () => {
  assert.throws(() => generateFrontpageLayout("bad"), /input must be an object/);
  assert.throws(() => generateFrontpageLayout({ tone: "raw" }), /tone must be one of/);
  assert.throws(() => generateFrontpageLayout({ feature_count: 0 }), /feature_count must be an integer 1..8/);
});
