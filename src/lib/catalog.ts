/**
 * Single source of truth for the RBAC catalogue, plan entitlements, role
 * templates and AI module registry. Pure data — safe to import from seeds,
 * server code and (read-only) UI.
 */

export type Scope = "PLATFORM" | "TENANT";

export type PermissionDef = {
  key: string;
  group: string;
  label: string;
  scope: Scope;
};

const tenant = (
  group: string,
  rows: [string, string][],
): PermissionDef[] =>
  rows.map(([key, label]) => ({ key: `tenant.${key}`, group, label, scope: "TENANT" }));

const platform = (
  group: string,
  rows: [string, string][],
): PermissionDef[] =>
  rows.map(([key, label]) => ({ key: `platform.${key}`, group, label, scope: "PLATFORM" }));

export const PERMISSIONS: PermissionDef[] = [
  ...platform("Platform", [
    ["overview.read", "View platform overview"],
    ["institutes.read", "View institutes"],
    ["institutes.manage", "Create, suspend & manage institutes"],
    ["plans.read", "View plans"],
    ["plans.manage", "Create & edit plans and entitlements"],
    ["subscriptions.read", "View subscriptions & invoices"],
    ["subscriptions.manage", "Change plans, extend trials & mark invoices paid"],
    ["roles.read", "View platform roles"],
    ["roles.manage", "Edit platform roles"],
    ["users.read", "View platform team"],
    ["users.manage", "Invite & manage platform team"],
    ["audit.read", "View platform audit log"],
    ["ai.read", "View AI usage across institutes"],
    ["settings.manage", "Manage platform settings"],
  ]),
  ...tenant("Leads", [
    ["leads.read", "View prospective student enquiries"],
    ["leads.write", "Add, update & assign leads"],
    ["leads.convert", "Convert leads to student admissions"],
    ["leads.delete", "Archive or delete leads"],
  ]),
  ...tenant("Batches", [
    ["batches.read", "View batches and student rosters"],
    ["batches.write", "Create and edit batch settings & capacity"],
    ["batches.enroll", "Enroll and drop students from batches"],
    ["batches.transfer", "Transfer students between batches"],
    ["batches.manage_teachers", "Assign and remove teachers from batches"],
  ]),
  ...tenant("Syllabus", [
    ["syllabus.read", "View syllabus structures, chapters, topics, lesson plans & progress"],
    ["syllabus.write", "Create and edit syllabus structures & metadata"],
    ["syllabus.manage_structure", "Create, edit and reorder chapters & topics"],
    ["syllabus.manage_lessons", "Create, edit, and complete lesson plans"],
    ["syllabus.update_progress", "Mark actual topic progress and log teaching hours"],
    ["syllabus.view_reports", "View completion and delay analytics"],
  ]),
  ...tenant("Exams", [
    ["exams.read", "View examinations, schedules, marks and reports"],
    ["exams.write", "Create and edit examinations, schedules and subjects"],
    ["exams.manage_grading", "Configure grade scales and grade bands"],
    ["exams.enroll", "Enroll and manage student exam participation"],
    ["exams.enter_marks", "Enter and update marks for assigned subjects"],
    ["exams.verify_marks", "Verify and lock evaluated marks"],
    ["exams.publish_results", "Calculate authoritative results and publish report cards"],
    ["exams.correct_published_marks", "Correct marks for published examinations with audit revision trail"],
    ["exams.view_reports", "View institutional exam performance analytics and reports"],
  ]),
  ...tenant("Students", [
    ["students.read", "View students"],
    ["students.write", "Add & edit students"],
    ["students.delete", "Archive & delete students"],
    ["parents.read", "View parents & guardians"],
    ["parents.write", "Add & edit parents"],
  ]),
  ...tenant("Staff", [
    ["staff.read", "View staff"],
    ["staff.write", "Invite & manage staff"],
  ]),
  ...tenant("Academics", [
    ["academics.read", "View classes & subjects"],
    ["academics.write", "Manage classes, sections & subjects"],
  ]),
  ...tenant("Attendance", [
    ["attendance.read", "View attendance"],
    ["attendance.write", "Mark attendance"],
  ]),
  ...tenant("Fees", [
    ["fees.read", "View fee invoices"],
    ["fees.write", "Create invoices & record payments"],
  ]),
  ...tenant("Communication", [
    ["announcements.read", "View announcements"],
    ["announcements.write", "Publish announcements"],
    ["notifications.read", "View delivery log"],
    ["notifications.write", "Send fee reminders & alerts"],
  ]),
  ...tenant("AI Studio", [
    ["ai.use", "Use AI modules"],
    ["ai.read", "View AI usage history"],
  ]),
  ...tenant("Billing", [
    ["billing.read", "View subscription & invoices"],
    ["billing.manage", "Upgrade plan & manage billing"],
  ]),
  ...tenant("Administration", [
    ["roles.read", "View roles"],
    ["roles.manage", "Create roles & edit permissions"],
    ["settings.read", "View institute settings"],
    ["settings.manage", "Manage institute settings"],
    ["audit.read", "View audit log"],
    ["reports.read", "View reports & analytics"],
  ]),
  ...tenant("Portal", [
    ["portal.read", "Access parent and student portal"],
  ]),
];

