import "server-only";

import crypto from "crypto";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const AI_PROVIDER_CONFIG_KEY = "ai_provider_config";

export interface EncryptedCredential {
  iv: string; // Hex-encoded 12-byte initialization vector
  authTag: string; // Hex-encoded 16-byte authentication tag
  ciphertext: string; // Hex-encoded ciphertext
}

export interface AiProviderAuditEntry {
  timestamp: string;
  actorId: string;
  actorName: string;
  action: "KEY_REPLACED" | "MODEL_SWITCHED" | "CONFIG_UPDATED" | "CONNECTION_TEST";
  previousModel?: string;
  newModel?: string;
  provider: string;
  testResult: "SUCCESS" | "FAILED";
  testMessage?: string;
}

export interface StoredAiProviderConfig {
  version: number; // Monotonically increasing configuration version
  provider: "groq";
  activeModel: string;
  encryptedApiKey?: EncryptedCredential;
  keyMask?: string; // e.g. "gsk_...3a" or "configured"
  status: "ACTIVE" | "TESTING" | "ERROR" | "UNCONFIGURED";
  lastTestStatus?: "SUCCESS" | "FAILED";
  lastTestMessage?: string;
  lastTestedAt?: string;
  updatedAt?: string;
  updatedBy?: { id: string; name: string };
  history: AiProviderAuditEntry[];
}

export interface SafeAiProviderStatus {
  version: number;
  provider: "groq";
  activeModel: string;
  isKeyConfigured: boolean;
  keyMask: string | null;
  status: "ACTIVE" | "TESTING" | "ERROR" | "UNCONFIGURED";
  lastTestStatus?: "SUCCESS" | "FAILED";
  lastTestMessage?: string;
  lastTestedAt?: string;
  updatedAt?: string;
  supportedModels: Array<{ id: string; name: string; isPreview: boolean; recommended: boolean }>;
}

export interface GroqModelOption {
  id: string;
  name: string;
  isChatCapable: boolean;
  isPreview: boolean;
  recommended: boolean;
}

/** Supported and verified models for Groq tool-calling and token streaming */
export const SUPPORTED_GROQ_MODELS = [
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Flagship — Function Calling & Streaming)", recommended: true, isPreview: false },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B (Fast — Function Calling & Streaming)", recommended: false, isPreview: false },
  { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B (General Chat & Streaming)", recommended: false, isPreview: false },
] as const;

/**
 * Derives a secure 32-byte AES-256 encryption key strictly from AI_CREDENTIALS_ENCRYPTION_KEY.
 * Fails closed if the dedicated encryption key is missing or shorter than 32 characters.
 * Silently deriving from SESSION_SECRET has been removed for production security.
 */
export function getEncryptionMasterKey(): Buffer {
  const envKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  if (!envKey || envKey.trim().length < 32) {
    throw new Error(
      "FATAL SECURITY VIOLATION: Dedicated AI_CREDENTIALS_ENCRYPTION_KEY must be configured with at least 32 characters (e.g. 64-character hex string). Automatic fallback to SESSION_SECRET has been removed.",
    );
  }
  return crypto.scryptSync(envKey.trim(), "knowletive_ai_salt_vault", 32);
}

/**
 * Returns the legacy key derivation used prior to Phase 3C.2, solely for one-time safe migration.
 */
export function getLegacyEncryptionKey(): Buffer {
  const fallbackSecret =
    process.env.SESSION_SECRET ||
    process.env.AI_SERVICE_SECRET ||
    "dev-only-master-encryption-key-fallback-32chars!";
  return crypto.scryptSync(fallbackSecret, "knowletive_ai_master_salt", 32);
}

/**
 * Decrypts with an explicitly supplied Buffer key.
 */
export function decryptWithKey(encrypted: EncryptedCredential, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));

  let decrypted = decipher.update(encrypted.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Encrypts a sensitive plaintext string using AES-256-GCM authenticated encryption.
 */
export function encryptCredential(plaintext: string): EncryptedCredential {
  const key = getEncryptionMasterKey();
  const iv = crypto.randomBytes(12); // Standard 12-byte IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    iv: iv.toString("hex"),
    authTag,
    ciphertext,
  };
}

/**
 * Decrypts an AES-256-GCM encrypted credential back to plaintext using dedicated master key.
 * Fails closed if the ciphertext has been tampered with or key is invalid.
 */
export function decryptCredential(encrypted: EncryptedCredential): string {
  const key = getEncryptionMasterKey();
  return decryptWithKey(encrypted, key);
}

