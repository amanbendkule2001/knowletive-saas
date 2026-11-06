import { z } from "zod";

export type FormState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const emptyFormState: FormState = {};

export function fieldErrors(error: z.ZodError): FormState {
  return {
    error: "Please fix the highlighted fields.",
    fieldErrors: z.flattenError(error).fieldErrors as FormState["fieldErrors"],
  };
}

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const passwordRules = z
  .string()
  .min(8, "Use at least 8 characters")
  .regex(/[A-Za-z]/, "Include a letter")
  .regex(/[0-9]/, "Include a number");

export const instituteSchema = z.object({
  name: z.string().trim().min(2, "Institute name is required").max(120),
  type: z.enum(["SCHOOL", "COLLEGE", "COACHING"]),
  email: z.string().trim().toLowerCase().email("Enter a valid institute email"),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  planKey: z.string().min(1, "Choose a plan"),
  adminName: z.string().trim().min(2, "Admin name is required").max(80),
  adminEmail: z.string().trim().toLowerCase().email("Enter a valid admin email"),
  adminPassword: passwordRules,
  trialDays: z.coerce.number().int().min(0).max(90).default(14),
});

export const planSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,30}$/, "Use lowercase letters, numbers and dashes"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).optional().or(z.literal("")),
  priceMonthly: z.coerce.number().min(0).max(10_000_000),
  priceYearly: z.coerce.number().min(0).max(100_000_000),
  maxStudents: z.coerce.number().int().min(1).max(1_000_000),
  maxStaff: z.coerce.number().int().min(1).max(100_000),
  maxStorageMb: z.coerce.number().int().min(100).max(10_000_000),
  aiCreditsMonthly: z.coerce.number().int().min(0).max(1_000_000),
  trialDays: z.coerce.number().int().min(0).max(90),
  highlighted: z.coerce.boolean().optional(),
  isPublic: z.coerce.boolean().optional(),
});

export const staffSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: passwordRules,
  roleId: z.string().min(1, "Choose a role"),
  designation: z.string().trim().max(80).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
});

export const studentSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  admissionNo: z.string().trim().min(1, "Admission number is required").max(30),
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("")),
  dob: z.string().optional().or(z.literal("")),
  bloodGroup: z.string().trim().max(6).optional().or(z.literal("")),
  address: z.string().trim().max(240).optional().or(z.literal("")),
  classId: z.string().optional().or(z.literal("")),
  sectionId: z.string().optional().or(z.literal("")),
  guardianName: z.string().trim().max(80).optional().or(z.literal("")),
  guardianPhone: z.string().trim().max(20).optional().or(z.literal("")),
  guardianEmail: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  guardianRelation: z.string().trim().max(30).optional().or(z.literal("")),
});

export const classSchema = z.object({
  name: z.string().trim().min(1, "Class name is required").max(40),
  order: z.coerce.number().int().min(0).max(100).default(0),
});

export const sectionSchema = z.object({
  classId: z.string().min(1, "Choose a class"),
  name: z.string().trim().min(1, "Section name is required").max(10),
  capacity: z.coerce.number().int().min(1).max(500).default(40),
});

export const feeInvoiceSchema = z.object({
  studentId: z.string().min(1, "Choose a student"),
  title: z.string().trim().min(2, "Title is required").max(120),
  amount: z.coerce.number().min(1, "Amount must be greater than zero").max(10_000_000),
  dueDate: z.string().min(1, "Due date is required"),
  notes: z.string().trim().max(240).optional().or(z.literal("")),
});

export const feePaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().min(1, "Amount must be greater than zero").max(10_000_000),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE"]),
  reference: z.string().trim().max(80).optional().or(z.literal("")),
});

export const announcementSchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(140),
  body: z.string().trim().min(2, "Message is required").max(4000),
  audience: z.enum(["ALL", "STAFF", "PARENTS", "STUDENTS"]),
  pinned: z.coerce.boolean().optional(),
});

export const aiSchema = z.object({
  feature: z.string().min(1, "Choose an AI module"),
  prompt: z.string().trim().min(10, "Add at least 10 characters of context").max(6000),
});

export const institutionSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  website: z.string().trim().max(160).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  state: z.string().trim().max(80).optional().or(z.literal("")),
  timezone: z.string().trim().max(60),
  currency: z.enum(["INR", "USD", "AED", "GBP"]),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordRules,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, "This reset link is invalid"),
    password: passwordRules,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const twoFactorCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"),
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, "Enter your password to disable 2FA"),
});
