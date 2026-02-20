const fs = require("fs");
const path = require("path");
const { isPathInside, validateWorkspacePathOrBadRequest } = require("../lib/pathUtils");
const { decodeBase64Payload } = require("../lib/codec");

module.exports = function registerWorkspaceRoutes(app, deps) {
  const {
    auth,
    badRequest,
    workspaceRoot,
    workspaceFileViewMaxBytes,
    workspaceUploadMaxBytes,
    workspaceFileWriteMaxBytes
  } = deps;

  // Helper functions (workspace-specific)
  function formatWorkspaceEntry(baseDir, dirent) {
    const abs = path.join(baseDir, dirent.name);
    let st = null;
    try {
      st = fs.statSync(abs);
    } catch {
      st = null;
    }
    const relPath = path.relative(workspaceRoot, abs) || ".";
    return {
      name: dirent.name,
      path: relPath.split(path.sep).join("/"),
      is_dir: !!dirent.isDirectory(),
      size: st && st.isFile() ? st.size : null,
      modified_at: st ? new Date(st.mtimeMs).toISOString() : null
    };
  }

  function shouldHideWorkspaceEntry(dirent) {
    const name = String(dirent?.name || "");
    if (!name) return false;
    if (name === ".gitkeep") return true;
    if (name === ".codex-home") return true;
    return false;
  }

  function isLikelyBinary(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
    const sampleLen = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleLen; i += 1) {
      if (buffer[i] === 0) return true;
    }
    return false;
  }

  // GET /v1/workspace/files
  app.get("/v1/workspace/files", auth, (req, res) => {
    const requestedPath = String(req.query.path || ".").trim() || ".";
    const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
    const target = path.resolve(workspaceRoot, requestedPath);

    if (!isPathInside(workspaceRoot, target)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace path not found" } });
    }

    let entries;
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
      });
    }

    const sorted = entries
      .filter((d) => !shouldHideWorkspaceEntry(d))
      .slice()
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit)
      .map((d) => formatWorkspaceEntry(target, d));

    return res.json({
      ok: true,
      root: workspaceRoot.split(path.sep).join("/"),
      path: path.relative(workspaceRoot, target).split(path.sep).join("/") || ".",
      entries: sorted,
      count: sorted.length
    });
  });

  // GET /v1/workspace/file
  app.get("/v1/workspace/file", auth, (req, res) => {
    const requestedPath = String(req.query.path || "").trim();
    if (!requestedPath) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'path' query parameter.");
    }

    const target = path.resolve(workspaceRoot, requestedPath);
    if (!isPathInside(workspaceRoot, target)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
    }

    let st;
    try {
      st = fs.statSync(target);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
      });
    }
    if (!st.isFile()) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
    }
    if (st.size > workspaceFileViewMaxBytes) {
      return res.status(413).json({
        ok: false,
        error: {
          code: "WORKSPACE_FILE_TOO_LARGE",
          message: `File exceeds view limit (${workspaceFileViewMaxBytes} bytes).`,
          details: { size: st.size, max_bytes: workspaceFileViewMaxBytes }
        }
      });
    }

    let contentBuffer;
    try {
      contentBuffer = fs.readFileSync(target);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
      });
    }
    if (isLikelyBinary(contentBuffer)) {
      return res.status(415).json({
        ok: false,
        error: { code: "WORKSPACE_FILE_BINARY", message: "Binary file preview is not supported." }
      });
    }

    return res.json({
      ok: true,
      file: {
        path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
        size: st.size,
        modified_at: new Date(st.mtimeMs).toISOString(),
        content: contentBuffer.toString("utf8")
      }
    });
  });

  // GET /v1/workspace/download
  app.get("/v1/workspace/download", auth, (req, res) => {
    const requestedPath = String(req.query.path || "").trim();
    if (!requestedPath) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'path' query parameter.");
    }
    const target = path.resolve(workspaceRoot, requestedPath);
    if (!isPathInside(workspaceRoot, target)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
    }

    let st;
    try {
      st = fs.statSync(target);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
      });
    }
    if (!st.isFile()) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
    }

    return res.download(target, path.basename(target), (err) => {
      if (!err || res.headersSent) return;
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_DOWNLOAD_FAILED", message: String(err?.message || err) }
      });
    });
  });

  // POST /v1/workspace/upload
  app.post("/v1/workspace/upload", auth, (req, res) => {
    const body = req.body ?? {};
    const requestedPath = String(body.path || "").trim();
    const overwrite = body.overwrite === true;
    const contentBase64 = body.content_base64;

    if (!requestedPath) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'path'.");
    }
    if (typeof contentBase64 !== "string" || !contentBase64.trim()) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'content_base64'.");
    }

    const target = path.resolve(workspaceRoot, requestedPath);
    if (!isPathInside(workspaceRoot, target)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
    }

    const parentDir = path.dirname(target);
    if (!isPathInside(workspaceRoot, parentDir)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested parent path escapes workspace root.");
    }
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      return badRequest(res, "VALIDATION_ERROR", "Target parent directory does not exist.");
    }
    if (fs.existsSync(target) && !overwrite) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: "Target file already exists. Set overwrite=true to replace." }
      });
    }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      return badRequest(res, "VALIDATION_ERROR", "Target path points to a directory.");
    }

    let data;
    try {
      data = decodeBase64Payload(contentBase64);
    } catch (e) {
      return badRequest(res, "VALIDATION_ERROR", `Invalid content_base64: ${String(e?.message || e)}`);
    }
    if (data.length > workspaceUploadMaxBytes) {
      return res.status(413).json({
        ok: false,
        error: {
          code: "WORKSPACE_FILE_TOO_LARGE",
          message: `Upload exceeds limit (${workspaceUploadMaxBytes} bytes).`,
          details: { size: data.length, max_bytes: workspaceUploadMaxBytes }
        }
      });
    }

    try {
      fs.writeFileSync(target, data);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
      });
    }

    let st;
    try {
      st = fs.statSync(target);
    } catch {
      st = { size: data.length, mtimeMs: Date.now() };
    }

    return res.status(201).json({
      ok: true,
      file: {
        path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
        size: st.size,
        modified_at: new Date(st.mtimeMs).toISOString(),
        overwritten: overwrite
      }
    });
  });

  // POST /v1/workspace/create
  app.post("/v1/workspace/create", auth, (req, res) => {
    const body = req.body ?? {};
    const requestedPath = validateWorkspacePathOrBadRequest({ res, rawPath: body.path, workspaceRoot, badRequest, fieldName: "path" });
    if (!requestedPath) return;

    const kindRaw = String(body.kind || "file").trim().toLowerCase();
    const kind = kindRaw === "dir" ? "dir" : "file";
    const overwrite = body.overwrite === true;
    const content = body.content == null ? "" : body.content;

    if (kind === "file" && typeof content !== "string") {
      return badRequest(res, "VALIDATION_ERROR", "'content' must be a string.");
    }

    const target = requestedPath.abs;
    const parentDir = path.dirname(target);
    if (!isPathInside(workspaceRoot, parentDir)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested parent path escapes workspace root.");
    }
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      return badRequest(res, "VALIDATION_ERROR", "Target parent directory does not exist.");
    }

    if (kind === "dir") {
      if (fs.existsSync(target)) {
        const st = fs.statSync(target);
        if (!st.isDirectory()) {
          return badRequest(res, "VALIDATION_ERROR", "Target path points to a file.");
        }
        if (!overwrite) {
          return res.status(409).json({
            ok: false,
            error: { code: "CONFLICT", message: "Target directory already exists. Set overwrite=true to continue." }
          });
        }
        return res.status(201).json({
          ok: true,
          entry: {
            path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
            kind: "dir",
            overwritten: true
          }
        });
      }
      try {
        fs.mkdirSync(target, { recursive: false });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
        });
      }
      return res.status(201).json({
        ok: true,
        entry: {
          path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
          kind: "dir",
          overwritten: false
        }
      });
    }

    const contentBuffer = Buffer.from(String(content), "utf8");
    if (contentBuffer.length > workspaceFileWriteMaxBytes) {
      return res.status(413).json({
        ok: false,
        error: {
          code: "WORKSPACE_FILE_TOO_LARGE",
          message: `File exceeds write limit (${workspaceFileWriteMaxBytes} bytes).`,
          details: { size: contentBuffer.length, max_bytes: workspaceFileWriteMaxBytes }
        }
      });
    }

    if (fs.existsSync(target)) {
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        return badRequest(res, "VALIDATION_ERROR", "Target path points to a directory.");
      }
      if (!overwrite) {
        return res.status(409).json({
          ok: false,
          error: { code: "CONFLICT", message: "Target file already exists. Set overwrite=true to replace." }
        });
      }
    }

    try {
      fs.writeFileSync(target, String(content), "utf8");
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
      });
    }

    let st;
    try {
      st = fs.statSync(target);
    } catch {
      st = { size: contentBuffer.length, mtimeMs: Date.now() };
    }

    return res.status(201).json({
      ok: true,
      entry: {
        path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
        kind: "file",
        size: st.size,
        modified_at: new Date(st.mtimeMs).toISOString(),
        overwritten: overwrite
      }
    });
  });

  // PATCH /v1/workspace/move
  app.patch("/v1/workspace/move", auth, (req, res) => {
    const body = req.body ?? {};
    const fromPath = validateWorkspacePathOrBadRequest({ res, rawPath: body.from_path, workspaceRoot, badRequest, fieldName: "from_path" });
    if (!fromPath) return;
    const toPath = validateWorkspacePathOrBadRequest({ res, rawPath: body.to_path, workspaceRoot, badRequest, fieldName: "to_path" });
    if (!toPath) return;

    const overwrite = body.overwrite === true;

    if (!fs.existsSync(fromPath.abs)) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Source path not found" } });
    }
    if (fromPath.abs === toPath.abs) {
      return res.json({
        ok: true,
        moved: false,
        from_path: fromPath.rel,
        to_path: toPath.rel
      });
    }

    const fromStat = fs.statSync(fromPath.abs);
    const toParent = path.dirname(toPath.abs);
    if (!fs.existsSync(toParent) || !fs.statSync(toParent).isDirectory()) {
      return badRequest(res, "VALIDATION_ERROR", "Destination parent directory does not exist.");
    }
    if (fromStat.isDirectory() && isPathInside(fromPath.abs, toPath.abs)) {
      return badRequest(res, "VALIDATION_ERROR", "Cannot move a directory inside itself.");
    }

    if (fs.existsSync(toPath.abs)) {
      const toStat = fs.statSync(toPath.abs);
      if (!overwrite) {
        return res.status(409).json({
          ok: false,
          error: { code: "CONFLICT", message: "Destination already exists. Set overwrite=true to replace." }
        });
      }
      if (toStat.isDirectory() && !fromStat.isDirectory()) {
        return badRequest(res, "VALIDATION_ERROR", "Destination is a directory.");
      }
      if (!toStat.isDirectory() && fromStat.isDirectory()) {
        return badRequest(res, "VALIDATION_ERROR", "Cannot replace file with directory.");
      }
      try {
        if (toStat.isDirectory()) fs.rmSync(toPath.abs, { recursive: true, force: true });
        else fs.unlinkSync(toPath.abs);
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: { code: "WORKSPACE_MOVE_FAILED", message: String(e?.message || e) }
        });
      }
    }

    try {
      fs.renameSync(fromPath.abs, toPath.abs);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_MOVE_FAILED", message: String(e?.message || e) }
      });
    }

    return res.json({
      ok: true,
      moved: true,
      from_path: path.relative(workspaceRoot, fromPath.abs).split(path.sep).join("/"),
      to_path: path.relative(workspaceRoot, toPath.abs).split(path.sep).join("/")
    });
  });

  // PUT /v1/workspace/file
  app.put("/v1/workspace/file", auth, (req, res) => {
    const body = req.body ?? {};
    const requestedPath = String(body.path || "").trim();
    const content = body.content;

    if (!requestedPath) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'path'.");
    }
    if (typeof content !== "string") {
      return badRequest(res, "VALIDATION_ERROR", "'content' must be a string.");
    }

    const target = path.resolve(workspaceRoot, requestedPath);
    if (!isPathInside(workspaceRoot, target)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
    }

    let st;
    try {
      st = fs.statSync(target);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
      });
    }
    if (!st.isFile()) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
    }

    const nextBuffer = Buffer.from(content, "utf8");
    if (nextBuffer.length > workspaceFileWriteMaxBytes) {
      return res.status(413).json({
        ok: false,
        error: {
          code: "WORKSPACE_FILE_TOO_LARGE",
          message: `File exceeds write limit (${workspaceFileWriteMaxBytes} bytes).`,
          details: { size: nextBuffer.length, max_bytes: workspaceFileWriteMaxBytes }
        }
      });
    }

    let currentBuffer;
    try {
      currentBuffer = fs.readFileSync(target);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
      });
    }
    if (isLikelyBinary(currentBuffer)) {
      return res.status(415).json({
        ok: false,
        error: { code: "WORKSPACE_FILE_BINARY", message: "Binary file edit is not supported." }
      });
    }

    try {
      fs.writeFileSync(target, content, "utf8");
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
      });
    }

    let nextStat;
    try {
      nextStat = fs.statSync(target);
    } catch {
      nextStat = { size: nextBuffer.length, mtimeMs: Date.now() };
    }

    return res.json({
      ok: true,
      file: {
        path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
        size: nextStat.size,
        modified_at: new Date(nextStat.mtimeMs).toISOString()
      }
    });
  });

  // DELETE /v1/workspace/file
  app.delete("/v1/workspace/file", auth, (req, res) => {
    const requestedPath = String(req.query.path || "").trim();
    if (!requestedPath) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'path' query parameter.");
    }

    const target = path.resolve(workspaceRoot, requestedPath);
    if (!isPathInside(workspaceRoot, target)) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
    }

    let st;
    try {
      st = fs.statSync(target);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
      });
    }
    if (!st.isFile()) {
      return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
    }

    try {
      fs.unlinkSync(target);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_DELETE_FAILED", message: String(e?.message || e) }
      });
    }

    return res.json({
      ok: true,
      deleted: true,
      file: {
        path: path.relative(workspaceRoot, target).split(path.sep).join("/")
      }
    });
  });
};
