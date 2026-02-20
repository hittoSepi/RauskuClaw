module.exports = function registerAuthRoutes(app, deps) {
  const { auth } = deps;

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
};
