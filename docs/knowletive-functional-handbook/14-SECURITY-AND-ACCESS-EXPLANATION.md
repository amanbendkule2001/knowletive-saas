# Knowletive SaaS — Security, Access Control & Tenant Isolation

## Document Information
- **Title:** Security Architecture, Authentication, RBAC & Isolation Guide
- **Document ID:** DOC-14-SECURITY-ACCESS
- **Target Audience:** Security Officers, Compliance Auditors, Cloud Architects, Developers
- **Classification:** Security Governance & Architecture Specification
- **Repository Location:** `docs/knowletive-functional-handbook/14-SECURITY-AND-ACCESS-EXPLANATION.md`

---

## Table of Contents
1. [Security Architecture Principles](#1-security-architecture-principles)
2. [Authentication & Session Security](#2-authentication--session-security)
3. [Dual-Scope Role-Based Access Control (RBAC)](#3-dual-scope-role-based-access-control-rbac)
4. [Tenant Isolation & Multi-Tenancy Defense in Depth](#4-tenant-isolation--multi-tenancy-defense-in-depth)
5. [Rate Limiting & Brute-Force Defense](#5-rate-limiting--brute-force-defense)
6. [Audit Logging & Compliance Traceability](#6-audit-logging--compliance-traceability)
7. [Data Protection, Cryptography & Privacy](#7-data-protection-cryptography--privacy)
8. [Vulnerability Mitigation Checklist](#8-vulnerability-mitigation-checklist)

---

## 1. Security Architecture Principles

Knowletive SaaS enforces an enterprise-grade security posture centered on **Zero-Trust Multi-Tenancy**:
- **Authentication:** Cryptographically verified session tokens delivered via secure, `httpOnly` cookies.
- **Authorization:** Multi-tiered RBAC enforcing both platform-level and institute-level permission boundaries.
- **Isolation:** Absolute data partitioning by `tenantId` across every query.
- **Auditability:** Complete accountability for every sensitive read and mutation.

---

## 2. Authentication & Session Security

### 2.1 Password Security
- User passwords are never stored in plaintext.
- Passwords are encrypted using salted PBKDF2 / bcrypt cryptographic hashing.
- Password complexity: Minimum 8 characters, requiring mixed alphanumeric characters.

### 2.2 Cookie & Token Infrastructure
- Sessions are maintained using signed HTTP session cookies.
- **Cookie Flags:**
  - `httpOnly: true` (prevents client-side JavaScript access, neutralizing XSS credential theft).
  - `SameSite=Lax` (protects against Cross-Site Request Forgery attacks).
  - `Secure: true` in production (forces HTTPS transmission).
- **Session Expiration:** Default 7-day sliding expiration. Sessions are invalidated instantly upon calling `logoutAction`.

---

## 3. Dual-Scope Role-Based Access Control (RBAC)

Knowletive segregates access into two non-overlapping permission domains:

```
+---------------------------------------------------------------------------------+
|                                    RBAC DOMAIN                                  |
+---------------------------------------------------------------------------------+
                     |                                       |
+--------------------v-------------+   +---------------------v-------------------+
|      PLATFORM SCOPE              |   |        TENANT SCOPE                     |
|  - Managed via isPlatformOwner   |   |  - Managed via Tenant Memberships       |
|  - Controls SaaS infrastructure  |   |  - 52 granular functional permissions   |
|  - 14 platform permissions       |   |  - Custom roles per institute           |
|  - Route: /platform/*            |   |  - Route: /app/*                        |
+----------------------------------+   +-----------------------------------------+
```

### 3.1 Route Guards & Server Action Guards
Every request passes through defensive verification:
1. **Client UI Guard:** Navbars conditionally render links based on `hasTenantPermission()`.
2. **Server Component Guard:** Pages invoke `await requireTenantPermission(perm)`.
3. **Server Action Guard:** Every mutation independently validates user permissions and tenant membership before executing database queries.

---

## 4. Tenant Isolation & Multi-Tenancy Defense in Depth

### 4.1 Zero-Trust Query Isolation
- Every database query executed within `/app` extracts `tenantId` directly from the verified session context:
  ```typescript
  const { tenantId } = await getTenantContext();
  const students = await prisma.student.findMany({
    where: { tenantId, status: "ACTIVE" }
  });
  ```
- A tenant cannot query, read, or mutate data belonging to another tenant, even if the primary ID of the target record is known.

### 4.2 Portal Consumer Isolation
- Students and parents in `/portal` cannot view data of other students.
- System validates that `Student.userId == session.userId` or `GuardianLink` links the parent's `Guardian.userId` to the requested student profile.

---

## 5. Rate Limiting & Brute-Force Defense

- Implemented via the `RateLimitBucket` database model.
- **Login Defense:** Client IP addresses are limited to 8 login attempts per 10-minute sliding window.
- Exceeding the threshold returns `429 Too Many Requests` and temporarily locks login attempts for that IP.

---

## 6. Audit Logging & Compliance Traceability

- Every administrative mutation (creating exams, publishing marks, altering roles, recording fee payments) creates an immutable record in `AuditLog` with:
  - Timestamp (UTC)
  - Actor User ID & Email
  - Tenant ID
  - Action Category
  - Client IP & User Agent
  - State Diff (Previous vs New values)

---

## 7. Data Protection, Cryptography & Privacy

- **Transport Encryption:** Enforced TLS 1.3 for all HTTP and database connections.
- **Asset Protection:** File attachments (student identity photos, medical records, receipts) are served via authenticated endpoint `/api/files/[id]` with tenant permission checks.

---

## 8. Vulnerability Mitigation Checklist

| Threat Vector | Defense Mechanism | Code Location |
|:---|:---|:---|
| **SQL Injection** | Parameterized queries via Prisma ORM | All database calls |
| **XSS (Cross-Site Scripting)** | React JSX auto-escaping + HttpOnly session cookies | `src/lib/auth.ts` |
| **CSRF** | SameSite cookie policy + Next.js Server Action CSRF tokens | Framework level |
| **IDOR (Direct Object Reference)** | Mandatory tenantId scoping on all entity lookups | `src/actions/*` |
| **Brute Force** | Database sliding-window rate limit buckets | `src/lib/rate-limit.ts` |
| **Privilege Escalation** | Server-side role and permission verification | `src/lib/auth.ts` |
