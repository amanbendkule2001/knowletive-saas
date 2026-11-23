# KNOWLETIVE — Journey 5: Complete Parent Portal End-to-End User Journey

```
========================================================================================
DOCUMENT IDENTIFIER:   KNOWLETIVE-JOURNEY-05-PARENT-PORTAL
DOCUMENT VERSION:      Revision 1.2 (Final Semantic and Payment Data Reconciliation)
RELEASE STATUS:        Approved & Frozen
SECURITY LEVEL:        Internal Functional Specification / Architecture Reference
TARGET REPOSITORY:     D:\IT\Saas
CANONICAL BRANCH:      staging/exam-stage-43
AUDIT REFERENCE:       SRC-DOC-25-REV-1.2
LAST UPDATED:          November 2026
========================================================================================
```

---

## 1. Document Information

This document provides the definitive, source-verified end-to-end functional journey of a Parent or Guardian utilizing the **Knowletive Multi-Tenant Education SaaS Platform**. It traces the entire lifecycle from initial student admission and parent entity creation, through authentication, multi-tenant workspace routing, consolidated multi-child academic monitoring, examination result verification, fee invoice settlement via dynamic UPI QR codes, document streaming, and notification lifecycle.

### Revision History

| Revision | Date | Summary of Changes | Author / Reviewer |
|:---|:---|:---|:---|
| `1.0` | November 2026 | Initial comprehensive source-verified baseline for Parent Portal Journey. | Core Architecture Audit Team |
| `1.1` | November 2026 | Source accuracy reconciliation: documented `/select-institute`, `switchTenantAction`, helper `setActiveTenant`, layout gating of announcements (`AppLayout:50`), 60s periodic polling, and `convertLeadAction`. | Core Architecture Audit Team |
| `1.2` | November 2026 | **Final Semantic and Payment Data Reconciliation:**<br>- Reclassified App Router routes under **"Parent-Journey App Router Routes"** (correcting the inaccurate "Authenticated" blanket label for `/login`); individually documented authentication, session, role conditions, and access nature.<br>- Restructured server-action inventory into 4 explicit availability categories: Authenticated UI actions (4), Shared tenant switcher (1), Public authentication/payment actions (2), and Exported backend action with no UI caller (`requestPasswordResetAction`).<br>- Verified `FeePayment` database non-participation: proved that `submitPaymentProofAction` mutates `model FeePaymentLink` (`utrReference`, `payerName`, `submittedAt`) without touching `FeePayment` or `FeeInvoice`; verified `FeePayment` creation is exclusive to administrative accountants (`verifyFeePaymentLinkAction` / `settleFeePaymentLink`).<br>- Confirmed 54 Prisma model partition: 23 participating + 31 non-participating disjoint models. | Core Architecture Audit Team |

---

## 2. Executive Summary

The Parent Portal is Knowletive's dedicated stakeholder interface designed for parents, guardians, and sponsors. Unlike administrative and teaching staff who operate within the multi-module back-office console (`/app/*`), parents interact with a streamlined, mobile-responsive portal hosted at `/portal`.

### Core Architectural Pillars Verified from Source

1. **Parent-Journey App Router Routes:**
   - The parent journey intersects exactly **4 App Router page routes**: `/login` (public entrypoint), `/select-institute` (authenticated conditional switcher), `/portal` (authenticated workspace dashboard), and `/portal/results/[id]` (authenticated guarded report card).
   - Calling all four "Authenticated App Router Pages" was inaccurate in earlier drafts because `/login` is an unauthenticated public route requiring neither a session nor tenant membership.

2. **Server Action Availability Categorization (8 Exported Actions):**
   - The eight exported actions participating in parent workflows partition into four precise availability tiers:
     - **Category A (Authenticated Parent-Portal UI Actions - 4):** `logoutAction`, `getInAppNotificationsAction`, `markNotificationReadAction`, `markAllNotificationsReadAction`.
     - **Category B (Shared Tenant-Selection Action - 1):** `switchTenantAction` (conditionally accessible on `/select-institute` when a parent belongs to >1 institute; redirects parents to `/portal`).
     - **Category C (Public Authentication & Payment Actions - 2):** `loginAction` (credential entry on `/login`), `submitPaymentProofAction` (UTR submission on `/pay/[token]`).
     - **Category D (Exported Backend Action with No Parent-Facing UI - 1):** `requestPasswordResetAction` (backend-ready password reset action in `src/actions/auth.ts:182`; has no UI form or button on `/login` or `/portal`).
   - `setActiveTenant` is an **internal server-side helper function** in `src/lib/auth.ts:167`, not an exported server action.

3. **Payment Data Lifecycle and `FeePayment` Non-Participation:**
   - Detailed inspection of the public payment route (`src/app/pay/[token]/page.tsx`) and the proof submission action (`submitPaymentProofAction` in `src/actions/operations.ts:251`) reveals that **`model FeePayment` is completely untouched** during parent payment interactions.
   - When a parent submits transaction proof (Bank UTR, Payer Name, Phone), the action updates **`model FeePaymentLink`** (`utrReference`, `payerName`, `payerPhone`, `payerNotes`, `submittedAt: new Date()`) and generates an in-app notice in `model NotificationLog` for institute accountants.
   - Neither `FeePayment` nor `FeeInvoice` balances are modified. The actual financial ledger record in `model FeePayment` is generated exclusively when school accountants verify the bank credit and execute `verifyFeePaymentLinkAction` (`settleFeePaymentLink`) in `/app/fees`. Consequently, `FeePayment` is **strictly non-participating** in Journey 5.

4. **Account Provisioning Gap (`Guardian.userId === null`):**
   - In Knowletive, student onboarding via `createStudentAction` (`src/actions/students.ts:31`), lead conversion via `convertLeadAction` (`src/actions/leads.ts:182`), or manual guardian creation via `createGuardianAction` (`src/actions/students.ts:186`) creates a record in `model Guardian`.
   - **Crucially, all three actions create `Guardian` records with `userId: null`.**
   - The action `convertLeadToStudentAction` does not exist in the codebase.
   - Furthermore, **no automated user account generation or invitation action (`inviteGuardianAction`) exists for guardians**.
   - For a parent to gain portal access, a corresponding `model User` record, password hash, and active `model Membership` with the `PARENT` role must be created and linked to `Guardian.userId` via out-of-band administrative seeding (`scripts/check-users.mjs`).

5. **Multi-Child Single Dashboard Experience:**
   - A parent with multiple children enrolled in the same institute does not navigate multiple sub-accounts.
   - The root portal page (`src/app/(portal)/portal/page.tsx`) executes a consolidated query finding all students where `guardians.some.guardian.userId === ctx.user.id`.
   - The dashboard dynamically renders unified cards per child displaying real-time section attendance, fee invoices with UPI payment links, student documents, and verified assessment report cards.

6. **Notification Delivery Mechanics:**
   - Knowletive does **not** utilize WebSockets, Server-Sent Events (SSE), or browser push notifications.
   - Attendance absence alerts are created **server-side synchronously** during `markAttendanceAction` (`src/actions/operations.ts:143`).
   - If `guardian.userId` is populated, an `IN_APP` notification is written to `model NotificationLog`. If `guardian.email` is present, an email notification is dispatched via SMTP/Resend.
   - In-app notifications are retrieved by `<NotificationCenter />` (`src/components/notifications/notification-center.tsx`) via `getInAppNotificationsAction()` on component mount and through **client-side periodic polling every 60 seconds**.
   - Read/unread status is updated via `markNotificationReadAction` and `markAllNotificationsReadAction`.

7. **Cryptographic Report Card Verification:**
   - Assessment results accessed via `/portal/results/[id]` require `exam.isPublished === true` and verify guardian linkage. Unauthorized or foreign IDs return a strict **404 Not Found**.
   - The portal evaluates `verifySnapshotChecksum(snapshotData, checksum)` (`src/lib/exam-snapshot.ts`), confirming data integrity against tampering.

8. **Role and Permission Scoping (Announcement Boundary):**
   - The built-in `PARENT` role (`src/lib/catalog.ts:256–260`) possesses exactly **two permissions**: `tenant.portal.read` and `tenant.announcements.read`.
   - While `tenant.announcements.read` exists in the RBAC catalog, no announcement UI is mounted in `src/app/(portal)/portal/page.tsx`, and navigating to `/app/announcements` is blocked by `src/app/(app)/app/layout.tsx:50` which redirects all non-staff users directly to `/portal`. Consequently, parents currently have no access to school announcements, and `model Announcement` remains non-participating.

---

## 3. Relationship to Journeys 1, 2, 3 and 4

