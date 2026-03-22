import { describe, expect, it } from "vitest";
import { assertSafeUrl, UrlGuardError } from "../src/lib/url-guard";

describe("url-guard", () => {
  // ── 正常外部 URL 通过 ──────────────────────────────────

  describe("allows external URLs", () => {
    it.each([
      "https://api.openai.com/v1",
      "https://api.anthropic.com/v1",
      "http://custom-proxy.example.com",
      "https://custom-proxy.example.com:8443/api",
      "https://8.8.8.8/dns-query",
    ])("allows %s", (url) => {
      expect(() => assertSafeUrl(url)).not.toThrow();
    });
  });

  // ── 协议校验（始终强制） ────────────────────────────────

  describe("rejects invalid protocols", () => {
    it.each([
      "ftp://example.com",
      "file:///etc/passwd",
      "gopher://example.com",
    ])("rejects %s", (url) => {
      expect(() => assertSafeUrl(url)).toThrow(UrlGuardError);
    });

    it("rejects invalid protocol even with allowPrivateNetwork", () => {
      expect(() => assertSafeUrl("ftp://example.com", { allowPrivateNetwork: true })).toThrow(UrlGuardError);
    });
  });

  // ── 无效 URL ────────────────────────────────────────────

  describe("rejects invalid URLs", () => {
    it("rejects non-URL string", () => {
      expect(() => assertSafeUrl("not-a-url")).toThrow(UrlGuardError);
    });
  });

  // ── 未确认时拒绝内网地址 ─────────────────────────────────

  describe("blocks private addresses without confirmation", () => {
    it.each([
      "http://127.0.0.1",
      "http://127.0.0.1:11434",
      "http://127.255.255.255",
      "http://localhost",
      "http://localhost:8080/v1",
      "http://sub.localhost",
      "http://10.0.0.1",
      "http://10.255.255.255",
      "http://172.16.0.1",
      "http://172.31.255.255",
      "http://192.168.1.1",
      "http://192.168.0.100:3000",
      "http://169.254.1.1",
      "http://0.0.0.0",
    ])("blocks IPv4 private %s", (url) => {
      expect(() => assertSafeUrl(url)).toThrow(UrlGuardError);
    });

    it("blocks IPv6 loopback", () => {
      expect(() => assertSafeUrl("http://[::1]")).toThrow(UrlGuardError);
    });

    it("blocks IPv6 link-local", () => {
      expect(() => assertSafeUrl("http://[fe80::1]")).toThrow(UrlGuardError);
    });

    it("blocks IPv6 unique local", () => {
      expect(() => assertSafeUrl("http://[fd00::1]")).toThrow(UrlGuardError);
    });
  });

  // ── 不拒绝非内网 IPv4 ───────────────────────────────────

  describe("allows non-private IPv4", () => {
    it.each([
      "http://172.15.255.255",   // just below 172.16.0.0/12
      "http://172.32.0.1",       // just above 172.31.255.255
      "http://192.167.1.1",      // not 192.168.x.x
      "http://11.0.0.1",         // not 10.x.x.x
    ])("allows %s", (url) => {
      expect(() => assertSafeUrl(url)).not.toThrow();
    });
  });

  // ── allowPrivateNetwork 确认放行 ────────────────────────

  describe("allows private addresses with confirmation", () => {
    it.each([
      "http://127.0.0.1",
      "http://127.0.0.1:11434",
      "http://localhost",
      "http://localhost:8080/v1",
      "http://10.0.0.1",
      "http://172.16.0.1",
      "http://192.168.1.1",
      "http://192.168.0.100:3000",
      "http://169.254.1.1",
      "http://0.0.0.0",
      "http://[::1]",
      "http://[fe80::1]",
      "http://[fd00::1]",
    ])("allows %s with allowPrivateNetwork", (url) => {
      expect(() => assertSafeUrl(url, { allowPrivateNetwork: true })).not.toThrow();
    });
  });

  // ── 错误对象属性 ────────────────────────────────────────

  describe("UrlGuardError properties", () => {
    it("has correct code and statusCode", () => {
      try {
        assertSafeUrl("http://127.0.0.1");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(UrlGuardError);
        expect((error as UrlGuardError).code).toBe("ssrf_blocked");
        expect((error as UrlGuardError).statusCode).toBe(400);
      }
    });
  });
});
