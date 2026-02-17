function createMemoryError(code, message, details, cause) {
  const err = new Error(String(message || "Memory error"));
  err.code = String(code || "MEMORY_ERROR");
  if (details && typeof details === "object") err.details = details;
  if (cause) err.cause = cause;
  return err;
}

function toMemoryError(err, fallbackCode, fallbackMessage, fallbackDetails) {
  if (err && typeof err === "object" && typeof err.code === "string") return err;
  return createMemoryError(
    fallbackCode || "MEMORY_ERROR",
    (err && err.message) ? err.message : (fallbackMessage || "Memory error"),
    fallbackDetails,
    err
  );
}

module.exports = {
  createMemoryError,
  toMemoryError
};
