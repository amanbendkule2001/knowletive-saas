import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cpu,
  History,
  KeyRound,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { requirePlatformPermission } from "@/lib/rbac";
import {
  getStoredAiProviderConfig,
  getActiveAiRuntimeConfig,
  fetchLiveGroqModels,
  SUPPORTED_GROQ_MODELS,
} from "@/lib/ai-credential-vault";
import {
  saveAiProviderApiKeyAction,
  switchAiModelAction,
  testAiConnectionAction,
  migrateAiCredentialsAction,
} from "@/actions/ai-provider";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "AI Provider Management" };

export default async function PlatformAiSettingsPage() {
  await requirePlatformPermission("platform.settings.manage");

  const [stored, runtime, liveModels] = await Promise.all([
    getStoredAiProviderConfig(),
    getActiveAiRuntimeConfig(),
    fetchLiveGroqModels(),
  ]);

  const isConfigured = Boolean(runtime.apiKey);
  const activeModel = runtime.activeModel;
  const isHealthy = stored.lastTestStatus === "SUCCESS";
  const configVersion = stored.version || 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance"
        title="AI Provider Management"
        description="Configure LLM provider credentials, model selection, live connection tests and rotation audit history."
        actions={
          <div className="flex items-center gap-2">
            <span className="badge font-mono text-[11px]">v{configVersion}</span>
            <Badge tone={isConfigured ? "success" : "warning"}>
              <ShieldCheck className="size-3" /> {isConfigured ? "Provider Active" : "Key Required"}
            </Badge>
          </div>
        }
      />

      {/* Overview Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Provider"
          value="Groq Cloud"
          sub="Official SDK (FastAPI microservice)"
          icon={<Bot className="size-4" />}
          tone="brand"
        />
        <StatCard
          label="Active Model"
          value={activeModel.split("/")[1] || activeModel}
          sub={activeModel.startsWith("openai/") ? "OpenAI Flagship on Groq" : "Groq Hosted"}
          icon={<Cpu className="size-4" />}
          tone="info"
        />
        <StatCard
          label="Credentials"
          value={isConfigured ? "Configured" : "Missing"}
          sub={stored.keyMask ? `Mask: ${stored.keyMask}` : runtime.source === "environment" ? "Via Environment" : "No API key"}
          icon={<KeyRound className="size-4" />}
          tone={isConfigured ? "success" : "danger"}
        />
        <StatCard
          label="Connection Health"
          value={stored.lastTestStatus || (isConfigured ? "Ready" : "Unverified")}
          sub={stored.lastTestedAt ? `Tested ${timeAgo(new Date(stored.lastTestedAt))}` : "Test connection below"}
          icon={<Zap className="size-4" />}
          tone={isHealthy ? "success" : stored.lastTestStatus === "FAILED" ? "danger" : "warning"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {/* Section A: Test Connection */}
          <Card>
            <CardHeader
              title="Test Connection"
              description="Verify live LLM response and tool compatibility with the active configuration. Does not consume institute credits."
            />
            <div className="p-4 space-y-4">
              {stored.lastTestMessage && (
                <div
                  className={`flex items-start gap-2.5 rounded-xl p-3 text-xs ${
                    stored.lastTestStatus === "SUCCESS"
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                      : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                  }`}
                >
                  {stored.lastTestStatus === "SUCCESS" ? (
                    <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {stored.lastTestStatus === "SUCCESS" ? "Connection Verified" : "Verification Failed"}
                    </p>
                    <p className="mt-0.5 opacity-90">{stored.lastTestMessage}</p>
                    {stored.lastTestedAt && (
                      <p className="mt-1 text-[10px] opacity-75">
                        Timestamp: {new Date(stored.lastTestedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <ActionForm
                action={testAiConnectionAction}
                submitLabel="Test Active Connection Now"
                pendingLabel="Testing Groq Connectivity…"
                submitClassName="btn btn-secondary w-full sm:w-auto"
              >
                <p className="text-xs text-muted">
                  Sends a lightweight ping to the Groq API endpoint verifying model availability and credential validity.
                </p>
              </ActionForm>
            </div>
          </Card>

          {/* Section B: API Key Replacement */}
          <Card>
            <CardHeader
              title="Replace Groq API Key"
              description="Securely rotate or update the Groq API key with AES-256-GCM encryption and zero-downtime Python synchronization."
            />
            <div className="p-4">
              <ActionForm
                action={saveAiProviderApiKeyAction}
                submitLabel="Validate & Activate API Key"
                pendingLabel="Validating against Groq…"
              >
                <FormGrid cols={1}>
                  <Field
                    label="Replacement API Key"
                    htmlFor="apiKey"
                    required
                    hint="Key must start with 'gsk_'. Tested against Groq before saving; encrypted with dedicated AI_CREDENTIALS_ENCRYPTION_KEY."
                  >
                    <input
                      id="apiKey"
                      name="apiKey"
                      type="password"
                      className="input font-mono"
                      placeholder="gsk_..."
                      required
                      autoComplete="off"
                    />
                  </Field>
                </FormGrid>
              </ActionForm>
            </div>
          </Card>

          {/* Section C: Model Switching */}
          <Card>
            <CardHeader
              title="Active Model Selection"
              description="Choose among tested Groq models compatible with tool calling and SSE token streaming."
            />
            <div className="p-4">
              <ActionForm
                action={switchAiModelAction}
                submitLabel="Switch Active Model"
                pendingLabel="Validating & Switching Model…"
              >
                <div className="space-y-3">
                  {liveModels.map((m) => {
                    const isSelected = activeModel === m.id;
                    return (
                      <label
                        key={m.id}
                        className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-all ${
                          isSelected
                            ? "border-[var(--brand)] bg-[var(--brand-soft)]/20 ring-1 ring-[var(--brand)]"
                            : "border-[var(--border)] hover:bg-[var(--surface-2)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="model"
                          value={m.id}
                          defaultChecked={isSelected}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold">{m.id}</span>
                            {m.recommended && (
                              <span className="badge badge-brand text-[9px] py-0 px-1.5">
                                Recommended
                              </span>
                            )}
                            {m.isPreview && (
                              <span className="badge badge-warning text-[9px] py-0 px-1.5">
                                Preview / Experimental
                              </span>
                            )}
                            {isSelected && (
                              <span className="badge badge-success text-[9px] py-0 px-1.5">
                                Current Active
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted">{m.name}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </ActionForm>
            </div>
          </Card>

          {/* Section D: Vault Migration */}
          <Card>
            <CardHeader
              title="Credential Vault Migration"
              description="Migrate vault records from legacy derivation to dedicated AI_CREDENTIALS_ENCRYPTION_KEY."
            />
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted">
                If credentials were saved under earlier versions with session secret fallback, run migration to re-encrypt them with the dedicated master key.
              </p>
              <ActionForm
                action={migrateAiCredentialsAction}
                submitLabel="Verify & Migrate Vault"
                pendingLabel="Running Migration…"
                submitClassName="btn btn-outline text-xs"
              >
                <p className="text-xs text-muted">
                  Click below to perform an automated integrity check and re-encryption.
                </p>
              </ActionForm>
            </div>
          </Card>
        </div>

        {/* Sidebar: Security, Precedence & Rotation Audit History */}
        <div className="space-y-5">
          {/* Security & Precedence Card */}
          <Card>
            <CardHeader title="Security Architecture" description="Multi-tenant encryption & precedence" />
            <div className="divide-y divide-[var(--border)] text-xs">
              <div className="p-3.5 space-y-1">
                <p className="font-medium">Dedicated Master Key</p>
                <p className="text-muted leading-relaxed">
                  Encryption strictly uses <code className="font-mono text-[11px]">AI_CREDENTIALS_ENCRYPTION_KEY</code> (AES-256-GCM). Automatic derivation from session secret is removed.
                </p>
              </div>
              <div className="p-3.5 space-y-1">
                <p className="font-medium">Runtime Microservice Sync</p>
                <p className="text-muted leading-relaxed">
                  Rotations trigger an authenticated internal push to the Python Copilot engine and sync per-request version tags. Plaintext keys are never stored on disk.
                </p>
              </div>
              <div className="p-3.5 space-y-1">
                <p className="font-medium">Atomic Failure Recovery</p>
                <p className="text-muted leading-relaxed">
                  If an entered key or selected model fails live validation, the previous working configuration is strictly preserved.
                </p>
              </div>
            </div>
          </Card>

          {/* Rotation History */}
          <Card>
            <CardHeader
              title="Configuration Audit History"
              description="Log of recent credential updates and model switches"
            />
            <div className="p-3.5">
              {stored.history.length === 0 ? (
                <p className="text-xs text-muted py-4 text-center">
                  No configuration updates logged yet. Changes will appear here automatically.
                </p>
              ) : (
                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {stored.history.map((entry, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/50 p-2.5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[11px] text-[var(--foreground)]">
                          {entry.action.replace(/_/g, " ")}
                        </span>
                        <span
                          className={`badge text-[9px] ${
                            entry.testResult === "SUCCESS" ? "badge-success" : "badge-danger"
                          }`}
                        >
                          {entry.testResult}
                        </span>
                      </div>
                      {entry.previousModel && entry.newModel && (
                        <p className="text-[11px] font-mono text-muted truncate">
                          {entry.previousModel} → {entry.newModel}
                        </p>
                      )}
                      {entry.testMessage && (
                        <p className="text-[11px] text-muted truncate">{entry.testMessage}</p>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-[var(--muted-2)] pt-1 border-t border-[var(--border)]/50">
                        <span>{entry.actorName}</span>
                        <span>{timeAgo(new Date(entry.timestamp))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