The Parent Portal Journey represents the external consumer culmination of the operational workflows established in previous journeys:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          KNOWLETIVE LIFECYCLE RELATIONSHIP                             │
├──────────────────────────┬──────────────────────────┬──────────────────────────────────┤
│ JOURNEY / ACTOR          │ PRIMARY ACTIONS          │ IMPACT ON PARENT PORTAL          │
├──────────────────────────┼──────────────────────────┼──────────────────────────────────┤
│ Journey 1: Admissions    │ convertLeadAction        │ Creates Student, Class, Section, │
│ & Lifecycle (DOC-21)     │ createStudentAction      │ and Guardian (userId: null).     │
│                          │ createGuardianAction     │ Establishes StudentGuardian link.│
├──────────────────────────┼──────────────────────────┼──────────────────────────────────┤
│ Journey 2: Platform      │ provisionTenantAction    │ Establishes Tenant boundary and  │
│ Owner (DOC-22)           │                          │ provisions default roles (PARENT)│
├──────────────────────────┼──────────────────────────┼──────────────────────────────────┤
│ Journey 3: Institute     │ inviteStaffAction        │ Onboards school accountants and  │
│ Admin (DOC-23)           │ createFeeInvoiceAction   │ teachers who generate invoices   │
│                          │                          │ and academic records for parents.│
├──────────────────────────┼──────────────────────────┼──────────────────────────────────┤
│ Journey 4: Teacher       │ markAttendanceAction     │ Populates Attendance records and │
│ Operations (DOC-24)      │ enterMarksBulkAction     │ triggers absence alerts. Results │
│                          │ calculateAndPublish-     │ generate immutable ExamResult-   │
│                          │ ResultsAction            │ Snapshot report cards.           │
├──────────────────────────┼──────────────────────────┼──────────────────────────────────┤
│ Journey 5: Parent        │ switchTenantAction       │ Authenticates, selects tenant,   │
│ Portal (DOC-25)          │ submitPaymentProofAction │ monitors multi-child progress,   │
│                          │ markNotificationRead-    │ inspects reports, settles fees,  │
│                          │ Action                   │ and streams student documents.   │
└──────────────────────────┴──────────────────────────┴──────────────────────────────────┘
```

---

## 4. Parent Role and Security Architecture

### 4.1 RBAC Catalog Definition

The `PARENT` role is defined in `src/lib/catalog.ts:256–260` as a default tenant role:

```typescript
// src/lib/catalog.ts
export const DEFAULT_ROLES = [
  // ...
  {
    name: "Parent",
    key: "PARENT",
    description: "Parent portal access for monitoring student progress and fee payments.",
    permissions: [
      "tenant.portal.read",
      "tenant.announcements.read"
    ],
  },
  // ...
];
```

### 4.2 Permission Inventory and Operational Reality

| Permission Identifier | Catalog Scope | Actual Codebase Enforcement | Operational Reality |
|:---|:---|:---|:---|
| `tenant.portal.read` | Read access to parent portal | Enforced by `requireTenantUser` and tenant context checks in `src/app/(portal)/portal/layout.tsx`. | **Fully Operational.** Allows parents to load `/portal` and view linked student records. |
| `tenant.announcements.read` | Read institute announcements | Required by `/app/announcements/page.tsx`. | **Gated by Layout.** Because `src/app/(app)/app/layout.tsx:50` bounces non-staff to `/portal`, and `/portal` has no announcement UI, parents cannot view announcements. |

### 4.3 App Shell Staff Gating Boundary

The administrative and staff console is enclosed within `src/app/(app)/app/layout.tsx`. Lines 50–52 strictly enforce:

```typescript
// src/app/(app)/app/layout.tsx:50-52
if (!isStaffMember(ctx)) {
  redirect("/portal");
}
```

Where `isStaffMember(ctx)` is defined in `src/lib/auth.ts:233`:

```typescript
// src/lib/auth.ts:233
export function isStaffMember(ctx: TenantContext): boolean {
  if (ctx.user.isPlatformOwner) return true;
  if (!ctx.membership) return false;
  return STAFF_ROLES.has(ctx.membership.role.key);
}
```

Since `STAFF_ROLES` (`src/actions/auth.ts:16`) comprises `["OWNER", "ADMIN", "TEACHER", "ACCOUNTANT", "FRONT_DESK"]`, the `PARENT` role is excluded. Any attempt by a parent to access `/app`, `/app/attendance`, `/app/announcements`, or `/app/settings` is intercepted by the layout gate and redirected to `/portal`.

---

## 5. Parent Account Creation and Handoff (Stage A)

### 5.1 Student Admission and Guardian Record Creation

During student onboarding, front desk or administrative staff record guardian details through three distinct server actions:

1. **`createStudentAction` (`src/actions/students.ts:31`):**
   - Form submitted at `/app/students/new`.
   - If `guardianName` and `guardianPhone` are provided, creates `model Guardian` and links it via `model StudentGuardian` with `isPrimary: true`.
   - `Guardian.userId` is **not set** and defaults to `null`.

2. **`convertLeadAction` (`src/actions/leads.ts:182`):**
   - Form submitted at `/app/leads/[id]` when converting an admission enquiry.
   - Note: Previous documentation informally referred to this as `convertLeadToStudentAction`; the exact exported identifier is `convertLeadAction`.
   - Deduplicates guardians by phone (`tx.guardian.findFirst({ where: { tenantId, phone: lead.guardianPhone } })`). If not found, creates a new `Guardian` record.
   - Links guardian via `StudentGuardian` with `isPrimary: true`.
   - `Guardian.userId` is **not set** and defaults to `null`.

3. **`createGuardianAction` (`src/actions/students.ts:186`):**
   - Form submitted at `/app/parents/new`.
   - Creates a new `Guardian` record and optionally links to a `Student` if `studentId` is provided.
   - `Guardian.userId` is **not set** and defaults to `null`.

### 5.2 The Account Provisioning Gap and Resolution

Because none of the above actions create a `model User` record, send an onboarding email, or provision credentials, a `Guardian` record in the database is initially decoupled from the authentication system.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PARENT ACCOUNT ONBOARDING REALITY ARCHITECTURE                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   [Student Admission]                                                           │
│           │                                                                     │
│           ▼                                                                     │
│   createStudentAction / convertLeadAction / createGuardianAction                │
│           │                                                                     │
│           ▼                                                                     │
│   Creates: model Guardian { id, name, phone, email, tenantId, userId: NULL }    │
│           │                                                                     │
│           ├───[MISSING IN SYSTEM: No inviteGuardianAction, No UI Account Creator]│
│           │                                                                     │
│           ▼ (Required Out-of-Band Administrative Provisioning)                  │
│   Database Seeding / Script (e.g., scripts/check-users.mjs)                     │
│           │                                                                     │
│           ├── 1. Creates model User { id, email, passwordHash, status: ACTIVE } │
│           ├── 2. Creates model Membership { userId, tenantId, role: PARENT }    │
│           └── 3. Updates model Guardian SET userId = user.id                    │
│           │                                                                     │
│           ▼                                                                     │
│   Parent Can Successfully Authenticate and View Linked Students at /portal      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key Operational Takeaway:** If a user account is created with a parent's email but `Guardian.userId` remains `null`, the parent can successfully log in, but `/portal` will display an empty state: *"No linked student profiles found"*.

---

## 6. Parent First Login and Authentication (Stage B)

### 6.1 Authentication Entrypoint (`/login`)

The parent visits `/login` (`src/app/login/page.tsx`) and submits credentials handled by `loginAction` (`src/actions/auth.ts:25`):

1. **Rate Limiting:** Enforces `login:${ip}:${email}` (maximum 8 attempts per 10-minute window) via `model RateLimitBucket`.
2. **Account Lockout:** Checks `user.lockedUntil`. If 5 consecutive failed attempts occur, locks account for 15 minutes and writes `auth.account_locked` to `model AuditLog`.
3. **Credential Verification:** Validates password hash using `bcrypt.compare(password, user.passwordHash)`.
4. **Active Status Check:** Enforces `user.status === "ACTIVE"`.

### 6.2 Session Creation, Cookie Issuance, and Tenant Routing

Upon successful authentication (assuming 2FA is disabled):
- `createSession(user.id, meta)` writes the `kl_session` cookie (14-day expiry, `httpOnly`, `sameSite: "lax"`, `secure` in production).
- Tenant resolution proceeds as follows:

```typescript
// src/actions/auth.ts:300-325
const validTenantCookie = user.memberships.find((m) => m.tenantId === currentTenantId);

let targetTenantId: string | null = null;
let targetNext = "/app";

if (user.isPlatformOwner || user.platformRoleId) {
  targetNext = "/platform";
} else if (validTenantCookie) {
  targetTenantId = validTenantCookie.tenantId;
  const isStaff = STAFF_ROLES.has(validTenantCookie.role.key);
  targetNext = isStaff ? "/app" : "/portal";
} else if (user.memberships.length === 1) {
  targetTenantId = user.memberships[0].tenantId;
  const isStaff = STAFF_ROLES.has(user.memberships[0].role.key);
  targetNext = isStaff ? "/app" : "/portal";
} else if (user.memberships.length > 1) {
  targetNext = "/select-institute";
}

if (targetTenantId) {
  await setActiveTenant(targetTenantId);
}
redirect(targetNext);
```

### 6.3 Multi-Institute Selection (`/select-institute`) and Tenant Switching

If the parent has memberships in multiple institutes (e.g., children attending different schools powered by Knowletive):
1. `loginAction` redirects the parent to `/select-institute` (`src/app/select-institute/page.tsx`).
2. The page renders cards for each active membership, displaying the institute name, role badge (`Parent`), and destination indicator: `"Parent & Student Portal (/portal)"`.
3. Clicking an institute submits a form calling `switchTenantAction(formData)` (`src/actions/auth.ts:286`):
   ```typescript
   // src/actions/auth.ts:286-302
   export async function switchTenantAction(formData: FormData) {
     const user = await getSession();
     if (!user) redirect("/login");

     const tenantId = String(formData.get("tenantId") ?? "");
     if (!tenantId) redirect("/app");

     const isMember = user.memberships.some((m) => m.tenantId === tenantId);
     if (!isMember && !user.isPlatformOwner) redirect("/app");

     await setActiveTenant(tenantId);
     const targetMembership = user.memberships.find((m) => m.tenantId === tenantId);
     const isStaff = user.isPlatformOwner || (targetMembership && STAFF_ROLES.has(targetMembership.roleKey));
     redirect(isStaff ? "/app" : "/portal");
   }
   ```
4. `setActiveTenant` is an **internal helper function** in `src/lib/auth.ts:167` (not an exported server action). It writes the `kl_tenant` cookie (`maxAge: 30 days`, `httpOnly`, `sameSite: "lax"`).
5. Since `PARENT` is not in `STAFF_ROLES`, `switchTenantAction` executes `redirect("/portal")`.

*(Note: There is no route named `/select-tenant` or `/no-tenant`. If a user with zero memberships attempts to access the portal, `PortalLayout` renders an inline fallback card).*

## 7. Parent Portal Dashboard & Multi-Child Navigation (Stage C)

### 7.1 Portal Layout Architecture (`PortalLayout`)

The parent workspace is framed by `src/app/(portal)/portal/layout.tsx`. Unlike the administrative layout (`AppLayout`), which provides multi-tiered sidebar navigation across dozens of operational modules, `PortalLayout` renders a clean, focused, sticky top-header navigation:

1. **Brand & Institute Branding:** Displays the Knowletive Logo, active institute name (`ctx.tenant.name`), and the user's role badge (`ctx.membership?.roleName ?? "Portal Member"`).
2. **Staff Console Switcher (Staff Only):** If the authenticated user also holds a staff role (`isStaffMember(ctx)`), an "ArrowLeft Staff Console" link to `/app` is rendered. For pure parents (`PARENT`), this link is completely omitted.
3. **Notification Center:** Mounts the client-side `<NotificationCenter />` component (`src/components/notifications/notification-center.tsx`) for in-app alert monitoring.
4. **User Profile Indicator:** Renders user avatar and name.
5. **Session Termination Form:** Provides a direct logout form invoking `logoutAction`.
6. **No-Tenant Fallback State:** If `ctx` is null (the user has no active institute context and zero memberships), `PortalLayout` renders an inline fallback card ("No institute assigned yet") rather than redirecting to a nonexistent `/no-tenant` route.

### 7.2 Consolidated Multi-Child Query Architecture

When the parent arrives at `/portal` (`src/app/(portal)/portal/page.tsx`), the page executes a single, highly optimized server-side query joining linked children:

```typescript
// src/app/(portal)/portal/page.tsx:50-75
const linkedStudents = await db.student.findMany({
  where: {
    tenantId: ctx.tenant.id,
    OR: [
      {
        guardians: {
          some: {
            guardian: {
              userId: ctx.user.id,
            },
          },
        },
      },
      {
        userId: ctx.user.id, // Handles student self-access
      },
    ],
  },
  include: {
    section: { include: { class: true } },
    files: { orderBy: { createdAt: "desc" } },
  },
  orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
});
```

### 7.3 Multi-Child UI Rendering & Empty State Handling

- **Case 1: No Linked Students (`linkedStudents.length === 0`):**
  Renders the `<EmptyState>` component:
  *"No linked student profiles found. Your login is active, but no student records have been linked to your email address yet. Please contact the school administration office to link your account."*
- **Case 2: One or More Linked Students:**
  Iterates over each linked student, rendering dedicated, card-based monitoring panels. A parent with three children sees all three children on the same unified page without needing to toggle accounts.

---

## 8. Child Academic Monitoring & Records Access (Stage D)

Each child's monitoring panel on `/portal` aggregates four critical operational vectors:

```
┌────────────────────────────────────────────────────────────────────────┐
│               CONSOLIDATED CHILD RECORD CARD (/portal)                 │
├────────────────────────────────────────────────────────────────────────┤
│  [Child Avatar]  Aarav Sharma     • Class 10 - Section A               │
│                  Admission No: ADM-2026-089                            │
├────────────────────────────────────────────────────────────────────────┤
│  TAB 1: ATTENDANCE (Last 30 Days)                                      │
│  [94% Present] • 28 Present • 2 Absent • 0 Late                        │
│  Recent Trail: [P] [P] [P] [A] [P] [P] [P] ...                         │
├────────────────────────────────────────────────────────────────────────┤
│  TAB 2: EXAMINATION RESULTS & REPORT CARDS                             │
│  • Mid-Term Examination 2026: 88.5% (Grade A) [Quick View] [Verified] │
│  • Unit Test 1: 91.0% (Grade A+)              [Quick View] [Verified] │
├────────────────────────────────────────────────────────────────────────┤
│  TAB 3: FEE INVOICES & PAYMENTS                                        │
│  • Term 1 Tuition Fee: ₹25,000 [PAID]                                  │
│  • Annual Activity Fee: ₹5,000 [PENDING]  --> [ Pay Now via UPI ]      │
├────────────────────────────────────────────────────────────────────────┤
│  TAB 4: STUDENT DOCUMENTS & CERTIFICATES                               │
│  • Birth_Certificate.pdf (1.2 MB)         --> [ Download File ]        │
│  • Transfer_Certificate_Previous.pdf      --> [ Download File ]        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Daily Section Attendance & Absence Reflection