export const PERMISSION_MAP = new Map(PERMISSIONS.map((p) => [p.key, p]));

export const PLATFORM_PERMISSIONS = PERMISSIONS.filter((p) => p.scope === "PLATFORM");
export const TENANT_PERMISSIONS = PERMISSIONS.filter((p) => p.scope === "TENANT");

export const TENANT_PERMISSION_KEYS = TENANT_PERMISSIONS.map((p) => p.key);
export const PLATFORM_PERMISSION_KEYS = PLATFORM_PERMISSIONS.map((p) => p.key);

/** Group order used by the permission matrix UI. */
export const PERMISSION_GROUPS = PERMISSIONS.reduce<Record<string, PermissionDef[]>>(
  (acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  },
  {},
);

// ─────────────────────────────── Entitlements ───────────────────────────────

export type FeatureDef = {
  key: string;
  label: string;
  description: string;
  group: string;
  tier?: "core" | "growth" | "scale";
};

export const FEATURES: FeatureDef[] = [
  { key: "core", label: "Students & parents", description: "Student records, guardians, admissions and profiles.", group: "Core", tier: "core" },
  { key: "attendance", label: "Attendance", description: "Daily attendance marking, registers and absence alerts.", group: "Core", tier: "core" },
  { key: "fees", label: "Fees & payments", description: "Fee invoices, partial payments, receipts and dues.", group: "Core", tier: "core" },
  { key: "announcements", label: "Announcements", description: "Publish notices to staff, parents and students.", group: "Core", tier: "core" },
  { key: "reports", label: "Reports & analytics", description: "Enrolment, collection and attendance analytics.", group: "Core", tier: "core" },
  { key: "parent_app", label: "Parent app / portal", description: "Parent login to view attendance, fees and notices.", group: "Engagement", tier: "core" },
  { key: "academics", label: "Academics", description: "Classes, sections, subjects and teacher allocation.", group: "Academics", tier: "growth" },
  { key: "staff", label: "Staff management", description: "Staff directory, roles and permissions.", group: "Academics", tier: "growth" },
  { key: "ai", label: "AI Studio", description: "Report card remarks, lesson plans, question papers and more.", group: "AI", tier: "growth" },
  { key: "sms", label: "SMS notifications", description: "Fee reminders and absence alerts over SMS.", group: "Engagement", tier: "growth" },
  { key: "whatsapp", label: "WhatsApp notifications", description: "Templated WhatsApp updates to parents.", group: "Engagement", tier: "scale" },
  { key: "api_access", label: "API & webhooks", description: "REST API and outbound webhooks for integrations.", group: "Platform", tier: "scale" },
  { key: "white_label", label: "White label", description: "Remove Knowletive branding and use your own.", group: "Platform", tier: "scale" },
  { key: "custom_domain", label: "Custom domain", description: "Run the portal on your own domain.", group: "Platform", tier: "scale" },
  { key: "priority_support", label: "Priority support", description: "Dedicated onboarding and 4-hour response SLA.", group: "Support", tier: "scale" },
  { key: "multi_campus", label: "Multi-campus", description: "Manage multiple branches under one institute.", group: "Platform", tier: "scale" },
];

export const FEATURE_MAP = new Map(FEATURES.map((f) => [f.key, f]));

// ─────────────────────────────── Role templates ───────────────────────────────

export type RoleTemplate = {
  key: string;
  scope: Scope;
  name: string;
  description: string;
  permissions: string[];
};

const tenantPerms = (...keys: string[]) => keys.map((k) => `tenant.${k}`);
const platformPerms = (...keys: string[]) => keys.map((k) => `platform.${k}`);

