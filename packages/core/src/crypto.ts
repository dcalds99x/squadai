import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts provider API keys at rest with AES-256-GCM.
 *
 * Format: "v1.<iv>.<authTag>.<ciphertext>", each part base64url.
 * The version prefix lets us rotate to envelope encryption (KMS) later
 * without breaking stored secrets.
 */

const VERSION = "v1";
const IV_BYTES = 12;

export function parseMasterKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error("SQUADAI_MASTER_KEY is not set.");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error(`SQUADAI_MASTER_KEY must be 32 bytes in base64 (got ${key.length} bytes).`);
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Unsupported or malformed secret payload.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Shows only the end of a key, like "sk-…a1b2", so people can tell keys apart. */
export function maskSecret(secret: string): string {
  return secret.length <= 4 ? "…" : `…${secret.slice(-4)}`;
}