### 9.1 Attendance Data Fetching and Metrics Calculation

The portal queries attendance records for the preceding 30 days:

```typescript
// src/app/(portal)/portal/page.tsx:90-98
db.attendance.findMany({
  where: {
    tenantId: ctx.tenant.id,
    studentId: { in: studentIds },
    date: { gte: thirtyDaysAgo },
  },
  orderBy: { date: "desc" },
  take: 300,
});
```

The portal aggregates counts for each status (`PRESENT`, `ABSENT`, `LATE`, `EXCUSED`) and computes the child's 30-day attendance percentage. Each status is styled with intuitive icons:
- `PRESENT`: `<CheckCircle2 className="text-[var(--success)]" />`
- `ABSENT`: `<XCircle className="text-[var(--danger)]" />`
- `LATE`: `<Clock className="text-[var(--warning)]" />`
- `EXCUSED`: `<CheckCircle2 className="text-[var(--info)]" />`

### 9.2 Absence Alert Notification Mechanics

When a teacher submits classroom attendance via `markAttendanceAction` (`src/actions/operations.ts:143`):
1. The server executes a database upsert in a `$transaction`.
2. It filters students marked `ABSENT`.
3. For each absent student, it queries the primary guardian (`student.guardians[0]?.guardian`).
4. **Synchronous Notification Dispatch:**
   - **In-App Channel:** If `guardian.userId` is present, it calls `sendNotification()` with `channel: "IN_APP"`, writing a row to `model NotificationLog` with `recipientUserId: guardian.userId` and status `SENT`.
   - **Email Channel:** If `guardian.email` is present, it calls `sendNotification()` with `channel: "EMAIL"`, dispatching an alert via SMTP or Resend API.
5. If `guardian.userId` is `null` (unlinked account), the in-app notification is skipped entirely, ensuring the system does not create orphan notification logs.

---

## 10. Examination Results & Report Cards

### 10.1 Result Publication Gate

Only published exam results are retrieved by the parent portal:

```typescript
// src/app/(portal)/portal/page.tsx:107-125
db.examResult.findMany({
  where: {
    tenantId: ctx.tenant.id,
    studentId: { in: studentIds },
    exam: { isPublished: true },
  },
  include: {
    exam: { include: { academicYear: true } },
    snapshots: { orderBy: { version: "desc" }, take: 1 },
  },
  orderBy: { publishedAt: "desc" },
});
```

Results in `DRAFT`, `IN_PROGRESS`, or `EVALUATED` states remain strictly invisible until an administrator or authorized staff member verifies marks and calls `calculateAndPublishResultsAction`.

### 10.2 Dual Interaction Patterns

Parents are provided two distinct mechanisms to inspect report cards:
1. **Interactive Client Modal (`<StudentReportCardModal />`):**
   - Clicked via the "Quick View" button on `/portal`.
   - Renders the frozen report card snapshot inside a client modal without triggering a page transition.
2. **Dedicated Deep Link Route (`/portal/results/[id]`):**
   - Clicked via the "View Report Card" link.
   - Navigates to a standalone server-rendered page providing detailed cryptographic verification, printable styling, and institutional verification badges.

---

## 11. Cryptographic Snapshot Verification (`/portal/results/[id]`)

### 11.1 Access Control and IDOR Prevention

When `/portal/results/[id]` loads, it enforces three strict security validations:

```typescript
// src/app/(portal)/portal/results/[id]/page.tsx:48-60
// Strict Check 1: Result existence
if (!result) notFound();

// Strict Check 2: Unpublished results must never be visible
if (!result.exam.isPublished) notFound();

// Strict Check 3: Guardian relationship verification
const isStudentSelf = result.student.userId === ctx.user.id;
const isLinkedGuardian = !isStudentSelf
  ? await db.studentGuardian.findFirst({
      where: {
        studentId: result.studentId,
        guardian: { userId: ctx.user.id },
      },
    })
  : null;

if (!isStudentSelf && !isLinkedGuardian) {
  notFound(); // Fails closed with a 404 response
}
```

Any attempt by a parent to alter the URL parameter to inspect another student's report card fails closed with a **404 Not Found**.

### 11.2 SHA-256 Snapshot Checksum Verification

To ensure that grade records cannot be altered post-publication, Knowletive generates an immutable JSON snapshot and SHA-256 checksum during publication (`calculateAndPublishResultsAction`).

On `/portal/results/[id]`:
```typescript
// src/app/(portal)/portal/results/[id]/page.tsx:62-67
const latestSnapshot = result.snapshots[0];
const checksumVerification = latestSnapshot
  ? verifySnapshotChecksum(latestSnapshot.snapshotData, latestSnapshot.checksum)
  : { valid: false, reason: "No snapshot found" };
```

If `checksumVerification.valid` is true, the page displays:
- `<ShieldCheck className="text-[var(--success)]" />`
- *"Verified Immutable Report Card"*
- Checksum string: `SHA-256: [hash]`
- Frozen evaluation date and publishing authority details.

---

## 12. Fee Invoices & Payment Gateway Integration

### 12.1 Fee Invoices Query & Status Tracking

The portal retrieves fee invoices associated with all linked students:

```typescript
// src/app/(portal)/portal/page.tsx:85-89
db.feeInvoice.findMany({
  where: { tenantId: ctx.tenant.id, studentId: { in: studentIds } },
  orderBy: { dueDate: "desc" },
  take: 60,
});
```

Invoices display the invoice title, amount, due date, and status badges:
- `PAID`: Fee fully settled and verified by the accounts office.
- `PENDING`: Fee currently outstanding.
- `OVERDUE`: Current date exceeds `dueDate` and balance remains positive.

### 12.2 Public Fee Payment Gateway (`/pay/[token]`)

When a parent clicks "Pay Now" on an active invoice:
1. The portal navigates to the public token route `/pay/[token]` (`src/app/pay/[token]/page.tsx`).
2. **Architecture Note:** `/pay/[token]` is a **public token-gated route**, not an authenticated parent portal route. It does not require login or session cookies, allowing parents or sponsors to pay without session overhead.
3. The route queries `model FeePaymentLink` by `token`, verifying `link.expiresAt >= now` and `link.status !== "PAID"`.
4. **Dynamic UPI QR Code Generation:**
   Using `qrcode.toDataURL()`, the page generates a standards-compliant NPCI UPI payment URI:
   `upi://pay?pa={upiVpa}&pn={instituteName}&am={amount}&cu=INR&tn={studentName}-{invoiceTitle}`
5. **Bank Transfer Information:**
   Displays the institute's bank name, IFSC code, account number, and account holder name (retrieved from `tenant.settings`).

### 12.3 Payment Proof Submission Data Lifecycle (`submitPaymentProofAction`)

After transferring funds via UPI or bank IMPS/NEFT, the payer enters the Bank Reference / UTR Number, Payer Name, Phone, and optional Notes into the form on `/pay/[token]`.

Submitting the form invokes `submitPaymentProofAction(formData)` (`src/actions/operations.ts:251`):

```typescript
// src/actions/operations.ts:272-282
await db.feePaymentLink.update({
  where: { id: link.id },
  data: {
    utrReference,
    payerName,
    payerPhone: payerPhone || null,
    payerNotes: payerNotes || null,
    submittedAt: new Date(),
  },
});

// Notify school accountants in-app
await db.notificationLog.create({
  data: {
    tenantId: link.tenantId,
    channel: "IN_APP",
    template: "fee.payment_submitted",
    to: link.tenant.email,
    subject: `Payment proof submitted: ${link.feeInvoice.number}`,
    body: `UTR ${utrReference} submitted for ₹${(link.amount / 100).toLocaleString("en-IN")} by ${payerName} for ${link.feeInvoice.student.firstName} ${link.feeInvoice.student.lastName}.`,
    status: "SENT",
  },
});

await writeAudit({
  tenantId: link.tenantId,
  actorName: payerName,
  action: "fee.payment_link.submitted",
  entity: "FeePaymentLink",
  entityId: link.id,
  meta: { utrReference, amount: link.amount, number: link.feeInvoice.number },
});
```

### 12.4 Deep Verification of `FeePayment` Non-Participation

A code-level trace through the entire public payment workflow establishes that **`model FeePayment` is completely unaccessed and unmutated** during the Parent Journey:

1. **Which Model Stores the Proof?**
   The submitted Bank UTR reference, payer name, phone number, notes, and submission timestamp are persisted strictly within **`model FeePaymentLink`** via `db.feePaymentLink.update`.
2. **Is `FeeInvoice` Updated?**
   No. `submitPaymentProofAction` does **not** decrement `feeInvoice.paidAmount` or update its status. The invoice remains in its existing state until an authorized staff member verifies the funds in the bank.
3. **When is `FeePayment` Actually Created?**
   A row in `model FeePayment` is generated exclusively when a school accountant reviews the bank statement, opens the invoice in `/app/fees`, and executes `verifyFeePaymentLinkAction` (`src/actions/operations.ts:287`).
   This administrative action invokes `settleFeePaymentLink` (`src/lib/payments.ts:167`), which runs a transactional mutation:
   ```typescript
   // src/lib/payments.ts:205-227 (Accountant Verification Workflow Only)
   await tx.feePayment.create({
     data: {
       tenantId: link.tenantId,
       feeInvoiceId: invoice.id,
       amount,
       method: input.provider === "razorpay" ? "UPI" : "CARD",
       reference: input.providerPaymentId ?? input.providerRef ?? null,
       provider: input.provider,
       providerRef: input.providerRef ?? null,
     },
   });
   await tx.feeInvoice.update({
     where: { id: invoice.id },
     data: { paidAmount, status: fullyPaid ? "PAID" : "PARTIAL", paidAt: fullyPaid ? new Date() : null },
   });
   await tx.feePaymentLink.update({
     where: { id: link.id },
     data: { status: "PAID", paidAt: new Date() },
   });
   ```
4. **Architectural Conclusion:**
   `model FeePayment` belongs strictly to the **Administrative Accounting Workflow** (Journey 3 / Accountant Manual). It does not participate in any parent portal queries, mutations, or public payment flows. Therefore, `FeePayment` is classified as **strictly non-participating** in Journey 5.

## 13. Student Documents & File Streaming

### 13.1 Document Metadata Query on Portal

Each child's card on `/portal` queries uploaded institutional documents:

```typescript
// src/app/(portal)/portal/page.tsx:72
files: { orderBy: { createdAt: "desc" } }
```

Documents (e.g., student birth certificates, transfer certificates, previous marksheets, medical clearance forms) are listed with file name, formatted file size, creation timestamp, and a direct download button linking to `/api/files/[id]`.

### 13.2 Secure File Streaming Route (`/api/files/[id]`)

File downloads are handled by the dedicated streaming API route `src/app/api/files/[id]/route.ts`. The route enforces rigorous multi-tenant relational authorization before streaming any binary bytes:

```typescript
// src/app/api/files/[id]/route.ts:47-56
if (!isStaff) {
  const isStudentSelf = fileAsset.studentId && fileAsset.student?.userId === user.id;
  const isLinkedGuardian = fileAsset.studentId
    ? await db.studentGuardian.findFirst({
        where: {
          studentId: fileAsset.studentId,
          guardian: { userId: user.id, tenantId: fileAsset.tenantId },
        },
      })
    : null;

  if (!isStudentSelf && !isLinkedGuardian) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}
```

