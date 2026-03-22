import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const CIPHER_ALGORITHM = "aes-256-gcm";
const CURRENT_VERSION = "v2";
const HKDF_INFO = "tavern-secrets-v2";
const HKDF_SALT_LENGTH = 16;

export class SecretUnavailableError extends Error {
  readonly code = "secret_unavailable" as const;

  constructor(message = "APP_SECRETS_MASTER_KEY is not configured") {
    super(message);
    this.name = "SecretUnavailableError";
  }
}

export class SecretFormatError extends Error {
  readonly code = "secret_invalid_format" as const;

  constructor(message = "Invalid encrypted secret format") {
    super(message);
    this.name = "SecretFormatError";
  }
}

export function encryptSecret(plain: string, masterKey: string): string {
  if (!masterKey || masterKey.trim().length === 0) {
    throw new SecretUnavailableError();
  }

  const salt = randomBytes(HKDF_SALT_LENGTH);
  const key = deriveKeyV2(masterKey, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    CURRENT_VERSION,
    salt.toString("base64url"),
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(cipherText: string, masterKey: string): string {
  if (!masterKey || masterKey.trim().length === 0) {
    throw new SecretUnavailableError();
  }

  const parts = cipherText.split(":");
  const version = parts[0];

  if (version === "v2") {
    return decryptV2(parts, masterKey);
  }

  if (version === "v1") {
    return decryptV1(parts, masterKey);
  }

  throw new SecretFormatError();
}

export function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return "****";
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 1)}****${secret.slice(-1)}`;
  }

  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

// ── v2: HKDF + salt ──────────────────────────────────────

/** Format: v2:salt:iv:tag:payload (5 segments) */
function decryptV2(parts: string[], masterKey: string): string {
  const [, saltEncoded, ivEncoded, tagEncoded, payloadEncoded, ...rest] = parts;
  if (rest.length > 0 || saltEncoded === undefined || ivEncoded === undefined || tagEncoded === undefined || payloadEncoded === undefined) {
    throw new SecretFormatError();
  }

  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const key = deriveKeyV2(masterKey, salt);
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    const payload = Buffer.from(payloadEncoded, "base64url");

    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const plain = Buffer.concat([decipher.update(payload), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new SecretFormatError();
  }
}

function deriveKeyV2(masterKey: string, salt: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, salt, HKDF_INFO, 32),
  );
}

// ── v1 (legacy): bare SHA-256 ─────────────────────────────

/** Format: v1:iv:tag:payload (4 segments) */
function decryptV1(parts: string[], masterKey: string): string {
  const [, ivEncoded, tagEncoded, payloadEncoded, ...rest] = parts;
  if (rest.length > 0 || ivEncoded === undefined || tagEncoded === undefined || payloadEncoded === undefined) {
    throw new SecretFormatError();
  }

  try {
    const key = deriveKeyV1(masterKey);
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    const payload = Buffer.from(payloadEncoded, "base64url");

    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const plain = Buffer.concat([decipher.update(payload), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new SecretFormatError();
  }
}

/** @deprecated Only used for decrypting legacy v1 ciphertext. New encryptions use HKDF (v2). */
function deriveKeyV1(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}
