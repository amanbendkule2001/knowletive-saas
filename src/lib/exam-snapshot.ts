import crypto from "node:crypto";

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 * Ensures consistent byte representations across runtimes, ORMs, and database roundtrips.
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(",")}]`;
  }
  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`
  );
  return `{${pairs.join(",")}}`;
}

/**
 * Computes an authoritative SHA-256 hash digest from a canonical snapshot payload.
 */
export function computeSnapshotChecksum(payload: unknown): string {
  const canonical = canonicalStringify(payload);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verifies the integrity of a stored result snapshot against a recalculation of its payload.
 */
export function verifySnapshotChecksum(
  payload: unknown,
  storedChecksum: string
): {
  isValid: boolean;
  computedChecksum: string;
  storedChecksum: string;
} {
  const computedChecksum = computeSnapshotChecksum(payload);
  const isValid =
    typeof storedChecksum === "string" &&
    storedChecksum.length === 64 &&
    computedChecksum.toLowerCase() === storedChecksum.toLowerCase();

  return {
    isValid,
    computedChecksum,
    storedChecksum: storedChecksum || "",
  };
}

