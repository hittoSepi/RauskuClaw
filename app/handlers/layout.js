function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeTone(raw) {
  const tone = clampText(raw, 40).toLowerCase() || "professional";
  const allowed = new Set(["professional", "bold", "minimal", "playful"]);
  if (!allowed.has(tone)) {
    throw new Error("tone must be one of: professional, bold, minimal, playful");
  }
  return tone;
}

function normalizeAudience(raw) {
  const audience = clampText(raw, 120) || "general";
  if (audience.length < 2) {
    throw new Error("audience must be at least 2 characters");
  }
  return audience;
}

function normalizePrimaryAction(raw) {
  const action = clampText(raw, 120) || "Get Started";
  if (action.length < 2) {
    throw new Error("primary_action must be at least 2 characters");
  }
  return action;
}

function normalizeFeatureCount(raw) {
  if (raw == null || raw === "") return 3;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 8) {
    throw new Error("feature_count must be an integer 1..8");
  }
  return n;
}

function buildSections(featureCount, primaryAction) {
  const featureItems = Array.from({ length: featureCount }).map((_, i) => ({
    id: `feature-${i + 1}`,
    headline: `Feature ${i + 1}`,
    body: `Describe benefit ${i + 1} in one concise sentence.`
  }));
  return [
    {
      id: "hero",
      purpose: "Communicate value proposition and conversion goal.",
      required_elements: ["headline", "subheadline", "primary_cta"],
      primary_cta: primaryAction
    },
    {
      id: "features",
      purpose: "Show core capabilities with proof-oriented copy.",
      items: featureItems
    },
    {
      id: "social-proof",
      purpose: "Build trust with metrics, logos, testimonials, or case snippets.",
      required_elements: ["proof_items"]
    },
    {
      id: "cta",
      purpose: "Repeat conversion action with reduced friction.",
      primary_cta: primaryAction
    },
    {
      id: "footer",
      purpose: "Navigation, legal links, and support contact."
    }
  ];
}

function generateFrontpageLayout(input) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("design.frontpage.layout input must be an object");
  }
  const safeInput = input || {};
  const title = clampText(safeInput.title, 120) || "Landing Page";
  const tone = normalizeTone(safeInput.tone);
  const audience = normalizeAudience(safeInput.audience);
  const primaryAction = normalizePrimaryAction(safeInput.primary_action);
  const featureCount = normalizeFeatureCount(safeInput.feature_count);

  return {
    title,
    summary: `Frontpage layout plan for ${audience} (${tone} tone, ${featureCount} feature blocks).`,
    style: {
      tone,
      audience,
      visual_direction: tone === "bold" ? "high-contrast" : (tone === "minimal" ? "clean-grid" : "balanced-modern")
    },
    sections: buildSections(featureCount, primaryAction),
    notes: [
      "Start with one clear conversion action above the fold.",
      "Keep section copy scannable and proof-first.",
      "Use consistent spacing scale and typographic hierarchy."
    ]
  };
}

module.exports = {
  generateFrontpageLayout
};
