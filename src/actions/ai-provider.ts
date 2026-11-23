"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  AI_PROVIDER_CONFIG_KEY,
  encryptCredential,
  maskApiKey,
  getStoredAiProviderConfig,
  getActiveAiRuntimeConfig,
  testGroqConnection,
  SUPPORTED_GROQ_MODELS,
  StoredAiProviderConfig,
  AiProviderAuditEntry,
  migrateStoredAiCredentials,
} from "@/lib/ai-credential-vault";
import { syncProviderConfigToEngine } from "@/lib/ai-gateway";

import { AuthUser } from "@/lib/auth";

export type FormState = {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
};

/**
 * Validates and atomically replaces the Groq API Key.
 * Authenticated encryption (AES-256-GCM) is applied before saving to the database.
 * If live validation fails, the previous working configuration is strictly preserved.
 * Dynamically synchronizes the new credential to the Python Copilot microservice without restart.
 */
export async function saveAiProviderApiKeyAction(
  _prev: FormState,
  formData: FormData,
  actorOverride?: AuthUser,
): Promise<FormState> {
  const actor = actorOverride || (await requirePlatformPermission("platform.settings.manage"));
  if (!actor.isPlatformOwner && !actor.platformPermissions?.includes("platform.settings.manage") && !actor.platformPermissions?.includes("*")) {
    throw new Error("Forbidden: Missing required platform permission platform.settings.manage");
  }

  const rawKey = String(formData.get("apiKey") ?? "").trim();

  if (!rawKey) {
    return { error: "API key cannot be empty." };
  }

  if (!rawKey.startsWith("gsk_") || rawKey.length < 20) {
    return {
      error: "Invalid Groq API key format. Expected key starting with 'gsk_' (minimum 20 characters).",
    };
  }

  const stored = await getStoredAiProviderConfig();
  const targetModel = stored.activeModel || "openai/gpt-oss-120b";

  // 1. Live Validation test before storing
  const testRes = await testGroqConnection(rawKey, targetModel);
  if (!testRes.success) {
    // Preserve previous working configuration
    return {
      error: `API Key validation failed: ${testRes.message}. Previous configuration was preserved.`,
    };
  }

  // 2. Authenticated Encryption with dedicated AES-256-GCM key
  const encrypted = encryptCredential(rawKey);
  const keyMask = maskApiKey(rawKey);
  const nowIso = new Date().toISOString();
  const nextVersion = (stored.version || 1) + 1;

  const auditEntry: AiProviderAuditEntry = {
    timestamp: nowIso,
    actorId: actor.id,
    actorName: actor.name,
    action: "KEY_REPLACED",
    provider: "groq",
    newModel: targetModel,
    testResult: "SUCCESS",
    testMessage: testRes.message,
  };

  const updatedConfig: StoredAiProviderConfig = {
    version: nextVersion,
    provider: "groq",
    activeModel: targetModel,
    encryptedApiKey: encrypted,
    keyMask,
    status: "ACTIVE",
    lastTestStatus: "SUCCESS",
    lastTestMessage: testRes.message,
    lastTestedAt: nowIso,
    updatedAt: nowIso,
    updatedBy: { id: actor.id, name: actor.name },
    history: [auditEntry, ...stored.history].slice(0, 30),
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

  // 3. Push real-time synchronization to Python Copilot microservice
  const syncResult = await syncProviderConfigToEngine({
    provider: "groq",
    apiKey: rawKey,
    model: targetModel,
    version: nextVersion,
  });

  // 4. Write Platform Audit Trail (NEVER stores raw API key)
  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "platform.ai.key_replace",
    entity: "Setting",
    entityId: AI_PROVIDER_CONFIG_KEY,
    meta: {
      provider: "groq",
      model: targetModel,
      keyMask,
      testResult: "SUCCESS",
      latencyMs: testRes.latencyMs,
      version: nextVersion,
      engineSync: syncResult.success ? "SYNCHRONIZED" : syncResult.error,
    },
  });

  try {
    revalidatePath("/platform/settings/ai");
  } catch {}
  return { success: `Groq API key (${keyMask}) validated and securely activated (v${nextVersion}).` };
}

/**
 * Switches the active model for Groq AI Copilot.
 * Validates model compatibility against the live provider before atomic activation.
 * Dynamically synchronizes model selection to Python microservice without restart.
 */