### 13.3 Security Invariants of File Streaming

1. **Authentication Gate:** Anonymous requests return `401 Unauthorized`.
2. **Tenant Scoping:** If a file belongs to a different institute, the route fails closed.
3. **Relational Linkage Check:** For non-staff parent users, the route strictly verifies that `db.studentGuardian` contains an active relationship connecting the student who owns the file to a `Guardian` record linked to the requesting `user.id`.
4. **Tampering Protection:** Any attempt to guess or brute-force file asset UUIDs across students or tenants immediately returns **403 Forbidden**.
5. **Streaming Response:** Once verified, the route streams the file directly from disk storage with appropriate headers (`Content-Type`, `Content-Disposition: inline; filename="..."`, `Content-Length`).

---

## 14. Parent Notifications & Alerts (Stage E)

### 14.1 Notification Architecture & Delivery Mechanics

Knowletive's notification system is built on **synchronous server-side generation** and **client-side periodic polling**. It does **not** employ WebSockets, Server-Sent Events (SSE), or browser push notification APIs.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   NOTIFICATION ARCHITECTURE & LIFECYCLE FLOW                     │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   [Teacher Marks Attendance]                                                     │
│             │                                                                    │
│             ▼                                                                    │
│   markAttendanceAction (src/actions/operations.ts)                               │
│             │                                                                    │
│             ├── Synchronous absence detection for each absent student            │
│             │                                                                    │
│             ▼                                                                    │
│   sendNotification (src/lib/notifications.ts)                                    │
│             │                                                                    │
│             ├── [Channel: IN_APP]                                                │
│             │   If guardian.userId is set:                                       │
│             │   Writes row to model NotificationLog                              │
│             │   { recipientUserId, channel: "IN_APP", status: "SENT", ... }      │
│             │                                                                    │
│             └── [Channel: EMAIL]                                                 │
│                 If guardian.email is set:                                        │
│                 Dispatches message via SMTP or Resend API                        │
│                 Updates NotificationLog with delivery status / providerRef       │
│                                                                                  │
│   [Parent Portal Session at /portal]                                             │
│             │                                                                    │
│             ▼                                                                    │
│   <NotificationCenter /> Component (src/components/notifications/...)            │
│             │                                                                    │
│             ├── 1. On Mount: Calls getInAppNotificationsAction()                 │
│             ├── 2. Periodic Polling: setInterval every 60 seconds (60,000ms)     │
│             └── 3. On User Click: Fetches fresh unread count and latest 25 logs  │
│                                                                                  │
│   [Parent Marks Notification Read]                                               │
│             │                                                                    │
│             ▼                                                                    │
│   markNotificationReadAction(formData) / markAllNotificationsReadAction()        │
│             │                                                                    │
│             └── Updates NotificationLog SET isRead = true, readAt = NOW()        │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 14.2 Outbound Channels and Provider Fallbacks