export const PLATFORM_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "PLATFORM_OWNER",
    scope: "PLATFORM",
    name: "Platform Owner",
    description: "Full control of the platform, institutes, plans and billing.",
    permissions: PLATFORM_PERMISSION_KEYS,
  },
  {
    key: "PLATFORM_SUPPORT",
    scope: "PLATFORM",
    name: "Platform Support",
    description: "Read-only access to institutes and subscriptions for support.",
    permissions: platformPerms(
      "overview.read",
      "institutes.read",
      "plans.read",
      "subscriptions.read",
      "users.read",
      "audit.read",
      "ai.read",
    ),
  },
];

export const TENANT_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "INSTITUTE_ADMIN",
    scope: "TENANT",
    name: "Institute Admin",
    description: "Full control of this institute.",
    permissions: TENANT_PERMISSION_KEYS,
  },
  {
    key: "PRINCIPAL",
    scope: "TENANT",
    name: "Principal",
    description: "Academic leadership with staff, academics and reporting access.",
    permissions: tenantPerms(
      "leads.read", "leads.write", "leads.convert",
      "batches.read", "batches.write", "batches.enroll", "batches.transfer", "batches.manage_teachers",
      "syllabus.read", "syllabus.write", "syllabus.manage_structure", "syllabus.manage_lessons", "syllabus.update_progress", "syllabus.view_reports",
      "exams.read", "exams.write", "exams.manage_grading", "exams.enroll", "exams.enter_marks", "exams.verify_marks", "exams.publish_results", "exams.correct_published_marks", "exams.view_reports",
      "students.read", "students.write", "parents.read", "parents.write",
      "staff.read", "academics.read", "academics.write",
      "attendance.read", "attendance.write", "fees.read",
      "announcements.read", "announcements.write", "ai.use", "ai.read",
      "notifications.read", "notifications.write",
      "billing.read", "roles.read", "settings.read", "audit.read", "reports.read",
    ),
  },
  {
    key: "TEACHER",
    scope: "TENANT",
    name: "Teacher",
    description: "Classroom access: attendance, students and AI teaching tools.",
    permissions: tenantPerms(
      "batches.read",
      "syllabus.read", "syllabus.manage_lessons", "syllabus.update_progress", "syllabus.view_reports",
      "exams.read", "exams.enter_marks", "exams.view_reports",
      "students.read", "parents.read", "academics.read",
      "attendance.read", "attendance.write",
      "announcements.read", "notifications.read", "ai.use", "reports.read",
    ),
  },
  {
    key: "ACCOUNTANT",
    scope: "TENANT",
    name: "Accountant",
    description: "Fees, collections, dues and billing visibility.",
    permissions: tenantPerms(
      "leads.read",
      "students.read", "parents.read", "fees.read", "fees.write",
      "announcements.read", "notifications.read", "notifications.write",
      "billing.read", "reports.read",
    ),
  },
  {
    key: "FRONT_DESK",
    scope: "TENANT",
    name: "Front Desk",
    description: "Admissions, student records and parent communication.",
    permissions: tenantPerms(
      "leads.read", "leads.write", "leads.convert",
      "batches.read", "batches.enroll",
      "students.read", "students.write", "parents.read", "parents.write",
      "announcements.read", "notifications.read", "notifications.write",
      "fees.read", "attendance.read",
    ),
  },
  {
    key: "PARENT",
    scope: "TENANT",
    name: "Parent",
    description: "Parent portal: own child's attendance, fees and notices.",
    permissions: tenantPerms("portal.read", "announcements.read"),
  },
  {
    key: "STUDENT",
    scope: "TENANT",
    name: "Student",
    description: "Student portal: timetable, attendance and notices.",
    permissions: tenantPerms("portal.read", "announcements.read"),
  },
];

export const STAFF_ROLE_KEYS = new Set([
  "INSTITUTE_ADMIN",
  "PRINCIPAL",
  "TEACHER",
  "ACCOUNTANT",
  "FRONT_DESK",
]);

export const ROLE_TEMPLATE_MAP = new Map(TENANT_ROLE_TEMPLATES.map((r) => [r.key, r]));

// ─────────────────────────────── Plans ───────────────────────────────

export type PlanSeed = {
  key: string;
  name: string;
  description: string;
  priceMonthly: number; // paise
  priceYearly: number;
  maxStudents: number;
  maxStaff: number;
  maxStorageMb: number;
  aiCreditsMonthly: number;
  features: string[];
  trialDays: number;
  isPublic: boolean;
  highlighted: boolean;
  sortOrder: number;
};

