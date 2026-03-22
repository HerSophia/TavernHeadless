import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret, SecretFormatError, SecretUnavailableError } from "../src/lib/secrets";

// ── 辅助：生成 v1 格式密文（模拟旧版加密行为） ──────────

function encryptSecretV1(plain: string, masterKey: string): string {
  const key = createHash("sha256").update(masterKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

// ── 测试 ──────────────────────────────────────────────────

describe("secrets", () => {
  const masterKey = "test-master-key-for-secrets";

  // ── v2 加密/解密 ────────────────────────────────────────

  describe("v2 encrypt → decrypt round-trip", () => {
    it("encrypts and decrypts a normal string", () => {
      const plain = "sk-abc123-secret-api-key";
      const cipher = encryptSecret(plain, masterKey);
      const result = decryptSecret(cipher, masterKey);
      expect(result).toBe(plain);
    });

    it("encrypts and decrypts an empty string", () => {
      const cipher = encryptSecret("", masterKey);
      const result = decryptSecret(cipher, masterKey);
      expect(result).toBe("");
    });

    it("encrypts and decrypts a long string", () => {
      const plain = "x".repeat(10000);
      const cipher = encryptSecret(plain, masterKey);
      const result = decryptSecret(cipher, masterKey);
      expect(result).toBe(plain);
    });

    it("encrypts and decrypts unicode content", () => {
      const plain = "密钥🔑こんにちは";
      const cipher = encryptSecret(plain, masterKey);
      const result = decryptSecret(cipher, masterKey);
      expect(result).toBe(plain);
    });

    it("produces v2 format ciphertext", () => {
      const cipher = encryptSecret("test", masterKey);
      expect(cipher.startsWith("v2:")).toBe(true);
      // v2 format: v2:salt:iv:tag:payload → 5 segments
      expect(cipher.split(":").length).toBe(5);
    });

    it("produces different ciphertext for the same plaintext (salt randomness)", () => {
      const plain = "same-secret";
      const cipher1 = encryptSecret(plain, masterKey);
      const cipher2 = encryptSecret(plain, masterKey);
      expect(cipher1).not.toBe(cipher2);
      // Both should decrypt to the same value
      expect(decryptSecret(cipher1, masterKey)).toBe(plain);
      expect(decryptSecret(cipher2, masterKey)).toBe(plain);
    });
  });

  // ── v1 向后兼容 ──────────────────────────────────────────

  describe("v1 backward compatibility", () => {
    it("decrypts a v1 ciphertext with the new code", () => {
      const plain = "sk-legacy-key-12345";
      const v1Cipher = encryptSecretV1(plain, masterKey);
      expect(v1Cipher.startsWith("v1:")).toBe(true);
      expect(v1Cipher.split(":").length).toBe(4);

      const result = decryptSecret(v1Cipher, masterKey);
      expect(result).toBe(plain);
    });

    it("decrypts a v1 empty string", () => {
      const v1Cipher = encryptSecretV1("", masterKey);
      const result = decryptSecret(v1Cipher, masterKey);
      expect(result).toBe("");
    });
  });

  // ── 解密失败场景 ─────────────────────────────────────────

  describe("decryption failures", () => {
    it("throws SecretFormatError when decrypting v2 with wrong masterKey", () => {
      const cipher = encryptSecret("secret", masterKey);
      expect(() => decryptSecret(cipher, "wrong-key")).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError when decrypting v1 with wrong masterKey", () => {
      const cipher = encryptSecretV1("secret", masterKey);
      expect(() => decryptSecret(cipher, "wrong-key")).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError for unknown version", () => {
      expect(() => decryptSecret("v3:aaa:bbb:ccc:ddd", masterKey)).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError for malformed v2 (missing segments)", () => {
      expect(() => decryptSecret("v2:salt:iv", masterKey)).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError for malformed v1 (missing segments)", () => {
      expect(() => decryptSecret("v1:iv", masterKey)).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError for v2 with extra segments", () => {
      expect(() => decryptSecret("v2:a:b:c:d:e", masterKey)).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError for v1 with extra segments", () => {
      expect(() => decryptSecret("v1:a:b:c:d", masterKey)).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError for completely invalid input", () => {
      expect(() => decryptSecret("not-a-valid-cipher", masterKey)).toThrow(SecretFormatError);
    });

    it("throws SecretFormatError for empty string", () => {
      expect(() => decryptSecret("", masterKey)).toThrow(SecretFormatError);
    });
  });

  // ── masterKey 校验 ──────────────────────────────────────

  describe("masterKey validation", () => {
    it("throws SecretUnavailableError when encrypting with empty masterKey", () => {
      expect(() => encryptSecret("secret", "")).toThrow(SecretUnavailableError);
    });

    it("throws SecretUnavailableError when encrypting with whitespace-only masterKey", () => {
      expect(() => encryptSecret("secret", "   ")).toThrow(SecretUnavailableError);
    });

    it("throws SecretUnavailableError when decrypting with empty masterKey", () => {
      const cipher = encryptSecret("secret", masterKey);
      expect(() => decryptSecret(cipher, "")).toThrow(SecretUnavailableError);
    });
  });

  // ── maskSecret ──────────────────────────────────────────

  describe("maskSecret", () => {
    it("masks short secrets (<=4 chars)", () => {
      expect(maskSecret("abc")).toBe("****");
      expect(maskSecret("abcd")).toBe("****");
    });

    it("masks medium secrets (5-8 chars)", () => {
      expect(maskSecret("abcde")).toBe("a****e");
      expect(maskSecret("abcdefgh")).toBe("a****h");
    });

    it("masks long secrets (>8 chars)", () => {
      expect(maskSecret("sk-abc123def")).toBe("sk-a****3def");
    });
  });
});
