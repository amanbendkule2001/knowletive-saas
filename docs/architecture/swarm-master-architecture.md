# Knowletive Swarm Master Architecture & Specialist Team Roster

**Author:** Agent 0: Chief Software Architect & Swarm Orchestrator  
**Date:** 2026-11-21  
**Milestone:** Phase 2.3.2 Swarm Initialization  

---

## 1. Specialist Team Roster

| Agent ID | Specialization | Focus & Ownership |
|---|---|---|
| **Agent 0** | Chief Software Architect & Swarm Orchestrator | System architecture, dependency graph, verification gates, cross-team coordination, user requirements. |
| **Agent 1** | Database & Data Architecture | PostgreSQL, Prisma schema, migration integrity, relational constraints, catalog invariants, drift prevention. |
| **Agent 2** | Security & RBAC | Multi-tenant isolation, branch scoping, authorization helpers, role permissions, RLS policies, vault encryption. |
| **Agent 3** | Backend & API | Next.js server actions, API routes, financial ledger consumers, reconciliation algorithms, payment routing. |
| **Agent 4** | Frontend & Application Engineering | Next.js App Router, layout hierarchy, page components, client mutations, forms, data tables, error boundaries. |
| **Agent 5** | UI/UX & Design System | Design tokens, typography, component consistency, dialogs, responsive viewports, accessibility standards. |
| **Agent 6** | QA & Test Automation | Vitest integration suites, regression test suites, disposable database provisioning, migration upgrade tests. |
| **Agent 7** | Performance & Reliability | Query optimization, index coverage, N+1 detection, connection pooling, transaction latency, view execution plans. |
| **Agent 8** | DevOps & Site Reliability | Environment isolation, deployment pipelines, database backup/recovery, secret vault configuration, CI workflows. |
| **Agent 9** | AI & Copilot Engineering | FastAPI service communication, Copilot thread persistence, tool execution registry, context security, provider failover. |
| **Agent 10** | Product & Business Workflow | User journey mapping, multi-role workflows, domain business rules, feature roadmap, acceptance criteria. |

---

## 2. Swarm Governance & Operational Principles

1. **Single Source of Truth:** All architectural decisions are reviewed and approved by Agent 0. No agent introduces unilateral changes to database schema or financial contracts without prior architectural approval.
2. **Repository Protection:**
   - Zero files committed, staged, stashed, reset, or cleaned.
   - All migrations and destructive operations run strictly against disposable databases.
   - Production and shared staging databases are never touched by test scripts.
3. **Collaboration Protocol:**
   - Agent 1 designs schema changes -> Agent 2 reviews security implications -> Agent 3 implements backend -> Agent 4 wires frontend -> Agent 6 verifies via automated integration tests -> Agent 7 benchmarks performance.
