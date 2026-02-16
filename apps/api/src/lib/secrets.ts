import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const CIPHER_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = "v1";

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

  const key = deriveKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(cipherText: string, masterKey: string): string {
  if (!masterKey || masterKey.trim().length === 0) {
    throw new SecretUnavailableError();
  }

  const [version, ivEncoded, tagEncoded, payloadEncoded, ...rest] = cipherText.split(":");
  if (rest.length > 0 || !version || !ivEncoded || !tagEncoded || !payloadEncoded || version !== ENCRYPTION_VERSION) {
    throw new SecretFormatError();
  }

  try {
    const key = deriveKey(masterKey);
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

export function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return "****";
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 1)}****${secret.slice(-1)}`;
  }

  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey).digest();
}
