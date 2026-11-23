import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  encryptCredential,
  decryptCredential,
  getEncryptionMasterKey,
  getLegacyEncryptionKey,
  decryptWithKey,
  maskApiKey,
  migrateStoredAiCredentials,
  getStoredAiProviderConfig,
  getActiveAiRuntimeConfig,
  fetchLiveGroqModels,
  SUPPORTED_GROQ_MODELS,
  AI_PROVIDER_CONFIG_KEY,
} from "@/lib/ai-credential-vault";
import {
  saveAiProviderApiKeyAction,
  switchAiModelAction,
  testAiConnectionAction,
  migrateAiCredentialsAction,
} from "@/actions/ai-provider";
import { syncProviderConfigToEngine, executeApprovedTool } from "@/lib/ai-gateway";
import { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";

const mockPlatformOwner: AuthUser = {
  id: "usr_platform_owner_test",
  name: "Platform Security Auditor",
  email: "platform.auditor@knowletive.com",
  avatarColor: "#2563eb",
  isPlatformOwner: true,
  platformPermissions: ["platform.settings.manage", "platform.overview.read"],
  memberships: [],
};

const mockInstituteOwner: AuthUser = {
  id: "usr_institute_owner_test",
  name: "Institute Admin",
  email: "owner@sunrise.edu",
  avatarColor: "#16a34a",
  isPlatformOwner: false,
  platformPermissions: [],
  memberships: [
    {
      tenantId: "tenant_sunrise",
      tenantName: "Sunrise Public School",
      tenantSlug: "sunrise",
      tenantStatus: "ACTIVE",
      tenantType: "K12",
      roleId: "role_owner",
      roleName: "Owner",
      roleKey: "OWNER",
      isOwner: true,
      permissions: ["students.read", "attendance.read", "fees.read"],
    },
  ],
};

describe("PHASE 3C.2: PROVIDER CREDENTIAL ROTATION & RELEASE HARDENING", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY =
      "2d69450ef731e21746c5b6135824a5ce4ba7224ccea99acb83a64a67817f1118";
    process.env.SESSION_SECRET = "dev-only-session-secret-for-testing-at-least-32chars";
    process.env.COPILOT_ENGINE_URL = "http://localhost:9000";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. DEDICATED ENCRYPTION KEY & REMOVAL OF SESSION_SECRET FALLBACK
  // =========================================================================
  describe("Section 2: Dedicated Encryption Key & Vault Security", () => {
    it("2.1 Rejects derivation and fails closed when AI_CREDENTIALS_ENCRYPTION_KEY is missing", () => {
      delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
      expect(() => getEncryptionMasterKey()).toThrow(
        /FATAL SECURITY VIOLATION: Dedicated AI_CREDENTIALS_ENCRYPTION_KEY must be configured/,
      );
    });

    it("2.2 Rejects derivation when AI_CREDENTIALS_ENCRYPTION_KEY is shorter than 32 characters", () => {
      process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "short_key_123";
      expect(() => getEncryptionMasterKey()).toThrow(
        /FATAL SECURITY VIOLATION: Dedicated AI_CREDENTIALS_ENCRYPTION_KEY must be configured/,
      );
    });

    it("2.3 Successfully encrypts and decrypts credentials using dedicated AES-256-GCM key", () => {
      const plaintext = "gsk_test_credential_rotation_secret_key_12345";
      const encrypted = encryptCredential(plaintext);

      expect(encrypted.iv).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(encrypted.authTag).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(encrypted.ciphertext).toBeTruthy();

      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("2.4 Fails closed on ciphertext tampering or corrupted authentication tag", () => {
      const plaintext = "gsk_tamper_test_secret";
      const encrypted = encryptCredential(plaintext);

      // Corrupt auth tag
      const corruptedTag = {
        ...encrypted,
        authTag: encrypted.authTag.replace(/^../, "ff"),
      };
      expect(() => decryptCredential(corruptedTag)).toThrow();

      // Corrupt IV
      const corruptedIv = {
        ...encrypted,
        iv: encrypted.iv.replace(/^../, "00"),
      };
      expect(() => decryptCredential(corruptedIv)).toThrow();
    });

    it("2.5 Key masking never leaks more than prefix and last 4 characters", () => {
      const key = "gsk_live_secret_rotation_alpha_numeric_9876";
      const masked = maskApiKey(key);
      expect(masked).toBe("gsk_...9876");
      expect(masked).not.toContain("rotation");
    });

    it("2.6 Safe Migration: Re-encrypts legacy SESSION_SECRET credentials with dedicated key", async () => {
      const legacyKey = getLegacyEncryptionKey();
      const legacyRaw = "gsk_legacy_session_secret_credential_test_key_001";

      // Encrypt with legacy key
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", legacyKey, iv);
      let ct = cipher.update(legacyRaw, "utf8", "hex");
      ct += cipher.final("hex");
      const authTag = cipher.getAuthTag().toString("hex");

      const legacyEncrypted = {
        iv: iv.toString("hex"),
        authTag,
        ciphertext: ct,
      };

      // Mock finding legacy record in DB
      const findUniqueSpy = vi.spyOn(db.setting, "findUnique").mockResolvedValueOnce({
        key: AI_PROVIDER_CONFIG_KEY,
        value: {
          version: 1,
          provider: "groq",
          activeModel: "openai/gpt-oss-120b",
          encryptedApiKey: legacyEncrypted,
          status: "ACTIVE",
          history: [],
        } as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const upsertSpy = vi.spyOn(db.setting, "upsert").mockResolvedValueOnce({} as any);

      const migrationResult = await migrateStoredAiCredentials();
      expect(migrationResult.status).toBe("MIGRATED_SUCCESSFULLY");
      expect(migrationResult.migrated).toBe(true);

      // Verify upsert was called with re-encrypted data
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const savedConfig = (upsertSpy.mock.calls[0][0] as any).update.value;
      expect(savedConfig.version).toBe(2);

      // Verify that the new encryptedApiKey decrypts with the dedicated master key
      const reDecrypted = decryptCredential(savedConfig.encryptedApiKey);
      expect(reDecrypted).toBe(legacyRaw);
    });
  });

  // =========================================================================
  // 2. END-TO-END PROVIDER CREDENTIAL ROTATION & VERSION SYNCHRONIZATION
  // =========================================================================
  describe("Section 1: End-to-End Credential Rotation & Microservice Sync", () => {
    it("1.1 Successfully rotates API key, increments version, and pushes sync to Python service", async () => {
      // Mock Groq connection ping
      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        if (url.includes("api.groq.com")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: "pong" } }] }),
          });
        }
        if (url.includes("/api/v1/copilot/provider/sync")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, version: 2, model: "openai/gpt-oss-120b" }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL in test: ${url}`));
      });

      vi.spyOn(db.setting, "findUnique").mockResolvedValue({
        key: AI_PROVIDER_CONFIG_KEY,
        value: {
          version: 1,
          provider: "groq",
          activeModel: "openai/gpt-oss-120b",
          status: "ACTIVE",
          history: [],
        } as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const upsertSpy = vi.spyOn(db.setting, "upsert").mockResolvedValue({} as any);

      const formData = new FormData();
      formData.set("apiKey", "gsk_replacement_verified_key_for_rotation_test_9999");

      const res = await saveAiProviderApiKeyAction({}, formData, mockPlatformOwner);
      expect(res.error).toBeUndefined();
      expect(res.success).toContain("validated and securely activated (v2)");

      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const savedData = (upsertSpy.mock.calls[0][0] as any).update.value;
      expect(savedData.version).toBe(2);
      expect(savedData.keyMask).toBe("gsk_...9999");

      // Verify decrypted key matches input
      const decrypted = decryptCredential(savedData.encryptedApiKey);
      expect(decrypted).toBe("gsk_replacement_verified_key_for_rotation_test_9999");
    });

    it("1.2 Rejects invalid replacement credentials and preserves existing configuration", async () => {
      // Groq ping returns 401 Unauthorized
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("api.groq.com")) {
          return Promise.resolve({
            ok: false,
            status: 401,
            statusText: "Unauthorized",
            json: async () => ({ error: { message: "Invalid API Key provided." } }),
          });
        }
        return Promise.reject(new Error("Unexpected call"));
      });

      const upsertSpy = vi.spyOn(db.setting, "upsert");

      const formData = new FormData();
      formData.set("apiKey", "gsk_invalid_failing_key_12345");

      const res = await saveAiProviderApiKeyAction({}, formData, mockPlatformOwner);
      expect(res.error).toContain("Previous configuration was preserved");
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it("1.3 Handles temporarily unavailable Python service gracefully without failing DB save", async () => {
      // Groq ping succeeds, but Python sync times out / connection refused
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("api.groq.com")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: "pong" } }] }),
          });
        }
        if (url.includes("/api/v1/copilot/provider/sync")) {
          return Promise.reject(new Error("ECONNREFUSED: Python service offline"));
        }
        return Promise.reject(new Error("Unexpected call"));
      });

      vi.spyOn(db.setting, "findUnique").mockResolvedValue({
        key: AI_PROVIDER_CONFIG_KEY,
        value: {
          version: 3,
          provider: "groq",
          activeModel: "openai/gpt-oss-120b",
          status: "ACTIVE",
          history: [],
        } as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const upsertSpy = vi.spyOn(db.setting, "upsert").mockResolvedValue({} as any);

      const formData = new FormData();
      formData.set("apiKey", "gsk_key_saved_while_python_is_down_8888");

      const res = await saveAiProviderApiKeyAction({}, formData, mockPlatformOwner);
      expect(res.error).toBeUndefined();
      expect(res.success).toContain("validated and securely activated (v4)");
      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });

    it("1.4 Dynamic sync helper sends HMAC authentication token and version payload", async () => {
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        capturedHeaders = opts.headers;
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, version: 5 }),
        });
      });

      const syncRes = await syncProviderConfigToEngine({
        provider: "groq",
        apiKey: "gsk_test_sync_key_1111",
        model: "openai/gpt-oss-120b",
        version: 5,
      });

      expect(syncRes.success).toBe(true);
      expect(capturedHeaders["X-Copilot-Service-Token"]).toBeTruthy();
      expect(capturedBody.version).toBe(5);
      expect(capturedBody.model).toBe("openai/gpt-oss-120b");
      // Phase 3C.3/3C.4 security hardening: API key must be envelope-encrypted in transit with HKDF & version AAD, never plaintext
      expect(capturedBody.api_key).toMatch(/^enc:aesgcm:(v\d+:)?[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
      expect(capturedBody.api_key).not.toBe("gsk_test_sync_key_1111");
    });
  });

  // =========================================================================
  // 3. DYNAMIC MODEL SELECTION & GROQ API QUERYING
  // =========================================================================
  describe("Section 6: Dynamic Model Selection & Live Discovery", () => {
    it("3.1 Fetches live models from Groq API and filters out non-chat models", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-oss-120b", active: true },
            { id: "openai/gpt-oss-20b", active: true },
            { id: "qwen/qwen3.8-27b", active: true },
            { id: "whisper-large-v3-turbo", active: true }, // Audio only
            { id: "meta-llama/llama-prompt-guard-2-22m", active: true }, // Guard only
            { id: "experimental-preview-model-v1", active: true }, // Preview
          ],
        }),
      });

      const models = await fetchLiveGroqModels("gsk_mock_key_for_model_query");
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain("openai/gpt-oss-120b");
      expect(modelIds).toContain("openai/gpt-oss-20b");
      expect(modelIds).toContain("qwen/qwen3.8-27b");
      expect(modelIds).not.toContain("whisper-large-v3-turbo");
      expect(modelIds).not.toContain("meta-llama/llama-prompt-guard-2-22m");

      // Verify preview model is tagged
      const preview = models.find((m) => m.id === "experimental-preview-model-v1");
      expect(preview?.isPreview).toBe(true);
    });

    it("3.2 Rejects unauthorized arbitrary model identifiers", async () => {
      const formData = new FormData();
      formData.set("model", "unsupported-dangerous-model-string");

      const res = await switchAiModelAction({}, formData, mockPlatformOwner);
      expect(res.error).toContain("Invalid model selection");
    });

    it("3.3 Successfully switches model, increments version, and notifies engine", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("api.groq.com")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: "pong" } }] }),
          });
        }
        if (url.includes("/api/v1/copilot/provider/sync")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, version: 6 }),
          });
        }
        return Promise.reject(new Error("Unexpected call"));
      });

      vi.spyOn(db.setting, "findUnique").mockResolvedValue({
        key: AI_PROVIDER_CONFIG_KEY,
        value: {
          version: 5,
          provider: "groq",
          activeModel: "openai/gpt-oss-120b",
          status: "ACTIVE",
          history: [],
        } as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const upsertSpy = vi.spyOn(db.setting, "upsert").mockResolvedValue({} as any);

      const formData = new FormData();
      formData.set("model", "openai/gpt-oss-20b");

      const res = await switchAiModelAction({}, formData, mockPlatformOwner);
      expect(res.error).toBeUndefined();
      expect(res.success).toContain("Active model successfully switched to openai/gpt-oss-20b (v6)");

      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const savedConfig = (upsertSpy.mock.calls[0][0] as any).update.value;
      expect(savedConfig.activeModel).toBe("openai/gpt-oss-20b");
      expect(savedConfig.version).toBe(6);
    });
  });

  // =========================================================================
  // 4. PLATFORM-LEVEL DATA AUTHORIZATION & BOUNDARIES
  // =========================================================================
  describe("Section 4: Platform-Level Data Authorization", () => {
    it("4.1 Allows Platform Owner to execute get_platform_metrics with platform.overview.read", async () => {
      const result = await executeApprovedTool(
        "get_platform_metrics",
        {},
        {
          user: mockPlatformOwner,
          tenant: { id: "platform-system", name: "Platform", slug: "platform", status: "ACTIVE" } as any,
          membership: null,
          permissions: new Set(["platform.overview.read"]),
          isOwnerView: true,
          subscriptionBlocked: false,
        },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(typeof data.activeTenants).toBe("number");
        expect(typeof data.totalStudentsAcrossPlatform).toBe("number");
        expect(typeof data.monthlyAiCreditsUsed).toBe("number");
        // Verify zero student PII is exposed
        expect(data.students).toBeUndefined();
        expect(data.parentEmails).toBeUndefined();
      }
    });

    it("4.2 Rejects Institute Owner attempting to execute get_platform_metrics with 403 Forbidden", async () => {
      const result = await executeApprovedTool(
        "get_platform_metrics",
        {},
        {
          user: mockInstituteOwner,
          tenant: { id: "tenant_sunrise", name: "Sunrise Public School", slug: "sunrise", status: "ACTIVE" } as any,
          membership: mockInstituteOwner.memberships[0] as any,
          permissions: new Set(["students.read", "attendance.read"]),
          isOwnerView: true,
          subscriptionBlocked: false,
        },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBeTruthy();
      }
    });

    it("4.3 Rejects Institute Owner attempting to access or modify provider settings", async () => {
      const formData = new FormData();
      formData.set("apiKey", "gsk_illegal_tenant_injection_key");

      await expect(
        saveAiProviderApiKeyAction({}, formData, mockInstituteOwner),
      ).rejects.toThrow(/Forbidden: Missing required platform permission/);
    });
  });
});
