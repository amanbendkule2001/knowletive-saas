import { db } from "@/lib/db";
import type { PaymentProviderAdapter, PaymentProviderType } from "./types";
import { DemoPaymentAdapter } from "./adapters/demo-adapter";
import { JodoPaymentAdapter } from "./adapters/jodo-adapter";

const adapterCache = new Map<string, PaymentProviderAdapter>();

/**
 * Resolves the payment provider adapter based on tenant/branch configuration
 * or explicit provider selection. Centralized factory ensures application-level
 * checkout and financial services do not contain scattered provider-specific conditions.
 */
export async function getPaymentProvider(
  requestedProvider?: string,
  tenantId?: string,
  branchId?: string
): Promise<PaymentProviderAdapter> {
  const normalized = (requestedProvider || "").toUpperCase();

  // If explicitly requested
  if (normalized === "DEMO" || normalized === "SIMULATION") {
    return new DemoPaymentAdapter();
  }

  if (normalized === "JODO") {
    // Check if tenant/branch has specific Jodo configuration
    if (tenantId) {
      const config = await db.paymentProviderConfig.findFirst({
        where: {
          tenantId,
          provider: "JODO",
          isEnabled: true,
          ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
        },
        orderBy: { branchId: "desc" }, // Prefer branch-specific over tenant-default
      });

      if (config) {
        return new JodoPaymentAdapter({
          merchantId: config.merchantId,
          secret: config.secretRef ? process.env[config.secretRef] : null,
          isEnabled: config.isEnabled,
        });
      }
    }

    return new JodoPaymentAdapter();
  }

  // Fallback to tenant/branch default from database if tenantId is available
  if (tenantId) {
    const config = await db.paymentProviderConfig.findFirst({
      where: {
        tenantId,
        isEnabled: true,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      orderBy: { branchId: "desc" },
    });

    if (config?.provider === "JODO") {
      return new JodoPaymentAdapter({
        merchantId: config.merchantId,
        secret: config.secretRef ? process.env[config.secretRef] : null,
        isEnabled: config.isEnabled,
      });
    }
  }

  // Default to DEMO provider
  return new DemoPaymentAdapter();
}

/**
 * Synchronous direct provider instantiation (convenient for testing and deterministic routes).
 */
export function resolvePaymentAdapter(provider: PaymentProviderType = "DEMO"): PaymentProviderAdapter {
  if (provider === "JODO") {
    return new JodoPaymentAdapter();
  }
  return new DemoPaymentAdapter();
}
