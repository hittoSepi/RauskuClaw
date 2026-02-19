/**
 * Working Memory module for agent session state persistence.
 * 
 * Provides a dedicated scope (agent.working_memory) for tracking:
 * - Current goals and objectives
 * - Active tasks and their status
 * - Completed steps
 * - Blockers and open questions
 * - Session context summary
 */

const crypto = require("crypto");

const WORKING_MEMORY_SCOPE = "agent.working_memory";
const SESSION_TTL_SEC = 86400; // 24 hours

function nowIso() {
  return new Date().toISOString();
}

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return `session.${ts}.${rand}`;
}

/**
 * Validate working memory state object
 */
function validateWorkingMemoryState(state) {
  if (!state || typeof state !== "object") {
    throw new Error("Working memory state must be an object");
  }

  const validated = {
    current_goal: String(state.current_goal || "").trim() || null,
    active_tasks: Array.isArray(state.active_tasks)
      ? state.active_tasks.map((t) => ({
          id: String(t?.id || crypto.randomUUID()),
          description: String(t?.description || "").trim(),
          status: ["pending", "in_progress", "completed", "blocked"].includes(t?.status)
            ? t.status
            : "pending",
          created_at: String(t?.created_at || nowIso()),
          updated_at: nowIso()
        }))
      : [],
    completed_steps: Array.isArray(state.completed_steps)
      ? state.completed_steps.map((s) => String(s || "").trim()).filter(Boolean)
      : [],
    blockers: Array.isArray(state.blockers)
      ? state.blockers.map((b) => ({
          description: String(b?.description || "").trim(),
          severity: ["low", "medium", "high"].includes(b?.severity) ? b.severity : "medium",
          created_at: String(b?.created_at || nowIso())
        }))
      : [],
    open_questions: Array.isArray(state.open_questions)
      ? state.open_questions.map((q) => String(q || "").trim()).filter(Boolean)
      : [],
    context_summary: String(state.context_summary || "").trim() || null,
    updated_at: nowIso()
  };

  return validated;
}

/**
 * Save working memory state for a session
 */
function saveWorkingMemoryState(db, sessionId, state, ttlSec = SESSION_TTL_SEC) {
  const id = String(sessionId || "").trim();
  if (!id) {
    throw new Error("Session ID is required");
  }

  const validated = validateWorkingMemoryState(state);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

  // Save each component as a separate memory entry
  const entries = [
    { key: `${id}.current_goal`, value: { text: validated.current_goal } },
    { key: `${id}.active_tasks`, value: { tasks: validated.active_tasks } },
    { key: `${id}.completed_steps`, value: { steps: validated.completed_steps } },
    { key: `${id}.blockers`, value: { blockers: validated.blockers } },
    { key: `${id}.open_questions`, value: { questions: validated.open_questions } },
    { key: `${id}.context_summary`, value: { text: validated.context_summary } },
    { key: `${id}.meta`, value: { updated_at: validated.updated_at, session_id: id } }
  ];

  const stmt = db.prepare(`
    INSERT INTO memories (
      id, scope, key, value_json, tags_json, created_at, updated_at, expires_at,
      embedding_status, embedding_error_json, embedded_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
    ON CONFLICT(scope, key) DO UPDATE SET
      value_json = excluded.value_json,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at,
      embedding_status = 'pending',
      embedding_error_json = NULL,
      embedded_at = NULL
  `);

  for (const entry of entries) {
    const memoryId = crypto.randomUUID();
    stmt.run(
      memoryId,
      WORKING_MEMORY_SCOPE,
      entry.key,
      JSON.stringify(entry.value),
      JSON.stringify(["working_memory", "session"]),
      now,
      now,
      expiresAt
    );
  }

  return { session_id: id, updated_at: validated.updated_at };
}

/**
 * Load working memory state for a session
 */
function loadWorkingMemoryState(db, sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  const now = nowIso();

  const rows = db.prepare(`
    SELECT key, value_json, updated_at
    FROM memories
    WHERE scope = ?
      AND key LIKE ? || '.%'
      AND (expires_at IS NULL OR expires_at > ?)
  `).all(WORKING_MEMORY_SCOPE, id, now);

  if (!rows || rows.length === 0) return null;

  const state = {
    session_id: id,
    current_goal: null,
    active_tasks: [],
    completed_steps: [],
    blockers: [],
    open_questions: [],
    context_summary: null,
    updated_at: null
  };

  for (const row of rows || []) {
    const key = String(row?.key || "");
    const suffix = key.replace(`${id}.`, "");
    let value;
    try {
      value = JSON.parse(row?.value_json || "{}");
    } catch {
      continue;
    }

    switch (suffix) {
      case "current_goal":
        state.current_goal = value?.text || null;
        break;
      case "active_tasks":
        state.active_tasks = Array.isArray(value?.tasks) ? value.tasks : [];
        break;
      case "completed_steps":
        state.completed_steps = Array.isArray(value?.steps) ? value.steps : [];
        break;
      case "blockers":
        state.blockers = Array.isArray(value?.blockers) ? value.blockers : [];
        break;
      case "open_questions":
        state.open_questions = Array.isArray(value?.questions) ? value.questions : [];
        break;
      case "context_summary":
        state.context_summary = value?.text || null;
        break;
      case "meta":
        state.updated_at = value?.updated_at || row?.updated_at || null;
        break;
    }
  }

  return state;
}

/**
 * Clear working memory state for a session
 */
function clearWorkingMemoryState(db, sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return { deleted: 0 };

  const result = db.prepare(`
    DELETE FROM memories
    WHERE scope = ? AND key LIKE ? || '.%'
  `).run(WORKING_MEMORY_SCOPE, id);

  return { deleted: result.changes || 0 };
}

