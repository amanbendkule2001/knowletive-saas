export type DemoAccount = {
  label: string;
  email: string;
  category: "Platform" | "Institute" | "Portal";
  hint: string;
  badge: string;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  // Platform Superadmins
  {
    label: "Platform Owner",
    email: "owner@knowletive.com",
    category: "Platform",
    badge: "Superadmin",
    hint: "Full platform control of institutes, plans, and billing",
  },
  {
    label: "Platform Support",
    email: "support@knowletive.com",
    category: "Platform",
    badge: "Support",
    hint: "Read-only access across institutes, audit log & AI telemetry",
  },
  // Institute Workspace (Sunrise Public School)
  {
    label: "Institute Admin",
    email: "admin@sunrise.test",
    category: "Institute",
    badge: "Admin",
    hint: "Sunrise Public School: full academic, fee & admissions control",
  },
  {
    label: "Principal",
    email: "principal@sunrise.test",
    category: "Institute",
    badge: "Academic",
    hint: "Academic leadership: exams, curriculum, syllabus & batches",
  },
  {
    label: "Teacher",
    email: "teacher@sunrise.test",
    category: "Institute",
    badge: "Faculty",
    hint: "Classroom faculty: marks entry, syllabus progress & attendance",
  },
  {
    label: "Accountant",
    email: "accounts@sunrise.test",
    category: "Institute",
    badge: "Finance",
    hint: "Financial control: fee invoices, payment receipts & ledger",
  },
  {
    label: "Front Desk",
    email: "frontdesk.test@sunrise.test",
    category: "Institute",
    badge: "Admissions",
    hint: "Front office: admissions CRM, enquiries & student conversions",
  },
  // Family & Student Portals
  {
    label: "Student",
    email: "student@sunrise.test",
    category: "Portal",
    badge: "Student",
    hint: "Student candidate: view report cards, attendance & profile",
  },
  {
    label: "Parent",
    email: "parent@sunrise.test",
    category: "Portal",
    badge: "Guardian",
    hint: "Guardian portal: child attendance, verified grades & fees",
  },
];

