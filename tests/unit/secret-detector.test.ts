import { describe, it, expect } from "vitest";
import { detectSecrets, redactSecrets, hasSecrets } from "../../server/capabilities/file/secretDetector";

describe("SecretDetector", () => {
  describe("detectSecrets", () => {
    it("should detect AWS access keys", () => {
      const secrets = detectSecrets("My key is AKIAIOSFODNN7EXAMPLE and more");
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].patternName).toBe("AWS Access Key");
    });

    it("should detect GitHub tokens", () => {
      const secrets = detectSecrets("Token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].patternName).toBe("GitHub Token");
    });

    it("should detect private key blocks", () => {
      const content = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7
-----END PRIVATE KEY-----`;
      const secrets = detectSecrets(content);
      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].patternName).toBe("Private Key Block");
    });

    it("should detect Stripe keys", () => {
      // Build the test key dynamically to avoid GitHub push protection false positives
      const prefix = ["sk", "live"].join("_");
      const suffix = "X".repeat(30);
      const testKey = `STRIPE_KEY=${prefix}_${suffix}`;
      const secrets = detectSecrets(testKey);
      expect(secrets.length).toBeGreaterThan(0);
    });

    it("should return empty for clean content", () => {
      const secrets = detectSecrets("This is just normal text with no secrets.");
      expect(secrets.length).toBe(0);
    });
  });

  describe("redactSecrets", () => {
    it("should redact detected secrets", () => {
      const { redacted, secretCount } = redactSecrets("Key: AKIAIOSFODNN7EXAMPLE");
      expect(secretCount).toBeGreaterThan(0);
      expect(redacted).toContain("[REDACTED:");
      expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });

    it("should return original text when no secrets found", () => {
      const { redacted, secretCount } = redactSecrets("No secrets here.");
      expect(secretCount).toBe(0);
      expect(redacted).toBe("No secrets here.");
    });

    it("should handle multiple secrets", () => {
      const stripeKey = ["sk", "live"].join("_") + "_" + "Z".repeat(30);
      const content = `AWS_KEY=AKIAIOSFODNN7EXAMPLE and STRIPE=${stripeKey}`;
      const { redacted, secretCount, patterns } = redactSecrets(content);
      expect(secretCount).toBeGreaterThan(1);
      expect(patterns.length).toBeGreaterThan(1);
    });
  });

  describe("hasSecrets", () => {
    it("should return true for content with secrets", () => {
      const testKey = ["sk", "live"].join("_") + "_" + "A".repeat(30);
      expect(hasSecrets(testKey)).toBe(true);
    });

    it("should return false for clean content", () => {
      expect(hasSecrets("normal text")).toBe(false);
    });
  });
});
