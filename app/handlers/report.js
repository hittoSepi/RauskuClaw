const crypto = require("crypto");

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function parseHighlights(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => clampText(x, 200))
    .filter(Boolean)
    .slice(0, 20);
}

function parseMetrics(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out = [];
  for (const [name, value] of Object.entries(raw)) {
    const metricName = clampText(name, 80);
    const metricValue = toFiniteNumber(value);
    if (!metricName || metricValue == null) continue;
    out.push({ name: metricName, value: metricValue });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out.slice(0, 100);
}

function parseValuesStats(rawValues) {
  if (!Array.isArray(rawValues)) return [];
  const values = rawValues.map(toFiniteNumber).filter((x) => x != null);
  if (values.length < 1) return [];
  const sum = values.reduce((acc, cur) => acc + cur, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = sum / values.length;
  return [
    { name: "count", value: values.length },
    { name: "sum", value: Number(sum.toFixed(6)) },
    { name: "min", value: Number(min.toFixed(6)) },
    { name: "max", value: Number(max.toFixed(6)) },
    { name: "avg", value: Number(avg.toFixed(6)) }
  ];
}

function chooseTopMetric(metrics) {
  if (!Array.isArray(metrics) || metrics.length < 1) return null;
  let best = metrics[0];
  for (const m of metrics) {
    if (Number(m.value) > Number(best.value)) best = m;
  }
  return best;
}

function generateReport(input, deps = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("report.generate input must be an object");
  }
  const safeInput = input || {};
  const idFactory = typeof deps.idFactory === "function" ? deps.idFactory : () => crypto.randomUUID();
  const nowFactory = typeof deps.nowIso === "function" ? deps.nowIso : () => new Date().toISOString();

  const title = clampText(safeInput.title, 120) || "Runtime Report";
  const source = clampText(safeInput.source, 120) || "unknown";
  const highlights = parseHighlights(safeInput.highlights);

  const metricsFromMap = parseMetrics(safeInput.metrics);
  const metricsFromValues = metricsFromMap.length < 1 ? parseValuesStats(safeInput.values) : [];
  const metrics = metricsFromMap.length > 0 ? metricsFromMap : metricsFromValues;
  const topMetric = chooseTopMetric(metrics);
  const topMetricPart = topMetric ? ` Top metric ${topMetric.name}=${topMetric.value}.` : "";
  const summary = `${title}: ${metrics.length} metric(s), ${highlights.length} highlight(s).${topMetricPart}`.trim();

  return {
    report_id: idFactory(),
    generated_at: nowFactory(),
    title,
    source,
    summary,
    metrics,
    highlights,
    notes: clampText(safeInput.notes, 1000) || null
  };
}

module.exports = {
  generateReport
};
