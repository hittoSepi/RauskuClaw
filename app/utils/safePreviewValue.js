/**
 * Safe JSON Preview Utility
 *
 * Provides safe JSON serialization with truncation for large values.
 * Used to prevent excessive response sizes while preserving meaningful content.
 *
 * This utility is shared between:
 * - app/worker.js (job result formatting)
 * - app/routes/agent_tools.js (tool output formatting)
 */

/**
 * Safe JSON stringify with null fallback
 *
 * @param {*} value - Value to stringify
 * @returns {string|null} JSON string or null on failure
 */
function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Truncate value if too large, returning preview metadata
 *
 * If the JSON serialization exceeds maxChars, returns a truncated
 * preview with metadata about original size.
 *
 * @param {*} value - Value to process
 * @param {number} maxChars - Maximum character limit (default 12000)
 * @returns {*} Original value if under limit, or truncation metadata
 *
 * @example
 * // Small value - returned as-is
 * safePreviewValue({ hello: "world" }) // => { hello: "world" }
 *
 * @example
 * // Large value - truncated
 * safePreviewValue(largeObject, 100)
 * // => { truncated: true, bytes: 54321, preview: "{...100 chars...}" }
 */
function safePreviewValue(value, maxChars = 12000) {
  const raw = safeJsonStringify(value);
  if (!raw) return null;
  if (raw.length <= maxChars) return value;
  return {
    truncated: true,
    bytes: Buffer.byteLength(raw, "utf8"),
    preview: raw.slice(0, maxChars)
  };
}

module.exports = {
  safeJsonStringify,
  safePreviewValue
};
