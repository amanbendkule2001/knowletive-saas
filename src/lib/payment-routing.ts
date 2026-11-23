import "server-only";

import { db } from "@/lib/db";

export interface CollectorRoutingInput {
  tenantId: string;
  provider: string; // e.g. "JODO", "DEMO", "RAZORPAY"
  environment: string; // e.g. "DEMO", "TEST", "LIVE"
  merchantId?: string | null;
  collectorCode: string;
  discriminator?: string | null; // e.g. custom tag, sub-merchant reference
  verifiedLinkBranchId?: string | null; // From FeePaymentLink or DemoPaymentSession
  metadata?: Record<string, any> | null;
}

export type RoutingResolutionResult =
  | {
      status: "RESOLVED";
      branchId: string;
      resolutionEvidence: string;
      candidateBranchIds: string[];
    }
  | {
      status: "QUARANTINED";
      reason:
        | "UNKNOWN_COLLECTOR_CODE"
        | "AMBIGUOUS_SHARED_CODE"
        | "CONFLICTING_METADATA"
        | "MERCHANT_MISMATCH"
        | "ENVIRONMENT_MISMATCH";
      branchId: null;
      resolutionEvidence: string;
      candidateBranchIds: string[];
    };

/**
 * Resolves the deterministic branch for a payment or webhook event based on collector routing configuration.
 * Adheres strictly to provider-neutral disambiguation rules:
 * - Deterministic single branch match -> RESOLVED
 * - Shared collector code disambiguated by verified metadata or discriminator -> RESOLVED
 * - Shared collector code without verified metadata -> QUARANTINED (never chooses first matching branch arbitrarily)
 * - Metadata discrepancy -> QUARANTINED
 * - Unknown or mismatched configuration -> QUARANTINED
 */