/**
 * Safe migration function:
 * Checks if stored credentials can be decrypted with the dedicated key.
 * If not, attempts legacy decryption; if successful, re-encrypts with the dedicated key,
 * verifies decryption, and commits the updated record to the database.
 */
export async function migrateStoredAiCredentials(): Promise<{
  migrated: boolean;
  status: "ALREADY_DEDICATED" | "MIGRATED_SUCCESSFULLY" | "NO_CONFIG" | "FAILED";
  error?: string;
}> {
  const record = db.setting
    ? await db.setting.findUnique({
        where: { key: AI_PROVIDER_CONFIG_KEY },
      }).catch(() => null)
    : null;

  if (!record || !record.value || typeof record.value !== "object") {
    return { migrated: false, status: "NO_CONFIG" };
  }

  const data = record.value as unknown as StoredAiProviderConfig;
  if (!data.encryptedApiKey) {
    return { migrated: false, status: "NO_CONFIG" };
  }

  // 1. Test if already decryptable with dedicated key
  try {
    const key = getEncryptionMasterKey();
    const plaintext = decryptWithKey(data.encryptedApiKey, key);
    if (plaintext && plaintext.startsWith("gsk_")) {
      return { migrated: false, status: "ALREADY_DEDICATED" };
    }
  } catch {
    // Dedicated key failed; attempt legacy migration
  }

  // 2. Attempt legacy decryption
  try {
    const legacyKey = getLegacyEncryptionKey();
    const legacyPlaintext = decryptWithKey(data.encryptedApiKey, legacyKey);
    if (!legacyPlaintext || !legacyPlaintext.trim()) {
      return { migrated: false, status: "FAILED", error: "Legacy decryption yielded empty string." };
    }

    // 3. Re-encrypt with dedicated key
    const newEncrypted = encryptCredential(legacyPlaintext);

    // 4. Verify round-trip decryption with dedicated key
    const verifyPlaintext = decryptCredential(newEncrypted);
    if (verifyPlaintext !== legacyPlaintext) {
      return { migrated: false, status: "FAILED", error: "Integrity check failed: re-encrypted plaintext does not match." };
    }

    // 5. Persist migrated record preserving all audit history
    const updatedConfig: StoredAiProviderConfig = {
      ...data,
      encryptedApiKey: newEncrypted,
      version: (data.version || 1) + 1,
      updatedAt: new Date().toISOString(),
      history: [
        {
          timestamp: new Date().toISOString(),
          actorId: "system-migration",
          actorName: "Credential Vault Migration (Phase 3C.2)",
          action: "CONFIG_UPDATED",
          provider: data.provider || "groq",
          testResult: "SUCCESS",
          testMessage: "Successfully migrated encryption from legacy SESSION_SECRET fallback to dedicated AI_CREDENTIALS_ENCRYPTION_KEY.",
        },
        ...(data.history || []),
      ],
    };

    await db.setting.upsert({
      where: { key: AI_PROVIDER_CONFIG_KEY },
      create: {
        key: AI_PROVIDER_CONFIG_KEY,
        value: updatedConfig as any,
      },
      update: {
        value: updatedConfig as any,
      },
    });

    return { migrated: true, status: "MIGRATED_SUCCESSFULLY" };
  } catch (err) {
    return {
      migrated: false,
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Creates a safe, non-revealing mask of an API key (e.g., "gsk_...a1b2").
 * Never reveals more than prefix and last 4 characters.
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 10) return "Configured";
  const prefix = key.startsWith("gsk_") ? "gsk_..." : key.slice(0, 4) + "...";
  const suffix = key.slice(-4);
  return `${prefix}${suffix}`;
}

/**
 * Retrieves the stored database AI provider configuration, or returns bootstrap defaults.
 */
export async function getStoredAiProviderConfig(): Promise<StoredAiProviderConfig> {
  const record = db.setting
    ? await db.setting.findUnique({
        where: { key: AI_PROVIDER_CONFIG_KEY },
      }).catch(() => null)
    : null;

  if (!record || !record.value || typeof record.value !== "object") {
    // Return bootstrap default configuration based on environment variables
    const bootstrapModel = process.env.GROQ_DEFAULT_MODEL || "openai/gpt-oss-120b";
    const hasEnvKey = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.startsWith("gsk_"));

    return {
      version: 1,
      provider: "groq",
      activeModel: bootstrapModel,
      keyMask: hasEnvKey ? maskApiKey(process.env.GROQ_API_KEY!) : undefined,
      status: hasEnvKey ? "ACTIVE" : "UNCONFIGURED",
      history: [],
    };
  }

  const data = record.value as unknown as StoredAiProviderConfig;
  return {
    version: typeof data.version === "number" ? data.version : 1,
    provider: data.provider || "groq",
    activeModel: data.activeModel || process.env.GROQ_DEFAULT_MODEL || "openai/gpt-oss-120b",
    encryptedApiKey: data.encryptedApiKey,
    keyMask: data.keyMask,
    status: data.status || "UNCONFIGURED",
    lastTestStatus: data.lastTestStatus,
    lastTestMessage: data.lastTestMessage,
    lastTestedAt: data.lastTestedAt,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
    history: Array.isArray(data.history) ? data.history : [],
  };
}

