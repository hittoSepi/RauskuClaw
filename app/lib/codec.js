/**
 * Decode a base64 payload into a Buffer.
 * This helper preserves the exact same validation logic and error behavior as the original.
 *
 * @param {string} raw - The raw base64 string to decode
 * @returns {Buffer} Decoded buffer
 * @throws {Error} If payload is empty or invalid base64
 */
function decodeBase64Payload(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("Empty base64 payload");
  try {
    return Buffer.from(s, "base64");
  } catch (e) {
    throw new Error("Invalid base64 payload");
  }
}

module.exports = {
  decodeBase64Payload
};