/**
 * List recent working memory sessions
 */
function listRecentWorkingMemorySessions(db, limit = 10) {
  const now = nowIso();
  const maxLimit = Math.min(Math.max(1, Number(limit) || 10), 100);

  // Find unique session IDs from working memory scope
  const rows = db.prepare(`
    SELECT 
      key,
      value_json,
      updated_at
    FROM memories
    WHERE scope = ?
      AND key LIKE 'session.%.meta'
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(WORKING_MEMORY_SCOPE, now, maxLimit);

  const sessions = [];
  for (const row of rows || []) {
    const key = String(row?.key || "");
    const match = key.match(/^session\.[^.]+\.meta$/);
    if (!match) continue;

    let meta;
    try {
      meta = JSON.parse(row?.value_json || "{}");
    } catch {
      meta = {};
    }

    const sessionId = meta?.session_id || key.replace(".meta", "");
    sessions.push({
      session_id: sessionId,
      updated_at: row?.updated_at || null
    });
  }

  return sessions;
}

/**
 * Build context instruction for provider from working memory state
 */
function buildWorkingMemoryContext(state) {
  if (!state) return null;

  const lines = ["Current working memory state:"];

  if (state.current_goal) {
    lines.push(`\n**Current Goal:** ${state.current_goal}`);
  }

  if (state.active_tasks && state.active_tasks.length > 0) {
    lines.push("\n**Active Tasks:**");
    for (const task of state.active_tasks) {
      const statusIcon = task.status === "in_progress" ? "🔄" : 
                         task.status === "completed" ? "✅" :
                         task.status === "blocked" ? "🚫" : "⏳";
      lines.push(`  ${statusIcon} ${task.description}`);
    }
  }

  if (state.completed_steps && state.completed_steps.length > 0) {
    lines.push("\n**Completed Steps:**");
    for (const step of state.completed_steps.slice(-5)) {
      lines.push(`  ✅ ${step}`);
    }
    if (state.completed_steps.length > 5) {
      lines.push(`  ... and ${state.completed_steps.length - 5} more`);
    }
  }

  if (state.blockers && state.blockers.length > 0) {
    lines.push("\n**Blockers:**");
    for (const blocker of state.blockers) {
      const severityIcon = blocker.severity === "high" ? "🔴" :
                          blocker.severity === "medium" ? "🟡" : "🟢";
      lines.push(`  ${severityIcon} ${blocker.description}`);
    }
  }

  if (state.open_questions && state.open_questions.length > 0) {
    lines.push("\n**Open Questions:**");
    for (const q of state.open_questions.slice(0, 3)) {
      lines.push(`  ❓ ${q}`);
    }
  }

  if (state.context_summary) {
    lines.push(`\n**Session Summary:** ${state.context_summary}`);
  }

  lines.push("\nUse this context to maintain continuity with previous work. Update working memory as you make progress.");

  return lines.join("\n");
}

/**
 * Get the most recent working memory session
 */
function getLatestWorkingMemorySession(db) {
  const sessions = listRecentWorkingMemorySessions(db, 1);
  if (!sessions || sessions.length === 0) return null;
  return loadWorkingMemoryState(db, sessions[0].session_id);
}

/**
 * Extract working memory updates from assistant output text
 * Simple heuristic extraction of task updates, completions, etc.
 */
function extractWorkingMemoryUpdates(text, currentState = {}) {
  const s = String(text || "").trim();
  if (!s) return null;

  const updates = {
    current_goal: currentState?.current_goal || null,
    active_tasks: [...(currentState?.active_tasks || [])],
    completed_steps: [...(currentState?.completed_steps || [])],
    blockers: [...(currentState?.blockers || [])],
    open_questions: [...(currentState?.open_questions || [])],
    context_summary: null
  };

  // Detect task completions
  const completionPatterns = [
    /(?:completed|finished|done|valmis|tehty)[:\s]+([^\n.]+)/gi,
    /✅\s*([^\n]+)/g
  ];

  for (const pattern of completionPatterns) {
    let match;
    while ((match = pattern.exec(s)) !== null) {
      const step = String(match[1] || "").trim();
      if (step && step.length > 3 && !updates.completed_steps.includes(step)) {
        updates.completed_steps.push(step);
      }
    }
  }

  // Detect blockers
  const blockerPatterns = [
    /(?:blocked|estyy|ei onnistu|virhe|error)[:\s]+([^\n.]+)/gi,
    /🚫\s*([^\n]+)/g
  ];

  for (const pattern of blockerPatterns) {
    let match;
    while ((match = pattern.exec(s)) !== null) {
      const blocker = String(match[1] || "").trim();
      if (blocker && blocker.length > 3) {
        const exists = updates.blockers.some(b => b.description === blocker);
        if (!exists) {
          updates.blockers.push({
            description: blocker,
            severity: "medium",
            created_at: nowIso()
          });
        }
      }
    }
  }

  // Limit growth
  updates.completed_steps = updates.completed_steps.slice(-20);
  updates.blockers = updates.blockers.slice(-10);
  updates.open_questions = updates.open_questions.slice(-10);

  return updates;
}

module.exports = {
  WORKING_MEMORY_SCOPE,
  SESSION_TTL_SEC,
  generateSessionId,
  validateWorkingMemoryState,
  saveWorkingMemoryState,
  loadWorkingMemoryState,
  clearWorkingMemoryState,
  listRecentWorkingMemorySessions,
  buildWorkingMemoryContext,
  getLatestWorkingMemorySession,
  extractWorkingMemoryUpdates
};