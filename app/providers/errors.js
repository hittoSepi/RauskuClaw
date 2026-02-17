function createProviderError(code, message, details, cause) {
  const err = new Error(String(message || "Provider error"));
  err.code = String(code || "PROVIDER_ERROR");
  if (details && typeof details === "object") err.details = details;
  if (cause) err.cause = cause;
  return err;
}

function toProviderError(err, fallbackCode, fallbackMessage, fallbackDetails) {
  if (err && typeof err === "object" && typeof err.code === "string") return err;
  return createProviderError(
    fallbackCode || "PROVIDER_ERROR",
    (err && err.message) ? err.message : (fallbackMessage || "Provider error"),
    fallbackDetails,
    err
  );
}

module.exports = {
  createProviderError,
  toProviderError
};
