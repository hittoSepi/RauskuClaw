module.exports = function registerProjectRoutes(app, deps) {
  const { auth, db, nowIso, badRequest } = deps;

  // GET /v1/projects/:id/meta
  app.get("/v1/projects/:id/meta", auth, (req, res) => {
    const { id } = req.params;
    const row = db.prepare(`
      SELECT project_id, display_name, notes, tags_json, archived, updated_at
      FROM projects_meta
      WHERE project_id = ?
    `).get(id);

    if (!row) {
      return res.json({
        ok: true,
        meta: {
          projectId: id,
          displayName: null,
          notes: null,
          tags: null,
          isArchived: false,
          updatedAt: null
        }
      });
    }

    let tags = null;
    if (row.tags_json) {
      try {
        tags = JSON.parse(row.tags_json);
      } catch {
        tags = null;
      }
    }

    return res.json({
      ok: true,
      meta: {
        projectId: row.project_id,
        displayName: row.display_name,
        notes: row.notes,
        tags,
        isArchived: row.archived === 1,
        updatedAt: row.updated_at
      }
    });
  });

  // PATCH /v1/projects/:id/meta
  app.patch("/v1/projects/:id/meta", auth, (req, res) => {
    const { id } = req.params;
    const body = req.body ?? {};

    // Get existing meta
    const existing = db.prepare(`
      SELECT project_id, display_name, notes, tags_json, archived
      FROM projects_meta
      WHERE project_id = ?
    `).get(id);

    const now = nowIso();
    const setCols = [];
    const setParams = [];

    // Build updates
    if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
      const displayName = body.displayName === null ? null : String(body.displayName || "").trim() || null;
      setCols.push("display_name = ?");
      setParams.push(displayName);
    }
    if (Object.prototype.hasOwnProperty.call(body, "notes")) {
      const notes = body.notes === null ? null : String(body.notes || "").trim() || null;
      setCols.push("notes = ?");
      setParams.push(notes);
    }
    if (Object.prototype.hasOwnProperty.call(body, "tags")) {
      const tags = body.tags === null ? null : JSON.stringify(body.tags || []);
      setCols.push("tags_json = ?");
      setParams.push(tags);
    }
    if (Object.prototype.hasOwnProperty.call(body, "isArchived")) {
      const archived = body.isArchived === true ? 1 : 0;
      setCols.push("archived = ?");
      setParams.push(archived);
    }

    if (setCols.length === 0) {
      return badRequest(res, "VALIDATION_ERROR", "No updatable fields provided");
    }

    setCols.push("updated_at = ?");
    setParams.push(now);
    setParams.push(id);

    if (existing) {
      // Update existing
      db.prepare(`
        UPDATE projects_meta
        SET ${setCols.join(", ")}
        WHERE project_id = ?
      `).run(...setParams);
    } else {
      // Insert new
      const insertCols = ["project_id"];
      const insertParams = [id];

      if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
        insertCols.push("display_name");
        insertParams.push(body.displayName === null ? null : String(body.displayName || "").trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(body, "notes")) {
        insertCols.push("notes");
        insertParams.push(body.notes === null ? null : String(body.notes || "").trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(body, "tags")) {
        insertCols.push("tags_json");
        insertParams.push(body.tags === null ? null : JSON.stringify(body.tags || []));
      }
      if (Object.prototype.hasOwnProperty.call(body, "isArchived")) {
        insertCols.push("archived");
        insertParams.push(body.isArchived === true ? 1 : 0);
      }

      insertCols.push("updated_at");
      insertParams.push(now);

      const placeholders = insertCols.map(() => "?").join(", ");
      db.prepare(`
        INSERT INTO projects_meta (${insertCols.join(", ")})
        VALUES (${placeholders})
      `).run(...insertParams);
    }

    // Fetch and return updated meta
    const row = db.prepare(`
      SELECT project_id, display_name, notes, tags_json, archived, updated_at
      FROM projects_meta
      WHERE project_id = ?
    `).get(id);

    let tags = null;
    if (row && row.tags_json) {
      try {
        tags = JSON.parse(row.tags_json);
      } catch {
        tags = null;
      }
    }

    return res.json({
      ok: true,
      meta: {
        projectId: row.project_id,
        displayName: row.display_name,
        notes: row.notes,
        tags,
        isArchived: row.archived === 1,
        updatedAt: row.updated_at
      }
    });
  });

  // GET /v1/projects/meta (batch fetch)
  app.get("/v1/projects/meta", auth, (req, res) => {
    const idsParam = req.query.ids;
    if (!idsParam || typeof idsParam !== "string") {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'ids' query parameter");
    }

    const ids = idsParam.split(",").map((id) => id.trim()).filter((id) => id);
    if (ids.length === 0 || ids.length > 100) {
      return badRequest(res, "VALIDATION_ERROR", "'ids' must contain 1-100 project IDs");
    }

    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT project_id, display_name, notes, tags_json, archived, updated_at
      FROM projects_meta
      WHERE project_id IN (${placeholders})
    `).all(...ids);

    const metaMap = {};
    for (const row of rows) {
      let tags = null;
      if (row.tags_json) {
        try {
          tags = JSON.parse(row.tags_json);
        } catch {
          tags = null;
        }
      }
      metaMap[row.project_id] = {
        projectId: row.project_id,
        displayName: row.display_name,
        notes: row.notes,
        tags,
        isArchived: row.archived === 1,
        updatedAt: row.updated_at
      };
    }

    // Fill in defaults for missing projects
    for (const id of ids) {
      if (!metaMap[id]) {
        metaMap[id] = {
          projectId: id,
          displayName: null,
          notes: null,
          tags: null,
          isArchived: false,
          updatedAt: null
        };
      }
    }

    return res.json({
      ok: true,
      meta: metaMap
    });
  });
};