/**
 * Resolves the active runtime credentials and model.
 * PRECEDENCE:
 * 1. Database-managed encrypted configuration (if set & valid).
 * 2. Environment variable bootstrap configuration (GROQ_API_KEY / GROQ_DEFAULT_MODEL).
 */
export async function getActiveAiRuntimeConfig(): Promise<{
  provider: "groq";
  apiKey: string | null;
  activeModel: string;
  version: number;
  source: "database" | "environment" | "none";
}> {
  const stored = await getStoredAiProviderConfig();

  if (stored.encryptedApiKey) {
    try {
      const decryptedKey = decryptCredential(stored.encryptedApiKey);
      if (decryptedKey && decryptedKey.trim().length > 0) {
        return {
          provider: "groq",
          apiKey: decryptedKey.trim(),
          activeModel: stored.activeModel,
          version: stored.version,
          source: "database",
        };
      }
    } catch (err) {
      console.error("[ai-vault] Failed to decrypt stored provider credentials:", err);
    }
  }

  // Fallback to environment configuration
  const envKey = process.env.GROQ_API_KEY?.trim() || null;
  const envModel = process.env.GROQ_DEFAULT_MODEL || stored.activeModel || "openai/gpt-oss-120b";

  return {
    provider: "groq",
    apiKey: envKey,
    activeModel: envModel,
    version: stored.version || 1,
    source: envKey ? "environment" : "none",
  };
}

/**
 * Queries live model availability from Groq API to verify models dynamically.
 * Identifies preview or non-recommended models.
 */
export async function fetchLiveGroqModels(apiKey?: string): Promise<GroqModelOption[]> {
  const key = apiKey || (await getActiveAiRuntimeConfig()).apiKey;
  if (!key) {
    return SUPPORTED_GROQ_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      isChatCapable: true,
      isPreview: false,
      recommended: m.recommended,
    }));
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Groq HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawModels: Array<{ id: string; active?: boolean }> = Array.isArray(data.data) ? data.data : [];

    // Filter chat-capable LLMs (exclude audio whisper and prompt guards)
    const validChatIds = rawModels
      .map((m) => m.id)
      .filter((id) => !id.includes("whisper") && !id.includes("prompt-guard") && !id.includes("safeguard"));

    return validChatIds.map((id) => {
      const known = SUPPORTED_GROQ_MODELS.find((m) => m.id === id);
      const isPreview = id.includes("preview") || id.includes("test") || id.includes("experimental");
      const isRecommended = known ? known.recommended : false;
      const name = known
        ? known.name
        : isPreview
        ? `${id} (Preview — Not Recommended for Production)`
        : `${id}`;

      return {
        id,
        name,
        isChatCapable: true,
        isPreview,
        recommended: isRecommended,
      };
    });
  } catch {
    return SUPPORTED_GROQ_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      isChatCapable: true,
      isPreview: false,
      recommended: m.recommended,
    }));
  }
}

/**
 * Validates a Groq API key and model against the live Groq API.
 * Makes a minimal ping completion that does NOT consume institute credits.
 */
export async function testGroqConnection(
  apiKey: string,
  modelName: string,
): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { success: false, message: "API key cannot be empty.", latencyMs: 0 };
  }

  const startTime = Date.now();
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: "Ping" }],
        max_tokens: 5,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg =
        errBody?.error?.message ||
        `Groq API returned HTTP ${res.status}: ${res.statusText}`;
      return {
        success: false,
        message: errMsg,
        latencyMs,
      };
    }

    return {
      success: true,
      message: `Connection successful! Verified ${modelName} in ${latencyMs}ms.`,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : "Network error contacting Groq API.";
    return {
      success: false,
      message: `Connection test failed: ${msg}`,
      latencyMs,
    };
  }
}
