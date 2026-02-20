const { prewarmRepoContextSummaries } = require("../providers/openai");

module.exports = function registerRepoRoutes(app, deps) {
  const { auth } = deps;

  // POST /v1/runtime/repo-context/prewarm
  app.post("/v1/runtime/repo-context/prewarm", auth, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const type = String(body.type || "").trim();
    const input = body.input && typeof body.input === "object" ? body.input : {};
    if (type && type !== "ai.chat.generate") {
      return res.json({
        ok: true,
        skipped: true,
        reason: `type '${type}' is not supported for repo-context prewarm`
      });
    }
    try {
      const out = prewarmRepoContextSummaries(input);
      return res.json({ ok: true, type: "ai.chat.generate", ...out });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: {
          code: "PREWARM_FAILED",
          message: String(e?.message || e)
        }
      });
    }
  });
};
