import { MockJodoAdapter } from "./mock-jodo";
import type { FeeGatewayAdapter } from "./types";

export * from "./types";
export { MockJodoAdapter } from "./mock-jodo";
export { DemoPaymentAdapter } from "./adapters/demo-adapter";
export { JodoPaymentAdapter, ProviderNotConfiguredError } from "./adapters/jodo-adapter";
export { getPaymentProvider, resolvePaymentAdapter } from "./registry";

/**
 * Returns the appropriate payment gateway adapter based on configuration.
 * Preserved for backward compatibility with existing webhook routes and integration tests.
 */
export function getPaymentGatewayAdapter(provider: string = "jodo"): FeeGatewayAdapter {
  if (provider === "jodo" || provider === "mock_jodo") {
    return new MockJodoAdapter();
  }
  return new MockJodoAdapter();
}
