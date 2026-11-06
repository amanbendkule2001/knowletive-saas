import { z } from "zod";

export const createLeadSchema = z.object({
  studentName: z.string().trim().min(2, "Student name is required").max(80),
  dob: z.string().optional().or(z.literal("")),
  guardianName: z.string().trim().min(2, "Guardian name is required").max(80),
  guardianPhone: z.string().trim().min(6, "Valid phone number is required").max(20),
  guardianEmail: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  classInterested: z.string().trim().max(50).optional().or(z.literal("")),
  academicYearId: z.string().optional().or(z.literal("")),
  source: z.string().trim().max(30).optional().or(z.literal("WALK_IN")),
  status: z.enum(["NEW", "CONTACTED", "FOLLOW_UP", "INTERESTED", "CONVERTED", "LOST"]).optional().default("NEW"),
  assignedToId: z.string().optional().or(z.literal("")),
  nextFollowUp: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const convertLeadSchema = z.object({
  leadId: z.string().min(1, "Lead ID is required"),
  admissionNo: z.string().trim().min(1, "Admission number is required").max(30),
  firstName: z.string().trim().min(2, "First name is required").max(50),
  lastName: z.string().trim().min(1, "Last name is required").max(50),
  dob: z.string().optional().or(z.literal("")),
  gender: z.string().optional().or(z.literal("")),
  bloodGroup: z.string().optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  classId: z.string().optional().or(z.literal("")),
  sectionId: z.string().optional().or(z.literal("")),
});

