const SCOPE_RE = /^[a-z0-9._:-]{2,80}$/i;
const KEY_RE = /^[a-z0-9._:-]{2,120}$/i;

export function validateMemoryInput(memory) {
  const enabled = memory?.enabled === true;
  if (!enabled) return "";
  const scope = String(memory?.scope || "").trim();
  if (!scope || !SCOPE_RE.test(scope)) {
    return "Memory scope must match ^[a-z0-9._:-]{2,80}$.";
  }
  const topK = Number(memory?.top_k);
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
    return "Memory top_k must be an integer between 1 and 100.";
  }
  return "";
}

export function validateMemoryWriteInput(memoryWrite) {
  const enabled = memoryWrite?.enabled === true;
  if (!enabled) return "";
  const scope = String(memoryWrite?.scope || "").trim();
  if (!scope || !SCOPE_RE.test(scope)) {
    return "Memory write scope must match ^[a-z0-9._:-]{2,80}$.";
  }
  const key = String(memoryWrite?.key || "").trim();
  if (key && !KEY_RE.test(key)) {
    return "Memory write key must match ^[a-z0-9._:-]{2,120}$.";
  }
  const ttl = memoryWrite?.ttl_sec;
  if (ttl != null && String(ttl).trim() !== "") {
    const n = Number(ttl);
    if (!Number.isInteger(n) || n < 1 || n > 31_536_000) {
      return "Memory write ttl_sec must be an integer between 1 and 31536000.";
    }
  }
  return "";
}

export function buildMemoryInput(memory) {
  if (memory?.enabled !== true) return null;
  const scope = String(memory?.scope || "").trim();
  const query = String(memory?.query || "").trim();
  const topK = Number(memory?.top_k);
  const out = {
    scope,
    top_k: Number.isInteger(topK) ? topK : 5,
    required: memory?.required === true
  };
  if (query) out.query = query;
  return out;
}

export function buildMemoryWriteInput(memoryWrite) {
  if (memoryWrite?.enabled !== true) return null;
  const scope = String(memoryWrite?.scope || "").trim();
  const key = String(memoryWrite?.key || "").trim();
  const ttlRaw = memoryWrite?.ttl_sec;
  const out = {
    scope,
    required: memoryWrite?.required === true
  };
  if (key) out.key = key;
  if (ttlRaw != null && String(ttlRaw).trim() !== "") {
    const ttl = Number(ttlRaw);
    if (Number.isInteger(ttl)) out.ttl_sec = ttl;
  }
  return out;
}

export function parseMemoryWriteStatus({ done, memoryWriteInput }) {
  if (!memoryWriteInput) return null;
  const meta = done?.result?.memory_write;
  if (meta && typeof meta === "object") {
    const scope = String(meta.scope || memoryWriteInput.scope || "").trim();
    const key = String(meta.key || memoryWriteInput.key || "").trim();
    return {
      status: "ok",
      code: "MEMORY_WRITE_OK",
      message: `Saved to ${scope}${key ? `/${key}` : ""}.`
    };
  }
  if (done?.status !== "succeeded") {
    const code = String(done?.error?.code || "MEMORY_WRITE_UNAVAILABLE");
    const msg = String(done?.error?.message || "Required memory write-back failed.");
    return { status: "fail", code, message: msg };
  }
  return {
    status: "unknown",
    code: "MEMORY_WRITE_NOT_CONFIRMED",
    message: "Memory write-back enabled, but result was not confirmed in provider output."
  };
}

export function formatMemoryWriteStatusLabel(statusObj) {
  if (!statusObj || typeof statusObj !== "object") return "";
  const code = String(statusObj.code || "").trim();
  if (statusObj.status === "ok") return "memory write ok";
  if (statusObj.status === "fail") return code ? `memory write failed (${code})` : "memory write failed";
  return "memory write unknown";
}
