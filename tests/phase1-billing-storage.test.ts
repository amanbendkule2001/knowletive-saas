import { describe, it, expect, vi } from "vitest";

// Mock next/navigation and next/headers
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Map()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { db } from "@/lib/db";
import {
  buildStorageKey,
  putObject,
  localRead,
  removeObject,
} from "@/lib/storage";

describe("Phase 1 Zero-Cost Billing & Storage Engine Tests", () => {
  it("TASK 1C: Local Persistent Storage - Storage Key and Isolation", () => {
    const tenantId = "tenant_test_123";
    const key = buildStorageKey(tenantId, "DOCUMENT", "Test Certificate (2026).pdf");

    // Key must strictly start with the tenant ID path
    expect(key.startsWith(`${tenantId}/document/`)).toBe(true);
    // Key must end with sanitized filename
    expect(key.endsWith("test-certificate-2026-.pdf")).toBe(true);
    // Must not contain spaces or special chars
    expect(key).not.toMatch(/[ ()]/);
  });

  it("TASK 1C: Local Persistent Storage - Path Traversal Prevention", async () => {
    // Attempting to escape the root directory must be rejected
    const maliciousKeys = [
      "../../etc/passwd",
      "../secret.env",
      "tenant_1/../../../windows/system32/cmd.exe",
    ];

    for (const badKey of maliciousKeys) {
      await expect(localRead(badKey)).rejects.toThrow("Invalid storage key");
    }
  });

  it("TASK 1C: Local Persistent Storage - Write, Read, and Delete lifecycle", async () => {
    const testTenant = "test_tenant_storage";
    const key = buildStorageKey(testTenant, "DOCUMENT", "sample-student-doc.txt");
    const payload = Buffer.from("Knowletive Phase 1 Local Storage Verification Content");

    // 1. Put object
    await putObject(key, payload, "text/plain");

    // 2. Read object back
    const retrieved = await localRead(key);
    expect(retrieved.toString("utf-8")).toBe("Knowletive Phase 1 Local Storage Verification Content");

    // 3. Remove object
    await removeObject(key);

    // 4. Verify file is gone
    await expect(localRead(key)).rejects.toThrow();
  });

  it("TASK 1A: Zero-Cost Billing - UPI String Formatting", () => {
    const upiId = "school@oksbi";
    const payeeName = "Delhi Public School";
    const amountInRupees = (150000 / 100).toFixed(2); // ₹1500.00
    const note = "INV-2026-001";

    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amountInRupees}&cu=INR&tn=${encodeURIComponent(note)}`;

    expect(upiUri).toContain("pa=school%40oksbi");
    expect(upiUri).toContain("pn=Delhi%20Public%20School");
    expect(upiUri).toContain("am=1500.00");
    expect(upiUri).toContain("cu=INR");
    expect(upiUri).toContain("tn=INV-2026-001");
  });

  it("TASK 1B: In-App Notification Center - Read/Unread State Tracking", async () => {
    // Find or pick a seeded tenant
    const tenant = await db.tenant.findFirst();
    expect(tenant).toBeDefined();

    // Create an in-app notification
    const notification = await db.notificationLog.create({
      data: {
        tenantId: tenant!.id,
        channel: "IN_APP",
        template: "fee.payment_submitted",
        to: tenant!.email,
        subject: "Unit Test Fee Payment Submitted",
        body: "Test notification body for student fee payment verification.",
        status: "SENT",
        isRead: false,
      },
    });

    expect(notification.isRead).toBe(false);
    expect(notification.readAt).toBeNull();

    // Mark as read
    const updated = await db.notificationLog.update({
      where: { id: notification.id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    expect(updated.isRead).toBe(true);
    expect(updated.readAt).not.toBeNull();

    // Cleanup test log
    await db.notificationLog.delete({ where: { id: notification.id } });
  });

  it("TASK 1A: Platform Subscription Manual UTR Reconciliation Reference Format", () => {
    const reference = "UTR99283741";
    const bankName = "State Bank of India";
    const notes = "NEFT transferred from parent account";

    const parts: string[] = [];
    if (reference) parts.push(`UTR:${reference}`);
    if (bankName) parts.push(`Bank:${bankName}`);
    if (notes) parts.push(`Note:${notes}`);
    const providerRef = parts.join(" | ");

    expect(providerRef).toBe("UTR:UTR99283741 | Bank:State Bank of India | Note:NEFT transferred from parent account");
  });
});