export async function switchAiModelAction(
  _prev: FormState,
  formData: FormData,
  actorOverride?: AuthUser,
): Promise<FormState> {
  const actor = actorOverride || (await requirePlatformPermission("platform.settings.manage"));
  if (!actor.isPlatformOwner && !actor.platformPermissions?.includes("platform.settings.manage") && !actor.platformPermissions?.includes("*")) {
    throw new Error("Forbidden: Missing required platform permission platform.settings.manage");
  }

  const newModel = String(formData.get("model") ?? "").trim();

  const validModelIds = SUPPORTED_GROQ_MODELS.map((m) => m.id as string);
  if (!validModelIds.includes(newModel)) {
    return {
      error: `Invalid model selection. Supported models: ${validModelIds.join(", ")}`,
    };
  }

  const stored = await getStoredAiProviderConfig();
  const previousModel = stored.activeModel;

  if (previousModel === newModel) {
    return { success: `Model is already set to ${newModel}.` };
  }

  // Validate new model with current active credentials
  const runtime = await getActiveAiRuntimeConfig();
  if (runtime.apiKey) {
    const testRes = await testGroqConnection(runtime.apiKey, newModel);
    if (!testRes.success) {
      return {
        error: `Model activation test failed for ${newModel}: ${testRes.message}. Previous model (${previousModel}) preserved.`,
      };
    }
  }

  const nowIso = new Date().toISOString();
  const nextVersion = (stored.version || 1) + 1;

  const auditEntry: AiProviderAuditEntry = {
    timestamp: nowIso,
    actorId: actor.id,
    actorName: actor.name,
    action: "MODEL_SWITCHED",
    previousModel,
    newModel,
    provider: "groq",
    testResult: "SUCCESS",
    testMessage: `Model switched from ${previousModel} to ${newModel}.`,
  };

  const updatedConfig: StoredAiProviderConfig = {
    ...stored,
    version: nextVersion,
    activeModel: newModel,
    updatedAt: nowIso,
    updatedBy: { id: actor.id, name: actor.name },
    history: [auditEntry, ...stored.history].slice(0, 30),
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

  // Push real-time synchronization to Python microservice
  const syncResult = await syncProviderConfigToEngine({
    provider: "groq",
    apiKey: runtime.apiKey,
    model: newModel,
    version: nextVersion,
  });

  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "platform.ai.model_switch",
    entity: "Setting",
    entityId: AI_PROVIDER_CONFIG_KEY,
    meta: {
      provider: "groq",
      previousModel,
      newModel,
      version: nextVersion,
      engineSync: syncResult.success ? "SYNCHRONIZED" : syncResult.error,
    },
  });

  try {
    revalidatePath("/platform/settings/ai");
  } catch {}
  return { success: `Active model successfully switched to ${newModel} (v${nextVersion}).` };
}

/**
 * Tests the currently configured AI Provider connection.
 * Does NOT consume institute AI credits.
 */
export async function testAiConnectionAction(
  _prev: FormState,
  _formData: FormData,
  actorOverride?: AuthUser,
): Promise<FormState> {
  const actor = actorOverride || (await requirePlatformPermission("platform.settings.manage"));
  if (!actor.isPlatformOwner && !actor.platformPermissions?.includes("platform.settings.manage") && !actor.platformPermissions?.includes("*")) {
    throw new Error("Forbidden: Missing required platform permission platform.settings.manage");
  }

  const runtime = await getActiveAiRuntimeConfig();

  if (!runtime.apiKey) {
    return {
      error: "No active API key configured. Enter and save a replacement Groq API key first.",
    };
  }

  const testRes = await testGroqConnection(runtime.apiKey, runtime.activeModel);
  const nowIso = new Date().toISOString();

  const stored = await getStoredAiProviderConfig();
  const auditEntry: AiProviderAuditEntry = {
    timestamp: nowIso,
    actorId: actor.id,
    actorName: actor.name,
    action: "CONNECTION_TEST",
    provider: "groq",
    newModel: runtime.activeModel,
    testResult: testRes.success ? "SUCCESS" : "FAILED",
    testMessage: testRes.message,
  };

  const updatedConfig: StoredAiProviderConfig = {
    ...stored,
    status: testRes.success ? "ACTIVE" : "ERROR",
    lastTestStatus: testRes.success ? "SUCCESS" : "FAILED",
    lastTestMessage: testRes.message,
    lastTestedAt: nowIso,
    history: [auditEntry, ...stored.history].slice(0, 30),
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

  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "platform.ai.connection_test",
    entity: "Setting",
    entityId: AI_PROVIDER_CONFIG_KEY,
    meta: {
      provider: "groq",
      model: runtime.activeModel,
      testResult: testRes.success ? "SUCCESS" : "FAILED",
      latencyMs: testRes.latencyMs,
    },
  });

  try {
    revalidatePath("/platform/settings/ai");
  } catch {}

  if (!testRes.success) {
    return { error: testRes.message };
  }
  return { success: testRes.message };
}

/**
 * Migration action: Safely migrates vault credentials from legacy SESSION_SECRET
 * fallback to the dedicated AI_CREDENTIALS_ENCRYPTION_KEY.
 */
export async function migrateAiCredentialsAction(
  _prev: FormState,
  _formData: FormData,
  actorOverride?: AuthUser,
): Promise<FormState> {
  const actor = actorOverride || (await requirePlatformPermission("platform.settings.manage"));
  if (!actor.isPlatformOwner && !actor.platformPermissions?.includes("platform.settings.manage") && !actor.platformPermissions?.includes("*")) {
    throw new Error("Forbidden: Missing required platform permission platform.settings.manage");
  }

  const result = await migrateStoredAiCredentials();

  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "platform.ai.migration",
    entity: "Setting",
    entityId: AI_PROVIDER_CONFIG_KEY,
    meta: {
      migrationStatus: result.status,
      migrated: result.migrated,
      error: result.error,
    },
  });

  try {
    revalidatePath("/platform/settings/ai");
  } catch {}
  if (result.status === "ALREADY_DEDICATED") {
    return { success: "Vault credentials are already encrypted using the dedicated AI_CREDENTIALS_ENCRYPTION_KEY." };
  }
  if (result.status === "MIGRATED_SUCCESSFULLY") {
    return { success: "Successfully migrated vault credentials to the dedicated AI_CREDENTIALS_ENCRYPTION_KEY." };
  }
  if (result.status === "NO_CONFIG") {
    return { success: "No stored credentials in database vault. Ready for new configuration." };
  }
  return { error: `Migration failed: ${result.error || "Unknown error"}` };
}
