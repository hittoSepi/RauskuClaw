const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signCallbackPayload,
  verifyCallbackSignature,
  getCallbackSigningSettings
} = require("../callback_signing");

const ENV_KEYS = [
  "CALLBACK_SIGNING_ENABLED",
  "CALLBACK_SIGNING_SECRET",
  "CALLBACK_SIGNING_TOLERANCE_SEC"
];

async function withEnv(nextEnv, fn) {
  const prev = {};
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(nextEnv || {})) process.env[k] = String(v);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("sign + verify callback payload succeeds with matching secret/timestamp", () => {
  const payload = JSON.stringify({ id: "job-1", status: "succeeded" });
  const signed = signCallbackPayload(payload, "secret-123", 1_700_000_000);
  const out = verifyCallbackSignature({
    payloadString: payload,
    timestampSec: signed.timestampSec,
    signatureHeader: signed.signature,
    secret: "secret-123",
    toleranceSec: 300,
    nowSec: 1_700_000_050
  });
  assert.equal(out.ok, true);
  assert.equal(out.code, "OK");
});

test("verify fails with signature mismatch", () => {
  const payload = JSON.stringify({ id: "job-1", status: "failed" });
  const signed = signCallbackPayload(payload, "secret-123", 1_700_000_000);
  const out = verifyCallbackSignature({
    payloadString: payload,
    timestampSec: signed.timestampSec,
    signatureHeader: signed.signature,
    secret: "wrong-secret",
    toleranceSec: 300,
    nowSec: 1_700_000_020
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "SIGNATURE_MISMATCH");
});

test("verify fails when timestamp is out of tolerance", () => {
  const payload = JSON.stringify({ id: "job-2", status: "succeeded" });
  const signed = signCallbackPayload(payload, "secret-123", 1_700_000_000);
  const out = verifyCallbackSignature({
    payloadString: payload,
    timestampSec: signed.timestampSec,
    signatureHeader: signed.signature,
    secret: "secret-123",
    toleranceSec: 60,
    nowSec: 1_700_001_000
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "TIMESTAMP_OUT_OF_TOLERANCE");
});

test("getCallbackSigningSettings reads env overrides", async () => {
  await withEnv({
    CALLBACK_SIGNING_ENABLED: "1",
    CALLBACK_SIGNING_SECRET: "env-secret",
    CALLBACK_SIGNING_TOLERANCE_SEC: "123"
  }, async () => {
    const out = getCallbackSigningSettings();
    assert.equal(out.enabled, true);
    assert.equal(out.secret, "env-secret");
    assert.equal(out.secretEnvName, "CALLBACK_SIGNING_SECRET");
    assert.equal(out.toleranceSec, 123);
  });
});