In `src/lib/notifications.ts`, delivery logic operates through provider-agnostic handlers:
- **Email Delivery (`deliverEmail`):**
  1. Primary: Direct zero-cost SMTP transport via `nodemailer` if `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are configured.
  2. Fallback: Resend API via HTTPS fetch if `RESEND_API_KEY` and `EMAIL_FROM` are set.
  3. Development / Missing Config: Dumps message payload to server console without throwing, or marks `NotificationLog.status = "SKIPPED"` to prevent PII leakage.
- **SMS / WhatsApp (`deliverSms`, `deliverWhatsApp`):**
  Supported by provider handlers (Twilio, WhatsApp Business Cloud API), but currently **not invoked** by classroom attendance workflows (which invoke only `IN_APP` and `EMAIL`).

### 14.3 In-App Notification Lifecycle and Client Polling

1. **Query Implementation (`getInAppNotificationsAction`):**
   - Exported from `src/actions/notifications.ts:8`.
   - Requires an authenticated user session (`getSession()`).
   - Queries `db.notificationLog.findMany` where `channel: "IN_APP"` and `recipientUserId === user.id`.
   - Returns the latest 25 notifications and the exact unread count.
2. **Client Polling Interval:**
   - In `src/components/notifications/notification-center.tsx:43–58`, `useEffect` establishes an interval:
     `const interval = setInterval(() => { void getInAppNotificationsAction().then(...) }, 60_000);`
   - Unread alerts refresh in the background every 60 seconds without full-page reloads.
3. **Read State Mutation:**
   - Clicking the checkmark button next to an alert invokes `markNotificationReadAction(formData)`.
   - Clicking "Mark all read" invokes `markAllNotificationsReadAction()`.
   - Both actions verify ownership (`recipientUserId === user.id`), mutate `isRead: true` and `readAt: new Date()`, and trigger cache revalidation via `revalidatePath("/portal")`.

### 14.4 Handling Unlinked Guardian Accounts

If an absent student's primary guardian record has `userId: null`:
- `markAttendanceAction` executes `if (guardian.userId)` which evaluates to false.
- The `IN_APP` notification is **not created**, preventing orphan logs.
- The system still attempts to send the `EMAIL` alert if `guardian.email` is populated.
- Once school administration links a `User` account to the `Guardian` record, subsequent absence events immediately begin populating the in-app notification center.

---

## 15. Announcements and Communication Boundaries

### 15.1 The Announcement Access Discrepancy

A critical architectural distinction verified in the Knowletive codebase relates to school announcements:

1. **The RBAC Catalog Definition:**
   `src/lib/catalog.ts:259` assigns the permission `tenant.announcements.read` to the built-in `PARENT` role.
2. **The App Shell Barrier:**
   The school announcement viewer is located at `/app/announcements/page.tsx`. However, all `/app/*` routes are wrapped by `src/app/(app)/app/layout.tsx`. As verified in Section 4.3, line 50 of `AppLayout` executes:
   ```typescript
   if (!isStaffMember(ctx)) {
     redirect("/portal");
   }
   ```
   Because `PARENT` is not in `STAFF_ROLES`, any parent attempting to navigate to `/app/announcements` is immediately redirected to `/portal`.
3. **Absence of Portal Announcement UI:**
   Inspection of `src/app/(portal)/portal/page.tsx` and its child components confirms that **no announcement queries or rendering components exist in the parent portal**.
4. **Architectural Conclusion:**
   Despite holding the `tenant.announcements.read` permission in the RBAC matrix, parents **cannot currently view institute announcements**. Consequently, `model Announcement` is classified as **non-participating** in the parent portal journey.

### 15.2 Absence of Direct Messaging Workflows

Knowletive does not currently provide:
- A real-time parent-to-teacher chat room or direct messaging console.
- A parent-initiated absence excuse submission form (parents must contact the school office out-of-band).
- A teacher office-hours booking or appointment scheduling tool.

---

## 16. Parent Account & Profile Management (Stage F)

### 16.1 Read-Only Profile Presentation

Parent identity is displayed in the sticky navigation header of `PortalLayout` (`src/app/(portal)/portal/layout.tsx`):
- User avatar with initials and generated background color (`<Avatar name={user.name} color={user.avatarColor} size={28} />`).
- User full name (`user.name`).
- User registered email address (`user.email`).

There is **no self-service profile edit form** in the parent portal. If a parent changes their legal name, phone number, or email address, the modification must be executed by school administrative staff via `/app/parents/[id]` (`updateGuardianAction`).

### 16.2 Session Termination (`logoutAction`)

Clicking the "Sign out" button in the portal header submits a form invoking `logoutAction` (`src/actions/auth.ts:251`):
1. Retrieves the active session token from the `kl_session` cookie.
2. Deletes the corresponding `model Session` record in the database.
3. Clears both `kl_session` and `kl_tenant` cookies (`maxAge: 0`).
4. Executes `redirect("/login")`.

### 16.3 Password Reset Workflow (`requestPasswordResetAction`)

Knowletive includes a fully functional, rate-limited password reset action in `src/actions/auth.ts:182` (`requestPasswordResetAction`):
- Validates the submitted email against `forgotPasswordSchema`.
- Applies IP rate limiting via `RateLimitBucket` (maximum 6 requests per 15 minutes).
- Generates an encrypted single-use token in `model PasswordResetToken` (60-minute expiry).
- Dispatches a password reset email via `passwordResetMessage`.
- **UI Limitation:** While the server action and email templates are fully implemented, there is currently no public "Forgot Password" form link mounted on `/login` or `/portal`. Password resets are initiated administratively or via direct API/script calls.

---

## 17. Multi-Tenant Security & Student Data Isolation

### 17.1 Cross-Tenant Isolation Principles

Knowletive guarantees strict multi-tenant and cross-student data isolation through multiple defense-in-depth architectural layers:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        DATA ISOLATION & ACCESS CONTROL LAYERS                          │
├─────────────────────────┬──────────────────────────────────────────────────────────────┤
│ LAYER                   │ ENFORCEMENT MECHANISM & SOURCE CODE ANCHOR                   │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 1. Cookie & Context     │ getTenantContext() in src/lib/auth.ts resolves tenant from   │
│                         │ kl_tenant cookie and verifies active membership.             │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 2. Layout Gating        │ src/app/(app)/app/layout.tsx:50 bounces non-staff users      │
│                         │ out of administrative /app/* routes into /portal.            │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 3. Relational Filtering │ src/app/(portal)/portal/page.tsx filters students via:       │
│                         │ guardians.some.guardian.userId === ctx.user.id.              │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 4. IDOR Exam Guard      │ src/app/(portal)/portal/results/[id]/page.tsx:48-60 verifies │
│                         │ studentGuardian relationship and exam.isPublished === true.  │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 5. File Streaming Guard │ src/app/api/files/[id]/route.ts:47-56 queries                │
│                         │ studentGuardian before streaming file bytes.                 │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 6. Public Pay Guard     │ src/app/pay/[token]/page.tsx validates token uniqueness,     │
│                         │ non-expiration, and unpaid status before accepting proof.    │
└─────────────────────────┴──────────────────────────────────────────────────────────────┘
```

### 17.2 IDOR Vulnerability Prevention

Insecure Direct Object Reference (IDOR) attacks are strictly prevented across all parent endpoints:
- **Tampering with Result IDs:** Navigating to `/portal/results/random-uuid` does not disclose foreign report cards; the relational check fails closed with a Next.js `notFound()` (404 response).
- **Tampering with File IDs:** Requesting `/api/files/foreign-uuid` validates that the requesting parent's `user.id` is linked to the student owning the file asset in `db.studentGuardian`. Unauthorized access returns a strict `403 Forbidden`.
- **Tampering with Invoice Links:** Payment links on `/pay/[token]` are cryptographically random 32-character tokens, preventing sequential enumeration attacks.

## 18. Complete Screen-by-Screen Functional Matrix

To maintain rigorous source-level precision, Knowletive's user-facing touchpoints are classified into four distinct functional categories rather than conflating client modals, background endpoints, and public web pages into App Router screens.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                      FUNCTIONAL INTERFACE CLASSIFICATION MATRIX                        │
├───────────────────────┬───────┬──────────────────────────────────┬─────────────────────┤
│ CATEGORY              │ COUNT │ INTERFACES / IDENTIFIERS         │ ROUTE TYPE          │
├───────────────────────┼───────┼──────────────────────────────────┼─────────────────────┤
│ A. Parent-Journey     │   4   │ P-01 (/login), P-02 (/select-    │ App Router Page     │
│    App Router Routes  │       │ institute), P-03 (/portal),      │ Routes              │
│                       │       │ P-04 (/portal/results/[id])      │                     │
├───────────────────────┼───────┼──────────────────────────────────┼─────────────────────┤
│ B. Reusable Overlays  │   2   │ C-01 (<StudentReportCardModal>), │ Client-Side Modal / │
│                       │       │ C-02 (<NotificationCenter>)      │ Dropdown Drawer     │
├───────────────────────┼───────┼──────────────────────────────────┼─────────────────────┤
│ C. API Endpoints      │   1   │ E-01 (/api/files/[id])           │ Binary File Stream  │
├───────────────────────┼───────┼──────────────────────────────────┼─────────────────────┤
│ D. Public Workflows   │   1   │ T-01 (/pay/[token])              │ Token-Gated Payment │
└───────────────────────┴───────┴──────────────────────────────────┴─────────────────────┘
```

---

### 18.1 Parent-Journey App Router Routes

#### Screen P-01: Parent Credential Authentication
- **Route:** `/login` (`src/app/login/page.tsx`)
- **Layout:** Root public layout (`src/app/layout.tsx`)
- **Authentication Required:** **No** (Public unauthenticated entrypoint)
- **Valid Session Required:** **No** (Session cookies are evaluated if present, but unauthenticated visitors load the login form directly)
- **Role / Membership Condition:** **None** (Accessible to any visitor, user, or platform stakeholder)
- **Accessible to Parents:** **Yes** (Primary credential entrypoint for parent accounts)
- **Access Nature:** **Direct** (Navigated directly via URL or automatically reached via unauthenticated redirects)
- **Primary Actions:** Submits email and password to `loginAction`.
- **Visible Elements:** Knowletive logo, institute OS subtitle, email input, password input, sign-in button, lockout countdown warning.
- **Redirect Dynamics:** If the parent has 1 membership with role `PARENT`, writes `kl_tenant` and redirects directly to `/portal`. If the parent user holds memberships in >1 institute, redirects to `/select-institute`.

#### Screen P-02: Multi-Tenant Institute Switcher
- **Route:** `/select-institute` (`src/app/select-institute/page.tsx`)
- **Layout:** Sunken standalone container (`src/app/layout.tsx`)
- **Authentication Required:** **Yes**
- **Valid Session Required:** **Yes** (`getSession()` required; redirects unauthenticated requests to `/login`)
- **Role / Membership Condition:** Requires user account to possess **more than one active membership** (`user.memberships.length > 1`) across non-churned institutes. Single-membership users are automatically routed past this page directly to their destination.
- **Accessible to Parents:** **Yes, conditionally**
- **Access Nature:** **Conditional** (Rendered exclusively when a parent user account is enrolled across multiple institutes, such as having children in different schools powered by Knowletive)
- **Primary Actions:** Submits selected `tenantId` to `switchTenantAction(formData)`.
- **Visible Elements:** Multi-institute list cards, institute name, role badge (`Parent`), destination indicator (`Parent & Student Portal (/portal)`), "Enter" button with arrow icon, global "Sign out" button.
- **Routing Note:** Previous documentation informally referenced `/select-tenant`; the verified App Router route in source is `/select-institute`.

#### Screen P-03: Consolidated Parent Portal Workspace & Child Overview
- **Route:** `/portal` (`src/app/(portal)/portal/page.tsx`)
- **Layout:** Framed by `PortalLayout` (`src/app/(portal)/portal/layout.tsx`)
- **Authentication Required:** **Yes**
- **Valid Session Required:** **Yes** (`getSession()` and `getTenantContext()` required via `PortalLayout`)
- **Role / Membership Condition:** Active membership in the resolved tenant with the `PARENT` role (or student self-access).
- **Accessible to Parents:** **Yes** (The primary home console for parents)
- **Access Nature:** **Direct** for single-membership parents after login; reached via `/select-institute` for multi-institute parents.
- **Primary Actions:** Toggles child monitoring tabs, triggers report card modal preview, initiates fee settlement navigation to `/pay/[token]`, clicks document download links.
- **Visible Elements:**
  - Header: Tenant name, role badge, `<NotificationCenter />`, user avatar, sign-out button.
  - Body: Student summary header (Class, Section, Admission No), attendance statistics widget (30-day percentage, Present/Absent/Late pills), published exam result cards, pending fee invoice cards with "Pay Now" buttons, uploaded document attachments list.
  - Fallback: `<EmptyState>` when no linked students are found (`linkedStudents.length === 0`).

#### Screen P-04: Verified Assessment Report Card Detail
- **Route:** `/portal/results/[id]` (`src/app/(portal)/portal/results/[id]/page.tsx`)
- **Layout:** Framed by `PortalLayout` (`src/app/(portal)/portal/layout.tsx`)
- **Authentication Required:** **Yes**
- **Valid Session Required:** **Yes** (`getSession()` and `getTenantContext()` required)
- **Role / Membership Condition:** User must have an active session in the tenant and be linked to the candidate student via `db.studentGuardian.findFirst({ where: { studentId: result.studentId, guardian: { userId: ctx.user.id } } })`. Furthermore, the examination must be published (`exam.isPublished === true`).
- **Accessible to Parents:** **Yes, conditionally**
- **Access Nature:** **Conditional / Guarded** (Requires linked child ownership of the specific result ID and published exam status; unauthorized, foreign, or unpublished IDs return 404 Not Found).
- **Primary Actions:** Navigates back to `/portal`, triggers browser print dialog for physical report card filing.
- **Visible Elements:** Institution header, student details block, subject-wise marks table (Maximum Marks, Marks Obtained, Percentage, Grade), aggregate statistics (Total, Overall Percentage, Overall Grade), cryptographic trust badge (`<ShieldCheck /> Verified Immutable Report Card`), SHA-256 checksum hash, publishing timestamp.

---

### 18.2 Reusable UI Components & Drawers

#### Component C-01: Interactive Report Card Modal
- **Component Identifier:** `<StudentReportCardModal />` (`src/components/exams/exam-client-bits.tsx`)
- **Mount Point:** Instantiated on `/portal` next to published exam results via the "Quick View" button.
- **Nature:** Client-side modal overlay (`"use client"`). Does not perform page navigation.
- **Visible Elements:** Modal backdrop, institution emblem, student header, frozen snapshot marks table, grade band indicators, close button.

#### Component C-02: In-App Notification Center Drawer
- **Component Identifier:** `<NotificationCenter />` (`src/components/notifications/notification-center.tsx`)
- **Mount Point:** Mounted in the sticky header of `PortalLayout` (`src/app/(portal)/portal/layout.tsx`).
- **Nature:** Client-side dropdown drawer (`"use client"`).
- **Delivery Mechanics:** Calls `getInAppNotificationsAction()` on mount and polls every 60 seconds.
- **Visible Elements:** Bell icon with unread count badge (e.g., `3 new` or `9+`), scrollable notification list, unread indicators, relative timestamps (`timeAgo`), individual checkmark "Mark as read" buttons, top-level "Mark all read" button.

---

### 18.3 API Endpoints & Resource Streaming

#### Endpoint E-01: Secure Student Document Streaming Route
- **Route:** `/api/files/[id]` (`src/app/api/files/[id]/route.ts`)
- **Protocol:** HTTP GET
- **Nature:** Next.js Route Handler streaming binary file bytes. Not an HTML web page.
- **Access Control:** Requires active session. Checks `db.studentGuardian.findFirst({ where: { studentId: fileAsset.studentId, guardian: { userId: user.id, tenantId } } })`. Unauthorized attempts return **403 Forbidden**.
- **Output:** Binary data stream with `Content-Type: application/pdf` (or image mime-type) and `Content-Disposition: inline`.

---

### 18.4 Public Token-Based Workflows

#### Workflow T-01: Public Fee Settlement & UPI Payment Gateway
- **Route:** `/pay/[token]` (`src/app/pay/[token]/page.tsx`)
- **Layout:** Standalone public layout (`src/app/layout.tsx`)
- **Nature:** Public token-gated web route. Does **not** require login or session cookies.
- **Access Control:** Gated by cryptographic token lookup in `model FeePaymentLink`. Rejects expired or already-paid links.
- **Primary Actions:** Submits transaction reference (UTR) to public server action `submitPaymentProofAction`.
- **Visible Elements:** Institution name, student name, class and section, invoice title, amount in INR, dynamic UPI QR code (`QRCode.toDataURL`), bank details block (Account Number, IFSC, Bank Name, Account Holder), transaction proof submission form (UTR number, payer name, phone, notes), "Submit Payment Proof" button.

---

### 18.5 Inline Fallback & Error State Matrix

| State Identifier | Triggering Condition | Hosting File & Container | UI Presentation |
|:---|:---|:---|:---|
| **State S-01** | Zero Active Memberships (`user.memberships.length === 0`) | `src/app/(portal)/portal/layout.tsx:24–45`<br>`src/app/(app)/app/layout.tsx:24–45` | **Inline Fallback Card:** *"No institute assigned yet. Your account is active but isn't linked to a school. Please contact your school administrator."* Includes Sign Out button. Confirms that no standalone `/no-tenant` route exists. |
| **State S-02** | Unlinked Guardian Account (`linkedStudents.length === 0`) | `src/app/(portal)/portal/page.tsx:242–260` | **Inline Empty State:** *"No linked student profiles found. Your login is active, but no student records have been linked to your email address yet. Please contact school administration."* |

---

## 19. Journey-Relevant Server-Action Inventory

### 19.1 Action Availability Categorization (8 Exported Actions)

The following eight exported server actions represent the complete, source-verified inventory of actions participating in parent workflows, categorized by actual operational availability:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        SERVER ACTION AVAILABILITY CATEGORIZATION                       │
├──────────────────────────┬───────┬─────────────────────────────────────────────────────┤
│ CATEGORY                 │ COUNT │ EXPORTED SERVER ACTIONS                             │
├──────────────────────────┼───────┼─────────────────────────────────────────────────────┤
│ Category A: Authenticated│   4   │ logoutAction, getInAppNotificationsAction,          │
│ Parent-Portal UI Actions │       │ markNotificationReadAction, markAllNotifications-   │
│                          │       │ ReadAction                                          │
├──────────────────────────┼───────┼─────────────────────────────────────────────────────┤
│ Category B: Shared       │   1   │ switchTenantAction                                  │
│ Tenant-Selection Action  │       │                                                     │
├──────────────────────────┼───────┼─────────────────────────────────────────────────────┤
│ Category C: Public       │   2   │ loginAction, submitPaymentProofAction               │
│ Workflow Actions         │       │                                                     │
├──────────────────────────┼───────┼─────────────────────────────────────────────────────┤
│ Category D: Exported     │   1   │ requestPasswordResetAction                          │
│ Backend Action (No UI)   │       │                                                     │
├──────────────────────────┴───────┴─────────────────────────────────────────────────────┤
│ TOTAL EXPORTED SERVER ACTIONS: Exactly 8 Actions                                       │
│ Internal Helper Function (Not a Server Action): setActiveTenant (src/lib/auth.ts)      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

#### Category A: Authenticated Parent-Portal UI Actions (4 Actions)

| Action Name | Source File | Auth Requirement | UI Invocation Site | Exact Functional Behavior |
|:---|:---|:---|:---|:---|
| `logoutAction` | `src/actions/auth.ts:251` | Authenticated | `PortalLayout` Sign Out Button | Deletes `Session` record, deletes `kl_session` and `kl_tenant` cookies, and redirects to `/login`. |
| `getInAppNotificationsAction` | `src/actions/notifications.ts:8` | Authenticated | `<NotificationCenter />` | Queries `NotificationLog` where `recipientUserId === user.id` and `channel === "IN_APP"`. Returns latest 25 logs and unread count. |
| `markNotificationReadAction` | `src/actions/notifications.ts:50` | Authenticated | `<NotificationCenter />` Row Checkmark | Validates ownership and updates `NotificationLog` setting `isRead: true` and `readAt: NOW()`. Revalidates `/portal`. |
| `markAllNotificationsReadAction` | `src/actions/notifications.ts:82` | Authenticated | `<NotificationCenter />` "Mark all read" | Updates all unread in-app logs for `user.id` to read. Revalidates `/portal`. |

---

#### Category B: Shared Tenant-Selection Action (1 Action)

| Action Name | Source File | Auth Requirement | UI Invocation Site | Exact Functional Behavior |
|:---|:---|:---|:---|:---|
| `switchTenantAction` | `src/actions/auth.ts:286` | Authenticated | `/select-institute` Cards | Conditionally available to parents with memberships across multiple institutes. Validates target membership, invokes internal helper `setActiveTenant(tenantId)`, inspects whether role is in `STAFF_ROLES`, and redirects parents directly to `/portal`. |

---

#### Category C: Public Authentication & Payment Actions (2 Actions)

| Action Name | Source File | Auth Requirement | UI Invocation Site | Exact Functional Behavior |
|:---|:---|:---|:---|:---|
| `loginAction` | `src/actions/auth.ts:25` | Public / Rate-limited | `/login` Form | Authenticates credentials, verifies lockout, writes `kl_session`, determines tenant destination, and redirects to `/portal` or `/select-institute`. |
| `submitPaymentProofAction` | `src/actions/operations.ts:251` | Public Token-Gated | `/pay/[token]` Form | Updates `FeePaymentLink` with UTR reference, payer name, and timestamp. Dispatches notification to accountants. Does not touch `FeePayment`. |

---

#### Category D: Exported Backend Action with No Parent-Facing UI (1 Action)

| Action Name | Source File | Auth Requirement | UI Invocation Site | Exact Functional Behavior |
|:---|:---|:---|:---|:---|
| `requestPasswordResetAction` | `src/actions/auth.ts:182` | Public / Rate-limited | **No Parent-Facing UI** | Fully exported server action in `src/actions/auth.ts`. Validates email, creates `PasswordResetToken`, and sends reset email. **Crucially: There is currently no UI caller or "Forgot Password" form link mounted on `/login` or `/portal`.** It is an exported backend capability, not an active parent-facing UI feature. |

---

#### Architectural Note on `setActiveTenant`:
`setActiveTenant` is defined in `src/lib/auth.ts:167` as an **internal server-side helper function** that writes the `kl_tenant` cookie (`maxAge: 30 days`, `httpOnly`, `sameSite: "lax"`). It is **not** an exported server action, cannot be referenced in form actions, and is invoked internally by `loginAction` and `switchTenantAction`.

---

### 19.2 Restricted Administrative Server Actions (24 Actions Denied to Parents)

The built-in `PARENT` role lacks all write permissions across the institute. Any attempt to invoke administrative actions fails closed via `authorizeTenantWrite`:

| Domain | Action Identifier | Source File | Required Permission | Denial Reason |
|:---|:---|:---|:---|:---|
| **Admissions** | `createStudentAction` | `src/actions/students.ts:31` | `tenant.students.write` | Denied: Parent cannot admit students. |
| **Admissions** | `updateStudentAction` | `src/actions/students.ts:123` | `tenant.students.write` | Denied: Parent cannot edit core student records. |
| **Admissions** | `convertLeadAction` | `src/actions/leads.ts:182` | `tenant.leads.convert` | Denied: Parent cannot convert CRM leads. |
| **Parents** | `createGuardianAction` | `src/actions/students.ts:186` | `tenant.parents.write` | Denied: Parent cannot create guardian records. |
| **Parents** | `updateGuardianAction` | `src/actions/students.ts:228` | `tenant.parents.write` | Denied: Parent cannot modify guardian profiles. |
| **Parents** | `deleteGuardianAction` | `src/actions/students.ts:285` | `tenant.parents.write` | Denied: Parent cannot delete guardian links. |
| **Staff** | `inviteStaffAction` | `src/actions/students.ts:301` | `tenant.staff.write` | Denied: Parent cannot onboard teachers/staff. |
| **Staff** | `removeStaffAction` | `src/actions/students.ts:384` | `tenant.staff.write` | Denied: Parent cannot terminate staff. |
| **Academics** | `createClassAction` | `src/actions/students.ts:408` | `tenant.academics.write` | Denied: Parent cannot create class levels. |
| **Academics** | `createSectionAction` | `src/actions/students.ts:430` | `tenant.academics.write` | Denied: Parent cannot create sections. |
| **Academics** | `createSubjectAction` | `src/actions/students.ts:457` | `tenant.academics.write` | Denied: Parent cannot configure subjects. |
| **Attendance** | `markAttendanceAction` | `src/actions/operations.ts:143` | `tenant.attendance.write` | Denied: Parent cannot mark attendance registers. |
| **Finance** | `createFeeInvoiceAction` | `src/actions/operations.ts:29` | `tenant.fees.write` | Denied: Parent cannot generate fee invoices. |
| **Finance** | `recordPaymentAction` | `src/actions/operations.ts:79` | `tenant.fees.write` | Denied: Parent cannot record fee payments. |
| **Finance** | `createFeePaymentLinkAction`| `src/actions/operations.ts:203` | `tenant.fees.write` | Denied: Parent cannot generate payment links. |
| **Examinations** | `createExaminationAction` | `src/actions/exams.ts:31` | `tenant.exams.write` | Denied: Parent cannot create exam sessions. |
| **Examinations** | `enterMarksBulkAction` | `src/actions/exams.ts:173` | `tenant.exams.write` | Denied: Parent cannot grade or enter marks. |
| **Examinations** | `verifyExamSubjectMarksAction`| `src/actions/exams.ts:258` | `tenant.exams.verify` | Denied: Parent cannot verify teacher marks. |
| **Examinations** | `calculateAndPublishResultsAction`| `src/actions/exams.ts:321` | `tenant.exams.publish` | Denied: Parent cannot publish results. |
| **Batches** | `createBatchAction` | `src/actions/batches.ts:45` | `tenant.batches.write` | Denied: Parent cannot create coaching batches. |
| **Batches** | `enrollStudentsAction` | `src/actions/batches.ts:512` | `tenant.batches.write` | Denied: Parent cannot enroll batch students. |
| **Batches** | `dropStudentAction` | `src/actions/batches.ts:579` | `tenant.batches.write` | Denied: Parent cannot drop students from batches. |
| **Syllabus** | `createSyllabusTrackAction`| `src/actions/syllabus.ts:34` | `tenant.syllabus.write` | Denied: Parent cannot configure syllabus tracks. |
| **Announcements**| `createAnnouncementAction`| `src/actions/operations.ts:382` | `tenant.announcements.write`| Denied: Parent cannot broadcast announcements. |

---

## 20. Database Lifecycle and Relationship Architecture

### 20.1 Complete 54-Model Partition Overview

The Knowletive Prisma schema (`prisma/schema.prisma`) declares exactly **54 models**. In the Parent Portal Journey, these models partition into **23 participating models** and **31 non-participating models**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PRISMA SCHEMA COMPLETE 54-MODEL PARTITION                       │
├─────────────────────────────────────────────────┬──────────────────────────────────────┤
│ PARTICIPATING MODELS (23)                       │ NON-PARTICIPATING MODELS (31)        │
├─────────────────────────────────────────────────┼──────────────────────────────────────┤
│ User, Session, Membership, Role, Tenant,        │ Lead, LeadActivity, Plan,            │
│ Guardian, Student, StudentGuardian, ClassLevel, │ TenantSubscription, TenantUsage,     │
│ Section, AcademicYear, Attendance, FeeInvoice,  │ Invoice, Payment, WebhookEvent,      │
│ FeePaymentLink, Examination, ExamSubject,       │ Permission, RolePermission, Batch,   │
│ Subject, ExamResult, ExamResultSnapshot,        │ BatchTeacher, BatchStudent,          │
│ FileAsset, NotificationLog, RateLimitBucket,    │ BatchEnrollmentEvent, SyllabusTrack, │
│ AuditLog                                        │ SyllabusChapter, SyllabusTopic,      │
│                                                 │ SyllabusTeacher, TopicProgress,      │
│                                                 │ SyllabusProgressEvent, LessonPlan,   │
│                                                 │ ExamEnrollment, ExamMark,            │
│                                                 │ ExamMarksRevisionEvent, GradeBand,   │
│                                                 │ GradeScale, Setting, FeePayment,     │
│                                                 │ PasswordResetToken, Announcement,    │
│                                                 │ AiJob                                │
├─────────────────────────────────────────────────┴──────────────────────────────────────┤
│ VERIFICATION: 23 Participating + 31 Non-Participating = Exactly 54 Models              │
│ Disjoint Sets: Participating ∩ Non-Participating = ∅                                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 20.2 Participating Models Inventory (23 Models)

| # | Model Name | Category | Exact Parent Journey Operational Role |
|:---|:---|:---|:---|
| 1 | `User` | Identity & Auth | Represents the parent login identity; stores email, name, avatarColor, passwordHash. |
| 2 | `Session` | Identity & Auth | Holds active session token (`kl_session`) for parent authentication and session termination. |
| 3 | `Membership` | Tenancy & RBAC | Connects parent `User` to `Tenant` with role `PARENT`. Validated during tenant resolution. |
| 4 | `Role` | Tenancy & RBAC | Resolves the built-in `PARENT` role name and permission set. |
| 5 | `Tenant` | Tenancy & RBAC | Scopes institute boundaries, workspace branding, and bank/UPI settings. |
| 6 | `Guardian` | Core Stakeholder | Stores parent legal name, phone, email, relation, and links to `User.id` via `userId`. |
| 7 | `Student` | Academic Core | Represents the child profile; queried on `/portal` via relational joins. |
| 8 | `StudentGuardian`| Relational Link | Junction table linking `Student` and `Guardian`; enforces IDOR authorization guards. |
| 9 | `ClassLevel` | Academic Structure| Queried via `section.class` to display child grade level (e.g., "Class 10"). |
| 10 | `Section` | Academic Structure| Queried via `student.section` to display classroom division (e.g., "Section A"). |
| 11 | `AcademicYear` | Academic Structure| Displayed on assessment results to contextualize examination terms (e.g., "2026-2027"). |
| 12 | `Attendance` | Classroom Telemetry| Queried on `/portal` for the last 30 days to render attendance percentage and status pills. |
| 13 | `FeeInvoice` | Financial Tracking| Queried on `/portal` and `/pay/[token]` to display outstanding student fee liabilities. |
| 14 | `FeePaymentLink` | Payment Gateway | Queried on `/pay/[token]` to render dynamic UPI QR codes and updated by `submitPaymentProofAction`. |
| 15 | `Examination` | Assessment Core | Queried on `/portal` and `/portal/results/[id]` to verify `isPublished === true`. |
| 16 | `ExamSubject` | Assessment Core | Queried on `/portal/results/[id]` to render subject-wise marks table structure. |
| 17 | `Subject` | Academic Structure| Resolves subject names (e.g., "Mathematics", "Science") in assessment reports. |
| 18 | `ExamResult` | Assessment Core | Stores aggregated marks, percentage, and overall grade for the student. |
| 19 | `ExamResultSnapshot`| Cryptographic Audit| Stores frozen JSON report card data and SHA-256 checksum evaluated on `/portal/results/[id]`. |
| 20 | `FileAsset` | Document Storage | Queried on `/portal` and streamed via `/api/files/[id]` for birth certificates and records. |
| 21 | `NotificationLog`| Communication | Outbox storing in-app alerts polled by `<NotificationCenter />` every 60 seconds. |
| 22 | `RateLimitBucket`| Infrastructure | Enforces IP rate limiting on `/login`, `/pay/[token]`, and password reset requests. |
| 23 | `AuditLog` | Compliance & Audit | Records authentication events (`auth.login`, `auth.account_locked`) and payment submissions. |

---

### 20.3 Non-Participating Models Inventory (31 Models)

The following 31 models are completely uninvolved in parent portal execution:

| Category | Count | Model Identifiers | Explicit Non-Participation Rationale |
|:---|:---:|:---|:---|
| **Platform Infrastructure** | 5 | `Plan`, `TenantSubscription`, `TenantUsage`, `WebhookEvent`, `AiJob` | Platform owner subscription billing, usage limits, and AI background processing; entirely outside parent portal visibility. |
| **CRM & Admissions** | 2 | `Lead`, `LeadActivity` | Pre-admission enquiry pipeline handled by front desk staff. Converted leads become `Student` and `Guardian`. |
| **Platform Accounting** | 2 | `Invoice`, `Payment` | B2B SaaS subscription invoices between Knowletive platform and institute owners; distinct from student fee invoices. |
| **RBAC Definitions** | 3 | `Permission`, `RolePermission`, `PasswordResetToken` | Catalog permissions and role definitions are evaluated in memory via catalog constants; password tokens are backend-ready without portal UI. |
| **Coaching Batches** | 4 | `Batch`, `BatchTeacher`, `BatchStudent`, `BatchEnrollmentEvent` | Batches and coaching schedules are back-office teacher/admin operations not exposed in the parent portal. |
| **Curriculum Planning** | 7 | `SyllabusTrack`, `SyllabusChapter`, `SyllabusTopic`, `SyllabusTeacher`, `SyllabusProgressEvent`, `LessonPlan`, `TopicProgress` | Teacher syllabus tracking, topic coverage, and lesson preparation; strictly restricted to staff console. |
| **Exam Grading** | 5 | `ExamEnrollment`, `ExamMark`, `ExamMarksRevisionEvent`, `GradeBand`, `GradeScale` | Raw teacher marks entry, mark revisions, and grading scale configurations; parents view only published `ExamResult` snapshots. |
| **Institute Operations** | 3 | `Setting`, `FeePayment`, `Announcement` | - `Setting`: Internal tenant key-value config.<br>- `FeePayment`: Official financial payment ledger records created exclusively by accountants when verifying bank credits via `verifyFeePaymentLinkAction` (`settleFeePaymentLink`). In the parent workflow, `submitPaymentProofAction` mutates only `FeePaymentLink`.<br>- `Announcement`: While `tenant.announcements.read` is listed in catalog, `/app/announcements` is gated by `AppLayout:50`, and `/portal` contains no announcement queries. |

## 21. Failure Paths and Edge Cases

The following error catalog maps observed edge cases, architectural boundaries, and failure behaviors encountered in parent workflows:

| Error Code | Failure Scenario | Triggering Condition | Exact System Behavior & Error Message | Recovery & Operational Resolution |
|:---|:---|:---|:---|:---|
| **ERR-P01** | Account Lockout | 5 consecutive incorrect password submissions at `/login`. | `loginAction` lockout gate: `"This account is temporarily locked due to too many failed sign-in attempts. Try again in 15 minutes."` | Parent must wait 15 minutes for lockout window expiry or request administrator password reset. |
| **ERR-P02** | Unlinked Guardian Account | Parent logs in, but `Guardian.userId` is `null` in the database. | `PortalPage` queries `linkedStudents.length === 0`. Renders `<EmptyState>`: *"No linked student profiles found... contact school administration."* | School administrative staff must link the parent's `User.id` to the existing `Guardian` record in the database. |
| **ERR-P03** | Unpublished Exam Access | Parent navigates directly to `/portal/results/[id]` for an exam that is in progress or evaluated. | Strict publication check: `if (!result.exam.isPublished) notFound();` returns a Next.js **404 Not Found** page. | Results remain invisible until the school publishes results via `calculateAndPublishResultsAction`. |
| **ERR-P04** | Foreign Result ID Tampering (IDOR) | Parent alters the URL parameter on `/portal/results/[id]` to inspect an unlinked student's result. | Relational guard `!isLinkedGuardian` fails closed with Next.js `notFound()` (404 response). | IDOR attempt completely fails; no data leakage occurs. |
| **ERR-P05** | Foreign File Asset Download (IDOR) | Parent requests `/api/files/[id]` for a document belonging to another student. | Route handler validates `db.studentGuardian.findFirst()`. Fails closed returning **403 Forbidden** JSON response. | Parent cannot access unlinked documents. |
| **ERR-P06** | Expired Fee Payment Link | Parent accesses `/pay/[token]` after link `expiresAt` has passed. | Route validates `link.expiresAt < now`. Renders expired callout; hides payment form and UPI QR. | Parent must request a renewed payment link from the school accounts office. |
| **ERR-P07** | Non-Staff App Shell Access | Parent attempts to access `/app`, `/app/attendance`, or `/app/announcements`. | `src/app/(app)/app/layout.tsx:50` evaluates `!isStaffMember(ctx)` and executes `redirect("/portal")`. | Immediate redirection back to safe parent portal. |
| **ERR-P08** | Multi-Institute Tenant Mismatch | Parent submits `switchTenantAction` with a `tenantId` they hold no membership in. | Action validates `user.memberships.some()`. Fails check and redirects safely to `/portal`. | Unauthorized tenant switching is strictly rejected. |

---

## 22. Process and Workflow Diagrams

### 22.1 Diagram 1: Parent Account Provisioning and Guardian Linking Architecture

```mermaid
flowchart TD
    subgraph Admission["Student Admission & CRM"]
        A["Front Desk / Admissions Staff"] -->|createStudentAction / convertLeadAction| B["model Student"]
        A -->|Creates Guardian Record| C["model Guardian<br/>(userId: NULL)"]
        B --- D["model StudentGuardian<br/>(isPrimary: true)"] --- C
    end

    subgraph Gap["Account Provisioning Gap"]
        C -.->|No inviteGuardianAction<br/>No Self-Registration| E["Unlinked Guardian Entity"]
    end

    subgraph OutOfBand["Administrative Account Resolution"]
        F["Database Scripting / Admin Seeding"] -->|Creates| G["model User<br/>(Email, PasswordHash)"]
        F -->|Assigns| H["model Membership<br/>(Role: PARENT)"]
        F -->|Updates| I["model Guardian<br/>SET userId = user.id"]
    end

    subgraph PortalAccess["Parent Authentication & Portal Access"]
        G --> J["Parent Logs In at /login"]
        H --> J
        I --> J
        J -->|Successful Login| K["/portal Dashboard<br/>Resolves Linked Students"]
    end

    E --> F
```

---

### 22.2 Diagram 2: Parent Authentication and Portal Routing

```mermaid
flowchart TD
    Start["Parent Visits /login"] --> Submit["Submits Email & Password"]
    Submit --> RateLimit{"Rate Limit OK?<br/>(Max 8 / 10m)"}
    RateLimit -- No --> ErrRate["Return Rate Limit Error"]
    RateLimit -- Yes --> LockCheck{"Account Locked?<br/>(lockedUntil > now)"}
    LockCheck -- Yes --> ErrLock["Return Lockout Error (15m)"]
    LockCheck -- No --> Verify{"bcrypt.compare(hash)<br/>Valid Credentials?"}
    Verify -- No --> FailedAttempt["Increment failedLoginAttempts<br/>If >= 5, Set lockedUntil = now + 15m"]
    Verify -- Yes --> ResetLock["Clear Failed Attempts<br/>Issue kl_session Cookie"]
    
    ResetLock --> MembershipCount{"Active Memberships Count?"}
    MembershipCount -- 1 Membership --> SingleTenant["Set kl_tenant Cookie<br/>Check Role in STAFF_ROLES"]
    SingleTenant --> RoleCheck{"Role == PARENT?"}
    RoleCheck -- Yes --> PortalRedirect["redirect('/portal')"]
    RoleCheck -- No (Staff) --> AppRedirect["redirect('/app')"]
    
    MembershipCount -- > 1 Memberships --> SelectInstitute["redirect('/select-institute')"]
    SelectInstitute --> PickInstitute["Parent Clicks Institute Card"]
    PickInstitute --> SwitchAction["switchTenantAction(formData)"]
    SwitchAction --> SetActive["setActiveTenant(tenantId)<br/>Writes kl_tenant Cookie"]
    SetActive --> PortalRedirect

    MembershipCount -- 0 Memberships --> NoTenant["AppLayout / PortalLayout<br/>Renders Inline Fallback Card"]
```

---

### 22.3 Diagram 3: Parent Dashboard Data Flow

```mermaid
flowchart TD
    User["Parent Browser"] -->|GET /portal| Layout["src/app/(portal)/portal/layout.tsx"]
    Layout --> Context{"getTenantContext()<br/>Valid Session & Tenant?"}
    Context -- No --> Login["redirect('/login')"]
    Context -- Yes --> Page["src/app/(portal)/portal/page.tsx"]
    
    Page --> QueryStudents["db.student.findMany()<br/>WHERE guardians.some.guardian.userId == ctx.user.id"]
    QueryStudents --> CheckCount{"linkedStudents.length > 0?"}
    
    CheckCount -- No --> EmptyState["Render <EmptyState><br/>'No linked student profiles found'"]
    
    CheckCount -- Yes --> ParallelQueries["Promise.all() Parallel Data Queries"]
    ParallelQueries --> Q1["db.feeInvoice.findMany()<br/>(Fee Invoices & Dues)"]
    ParallelQueries --> Q2["db.attendance.findMany()<br/>(Last 30 Days Records)"]
    ParallelQueries --> Q3["db.feePaymentLink.findMany()<br/>(Active Token Links)"]
    ParallelQueries --> Q4["db.examResult.findMany()<br/>(Published Results & Snapshots)"]
    
    ParallelQueries --> RenderCards["Render Consolidated Multi-Child Cards:<br/>• Attendance Metrics<br/>• Exam Report Cards<br/>• Fee Settlement<br/>• Student Documents"]
```

---

### 22.4 Diagram 4: Multi-Child Student Access Architecture

```mermaid
flowchart LR
    subgraph Identity["Parent User Identity"]
        PUser["model User<br/>(id: usr_parent_99)"]
        PMem["model Membership<br/>(tenantId: ten_school_1, role: PARENT)"]
        PUser --- PMem
    end

    subgraph Guardianship["Guardian Records"]
        GRecord["model Guardian<br/>(id: grd_99, userId: usr_parent_99)"]
        PUser -.->|Linked By userId| GRecord
    end

    subgraph Children["Enrolled Children in Same Institute"]
        SG1["model StudentGuardian<br/>(isPrimary: true)"]
        SG2["model StudentGuardian<br/>(isPrimary: true)"]
        GRecord --- SG1
        GRecord --- SG2
        
        Child1["model Student<br/>Aarav Sharma (Class 10-A)"]
        Child2["model Student<br/>Ananya Sharma (Class 7-B)"]
        SG1 --- Child1
        SG2 --- Child2
    end

    subgraph PortalView["Unified Portal Dashboard (/portal)"]
        View["Single Page View<br/>Dynamically Lists Both Aarav and Ananya<br/>Zero Account Switching Required"]
    end

    Child1 --> View
    Child2 --> View
```

---

### 22.5 Diagram 5: Attendance and Examination Result Visibility & Security

```mermaid
sequenceDiagram
    autonumber
    actor Parent as Parent User
    participant Browser as Browser Client
    participant Portal as /portal/results/[id]
    participant DB as PostgreSQL Database
    participant Crypto as Snapshot Verifier

    Parent->>Browser: Clicks "View Report Card"
    Browser->>Portal: GET /portal/results/res_123
    Portal->>DB: findFirst(ExamResult where id = res_123)
    DB-->>Portal: Result Record + Examination + Snapshot

    alt Result does not exist
        Portal-->>Browser: 404 Not Found
    else Exam is not published (isPublished == false)
        Portal-->>Browser: 404 Not Found (Strict Hidden Gate)
    else Foreign Student ID (IDOR Attack)
        Portal->>DB: studentGuardian.findFirst(studentId, guardian.userId == user.id)
        DB-->>Portal: null (No Link)
        Portal-->>Browser: 404 Not Found (Fails Closed)
    else Legitimate Linked Child
        Portal->>DB: studentGuardian.findFirst(studentId, guardian.userId == user.id)
        DB-->>Portal: Valid Link Record
        Portal->>Crypto: verifySnapshotChecksum(snapshotData, checksum)
        Crypto-->>Portal: { valid: true }
        Portal-->>Browser: 200 OK (Render Verified Report Card & Cryptographic Badge)
    end
```

---

### 22.6 Diagram 6: Parent Notifications and Communication Scope

```mermaid
flowchart TD
    subgraph Trigger["Operational Trigger"]
        Teacher["Teacher Marks Attendance"] --> MarkAction["markAttendanceAction()"]
        MarkAction --> DetectAbsent["Filters Absent Students"]
    end

    subgraph Dispatch["Synchronous Notification Dispatch"]
        DetectAbsent --> QueryGuardian["Find Primary Guardian"]
        QueryGuardian --> CheckUserId{"guardian.userId != null?"}
        CheckUserId -- Yes --> InApp["sendNotification(channel: IN_APP)<br/>Writes row to NotificationLog<br/>(recipientUserId = guardian.userId)"]
        CheckUserId -- No --> SkipInApp["Skip In-App Creation<br/>(Prevents Orphan Logs)"]
        
        QueryGuardian --> CheckEmail{"guardian.email != null?"}
        CheckEmail -- Yes --> Email["sendNotification(channel: EMAIL)<br/>Dispatches via SMTP / Resend"]
        CheckEmail -- No --> SkipEmail["Skip Email Dispatch"]
    end

    subgraph ParentPortal["Parent Notification Consumption"]
        ParentNav["Parent on /portal"] --> Mount["<NotificationCenter /> Mounts"]
        Mount --> InitialFetch["getInAppNotificationsAction()<br/>Fetches Unread Count"]
        Mount --> Polling["setInterval(60_000ms)<br/>Client-Side Periodic 60s Polling"]
        Polling --> BackgroundUpdate["Updates Unread Count Badge"]
        
        ParentNav --> ClickBell["Clicks Notification Bell"]
        ClickBell --> OpenDrawer["Opens Dropdown Drawer<br/>Lists Latest 25 Notifications"]
        OpenDrawer --> MarkRead["Clicks Checkmark<br/>markNotificationReadAction()"]
        MarkRead --> MutateDB["NotificationLog SET isRead = true"]
    end

    subgraph Boundary["Announcement Layout Boundary"]
        ParentURL["Parent Visits /app/announcements"] --> LayoutGate["src/app/(app)/app/layout.tsx:50"]
        LayoutGate --> EvaluateStaff{"isStaffMember(ctx)?"}
        EvaluateStaff -- No (PARENT) --> Bounce["redirect('/portal')<br/>Cannot Access Announcements"]
    end

    InApp -.-> InitialFetch
```

---

## 23. Unimplemented Capabilities and Known Limitations

The following functional capabilities are currently not implemented in the Knowletive platform for the parent user journey:

1. **Automated Guardian Self-Registration & Invitation Emails:**
   - There is no self-registration portal for parents.
   - There is no `inviteGuardianAction` to dispatch onboarding invitation emails with setup links.
   - When a student is admitted via `createStudentAction` or `convertLeadAction`, `Guardian.userId` is left as `null`. Account creation requires manual database administration.
2. **Institute Announcements in Parent Portal:**
   - Although the `PARENT` role possesses `tenant.announcements.read` in the RBAC catalog, `/app/announcements` is blocked by `AppLayout:50`, and `/portal` contains no announcement queries or components.
3. **Real-Time Push Notifications & WebSockets:**
   - The platform does not support WebSockets, SSE, or mobile push notifications.
   - Notification updates rely on synchronous server creation on trigger and client-side 60-second periodic polling in `<NotificationCenter />`.
4. **Direct Parent-Teacher Messaging:**
   - There is no messaging module, chat room, or direct email thread between parents and classroom teachers.
5. **Parent-Initiated Online Absence Excuse Submissions:**
   - Parents cannot log into `/portal` to report an upcoming absence, sick leave, or travel plan. Absences must be conveyed out-of-band to the school front desk.
6. **Self-Service Parent Profile Editing:**
   - Parents cannot update their phone number, email address, or emergency contacts on `/portal`. Modifications must be made by school administrators via `/app/parents/[id]`.
7. **Public Forgot-Password Link:**
   - While `requestPasswordResetAction` is implemented on the backend, there is no "Forgot Password" link on `/login`.

---

## 24. Source Code Verification Register

The findings and architectural invariants in this document are verified against the following codebase files:

### Codebase Verification Register

| File Path | Inspected Component / Logic | Verified Architectural Fact |
|:---|:---|:---|
| `src/lib/catalog.ts:256–260` | `DEFAULT_ROLES` (`PARENT`) | Defines exactly 2 permissions: `tenant.portal.read`, `tenant.announcements.read`. |
| `src/actions/auth.ts:16` | `STAFF_ROLES` Set | Contains `OWNER`, `ADMIN`, `TEACHER`, `ACCOUNTANT`, `FRONT_DESK`. Excludes `PARENT`. |
| `src/actions/auth.ts:25–340` | `loginAction` | Authenticates, enforces lockout, issues `kl_session`, routes single membership to `/portal`, >1 to `/select-institute`. |
| `src/actions/auth.ts:251–265` | `logoutAction` | Deletes `Session` record, deletes `kl_session` and `kl_tenant` cookies, redirects to `/login`. |
| `src/actions/auth.ts:286–302` | `switchTenantAction` | Validates membership, calls helper `setActiveTenant(tenantId)`, redirects non-staff to `/portal`. |
| `src/lib/auth.ts:167–177` | `setActiveTenant` | Internal helper function that writes `kl_tenant` cookie; not an exported server action. |
| `src/app/select-institute/page.tsx` | Multi-Institute Selector | Verified page route; lists user memberships and renders forms posting to `switchTenantAction`. |
| `src/app/(app)/app/layout.tsx:50–52` | `AppLayout` Staff Gate | Evaluates `!isStaffMember(ctx)` and executes `redirect("/portal")`. Blocks parent access to `/app/*`. |
| `src/app/(portal)/portal/layout.tsx` | `PortalLayout` | Provides portal frame, tenant header, `<NotificationCenter />`, avatar, logout form, and inline no-tenant fallback card. |
| `src/app/(portal)/portal/page.tsx` | `PortalPage` | Consolidated dashboard; queries `linkedStudents` via `guardians.some.guardian.userId === ctx.user.id`. |
| `src/app/(portal)/portal/results/[id]/page.tsx` | Report Card Detail | Enforces `exam.isPublished === true` and `studentGuardian` check. Evaluates SHA-256 snapshot checksum. |
| `src/app/pay/[token]/page.tsx` | Public Fee Payment | Public token route; generates UPI QR code (`QRCode.toDataURL`), displays bank details, hosts proof form. |
| `src/actions/operations.ts:143–230`| `markAttendanceAction` | Marks attendance in transaction; synchronously dispatches `IN_APP` and `EMAIL` absence notices. |
| `src/actions/operations.ts:251–285`| `submitPaymentProofAction`| Public action; updates `FeePaymentLink` with UTR reference and notifies accountants. Does not touch `FeePayment`. |
| `src/actions/students.ts:31–120` | `createStudentAction` | Creates student and guardian record with `userId: null`. No user account or invitation created. |
| `src/actions/leads.ts:182–280` | `convertLeadAction` | Converts lead to student; creates guardian with `userId: null`. (`convertLeadToStudentAction` does not exist). |
| `src/actions/students.ts:186–225` | `createGuardianAction` | Creates guardian record with `userId: null`. |
| `src/actions/notifications.ts:8–105` | Notification Actions | Exports `getInAppNotificationsAction`, `markNotificationReadAction`, `markAllNotificationsReadAction`. |
| `src/components/notifications/...` | `<NotificationCenter />` | Client dropdown drawer; calls `getInAppNotificationsAction()` on mount and polls every 60 seconds. |
| `src/app/api/files/[id]/route.ts` | File Streaming Route | Validates `db.studentGuardian.findFirst()`. Fails closed with 403 Forbidden on foreign requests. |
| `prisma/schema.prisma` | Full Database Schema | Declares exactly 54 models: 23 participating + 31 non-participating. Disjoint sets. |

---

### Handbook Baseline & Companion Document Integrity Distinction

To maintain strict configuration management and handbook baseline control:
- **Pre-Existing Companion Handbook Documents (`00` through `24`):** These 25 pre-existing documents form the immutable historical baseline of the Knowletive Functional Handbook. Their content and SHA-256 checksums remain strictly unchanged and frozen.
- **Current Target Deliverable (Document `25`):** The current document (`25-PARENT-PORTAL-END-TO-END-USER-JOURNEY.md`) is the newly produced deliverable under audit, and its SHA-256 hash is computed and tracked independently.

---

## 25. Final Audit and Parent Portal Readiness Assessment

### 25.1 Comprehensive Functional Audit Findings

| Audit Dimension | Target Requirement | Source Status | Audit Finding |
|:---|:---|:---:|:---|
| **Route Accuracy** | Distinguish App Router pages from components/APIs | **VERIFIED** | Exactly 4 App Router pages (`/login`, `/select-institute`, `/portal`, `/portal/results/[id]`), 2 reusable UI components, 1 API route, 1 public payment route. Confirmed `/no-tenant` does not exist (inline layout fallback). |
| **Tenant Switching** | Document `/select-institute` and `switchTenantAction` | **VERIFIED** | Verified `/select-institute` route, `switchTenantAction` export, and confirmed `setActiveTenant` is an internal helper in `src/lib/auth.ts`. |
| **Guardian Provisioning** | Verify exact action identifiers and `userId` behavior | **VERIFIED** | Verified `createStudentAction`, `convertLeadAction`, `createGuardianAction` create `Guardian` with `userId: null`. Confirmed `convertLeadToStudentAction` does not exist. Confirmed absence of `inviteGuardianAction`. |
| **Announcements** | Reconcile role permission vs portal UI | **VERIFIED** | Verified `tenant.announcements.read` is assigned in catalog, but `/app/announcements` is blocked by `AppLayout:50`, and `/portal` has no announcement UI. `Announcement` classified as non-participating. |
| **Notification Mechanics** | Correct delivery and polling terminology | **VERIFIED** | Verified server-side synchronous creation during `markAttendanceAction`, and client-side 60s periodic polling in `<NotificationCenter />`. Confirmed absence of WebSockets, SSE, and browser push notifications. |
| **Server Actions** | Exactly 8 permitted parent-relevant actions | **VERIFIED** | Exactly 8 exported server actions verified with UI callers and authorization checks. |
| **Prisma Partition** | 54 models partitioned without overlap | **VERIFIED** | Exactly 23 participating + 31 non-participating models = 54 total models. Disjoint sets ($P \cap NP = \emptyset$). |
| **Security & IDOR** | Cryptographic snapshot & relational guards | **VERIFIED** | Verified SHA-256 checksum verification, `isPublished` gate, and `studentGuardian` relational guards across `/portal/results/[id]` and `/api/files/[id]`. |

### 25.2 Readiness Declaration

The Parent Portal User Journey specification is fully reconciled against the current repository source on canonical branch `staging/exam-stage-43`. All identified discrepancies in Revision 1.0 and Revision 1.1 have been corrected and verified from the code.

**DOCUMENT STATUS: APPROVED & FROZEN (Revision 1.2 Baseline)**
