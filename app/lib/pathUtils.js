const path = require("path");

/**
 * Check if a candidate path is inside a parent directory.
 * @param {string} parent - The parent directory path
 * @param {string} candidate - The candidate path to check
 * @returns {boolean} True if candidate is inside parent, false otherwise
 */
function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Validate a workspace path and return badRequest if invalid.
 * This helper preserves the exact same validation logic and response shape as the original.
 *
 * @param {Object} params - Validation parameters
 * @param {Object} params.res - Express response object
 * @param {string} params.rawPath - The raw path input to validate
 * @param {string} params.workspaceRoot - The workspace root directory
 * @param {Function} params.badRequest - badRequest helper function
 * @param {string} [params.fieldName="path"] - Field name for error messages
 * @returns {{rel: string, abs: string}|null} Path object if valid, null if badRequest was called
 */
function validateWorkspacePathOrBadRequest({ res, rawPath, workspaceRoot, badRequest, fieldName = "path" }) {
  const p = String(rawPath || "").trim();
  if (!p) {
    badRequest(res, "VALIDATION_ERROR", `Missing '${fieldName}'.`);
    return null;
  }
  const abs = path.resolve(workspaceRoot, p);
  if (!isPathInside(workspaceRoot, abs)) {
    badRequest(res, "VALIDATION_ERROR", `Requested ${fieldName} escapes workspace root.`);
    return null;
  }
  return { rel: p, abs };
}

module.exports = {
  isPathInside,
  validateWorkspacePathOrBadRequest
};
