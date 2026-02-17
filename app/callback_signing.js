const crypto = require("crypto");
const { getConfig } = require("./config");

const HEADER_TIMESTAMP = "x-rauskuclaw-timestamp";
const HEADER_SIGNATURE = "x-rauskuclaw-signature";
const HEADER_SIGNATURE_VERSION = "v1";

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function getCallbackSigningSettings() {
  const enabled = process.env.CALLBACK_SIGNING_ENABLED != null
    ? process.env.CALLBACK_SIGNING_ENABLED === "1"
    : Boolean(getConfig("callbacks.signing.enabled", false));
  const secretEnvName = String(getConfig("callbacks.signing.secret_env", "CALLBACK_SIGNING_SECRET")).trim() || "CALLBACK_SIGNING_SECRET";
  const secret = String(process.env[secretEnvName] || "").trim();
  const toleranceSec = process.env.CALLBACK_SIGNING_TOLERANCE_SEC != null
    ? parsePositiveInt(process.env.CALLBACK_SIGNING_TOLERANCE_SEC, 300)
    : parsePositiveInt(getConfig("callbacks.signing.tolerance_sec", 300), 300);

  return {
    enabled,
    secretEnvName,
    secret,
    toleranceSec
  };
}

function buildSigningInput(timestampSec, payloadString) {
  return `${String(timestampSec)}.${String(payloadString)}`;
}

function signCallbackPayload(payloadString, secret, timestampSec) {
  const ts = Number.isFinite(Number(timestampSec))
    ? Math.floor(Number(timestampSec))
    : Math.floor(Date.now() / 1000);
  const data = buildSigningInput(ts, payloadString);
  const digest = crypto.createHmac("sha256", String(secret || "")).update(data).digest("hex");
  return { timestampSec: ts, signature: `${HEADER_SIGNATURE_VERSION}=${digest}` };
}

function timingSafeEqualHex(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyCallbackSignature({ payloadString, timestampSec, signatureHeader, secret, toleranceSec = 300, nowSec } = {}) {
  const ts = parsePositiveInt(timestampSec, 0);
  if (ts < 1) return { ok: false, code: "INVALID_TIMESTAMP" };

  const sigRaw = String(signatureHeader || "").trim();
  const expectedPrefix = `${HEADER_SIGNATURE_VERSION}=`;
  if (!sigRaw.startsWith(expectedPrefix)) return { ok: false, code: "INVALID_SIGNATURE_FORMAT" };
  const receivedHex = sigRaw.slice(expectedPrefix.length).trim();
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return { ok: false, code: "INVALID_SIGNATURE_FORMAT" };

  const signed = signCallbackPayload(payloadString, secret, ts);
  const expectedHex = signed.signature.slice(expectedPrefix.length);
  if (!timingSafeEqualHex(receivedHex.toLowerCase(), expectedHex.toLowerCase())) {
    return { ok: false, code: "SIGNATURE_MISMATCH" };
  }

  const current = Number.isFinite(Number(nowSec)) ? Math.floor(Number(nowSec)) : Math.floor(Date.now() / 1000);
  const tolerance = parsePositiveInt(toleranceSec, 300);
  if (Math.abs(current - ts) > tolerance) {
    return { ok: false, code: "TIMESTAMP_OUT_OF_TOLERANCE" };
  }

  return { ok: true, code: "OK" };
}

module.exports = {
  HEADER_TIMESTAMP,
  HEADER_SIGNATURE,
  HEADER_SIGNATURE_VERSION,
  getCallbackSigningSettings,
  signCallbackPayload,
  verifyCallbackSignature
};
