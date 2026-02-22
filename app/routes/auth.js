module.exports = function registerAuthRoutes(app, deps) {
  const {
    auth,
    issueSseAuthToken,
    sseTokenParam = "stream_token"
  } = deps;

  // GET /v1/ping
  app.get("/v1/ping", auth, (req, res) => res.json({ ok: true, pong: true }));

  // GET /v1/auth/whoami
  app.get("/v1/auth/whoami", auth, (req, res) => {
    const role = String(req.auth?.role || "read");
    return res.json({
      ok: true,
      auth: {
        name: String(req.auth?.name || ""),
        role,
        sse: req.auth?.sse === true,
        can_write: role === "admin",
        queue_allowlist: Array.isArray(req.auth?.queue_allowlist) ? req.auth.queue_allowlist : null
      }
    });
  });

  // POST /v1/auth/sse-token
  // Mint short-lived stream auth token so EventSource URL does not carry raw API key.
  app.post("/v1/auth/sse-token", auth, (req, res) => {
    if (typeof issueSseAuthToken !== "function") {
      return res.status(500).json({
        ok: false,
        error: { code: "UNAVAILABLE", message: "SSE token minting is unavailable." }
      });
    }

    const body = req.body ?? {};
    const rawJobId = String(body.job_id || "").trim();
    if (rawJobId && !/^[a-z0-9._:-]{1,120}$/i.test(rawJobId)) {
      return res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "'job_id' must match ^[a-z0-9._:-]{1,120}$" }
      });
    }

    try {
      const issued = issueSseAuthToken(req.auth, { jobId: rawJobId || null });
      return res.json({
        ok: true,
        token: issued.token,
        token_param: issued.token_param || sseTokenParam,
        ttl_sec: issued.ttl_sec,
        expires_at: issued.expires_at,
        job_id: issued.job_id || null
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "SSE_TOKEN_ISSUE_FAILED", message: String(e?.message || e) }
      });
    }
  });
};
