function stableSortValue(value) {
  if (Array.isArray(value)) return value.map(stableSortValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = stableSortValue(value[key]);
  }
  return out;
}

function stableJson(value) {
  return JSON.stringify(stableSortValue(value ?? null));
}

function projectMemoryForEmbedding(memory) {
  const scope = String(memory?.scope || "").trim();
  const key = String(memory?.key || "").trim();
  const tags = Array.isArray(memory?.tags) ? memory.tags.map((x) => String(x)) : [];
  const value = memory?.value;

  return [
    `scope:${scope}`,
    `key:${key}`,
    `tags:${stableJson(tags)}`,
    `value:${stableJson(value)}`
  ].join("\n");
}

module.exports = {
  stableJson,
  projectMemoryForEmbedding
};
