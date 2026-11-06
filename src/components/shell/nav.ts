export type NavIcon =
  | "dashboard"
  | "building"
  | "layers"
  | "card"
  | "sparkles"
  | "shield"
  | "users"
  | "scroll"
  | "settings"
  | "graduation"
  | "parents"
  | "briefcase"
  | "book"
  | "calendar"
  | "wallet"
  | "megaphone";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  permission?: string;
  section: string;
  exact?: boolean;
};

export const platformNav: NavItem[] = [
  { href: "/platform", label: "Overview", icon: "dashboard", permission: "platform.overview.read", section: "Platform", exact: true },
  { href: "/platform/institutes", label: "Institutes", icon: "building", permission: "platform.institutes.read", section: "Platform" },
  { href: "/platform/plans", label: "Plans & features", icon: "layers", permission: "platform.plans.read", section: "Platform" },
  { href: "/platform/subscriptions", label: "Subscriptions", icon: "card", permission: "platform.subscriptions.read", section: "Revenue" },
  { href: "/platform/ai", label: "AI usage", icon: "sparkles", permission: "platform.ai.read", section: "Revenue" },
  { href: "/platform/roles", label: "Platform roles", icon: "shield", permission: "platform.roles.read", section: "Governance" },
  { href: "/platform/team", label: "Platform team", icon: "users", permission: "platform.users.read", section: "Governance" },
  { href: "/platform/audit", label: "Audit log", icon: "scroll", permission: "platform.audit.read", section: "Governance" },
  { href: "/platform/settings", label: "Settings", icon: "settings", permission: "platform.settings.manage", section: "Governance" },
];

export const appNav: NavItem[] = [
  { href: "/app", label: "Overview", icon: "dashboard", section: "Workspace", exact: true },
  { href: "/app/leads", label: "Leads", icon: "scroll", permission: "tenant.leads.read", section: "Workspace" },
  { href: "/app/students", label: "Students", icon: "graduation", permission: "tenant.students.read", section: "Workspace" },
  { href: "/app/parents", label: "Parents", icon: "parents", permission: "tenant.parents.read", section: "Workspace" },
  { href: "/app/staff", label: "Staff", icon: "briefcase", permission: "tenant.staff.read", section: "Workspace" },
  { href: "/app/academics", label: "Academics", icon: "book", permission: "tenant.academics.read", section: "Academics" },
  { href: "/app/batches", label: "Batches", icon: "layers", permission: "tenant.batches.read", section: "Academics" },
  { href: "/app/syllabus", label: "SyllabusTrack", icon: "book", permission: "tenant.syllabus.read", section: "Academics" },
  { href: "/app/exams", label: "Exams", icon: "scroll", permission: "tenant.exams.read", section: "Academics" },
  { href: "/app/attendance", label: "Attendance", icon: "calendar", permission: "tenant.attendance.read", section: "Academics" },
  { href: "/app/fees", label: "Fees", icon: "wallet", permission: "tenant.fees.read", section: "Operations" },
  { href: "/app/announcements", label: "Announcements", icon: "megaphone", permission: "tenant.announcements.read", section: "Operations" },
  { href: "/app/ai", label: "AI Studio", icon: "sparkles", permission: "tenant.ai.use", section: "Intelligence" },
  { href: "/app/billing", label: "Subscription", icon: "card", permission: "tenant.billing.read", section: "Administration" },
  { href: "/app/roles", label: "Roles & permissions", icon: "shield", permission: "tenant.roles.read", section: "Administration" },
  { href: "/app/settings", label: "Settings", icon: "settings", permission: "tenant.settings.read", section: "Administration" },
];
