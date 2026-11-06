/**
 * Demo seed for Knowletive. Destructive by design — run against a dev database:
 *   npm run db:seed
 *
 * Logins (password for all demo users: Admin@123)
 *   owner@knowletive.com      Platform owner
 *   support@knowletive.com    Platform support (read-only)
 *   admin@sunrise.test        Institute admin — Sunrise Public School
 *   teacher@sunrise.test      Teacher
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  PERMISSIONS,
  PLATFORM_ROLE_TEMPLATES,
  TENANT_ROLE_TEMPLATES,
  PLAN_SEEDS,
  AI_FEATURE_MAP,
} from "../src/lib/catalog";

const db = new PrismaClient();

function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261104);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addMonths = (d: Date, n: number) => {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
};
const startOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const atUtcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Ishaan", "Kabir",
  "Rohan", "Dhruv", "Aarush", "Yash", "Advait", "Riya", "Ananya", "Diya", "Aadhya", "Saanvi",
  "Myra", "Aarohi", "Anika", "Navya", "Kiara", "Tanvi", "Ira", "Meera", "Sara", "Aisha",
  "Ishita", "Riddhi", "Nisha", "Pooja", "Neha", "Shreya", "Aryan", "Kunal", "Manav", "Nikhil",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Patil", "Deshmukh", "Iyer", "Nair", "Reddy", "Gupta", "Joshi", "Kulkarni",
  "Mehta", "Shah", "Singh", "Rao", "Bhat", "Naik", "Chavan", "Patel", "Mishra", "Pillai",
];
const OCCUPATIONS = [
  "Software Engineer", "Doctor", "Teacher", "Business Owner", "Banker", "Consultant",
  "Government Officer", "Homemaker", "Architect", "Chartered Accountant",
];
const SUBJECTS_BY_TYPE: Record<string, string[]> = {
  SCHOOL: ["English", "Mathematics", "Science", "Social Studies", "Hindi", "Computer Science"],
  COLLEGE: ["English", "Accountancy", "Economics", "Business Studies", "Mathematics", "Computer Science"],
  COACHING: ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Logical Reasoning"],
};

type TenantSeed = {
  name: string;
  slug: string;
  type: "SCHOOL" | "COLLEGE" | "COACHING";
  status: "TRIAL" | "ACTIVE" | "SUSPENDED";
  planKey: string;
  city: string;
  state: string;
  students: number;
  accent: string;
  classes: string[];
  domain: string;
};

const TENANTS: TenantSeed[] = [
  {
    name: "Sunrise Public School", slug: "sunrise", type: "SCHOOL", status: "ACTIVE",
    planKey: "growth", city: "Pune", state: "Maharashtra", students: 68, accent: "#4f46e5",
    classes: ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8"],
    domain: "sunrise.test",
  },
  {
    name: "Greenwood International School", slug: "greenwood", type: "SCHOOL", status: "ACTIVE",
    planKey: "scale", city: "Mumbai", state: "Maharashtra", students: 84, accent: "#0d9488",
    classes: ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8"],
    domain: "greenwood.test",
  },
  {
    name: "Apex Commerce Academy", slug: "apex", type: "COACHING", status: "TRIAL",
    planKey: "starter", city: "Nagpur", state: "Maharashtra", students: 46, accent: "#ea580c",
    classes: ["Class 9", "Class 10", "Class 11", "Class 12"],
    domain: "apex.test",
  },
  {
    name: "Vidya Junior College", slug: "vidya", type: "COLLEGE", status: "ACTIVE",
    planKey: "growth", city: "Nashik", state: "Maharashtra", students: 58, accent: "#7c3aed",
    classes: ["FYJC", "SYJC"],
    domain: "vidya.test",
  },
  {
    name: "Oakridge Prep", slug: "oakridge", type: "SCHOOL", status: "SUSPENDED",
    planKey: "starter", city: "Bengaluru", state: "Karnataka", students: 32, accent: "#be123c",
    classes: ["Class 4", "Class 5", "Class 6", "Class 7"],
    domain: "oakridge.test",
  },
];

const AI_SAMPLES = [
  {
    feature: "report_card_remarks",
    prompt: "Student: Aarav Sharma, Class 6-B. Maths 78, Science 84, English 71. Hardworking.",
    output:
      "Aarav has had a steady term and shows real curiosity in Science. Mathematics is improving with practice, while written accuracy in English needs a little more attention. A 15-minute daily revision routine and one question asked in class each day would help. Suggested note to parents: “Aarav is progressing well and responds to encouragement. Please support a consistent study routine at home.”",
  },
  {
    feature: "fee_reminder",
    prompt: "Parent: Mrs. Kulkarni, Riya Class 8-A, pending ₹12,500 Term 2, 5 days overdue.",
    output:
      "Dear Parent,\n\nA gentle reminder that ₹12,500 towards Term 2 fees for Riya is pending. You can pay via UPI, card or net banking on the parent portal, or at the accounts office between 9 am and 3 pm. If you would like to split the amount into instalments, reply to this message and we will be glad to work out a plan.\n\nThank you,\nAccounts Office",
  },
  {
    feature: "attendance_insight",
    prompt: "Class 9-A: 38 students, 6 below 75% attendance. Monsoon season, two medical notes.",
    output:
      "What the numbers suggest\n• Six students below 75% is a pattern worth investigating, not six isolated incidents.\n• Check whether absences cluster on Mondays or a specific subject period.\n\nPriority actions\n1. Class teacher: call all six families and log reasons by Wednesday.\n2. Coordinator: pull a 30-day heatmap and flag repeat patterns by Thursday.\n3. Counsellor: meet any student with three consecutive unexplained absences.",
  },
];

async function reset() {
  await db.auditLog.deleteMany();
  await db.aiJob.deleteMany();
  await db.tenantUsage.deleteMany();
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
  await db.tenantSubscription.deleteMany();
  await db.feePayment.deleteMany();
  await db.feeInvoice.deleteMany();
  await db.attendance.deleteMany();
  await db.studentGuardian.deleteMany();
  await db.guardian.deleteMany();
  await db.student.deleteMany();
  await db.announcement.deleteMany();
  await db.subject.deleteMany();
  await db.section.deleteMany();
  await db.classLevel.deleteMany();
  await db.academicYear.deleteMany();
  await db.membership.deleteMany();
  await db.rolePermission.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.role.deleteMany();
  await db.tenant.deleteMany();
  await db.plan.deleteMany();
  await db.permission.deleteMany();
  await db.setting.deleteMany();
}

async function main() {
  console.log("Seeding Knowletive…");
  await reset();

  // ── Permissions ────────────────────────────────────────────────
  await db.permission.createMany({
    data: PERMISSIONS.map((p) => ({
      key: p.key,
      group: p.group,
      label: p.label,
      scope: p.scope,
      description: null,
    })),
  });

  // ── Plans ──────────────────────────────────────────────────────
  const plans = new Map<string, { id: string }>();
  for (const p of PLAN_SEEDS) {
    const plan = await db.plan.create({
      data: {
        key: p.key,
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        currency: "INR",
        maxStudents: p.maxStudents,
        maxStaff: p.maxStaff,
        maxStorageMb: p.maxStorageMb,
        aiCreditsMonthly: p.aiCreditsMonthly,
        features: p.features,
        trialDays: p.trialDays,
        isPublic: p.isPublic,
        highlighted: p.highlighted,
        sortOrder: p.sortOrder,
      },
    });
    plans.set(p.key, plan);
  }

  // ── Platform roles ─────────────────────────────────────────────
  const supportRole = await db.role.create({
    data: {
      scope: "PLATFORM",
      key: "PLATFORM_SUPPORT",
      name: "Platform Support",
      description: "Read-only access to institutes and subscriptions for support.",
      isSystem: true,
      permissions: {
        createMany: {
          data: PLATFORM_ROLE_TEMPLATES.find((r) => r.key === "PLATFORM_SUPPORT")!.permissions.map(
            (permissionKey) => ({ permissionKey }),
          ),
        },
      },
    },
  });
  await db.role.create({
    data: {
      scope: "PLATFORM",
      key: "PLATFORM_OWNER",
      name: "Platform Owner",
      description: "Full control of the platform.",
      isSystem: true,
    },
  });

  const passwordHash = await bcrypt.hash("Admin@123", 12);

  const owner = await db.user.create({
    data: {
      email: "owner@knowletive.com",
      name: "Aman Bendkule",
      passwordHash,
      isPlatformOwner: true,
      avatarColor: "#4f46e5",
      status: "ACTIVE",
    },
  });
  await db.user.create({
    data: {
      email: "support@knowletive.com",
      name: "Priya Nair",
      passwordHash,
      platformRoleId: supportRole.id,
      avatarColor: "#0d9488",
      status: "ACTIVE",
    },
  });

  // ── Tenants ────────────────────────────────────────────────────
  for (const [index, t] of TENANTS.entries()) {
    const plan = plans.get(t.planKey)!;
    const planSeed = PLAN_SEEDS.find((p) => p.key === t.planKey)!;
    const now = new Date();
    const isTrial = t.status === "TRIAL";
    const isSuspended = t.status === "SUSPENDED";
    const periodStart = isTrial
      ? addDays(now, -4)
      : addMonths(startOfMonth(now), -1);
    const periodEnd = isTrial ? addDays(now, 10) : addMonths(startOfMonth(now), 1);

    const tenant = await db.tenant.create({
      data: {
        name: t.name,
        slug: t.slug,
        type: t.type,
        status: t.status,
        email: `office@${t.domain}`,
        phone: `+91 98${between(10, 99)}${between(10000, 99999)}`,
        website: `https://${t.domain}`,
        address: `${between(1, 120)}, ${pick(["MG Road", "College Road", "Station Road", "FC Road", "Baner Road"])}`,
        city: t.city,
        state: t.state,
        country: "India",
        timezone: "Asia/Kolkata",
        currency: "INR",
        logoInitials: t.name.split(" ").slice(0, 2).map((w) => w[0]).join(""),
        accentColor: t.accent,
        trialEndsAt: isTrial ? addDays(now, 10) : null,
        approvedAt: isTrial ? null : addDays(now, -between(120, 600)),
        createdAt: addDays(now, -between(40, 520)),
        settings: { attendanceCutoff: "09:30", academicYear: "2026-27" },
      },
    });

    await db.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: isTrial ? "TRIALING" : isSuspended ? "PAST_DUE" : "ACTIVE",
        billingCycle: index % 2 === 0 ? "YEARLY" : "MONTHLY",
        currentPeriodStart: periodStart,
        currentPeriodEnd: isSuspended ? addDays(now, -6) : periodEnd,
        trialEndsAt: isTrial ? addDays(now, 10) : null,
        seats: planSeed.maxStaff,
        provider: "manual",
      },
    });

    // ── Platform invoices (previous paid periods) ────────────────
    const cycle = index % 2 === 0 ? "YEARLY" : "MONTHLY";
    const baseAmount = cycle === "YEARLY" ? planSeed.priceYearly : planSeed.priceMonthly;
    const tax = Math.round(baseAmount * 0.18);
    for (let i = 3; i >= 1; i--) {
      const pStart = addMonths(periodStart, -i);
      const pEnd = addMonths(pStart, cycle === "YEARLY" ? 12 : 1);
      await db.invoice.create({
        data: {
          number: `INV-${pStart.getFullYear()}-${t.slug.slice(0, 3).toUpperCase()}${i}${index}`,
          tenantId: tenant.id,
          planId: plan.id,
          status: "PAID",
          currency: "INR",
          subtotal: baseAmount,
          tax,
          total: baseAmount + tax,
          periodStart: pStart,
          periodEnd: pEnd,
          dueAt: addDays(pStart, 7),
          paidAt: addDays(pStart, 3),
          lines: [
            { description: `${planSeed.name} plan — ${cycle === "YEARLY" ? "annual" : "monthly"}`, amount: baseAmount },
            { description: "GST (18%)", amount: tax },
          ],
        },
      });
    }
    if (!isTrial) {
      await db.invoice.create({
        data: {
          number: `INV-${now.getFullYear()}-${t.slug.slice(0, 3).toUpperCase()}R${index}`,
          tenantId: tenant.id,
          planId: plan.id,
          status: isSuspended ? "OPEN" : index === 0 ? "OPEN" : "PAID",
          currency: "INR",
          subtotal: baseAmount,
          tax,
          total: baseAmount + tax,
          periodStart,
          periodEnd,
          dueAt: addDays(periodStart, 7),
          paidAt: isSuspended ? null : addDays(periodStart, 2),
          lines: [
            { description: `${planSeed.name} plan — current period`, amount: baseAmount },
            { description: "GST (18%)", amount: tax },
          ],
        },
      });
    }

    // ── Roles & staff ────────────────────────────────────────────
    const roles = new Map<string, { id: string }>();
    for (const template of TENANT_ROLE_TEMPLATES) {
      const role = await db.role.create({
        data: {
          scope: "TENANT",
          tenantId: tenant.id,
          key: template.key,
          name: template.name,
          description: template.description,
          isSystem: true,
          permissions: {
            createMany: { data: template.permissions.map((permissionKey) => ({ permissionKey })) },
          },
        },
      });
      roles.set(template.key, role);
    }

    const staffSeeds = [
      { role: "INSTITUTE_ADMIN", name: `${t.name.split(" ")[0]} Admin`, designation: "Institute Administrator", local: "admin", ownerFlag: true },
      { role: "PRINCIPAL", name: `Dr. ${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, designation: "Principal", local: "principal", ownerFlag: false },
      { role: "TEACHER", name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, designation: "Senior Teacher", local: "teacher", ownerFlag: false },
      { role: "ACCOUNTANT", name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, designation: "Accounts Officer", local: "accounts", ownerFlag: false },
    ];

    for (const s of staffSeeds) {
      const user = await db.user.create({
        data: {
          email: `${s.local}@${t.domain}`,
          name: s.name,
          passwordHash,
          avatarColor: pick(["#4f46e5", "#0d9488", "#ea580c", "#7c3aed", "#be123c", "#0284c7"]),
          status: "ACTIVE",
          lastLoginAt: addDays(now, -between(0, 12)),
        },
      });
      await db.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: roles.get(s.role)!.id,
          designation: s.designation,
          phone: `+91 97${between(10, 99)}${between(10000, 99999)}`,
          employeeNo: `${t.slug.slice(0, 3).toUpperCase()}-EMP-${between(100, 999)}`,
          isOwner: s.ownerFlag,
          status: "ACTIVE",
        },
      });
    }

    // ── Academic structure ───────────────────────────────────────
    await db.academicYear.createMany({
      data: [
        { id: randomUUID(), tenantId: tenant.id, name: "2025-26", startDate: new Date("2025-04-01"), endDate: new Date("2026-03-31"), isActive: false },
        { id: randomUUID(), tenantId: tenant.id, name: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isActive: true },
      ],
    });

    const classIds: { id: string; name: string; order: number }[] = [];
    for (const [i, className] of t.classes.entries()) {
      const id = randomUUID();
      await db.classLevel.create({ data: { id, tenantId: tenant.id, name: className, order: i + 1 } });
      classIds.push({ id, name: className, order: i + 1 });
    }

    const sectionIds: { id: string; classId: string; classOrder: number; name: string }[] = [];
    for (const c of classIds) {
      for (const sectionName of ["A", "B"]) {
        const id = randomUUID();
        await db.section.create({
          data: { id, tenantId: tenant.id, classId: c.id, name: sectionName, capacity: 40 },
        });
        sectionIds.push({ id, classId: c.id, classOrder: c.order, name: sectionName });
      }
    }

    await db.subject.createMany({
      data: (SUBJECTS_BY_TYPE[t.type] ?? SUBJECTS_BY_TYPE.SCHOOL).map((name, i) => ({
        id: randomUUID(),
        tenantId: tenant.id,
        classId: classIds[i % classIds.length].id,
        name,
        code: `${name.slice(0, 3).toUpperCase()}-${100 + i}`,
      })),
    });

    // ── Students + guardians ────────────────────────────────────
    const studentRows: Prisma.StudentCreateManyInput[] = [];
    const guardianRows: Prisma.GuardianCreateManyInput[] = [];
    const linkRows: Prisma.StudentGuardianCreateManyInput[] = [];
    const feeRows: Prisma.FeeInvoiceCreateManyInput[] = [];
    const feePaymentRows: Prisma.FeePaymentCreateManyInput[] = [];

    for (let i = 0; i < t.students; i++) {
      const section = sectionIds[i % sectionIds.length];
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const studentId = randomUUID();
      const admissionNo = `${t.slug.slice(0, 3).toUpperCase()}-2026-${String(i + 1).padStart(4, "0")}`;
      const dobYear = 2026 - (5 + section.classOrder);

      studentRows.push({
        id: studentId,
        tenantId: tenant.id,
        admissionNo,
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@student.${t.domain}`,
        phone: `+91 96${between(10, 99)}${between(10000, 99999)}`,
        dob: new Date(Date.UTC(dobYear, between(0, 11), between(1, 28))),
        gender: rand() > 0.48 ? "MALE" : "FEMALE",
        bloodGroup: pick(["A+", "B+", "O+", "AB+", "O-", "A-"]),
        address: `${between(1, 200)}, ${pick(["Shivaji Nagar", "Kothrud", "Viman Nagar", "Andheri West", "Dharampeth"])}, ${t.city}`,
        status: "ACTIVE",
        classId: section.classId,
        sectionId: section.id,
        admissionDate: addDays(now, -between(60, 900)),
      });

      const guardianId = randomUUID();
      const gFirst = pick(FIRST_NAMES);
      guardianRows.push({
        id: guardianId,
        tenantId: tenant.id,
        name: `${gFirst} ${last}`,
        email: `${gFirst.toLowerCase()}.${last.toLowerCase()}${i}@parent.${t.domain}`,
        phone: `+91 95${between(10, 99)}${between(10000, 99999)}`,
        relation: rand() > 0.5 ? "Father" : "Mother",
        occupation: pick(OCCUPATIONS),
      });
      linkRows.push({ studentId, guardianId, isPrimary: true });

      if (rand() > 0.65) {
        const secondId = randomUUID();
        guardianRows.push({
          id: secondId,
          tenantId: tenant.id,
          name: `${pick(FIRST_NAMES)} ${last}`,
          email: null,
          phone: `+91 94${between(10, 99)}${between(10000, 99999)}`,
          relation: rand() > 0.5 ? "Mother" : "Father",
          occupation: pick(OCCUPATIONS),
        });
        linkRows.push({ studentId, guardianId: secondId, isPrimary: false });
      }

      // Fee invoices: Term 1 (paid) + Term 2 (mixed status).
      // All money is stored in minor units (paise).
      const term1 = (8000 + section.classOrder * 1500) * 100;
      feeRows.push({
        id: randomUUID(),
        tenantId: tenant.id,
        studentId,
        number: `${t.slug.slice(0, 3).toUpperCase()}-FEE-${String(i + 1).padStart(4, "0")}-1`,
        title: "Term 1 fees",
        amount: term1,
        paidAmount: term1,
        status: "PAID",
        dueDate: addDays(now, -120),
        issuedAt: addDays(now, -140),
        paidAt: addDays(now, -130),
      });
      const term2 = term1;
      const roll = rand();
      const status = roll > 0.62 ? "PAID" : roll > 0.4 ? "PARTIAL" : roll > 0.2 ? "OVERDUE" : "PENDING";
      const paid = status === "PAID" ? term2 : status === "PARTIAL" ? Math.round(term2 * 0.4) : 0;
      const invoiceId = randomUUID();
      feeRows.push({
        id: invoiceId,
        tenantId: tenant.id,
        studentId,
        number: `${t.slug.slice(0, 3).toUpperCase()}-FEE-${String(i + 1).padStart(4, "0")}-2`,
        title: "Term 2 fees",
        amount: term2,
        paidAmount: paid,
        status,
        dueDate: addDays(now, status === "PAID" ? -10 : status === "OVERDUE" ? -12 : 14),
        issuedAt: addDays(now, -45),
        paidAt: status === "PAID" ? addDays(now, -20) : null,
      });
      if (paid > 0) {
        feePaymentRows.push({
          id: randomUUID(),
          tenantId: tenant.id,
          feeInvoiceId: invoiceId,
          amount: paid,
          method: pick(["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE"]),
          reference: `RCPT-${between(100000, 999999)}`,
          paidAt: addDays(now, -between(1, 20)),
        });
      }
    }

    await db.student.createMany({ data: studentRows });
    await db.guardian.createMany({ data: guardianRows });
    await db.studentGuardian.createMany({ data: linkRows });
    await db.feeInvoice.createMany({ data: feeRows });
    await db.feePayment.createMany({ data: feePaymentRows });

    // ── Attendance: last 12 weekdays ─────────────────────────────
    const attendance: Prisma.AttendanceCreateManyInput[] = [];
    let day = atUtcMidnight(now);
    let added = 0;
    while (added < 12) {
      const dow = day.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        for (const s of studentRows) {
          const roll = rand();
          attendance.push({
            id: randomUUID(),
            tenantId: tenant.id,
            studentId: s.id!,
            date: day,
            status: roll > 0.075 ? "PRESENT" : roll > 0.035 ? "ABSENT" : roll > 0.018 ? "LATE" : "EXCUSED",
            markedById: null,
          });
        }
        added++;
      }
      day = addDays(day, -1);
    }
    await db.attendance.createMany({ data: attendance });

    // ── Announcements ───────────────────────────────────────────
    await db.announcement.createMany({
      data: [
        {
          id: randomUUID(), tenantId: tenant.id,
          title: "Parent-teacher meeting — Saturday",
          body: "The term-end parent-teacher meeting will be held this Saturday from 9:00 am to 1:00 pm. Please book a slot with the class teacher. Report cards will be shared during the meeting.",
          audience: "PARENTS", pinned: true, publishedAt: addDays(now, -2),
        },
        {
          id: randomUUID(), tenantId: tenant.id,
          title: "Annual sports day registrations open",
          body: "Registrations for the annual sports day are now open. Students may sign up for athletics, football, basketball and chess with their class teacher by Friday.",
          audience: "ALL", pinned: false, publishedAt: addDays(now, -6),
        },
        {
          id: randomUUID(), tenantId: tenant.id,
          title: "Fee payment window extended",
          body: "The Term 2 fee payment window has been extended by two weeks. Families who need a payment plan may contact the accounts office confidentially.",
          audience: "PARENTS", pinned: false, publishedAt: addDays(now, -12),
        },
      ],
    });

    // ── AI usage & sample jobs ──────────────────────────────────
    await db.tenantUsage.create({
      data: {
        tenantId: tenant.id,
        periodStart: startOfMonth(now),
        aiCreditsUsed: Math.min(planSeed.aiCreditsMonthly, between(35, 180)),
        aiCreditsLimit: planSeed.aiCreditsMonthly,
      },
    });
    for (let i = 0; i < 2; i++) {
      const sample = AI_SAMPLES[(index + i) % AI_SAMPLES.length];
      const feature = AI_FEATURE_MAP.get(sample.feature)!;
      await db.aiJob.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          feature: sample.feature,
          prompt: sample.prompt,
          output: sample.output,
          credits: feature.credits,
          status: "SUCCEEDED",
          provider: "mock",
          model: "knowletive-demo",
          tokensIn: between(80, 220),
          tokensOut: between(150, 400),
          durationMs: between(600, 2400),
          createdAt: addDays(now, -between(1, 9)),
        },
      });
    }

    // ── Tenant audit entries ────────────────────────────────────
    await db.auditLog.createMany({
      data: [
        {
          tenantId: tenant.id, actorId: owner.id, actorType: "TENANT",
          actorName: "Institute Admin", action: "student.create", entity: "Student",
          meta: { count: 1 }, createdAt: addDays(now, -1),
        },
        {
          tenantId: tenant.id, actorId: owner.id, actorType: "TENANT",
          actorName: "Institute Admin", action: "fee.payment.record", entity: "FeeInvoice",
          meta: { amount: 1_250_000 }, createdAt: addDays(now, -3),
        },
        {
          tenantId: tenant.id, actorId: owner.id, actorType: "TENANT",
          actorName: "Principal", action: "announcement.publish", entity: "Announcement",
          createdAt: addDays(now, -6),
        },
      ],
    });

    console.log(`  ✓ ${t.name} (${t.students} students, ${t.planKey})`);
  }

  // ── Platform audit + settings ─────────────────────────────────
  await db.auditLog.createMany({
    data: [
      { actorId: owner.id, actorType: "PLATFORM", actorName: "Aman Bendkule", action: "institute.create", entity: "Tenant", meta: { tenant: "Sunrise Public School" }, createdAt: addDays(new Date(), -40) },
      { actorId: owner.id, actorType: "PLATFORM", actorName: "Aman Bendkule", action: "plan.update", entity: "Plan", meta: { plan: "growth" }, createdAt: addDays(new Date(), -12) },
      { actorId: owner.id, actorType: "PLATFORM", actorName: "Aman Bendkule", action: "subscription.extend_trial", entity: "Tenant", meta: { days: 7 }, createdAt: addDays(new Date(), -5) },
      { actorId: owner.id, actorType: "PLATFORM", actorName: "Aman Bendkule", action: "institute.suspend", entity: "Tenant", meta: { reason: "Payment overdue" }, createdAt: addDays(new Date(), -2) },
    ],
  });

  await db.setting.create({
    data: {
      key: "platform",
      value: {
        name: "Knowletive",
        supportEmail: "support@knowletive.com",
        defaultTrialDays: 14,
        billingProvider: "manual",
        aiMode: process.env.AI_PROVIDER ?? "mock",
      },
    },
  });

  console.log("\nSeed complete.\n");
  console.log("  Platform owner : owner@knowletive.com / Admin@123");
  console.log("  Platform support: support@knowletive.com / Admin@123");
  console.log("  Institute admin : admin@sunrise.test / Admin@123");
  console.log("  Teacher         : teacher@sunrise.test / Admin@123\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
