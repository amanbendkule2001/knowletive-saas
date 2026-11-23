# AI ACCESS MANAGEMENT & GOVERNANCE ARCHITECTURE

## 1. Overview & Policy Hierarchy

Knowletive SaaS enforces an explicit default-deny access policy for all generative AI and analytics capabilities. Privileged AI modules are governed exclusively by Institute Owners and Platform Owners.

### 1.1 Default Access Matrix by Role

| User Role | Default Access | Grant Mechanism | Domain-Level Read Restriction |
| :--- | :--- | :--- | :--- |
| **Platform Owner** | **Enabled** (All institutes) | Root Platform Role | Root access across platform |
| **Institute Owner** (`isOwner === true`) | **Enabled** (Own institute) | Verified Ownership | Enforces tenant boundary |
| **Institute Admin** (`isOwner === false`) | **Disabled** | Explicit `extraPermissions` grant | Subject to assigned role permissions |
| **Teacher** | **Disabled** | Explicit `extraPermissions` grant | Subject to assigned role permissions |
| **Student** | **Disabled** | Explicit `extraPermissions` grant | Restricted to student portal data |
| **Parent** | **Disabled** | Explicit `extraPermissions` grant | Restricted to ward data |
| **Accountant** | **Disabled** | Explicit `extraPermissions` grant | Subject to assigned financial permissions |
| **Platform Support** (Impersonation) | **Strictly Denied** | None (Security Block) | Impersonators cannot view AI data |

---

## 2. Granular AI Capabilities (10 Modules)

All AI capabilities are defined in `src/lib/catalog.ts` under `AI_PERMISSION_KEYS` and validated against `AI_PERMISSION_ALLOWLIST`:

1. `tenant.ai.copilot`: Interactive chat assistant with live student, attendance, and fee data synthesis.
2. `tenant.ai.analytics.institute`: High-level institutional KPI, trend forecasting, and executive overviews.
3. `tenant.ai.analytics.student`: Academic progress tracking, student intervention flags, and grade predictions.
4. `tenant.ai.analytics.attendance`: Absenteeism pattern detection, anomaly tracking, and attendance summaries.
5. `tenant.ai.analytics.fees`: Delinquency predictions, collection velocity, and fee recovery summaries.
6. `tenant.ai.analytics.admissions`: Inquiry conversion likelihood and demographic trend analysis.
7. `tenant.ai.analytics.exams`: Subject difficulty analysis, score distributions, and class comparative metrics.
8. `tenant.ai.reports.generate`: AI-assisted PDF and narrative report compilation for students and staff.
9. `tenant.ai.document.intelligence`: OCR extraction and parsing for receipts, marksheets, and identity documents.
10. `tenant.ai.workflows`: Multi-step agent workflows for notifications, reminders, and alerts.

---

## 3. Storage & Permission Grant Mechanism

### 3.1 Uniform Membership Storage
Every user linked to a tenant (including Staff, Teachers, Students, and Parents) has a `Membership` record in PostgreSQL:
```prisma
model Membership {
  id               String    @id @default(cuid())
  tenantId         String
  userId           String
  roleId           String
  isOwner          Boolean   @default(false)
  extraPermissions String[]  @default([])
  denyPermissions  String[]  @default([])
  ...
}
```

### 3.2 Non-Destructive Update Pipeline
When an Institute Owner grants or revokes AI permissions via `updateAiPermissionsAction(membershipId, permissions)`:
1. Caller verification confirms `isVerifiedInstituteOwner(ctx) || isVerifiedPlatformOwner(ctx.user)`.
2. Existing non-AI operational permissions in `extraPermissions` (e.g. custom operational overrides) are strictly preserved.
3. New permissions are filtered through `AI_PERMISSION_ALLOWLIST` to prevent injection of unauthorized keys.
4. Tamper-evident audit logging is written to `db.auditLog` with action `ai.permission.update`.

---

## 4. Owner Management Interface (`/app/settings/ai`)

Located in the authenticated settings section at `src/app/(app)/app/settings/ai/page.tsx`:
- **Member Directory:** Searchable table with instant filtering by name, email, or role (Admin, Teacher, Student, Parent, Staff).
- **Access Badges:** Visual indicators showing Copilot status (`Enabled` / `Disabled`) and module counts (e.g. `3 / 10 Modules`).
- **Configuration Drawer:** Full modal allowing owners to toggle individual modules or apply presets:
  - *Copilot Only*
  - *Copilot + Analytics*
  - *Select All (10)*
  - *Clear All*
- **Audit Feed:** Real-time log displaying recent permission modifications, timestamps, actor names, and affected accounts.