export const PLAN_SEEDS: PlanSeed[] = [
  {
    key: "starter",
    name: "Starter",
    description: "For small schools getting their records online.",
    priceMonthly: 499900,
    priceYearly: 4999000,
    maxStudents: 250,
    maxStaff: 25,
    maxStorageMb: 2048,
    aiCreditsMonthly: 100,
    features: ["core", "attendance", "fees", "announcements", "reports", "parent_app"],
    trialDays: 14,
    isPublic: true,
    highlighted: false,
    sortOrder: 1,
  },
  {
    key: "growth",
    name: "Growth",
    description: "The complete academic + billing toolkit for growing institutes.",
    priceMonthly: 999900,
    priceYearly: 9999000,
    maxStudents: 1000,
    maxStaff: 100,
    maxStorageMb: 10240,
    aiCreditsMonthly: 500,
    features: ["core", "attendance", "fees", "announcements", "reports", "parent_app", "academics", "staff", "ai", "sms"],
    trialDays: 14,
    isPublic: true,
    highlighted: true,
    sortOrder: 2,
  },
  {
    key: "scale",
    name: "Scale",
    description: "Multi-campus groups that need automation, APIs and white-glove support.",
    priceMonthly: 1999900,
    priceYearly: 19999000,
    maxStudents: 5000,
    maxStaff: 500,
    maxStorageMb: 51200,
    aiCreditsMonthly: 2500,
    features: ["core", "attendance", "fees", "announcements", "reports", "parent_app", "academics", "staff", "ai", "sms", "whatsapp", "api_access", "white_label", "custom_domain", "priority_support", "multi_campus"],
    trialDays: 21,
    isPublic: true,
    highlighted: false,
    sortOrder: 3,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Custom limits, contracts and dedicated infrastructure.",
    priceMonthly: 0,
    priceYearly: 0,
    maxStudents: 25000,
    maxStaff: 2500,
    maxStorageMb: 256000,
    aiCreditsMonthly: 20000,
    features: FEATURES.map((f) => f.key),
    trialDays: 30,
    isPublic: false,
    highlighted: false,
    sortOrder: 4,
  },
];

// ─────────────────────────────── AI modules ───────────────────────────────

export type AiFeatureDef = {
  key: string;
  label: string;
  description: string;
  credits: number;
  placeholder: string;
  icon: string;
};

export const AI_FEATURES: AiFeatureDef[] = [
  {
    key: "report_card_remarks",
    label: "Report card remarks",
    description: "Turn marks and observations into balanced, parent-friendly remarks.",
    credits: 2,
    placeholder: "Student: Aarav Sharma, Class 6-B. Maths 78/100, Science 84/100, English 71/100. Hardworking, improves steadily, needs to participate more in class.",
    icon: "file-text",
  },
  {
    key: "lesson_plan",
    label: "Lesson plan builder",
    description: "Generate a structured, outcome-based lesson plan for any topic.",
    credits: 3,
    placeholder: "Class 7 Science — Chapter: Photosynthesis. 45 minute period, CBSE curriculum, include a low-cost classroom activity.",
    icon: "book-open",
  },
  {
    key: "question_paper",
    label: "Question paper",
    description: "Create a blueprint-aligned question paper with answer keys.",
    credits: 4,
    placeholder: "Class 9 Mathematics, 40 marks, 90 minutes. Chapters: Polynomials, Coordinate Geometry, Linear Equations. 30% easy, 50% medium, 20% hard.",
    icon: "clipboard-list",
  },
  {
    key: "fee_reminder",
    label: "Fee reminder",
    description: "Write polite, firm reminders for pending fees in seconds.",
    credits: 1,
    placeholder: "Parent: Mrs. Kulkarni, student: Riya (Class 8-A), pending ₹12,500 for Term 2, due 5 days ago. Offer UPI payment link and office hours.",
    icon: "wallet",
  },
  {
    key: "admission_reply",
    label: "Admission enquiry reply",
    description: "Answer admission enquiries with accurate next steps.",
    credits: 1,
    placeholder: "Enquiry for Class 4 admission, parent asked about fees, transport and document checklist. School: Greenwood International, CBSE.",
    icon: "message-square",
  },
  {
    key: "attendance_insight",
    label: "Attendance insight",
    description: "Spot attendance risks and get an action plan for the week.",
    credits: 2,
    placeholder: "Class 9-A: 38 students. 6 students below 75% attendance. Monsoon season, two students have medical notes. Suggest interventions.",
    icon: "trending-up",
  },
];

export const AI_FEATURE_MAP = new Map(AI_FEATURES.map((f) => [f.key, f]));

export const PLATFORM_NAME = "Knowletive";
export const PLATFORM_TAGLINE = "The operating system for modern institutes";
