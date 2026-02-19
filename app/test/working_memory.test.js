const { describe, it, beforeEach, afterEach } = require("mocha");
const assert = require("assert");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const {
  generateSessionId,
  validateWorkingMemoryState,
  saveWorkingMemoryState,
  loadWorkingMemoryState,
  clearWorkingMemoryState,
  listRecentWorkingMemorySessions,
  buildWorkingMemoryContext,
  getLatestWorkingMemorySession,
  extractWorkingMemoryUpdates,
  WORKING_MEMORY_SCOPE
} = require("../memory/working_memory");

describe("working_memory module", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT,
        tags_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        embedding_status TEXT DEFAULT 'pending',
        embedding_error_json TEXT,
        embedded_at TEXT,
        UNIQUE(scope, key)
      );
    `);
    db.pragma("journal_mode = WAL");
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe("generateSessionId", () => {
    it("generates unique session IDs", () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      assert.match(id1, /^session\.[a-z0-9]+\.[a-f0-9]+$/);
      assert.match(id2, /^session\.[a-z0-9]+\.[a-f0-9]+$/);
      assert.notStrictEqual(id1, id2);
    });
  });

  describe("validateWorkingMemoryState", () => {
    it("validates a minimal state object", () => {
      const validated = validateWorkingMemoryState({});
      assert.strictEqual(validated.current_goal, null);
      assert.deepStrictEqual(validated.active_tasks, []);
      assert.deepStrictEqual(validated.completed_steps, []);
      assert.deepStrictEqual(validated.blockers, []);
      assert.deepStrictEqual(validated.open_questions, []);
      assert.strictEqual(validated.context_summary, null);
    });

    it("validates a full state object", () => {
      const state = {
        current_goal: "Test goal",
        active_tasks: [
          { id: "task-1", description: "Task one", status: "in_progress" }
        ],
        completed_steps: ["Step 1 done"],
        blockers: [{ description: "Blocker one", severity: "high" }],
        open_questions: ["Question one?"],
        context_summary: "Session summary"
      };
      const validated = validateWorkingMemoryState(state);
      assert.strictEqual(validated.current_goal, "Test goal");
      assert.strictEqual(validated.active_tasks.length, 1);
      assert.strictEqual(validated.active_tasks[0].description, "Task one");
      assert.strictEqual(validated.active_tasks[0].status, "in_progress");
      assert.strictEqual(validated.blockers[0].severity, "high");
    });

    it("normalizes invalid task status", () => {
      const state = {
        active_tasks: [{ description: "Task", status: "invalid_status" }]
      };
      const validated = validateWorkingMemoryState(state);
      assert.strictEqual(validated.active_tasks[0].status, "pending");
    });

    it("normalizes invalid blocker severity", () => {
      const state = {
        blockers: [{ description: "Blocker", severity: "critical" }]
      };
      const validated = validateWorkingMemoryState(state);
      assert.strictEqual(validated.blockers[0].severity, "medium");
    });

    it("throws for non-object input", () => {
      assert.throws(() => validateWorkingMemoryState(null), /must be an object/);
      assert.throws(() => validateWorkingMemoryState("string"), /must be an object/);
    });
  });

  describe("saveWorkingMemoryState", () => {
    it("saves working memory state to database", () => {
      const sessionId = generateSessionId();
      const state = {
        current_goal: "Build feature X",
        active_tasks: [{ description: "Write tests", status: "in_progress" }],
        completed_steps: ["Research done"],
        blockers: [],
        open_questions: ["How to handle edge case?"],
        context_summary: "Building feature X"
      };

      const result = saveWorkingMemoryState(db, sessionId, state);
      assert.strictEqual(result.session_id, sessionId);
      assert.ok(result.updated_at);

      const rows = db.prepare("SELECT * FROM memories WHERE scope = ?").all(WORKING_MEMORY_SCOPE);
      assert.strictEqual(rows.length, 7); // 7 components
    });

    it("updates existing session state", () => {
      const sessionId = generateSessionId();
      saveWorkingMemoryState(db, sessionId, { current_goal: "Goal 1" });
      saveWorkingMemoryState(db, sessionId, { current_goal: "Goal 2" });

      const loaded = loadWorkingMemoryState(db, sessionId);
      assert.strictEqual(loaded.current_goal, "Goal 2");
    });

    it("throws for missing session ID", () => {
      assert.throws(
        () => saveWorkingMemoryState(db, "", { current_goal: "Test" }),
        /Session ID is required/
      );
    });
  });

  describe("loadWorkingMemoryState", () => {
    it("returns null for non-existent session", () => {
      const loaded = loadWorkingMemoryState(db, "session.nonexistent");
      assert.strictEqual(loaded, null);
    });

    it("loads saved state correctly", () => {
      const sessionId = generateSessionId();
      const state = {
        current_goal: "Goal",
        active_tasks: [{ description: "Task", status: "pending" }],
        completed_steps: ["Step 1"],
        blockers: [{ description: "Blocker", severity: "medium" }],
        open_questions: ["Question?"],
        context_summary: "Summary"
      };
      saveWorkingMemoryState(db, sessionId, state);

      const loaded = loadWorkingMemoryState(db, sessionId);
      assert.strictEqual(loaded.session_id, sessionId);
      assert.strictEqual(loaded.current_goal, "Goal");
      assert.strictEqual(loaded.active_tasks.length, 1);
      assert.strictEqual(loaded.active_tasks[0].description, "Task");
      assert.deepStrictEqual(loaded.completed_steps, ["Step 1"]);
      assert.strictEqual(loaded.blockers.length, 1);
      assert.deepStrictEqual(loaded.open_questions, ["Question?"]);
      assert.strictEqual(loaded.context_summary, "Summary");
    });
  });

  describe("clearWorkingMemoryState", () => {
    it("clears session state", () => {
      const sessionId = generateSessionId();
      saveWorkingMemoryState(db, sessionId, { current_goal: "Test" });

      const result = clearWorkingMemoryState(db, sessionId);
      assert.strictEqual(result.deleted, 7);

      const loaded = loadWorkingMemoryState(db, sessionId);
      assert.strictEqual(loaded, null);
    });

    it("returns 0 for non-existent session", () => {
      const result = clearWorkingMemoryState(db, "session.nonexistent");
      assert.strictEqual(result.deleted, 0);
    });
  });

  describe("listRecentWorkingMemorySessions", () => {
    it("returns empty array when no sessions exist", () => {
      const sessions = listRecentWorkingMemorySessions(db, 10);
      assert.deepStrictEqual(sessions, []);
    });

    it("lists recent sessions sorted by updated_at", async () => {
      const session1 = generateSessionId();
      const session2 = generateSessionId();
      const session3 = generateSessionId();

      saveWorkingMemoryState(db, session1, { current_goal: "Goal 1" });
      await new Promise(r => setTimeout(r, 50));
      saveWorkingMemoryState(db, session2, { current_goal: "Goal 2" });
      await new Promise(r => setTimeout(r, 50));
      saveWorkingMemoryState(db, session3, { current_goal: "Goal 3" });

      const sessions = listRecentWorkingMemorySessions(db, 10);
      assert.strictEqual(sessions.length, 3);
      assert.strictEqual(sessions[0].session_id, session3);
      assert.strictEqual(sessions[1].session_id, session2);
      assert.strictEqual(sessions[2].session_id, session1);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 15; i++) {
        saveWorkingMemoryState(db, generateSessionId(), { current_goal: `Goal ${i}` });
      }
      const sessions = listRecentWorkingMemorySessions(db, 5);
      assert.strictEqual(sessions.length, 5);
    });
  });

  describe("buildWorkingMemoryContext", () => {
    it("returns null for null state", () => {
      const context = buildWorkingMemoryContext(null);
      assert.strictEqual(context, null);
    });

    it("builds context string from state", () => {
      const state = {
        session_id: "session.test",
        current_goal: "Build feature",
        active_tasks: [
          { description: "Write tests", status: "in_progress" },
          { description: "Implement feature", status: "pending" }
        ],
        completed_steps: ["Research", "Design"],
        blockers: [{ description: "API unavailable", severity: "high" }],
        open_questions: ["How to handle errors?"],
        context_summary: "Building feature X"
      };
      const context = buildWorkingMemoryContext(state);
      assert.ok(context.includes("Current working memory state"));
      assert.ok(context.includes("Current Goal:** Build feature"));
      assert.ok(context.includes("Active Tasks:"));
      assert.ok(context.includes("Write tests"));
      assert.ok(context.includes("Completed Steps:"));
      assert.ok(context.includes("Research"));
      assert.ok(context.includes("Blockers:"));
      assert.ok(context.includes("API unavailable"));
      assert.ok(context.includes("Open Questions:"));
      assert.ok(context.includes("Session Summary:** Building feature X"));
    });
  });

  describe("getLatestWorkingMemorySession", () => {
    it("returns null when no sessions exist", () => {
      const latest = getLatestWorkingMemorySession(db);
      assert.strictEqual(latest, null);
    });

    it("returns the most recently updated session", async () => {
      const session1 = generateSessionId();
      const session2 = generateSessionId();

      saveWorkingMemoryState(db, session1, { current_goal: "Goal 1" });
      await new Promise(r => setTimeout(r, 50));
      saveWorkingMemoryState(db, session2, { current_goal: "Goal 2" });

      const latest = getLatestWorkingMemorySession(db);
      assert.strictEqual(latest.session_id, session2);
      assert.strictEqual(latest.current_goal, "Goal 2");
    });
  });

  describe("extractWorkingMemoryUpdates", () => {
    it("returns null for empty text", () => {
      const updates = extractWorkingMemoryUpdates("", {});
      assert.strictEqual(updates, null);
    });

    it("extracts completed steps from text", () => {
      const text = "I have completed the initial setup and ready for next step.";
      const updates = extractWorkingMemoryUpdates(text, {});
      assert.ok(updates.completed_steps.some(s => s.includes("initial setup")));
    });

    it("extracts blockers from text", () => {
      const text = "Progress blocked: API key missing for the service.";
      const updates = extractWorkingMemoryUpdates(text, {});
      assert.ok(updates.blockers.some(b => b.description.includes("API key missing")));
    });

    it("preserves existing state values", () => {
      const currentState = {
        current_goal: "Existing goal",
        active_tasks: [{ description: "Task 1", status: "pending" }],
        completed_steps: ["Previous step"],
        blockers: [],
        open_questions: ["Existing question"]
      };
      const text = "Completed: new task implementation";
      const updates = extractWorkingMemoryUpdates(text, currentState);
      assert.strictEqual(updates.current_goal, "Existing goal");
      assert.strictEqual(updates.active_tasks.length, 1);
      assert.ok(updates.completed_steps.includes("Previous step"));
    });
  });
});