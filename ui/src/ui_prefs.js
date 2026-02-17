import { api } from "./api.js";

const KEY_DEV_MODE = "rauskuclaw_ui_dev_mode";
const KEY_CHAT_MEMORY_DEFAULT = "rauskuclaw_chat_memory_default_enabled";
const KEY_CHAT_MEMORY_WRITE_DEFAULT = "rauskuclaw_chat_memory_write_default_enabled";
const KEY_SUGGESTED_APPROVAL_MODE = "rauskuclaw_suggested_approval_mode";
const KEY_SUGGESTED_AUTO_MAX_TIMEOUT_SEC = "rauskuclaw_suggested_auto_max_timeout_sec";
const KEY_SUGGESTED_AUTO_MAX_ATTEMPTS = "rauskuclaw_suggested_auto_max_attempts";
const KEY_SUGGESTED_AUTO_MAX_PRIORITY = "rauskuclaw_suggested_auto_max_priority";
const KEY_SUGGESTED_AUTO_ALLOW_TYPES = "rauskuclaw_suggested_auto_allow_types";
const PREFS_SCOPE = "default";

let persistTimer = null;
let persistInFlight = false;
let persistQueued = false;

function readBool(key, fallback = false) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  try {
    sessionStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

function readString(key, fallback = "") {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return String(raw);
  } catch {
    return fallback;
  }
}

function writeString(key, value) {
  try {
    sessionStorage.setItem(key, String(value ?? ""));
  } catch {}
}

function readInt(key, fallback) {
  const raw = readString(key, "");
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

function normalizeApprovalMode(mode) {
  const v = String(mode || "").trim();
  return (v === "always" || v === "never" || v === "smart") ? v : "smart";
}

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePrefs(input = {}) {
  return {
    devMode: input.devMode === true,
    chatMemoryDefaultEnabled: input.chatMemoryDefaultEnabled !== false,
    chatMemoryWriteDefaultEnabled: input.chatMemoryWriteDefaultEnabled === true,
    suggestedApprovalMode: normalizeApprovalMode(input.suggestedApprovalMode),
    suggestedAutoMaxTimeoutSec: clampInt(input.suggestedAutoMaxTimeoutSec, { min: 1, max: 3600, fallback: 30 }),
    suggestedAutoMaxAttempts: clampInt(input.suggestedAutoMaxAttempts, { min: 1, max: 10, fallback: 1 }),
    suggestedAutoMaxPriority: clampInt(input.suggestedAutoMaxPriority, { min: 0, max: 10, fallback: 5 }),
    suggestedAutoAllowTypes: String(input.suggestedAutoAllowTypes || "report.generate,memory.write")
  };
}

function readSessionPrefs() {
  return normalizePrefs({
    devMode: readBool(KEY_DEV_MODE, false),
    chatMemoryDefaultEnabled: readBool(KEY_CHAT_MEMORY_DEFAULT, true),
    chatMemoryWriteDefaultEnabled: readBool(KEY_CHAT_MEMORY_WRITE_DEFAULT, false),
    suggestedApprovalMode: readString(KEY_SUGGESTED_APPROVAL_MODE, "smart"),
    suggestedAutoMaxTimeoutSec: readInt(KEY_SUGGESTED_AUTO_MAX_TIMEOUT_SEC, 30),
    suggestedAutoMaxAttempts: readInt(KEY_SUGGESTED_AUTO_MAX_ATTEMPTS, 1),
    suggestedAutoMaxPriority: readInt(KEY_SUGGESTED_AUTO_MAX_PRIORITY, 5),
    suggestedAutoAllowTypes: readString(KEY_SUGGESTED_AUTO_ALLOW_TYPES, "report.generate,memory.write")
  });
}

function writeSessionPrefs(prefs) {
  const p = normalizePrefs(prefs);
  writeBool(KEY_DEV_MODE, p.devMode);
  writeBool(KEY_CHAT_MEMORY_DEFAULT, p.chatMemoryDefaultEnabled);
  writeBool(KEY_CHAT_MEMORY_WRITE_DEFAULT, p.chatMemoryWriteDefaultEnabled);
  writeString(KEY_SUGGESTED_APPROVAL_MODE, p.suggestedApprovalMode);
  writeString(KEY_SUGGESTED_AUTO_MAX_TIMEOUT_SEC, p.suggestedAutoMaxTimeoutSec);
  writeString(KEY_SUGGESTED_AUTO_MAX_ATTEMPTS, p.suggestedAutoMaxAttempts);
  writeString(KEY_SUGGESTED_AUTO_MAX_PRIORITY, p.suggestedAutoMaxPriority);
  writeString(KEY_SUGGESTED_AUTO_ALLOW_TYPES, p.suggestedAutoAllowTypes);
}

async function flushPersist() {
  if (persistInFlight) {
    persistQueued = true;
    return;
  }
  persistInFlight = true;
  try {
    const prefs = readSessionPrefs();
    await api.saveUiPrefs(PREFS_SCOPE, prefs);
  } catch {
    // Keep session-local copy as fallback when API save fails.
  } finally {
    persistInFlight = false;
    if (persistQueued) {
      persistQueued = false;
      void flushPersist();
    }
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist();
  }, 250);
}

function updateAndPersist(mutator) {
  const current = readSessionPrefs();
  const nextRaw = typeof mutator === "function" ? mutator(current) : current;
  const next = normalizePrefs(nextRaw);
  writeSessionPrefs(next);
  schedulePersist();
}

export function getUiPrefs() {
  return readSessionPrefs();
}

export async function loadUiPrefsFromApi() {
  try {
    const out = await api.uiPrefs(PREFS_SCOPE);
    const prefs = normalizePrefs(out?.prefs || {});
    writeSessionPrefs(prefs);
    return prefs;
  } catch {
    return readSessionPrefs();
  }
}

export function setDevModeEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, devMode: enabled === true }));
}

export function setChatMemoryDefaultEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, chatMemoryDefaultEnabled: enabled === true }));
}

export function setChatMemoryWriteDefaultEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, chatMemoryWriteDefaultEnabled: enabled === true }));
}

export function setSuggestedApprovalMode(mode) {
  updateAndPersist((p) => ({ ...p, suggestedApprovalMode: normalizeApprovalMode(mode) }));
}

export function setSuggestedAutoMaxTimeoutSec(value) {
  updateAndPersist((p) => ({
    ...p,
    suggestedAutoMaxTimeoutSec: clampInt(value, { min: 1, max: 3600, fallback: 30 })
  }));
}

export function setSuggestedAutoMaxAttempts(value) {
  updateAndPersist((p) => ({
    ...p,
    suggestedAutoMaxAttempts: clampInt(value, { min: 1, max: 10, fallback: 1 })
  }));
}

export function setSuggestedAutoMaxPriority(value) {
  updateAndPersist((p) => ({
    ...p,
    suggestedAutoMaxPriority: clampInt(value, { min: 0, max: 10, fallback: 5 })
  }));
}

export function setSuggestedAutoAllowTypes(value) {
  updateAndPersist((p) => ({ ...p, suggestedAutoAllowTypes: String(value || "") }));
}
