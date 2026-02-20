const crypto = require("crypto");

module.exports = function registerDevRoutes(app, deps) {
  const { auth, db, rowToJob, nowIso, log, badRequest } = deps;

  /**
   * POST /v1/dev/jobs
   *
   * Dev-only endpoint to create a simple test job.
   * This allows testing the UI in API mode without needing full job creation flow.
   */
  app.post("/v1/dev/jobs", auth, (req, res) => {
    const allowDev =
      process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_ENDPOINTS === "1";

    if (!allowDev) {
      return res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "Dev endpoints are not available" },
      });
    }

    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const queue = String(body.queue || "default").trim();
      const type = String(body.type || "test").trim();

      // Create a minimal test job
      const id = crypto.randomUUID();
      const now = nowIso();

      db.prepare(`
        INSERT INTO jobs (id, type, queue, status, priority, timeout_sec, max_attempts, attempts, callback_url, tags_json, input_json, created_at, updated_at)
        VALUES (?, ?, ?, 'queued', 0, 60, 1, 0, NULL, NULL, '{}', ?, ?)
      `).run(id, type, queue, now, now);

      log(id, "info", `Dev job created`, { type, queue });

      const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
      res.json({ ok: true, job: rowToJob(row) });
    } catch (e) {
      return badRequest(res, "DEV_JOB_ERROR", String(e?.message || e));
    }
  });
};