export async function resolvePaymentCollectorBranch(
  input: CollectorRoutingInput,
  client: any = db
): Promise<RoutingResolutionResult> {
  const { tenantId, provider, environment, merchantId, collectorCode, discriminator, verifiedLinkBranchId } = input;

  if (!tenantId || !collectorCode || !collectorCode.trim()) {
    return {
      status: "QUARANTINED",
      reason: "UNKNOWN_COLLECTOR_CODE",
      branchId: null,
      resolutionEvidence: "Missing tenant or collector code identifier.",
      candidateBranchIds: [],
    };
  }

  const cleanCode = collectorCode.trim();

  // 1. Query candidate routes in PaymentCollectorRoute
  const activeRoutes = await client.paymentCollectorRoute.findMany({
    where: {
      tenantId,
      provider: provider.toUpperCase(),
      collectorCode: cleanCode,
      isActive: true,
    },
    include: {
      branch: {
        select: { id: true, name: true, code: true, isActive: true },
      },
    },
  });

  // Also query legacy/fallback Branch.collectorCode if no explicit PaymentCollectorRoute rows exist
  let candidateBranchRecords: { branchId: string; merchantId: string | null; environment: string; discriminator: string | null }[] = [];

  if (activeRoutes.length > 0) {
    candidateBranchRecords = activeRoutes
      .filter((r: any) => r.branch && r.branch.isActive)
      .map((r: any) => ({
        branchId: r.branchId,
        merchantId: r.merchantId ?? null,
        environment: r.environment,
        discriminator: r.routingDiscriminator ?? null,
      }));
  } else {
    // Check if there are unverified or inactive routes for this collector code
    const unverifiedOrInactive = await client.paymentCollectorRoute.findFirst({
      where: {
        tenantId,
        collectorCode: cleanCode,
      },
      select: { id: true, provider: true, isActive: true },
    });

    if (unverifiedOrInactive) {
      return {
        status: "QUARANTINED",
        reason: "UNKNOWN_COLLECTOR_CODE",
        branchId: null,
        resolutionEvidence: `Collector code '${cleanCode}' is registered in tenant ${tenantId} but is ${
          !unverifiedOrInactive.isActive ? "inactive" : "unverified"
        }. Payment cannot be routed to uncertain or inactive destinations.`,
        candidateBranchIds: [],
      };
    }

    // Fallback: check active branches with matching legacy collectorCode
    const matchingBranches = await client.branch.findMany({
      where: {
        tenantId,
        collectorCode: cleanCode,
        isActive: true,
      },
      select: { id: true },
    });
    candidateBranchRecords = matchingBranches.map((b: any) => ({
      branchId: b.id,
      merchantId: null,
      environment,
      discriminator: null,
    }));
  }

  if (candidateBranchRecords.length === 0) {
    return {
      status: "QUARANTINED",
      reason: "UNKNOWN_COLLECTOR_CODE",
      branchId: null,
      resolutionEvidence: `Collector code '${cleanCode}' is not registered to any active branch in tenant ${tenantId}.`,
      candidateBranchIds: [],
    };
  }

  // 2. Validate Environment
  const envMatches = candidateBranchRecords.filter(
    (r) => !r.environment || r.environment.toUpperCase() === environment.toUpperCase()
  );
  if (envMatches.length === 0) {
    return {
      status: "QUARANTINED",
      reason: "ENVIRONMENT_MISMATCH",
      branchId: null,
      resolutionEvidence: `Collector code '${cleanCode}' exists for provider ${provider} but not in environment '${environment}'.`,
      candidateBranchIds: Array.from(new Set(candidateBranchRecords.map((r) => r.branchId))),
    };
  }

  // 3. Validate Merchant Account if specified
  let merchantMatches = envMatches;
  if (merchantId) {
    const specificMerchantMatches = envMatches.filter(
      (r) => !r.merchantId || r.merchantId.trim() === merchantId.trim()
    );
    if (specificMerchantMatches.length === 0) {
      return {
        status: "QUARANTINED",
        reason: "MERCHANT_MISMATCH",
        branchId: null,
        resolutionEvidence: `Collector code '${cleanCode}' exists in ${environment} but does not match merchant account '${merchantId}'.`,
        candidateBranchIds: Array.from(new Set(envMatches.map((r) => r.branchId))),
      };
    }
    merchantMatches = specificMerchantMatches;
  }

  // Deduplicate candidate branch IDs
  const candidateBranchIds = Array.from(new Set(merchantMatches.map((r) => r.branchId)));

  // 4. Case: Exactly One Candidate Branch
  if (candidateBranchIds.length === 1) {
    const singleBranchId = candidateBranchIds[0];

    // Check conflict against verified payment link metadata if present
    if (verifiedLinkBranchId && verifiedLinkBranchId !== singleBranchId) {
      return {
        status: "QUARANTINED",
        reason: "CONFLICTING_METADATA",
        branchId: null,
        resolutionEvidence: `Discrepancy: Collector code '${cleanCode}' maps to branch ${singleBranchId}, but verified payment order/link explicitly specifies branch ${verifiedLinkBranchId}.`,
        candidateBranchIds,
      };
    }

    // Check if multiple distinct merchant accounts exist on this branch for this collector code
    const distinctMerchants = Array.from(new Set(merchantMatches.map((r) => r.merchantId).filter(Boolean)));
    if (!merchantId && distinctMerchants.length > 1) {
      return {
        status: "QUARANTINED",
        reason: "AMBIGUOUS_SHARED_CODE",
        branchId: null,
        resolutionEvidence: `Collector code '${cleanCode}' is configured with multiple distinct merchant accounts (${distinctMerchants.join(
          ", "
        )}) on branch ${singleBranchId}. Missing merchant identity cannot be resolved unambiguously.`,
        candidateBranchIds,
      };
    }

    // Check if discriminator was provided and conflicts with configured route
    if (discriminator && discriminator.trim()) {
      const cleanDisc = discriminator.trim();
      const routesWithDisc = merchantMatches.filter((r) => r.discriminator);
      const matchingDiscRoutes = merchantMatches.filter(
        (r) => r.discriminator && r.discriminator.trim() === cleanDisc
      );
      if (routesWithDisc.length > 0 && matchingDiscRoutes.length === 0) {
        return {
          status: "QUARANTINED",
          reason: "CONFLICTING_METADATA",
          branchId: null,
          resolutionEvidence: `Collector code '${cleanCode}' does not match provided routing discriminator '${cleanDisc}'.`,
          candidateBranchIds,
        };
      }
    }

    // Check if multiple distinct discriminators exist on this branch but none was provided
    const distinctDiscriminators = Array.from(new Set(merchantMatches.map((r) => r.discriminator).filter(Boolean)));
    if (!discriminator && distinctDiscriminators.length > 1) {
      return {
        status: "QUARANTINED",
        reason: "AMBIGUOUS_SHARED_CODE",
        branchId: null,
        resolutionEvidence: `Collector code '${cleanCode}' has multiple distinct routing discriminators (${distinctDiscriminators.join(
          ", "
        )}) on branch ${singleBranchId}. Missing discriminator cannot be resolved unambiguously.`,
        candidateBranchIds,
      };
    }

    const evidence = verifiedLinkBranchId
      ? `Deterministic collector code '${cleanCode}' corroborated by verified payment order/link metadata.`
      : merchantId
      ? `Deterministic unique route for collector code '${cleanCode}' (merchant: ${merchantId}) in ${environment}.`
      : `Deterministic unique route for collector code '${cleanCode}' in ${environment}.`;

    return {
      status: "RESOLVED",
      branchId: singleBranchId,
      resolutionEvidence: evidence,
      candidateBranchIds,
    };
  }

  // 5. Case: Multiple Candidate Branches (Shared Collector Code)
  // Step 5A: Try disambiguation via routing discriminator
  if (discriminator && discriminator.trim()) {
    const cleanDisc = discriminator.trim();
    const discriminatorMatches = merchantMatches.filter(
      (r) => r.discriminator && r.discriminator.trim() === cleanDisc
    );
    const discBranchIds = Array.from(new Set(discriminatorMatches.map((r) => r.branchId)));

    if (discBranchIds.length === 1) {
      const matchedBranchId = discBranchIds[0];
      if (verifiedLinkBranchId && verifiedLinkBranchId !== matchedBranchId) {
        return {
          status: "QUARANTINED",
          reason: "CONFLICTING_METADATA",
          branchId: null,
          resolutionEvidence: `Discriminator matched branch ${matchedBranchId}, but verified link metadata specifies ${verifiedLinkBranchId}.`,
          candidateBranchIds,
        };
      }
      return {
        status: "RESOLVED",
        branchId: matchedBranchId,
        resolutionEvidence: `Shared collector code '${cleanCode}' disambiguated by provider routing discriminator '${cleanDisc}'.`,
        candidateBranchIds,
      };
    } else if (discBranchIds.length === 0) {
      return {
        status: "QUARANTINED",
        reason: "CONFLICTING_METADATA",
        branchId: null,
        resolutionEvidence: `Shared collector code '${cleanCode}' does not match provided routing discriminator '${cleanDisc}'.`,
        candidateBranchIds,
      };
    }
  }

  // Step 5B: Try disambiguation via verified payment link / order metadata
  if (verifiedLinkBranchId) {
    if (candidateBranchIds.includes(verifiedLinkBranchId)) {
      return {
        status: "RESOLVED",
        branchId: verifiedLinkBranchId,
        resolutionEvidence: `Shared collector code '${cleanCode}' disambiguated by verified payment order/link metadata for branch ${verifiedLinkBranchId}.`,
        candidateBranchIds,
      };
    }

    // Link branch is not among the candidate branches for this collector code
    return {
      status: "QUARANTINED",
      reason: "CONFLICTING_METADATA",
      branchId: null,
      resolutionEvidence: `Verified payment link references branch ${verifiedLinkBranchId}, which is not among the ${candidateBranchIds.length} candidate branches configured for shared collector code '${cleanCode}'.`,
      candidateBranchIds,
    };
  }

  // Step 5C: Shared collector code with no verified distinguishing metadata
  // Fail closed: never pick arbitrarily
  return {
    status: "QUARANTINED",
    reason: "AMBIGUOUS_SHARED_CODE",
    branchId: null,
    resolutionEvidence: `Shared collector code '${cleanCode}' is configured across ${candidateBranchIds.length} branches (${candidateBranchIds.join(
      ", "
    )}). Event quarantined because no routing discriminator or verified order linkage was provided.`,
    candidateBranchIds,
  };
}
