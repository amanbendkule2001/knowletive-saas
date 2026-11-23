--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET search_path TO public;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AiJobStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."AiJobStatus" AS ENUM (
    'SUCCEEDED',
    'FAILED'
);


ALTER TYPE public."AiJobStatus" OWNER TO knowletive;

--
-- Name: AttendanceStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."AttendanceStatus" AS ENUM (
    'PRESENT',
    'ABSENT',
    'LATE',
    'EXCUSED'
);


ALTER TYPE public."AttendanceStatus" OWNER TO knowletive;

--
-- Name: AuditActorType; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."AuditActorType" AS ENUM (
    'PLATFORM',
    'TENANT',
    'SYSTEM'
);


ALTER TYPE public."AuditActorType" OWNER TO knowletive;

--
-- Name: BatchEventType; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."BatchEventType" AS ENUM (
    'ENROLLED',
    'DROPPED',
    'RE_ENROLLED',
    'TRANSFERRED',
    'COMPLETED'
);


ALTER TYPE public."BatchEventType" OWNER TO knowletive;

--
-- Name: BatchStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."BatchStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'COMPLETED',
    'ARCHIVED'
);


ALTER TYPE public."BatchStatus" OWNER TO knowletive;

--
-- Name: BatchStudentStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."BatchStudentStatus" AS ENUM (
    'ACTIVE',
    'DROPPED',
    'COMPLETED',
    'TRANSFERRED'
);


ALTER TYPE public."BatchStudentStatus" OWNER TO knowletive;

--
-- Name: BillingCycle; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."BillingCycle" AS ENUM (
    'MONTHLY',
    'YEARLY'
);


ALTER TYPE public."BillingCycle" OWNER TO knowletive;

--
-- Name: ExamEnrollmentStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."ExamEnrollmentStatus" AS ENUM (
    'REGISTERED',
    'ELIGIBLE',
    'ABSENT',
    'EXEMPTED',
    'WITHDRAWN'
);


ALTER TYPE public."ExamEnrollmentStatus" OWNER TO knowletive;

--
-- Name: ExamEvaluationStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."ExamEvaluationStatus" AS ENUM (
    'PENDING',
    'DRAFT',
    'SUBMITTED',
    'VERIFIED'
);


ALTER TYPE public."ExamEvaluationStatus" OWNER TO knowletive;

--
-- Name: ExamResultState; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."ExamResultState" AS ENUM (
    'DRAFT',
    'COMPUTED',
    'VERIFIED',
    'PUBLISHED'
);


ALTER TYPE public."ExamResultState" OWNER TO knowletive;

--
-- Name: ExamResultStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."ExamResultStatus" AS ENUM (
    'PASS',
    'FAIL',
    'WITHHELD',
    'EXPELLED'
);


ALTER TYPE public."ExamResultStatus" OWNER TO knowletive;

--
-- Name: ExamStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."ExamStatus" AS ENUM (
    'DRAFT',
    'SCHEDULED',
    'IN_PROGRESS',
    'COMPLETED',
    'EVALUATED',
    'PUBLISHED',
    'ARCHIVED'
);


ALTER TYPE public."ExamStatus" OWNER TO knowletive;

--
-- Name: ExamTargetType; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."ExamTargetType" AS ENUM (
    'CLASS_SECTION',
    'BATCH'
);


ALTER TYPE public."ExamTargetType" OWNER TO knowletive;

--
-- Name: ExamType; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."ExamType" AS ENUM (
    'UNIT_TEST',
    'MID_TERM',
    'FINAL',
    'MOCK_TEST',
    'PRACTICAL',
    'ASSIGNMENT',
    'CUSTOM'
);


ALTER TYPE public."ExamType" OWNER TO knowletive;

--
-- Name: FeeStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."FeeStatus" AS ENUM (
    'PENDING',
    'PARTIAL',
    'PAID',
    'OVERDUE',
    'WAIVED'
);


ALTER TYPE public."FeeStatus" OWNER TO knowletive;

--
-- Name: FileKind; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."FileKind" AS ENUM (
    'LOGO',
    'STUDENT_PHOTO',
    'DOCUMENT',
    'RECEIPT'
);


ALTER TYPE public."FileKind" OWNER TO knowletive;

--
-- Name: InvoiceStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."InvoiceStatus" AS ENUM (
    'DRAFT',
    'OPEN',
    'PAID',
    'VOID'
);


ALTER TYPE public."InvoiceStatus" OWNER TO knowletive;

--
-- Name: LeadStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."LeadStatus" AS ENUM (
    'NEW',
    'CONTACTED',
    'FOLLOW_UP',
    'INTERESTED',
    'CONVERTED',
    'LOST'
);


ALTER TYPE public."LeadStatus" OWNER TO knowletive;

--
-- Name: LessonPlanStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."LessonPlanStatus" AS ENUM (
    'DRAFT',
    'PLANNED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."LessonPlanStatus" OWNER TO knowletive;

--
-- Name: NotificationChannel; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."NotificationChannel" AS ENUM (
    'EMAIL',
    'SMS',
    'WHATSAPP',
    'IN_APP'
);


ALTER TYPE public."NotificationChannel" OWNER TO knowletive;

--
-- Name: NotificationStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."NotificationStatus" AS ENUM (
    'QUEUED',
    'SENT',
    'FAILED',
    'SKIPPED'
);


ALTER TYPE public."NotificationStatus" OWNER TO knowletive;

--
-- Name: PaymentLinkStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."PaymentLinkStatus" AS ENUM (
    'OPEN',
    'PAID',
    'EXPIRED',
    'CANCELED'
);


ALTER TYPE public."PaymentLinkStatus" OWNER TO knowletive;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'REFUNDED'
);


ALTER TYPE public."PaymentStatus" OWNER TO knowletive;

--
-- Name: RoleScope; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."RoleScope" AS ENUM (
    'PLATFORM',
    'TENANT'
);


ALTER TYPE public."RoleScope" OWNER TO knowletive;

--
-- Name: StudentStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."StudentStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'ALUMNI'
);


ALTER TYPE public."StudentStatus" OWNER TO knowletive;

--
-- Name: SubscriptionStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'PAUSED',
    'CANCELED',
    'EXPIRED'
);


ALTER TYPE public."SubscriptionStatus" OWNER TO knowletive;

--
-- Name: SyllabusStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."SyllabusStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'COMPLETED',
    'ARCHIVED'
);


ALTER TYPE public."SyllabusStatus" OWNER TO knowletive;

--
-- Name: SyllabusTargetType; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."SyllabusTargetType" AS ENUM (
    'CLASS_SECTION',
    'BATCH'
);


ALTER TYPE public."SyllabusTargetType" OWNER TO knowletive;

--
-- Name: TenantStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."TenantStatus" AS ENUM (
    'TRIAL',
    'ACTIVE',
    'SUSPENDED',
    'CHURNED'
);


ALTER TYPE public."TenantStatus" OWNER TO knowletive;

--
-- Name: TenantType; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."TenantType" AS ENUM (
    'SCHOOL',
    'COLLEGE',
    'COACHING'
);


ALTER TYPE public."TenantType" OWNER TO knowletive;

--
-- Name: TopicProgressStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."TopicProgressStatus" AS ENUM (
    'NOT_STARTED',
    'IN_PROGRESS',
    'COMPLETED',
    'SKIPPED'
);


ALTER TYPE public."TopicProgressStatus" OWNER TO knowletive;

--
-- Name: UserStatus; Type: TYPE; Schema: public; Owner: knowletive
--

CREATE TYPE public."UserStatus" AS ENUM (
    'ACTIVE',
    'INVITED',
    'SUSPENDED'
);


ALTER TYPE public."UserStatus" OWNER TO knowletive;

--
-- Name: fn_protect_exam_revision_event_immutability(); Type: FUNCTION; Schema: public; Owner: knowletive
--

CREATE FUNCTION public.fn_protect_exam_revision_event_immutability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'ExamMarksRevisionEvent records are immutable audit logs and cannot be updated or deleted (id: %)', OLD.id
    USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION public.fn_protect_exam_revision_event_immutability() OWNER TO knowletive;

--
-- Name: fn_protect_exam_revision_truncate(); Type: FUNCTION; Schema: public; Owner: knowletive
--

CREATE FUNCTION public.fn_protect_exam_revision_truncate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'ExamMarksRevisionEvent records are immutable audit logs and cannot be truncated'
    USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION public.fn_protect_exam_revision_truncate() OWNER TO knowletive;

--
-- Name: fn_protect_exam_snapshot_immutability(); Type: FUNCTION; Schema: public; Owner: knowletive
--

CREATE FUNCTION public.fn_protect_exam_snapshot_immutability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'ExamResultSnapshot records are immutable and cannot be updated or deleted (resultId: %)', OLD."resultId"
    USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION public.fn_protect_exam_snapshot_immutability() OWNER TO knowletive;

--
-- Name: fn_protect_exam_snapshot_truncate(); Type: FUNCTION; Schema: public; Owner: knowletive
--

CREATE FUNCTION public.fn_protect_exam_snapshot_truncate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'ExamResultSnapshot records are immutable and cannot be truncated'
    USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION public.fn_protect_exam_snapshot_truncate() OWNER TO knowletive;

--
-- Name: prevent_batch_event_tampering(); Type: FUNCTION; Schema: public; Owner: knowletive
--

CREATE FUNCTION public.prevent_batch_event_tampering() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'BatchEnrollmentEvent records are immutable and cannot be updated, deleted, or truncated.';
END;
$$;


ALTER FUNCTION public.prevent_batch_event_tampering() OWNER TO knowletive;

--
-- Name: trg_syllabustrack_event_immutability(); Type: FUNCTION; Schema: public; Owner: knowletive
--

CREATE FUNCTION public.trg_syllabustrack_event_immutability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'SyllabusProgressEvent records are immutable and cannot be updated, deleted, or truncated.'
    USING ERRCODE = 'P0001';
END;
$$;


ALTER FUNCTION public.trg_syllabustrack_event_immutability() OWNER TO knowletive;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AcademicYear; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."AcademicYear" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    "isActive" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AcademicYear" OWNER TO knowletive;

--
-- Name: AiJob; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."AiJob" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "userId" text,
    feature text NOT NULL,
    prompt text NOT NULL,
    output text,
    credits integer DEFAULT 1 NOT NULL,
    status public."AiJobStatus" DEFAULT 'SUCCEEDED'::public."AiJobStatus" NOT NULL,
    provider text DEFAULT 'mock'::text NOT NULL,
    model text,
    "tokensIn" integer,
    "tokensOut" integer,
    "durationMs" integer,
    error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AiJob" OWNER TO knowletive;

--
-- Name: Announcement; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Announcement" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    audience text DEFAULT 'ALL'::text NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    "authorId" text,
    "publishedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Announcement" OWNER TO knowletive;

--
-- Name: Attendance; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Attendance" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "studentId" text NOT NULL,
    date date NOT NULL,
    status public."AttendanceStatus" DEFAULT 'PRESENT'::public."AttendanceStatus" NOT NULL,
    note text,
    "markedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Attendance" OWNER TO knowletive;

--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."AuditLog" (
    id text NOT NULL,
    "tenantId" text,
    "actorId" text,
    "actorType" public."AuditActorType" DEFAULT 'SYSTEM'::public."AuditActorType" NOT NULL,
    "actorName" text NOT NULL,
    action text NOT NULL,
    entity text,
    "entityId" text,
    meta jsonb,
    ip text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AuditLog" OWNER TO knowletive;

--
-- Name: Batch; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Batch" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "academicYearId" text NOT NULL,
    "subjectId" text,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    capacity integer DEFAULT 30 NOT NULL,
    status public."BatchStatus" DEFAULT 'ACTIVE'::public."BatchStatus" NOT NULL,
    "startDate" timestamp(3) without time zone,
    "endDate" timestamp(3) without time zone,
    schedule text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Batch" OWNER TO knowletive;

--
-- Name: BatchEnrollmentEvent; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."BatchEnrollmentEvent" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    "studentId" text NOT NULL,
    "actorId" text,
    "actorName" text NOT NULL,
    "eventType" public."BatchEventType" NOT NULL,
    "fromBatchId" text,
    "toBatchId" text,
    "effectiveDate" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reason text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."BatchEnrollmentEvent" OWNER TO knowletive;

--
-- Name: BatchStudent; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."BatchStudent" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    "studentId" text NOT NULL,
    status public."BatchStudentStatus" DEFAULT 'ACTIVE'::public."BatchStudentStatus" NOT NULL,
    "enrolledAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "droppedAt" timestamp(3) without time zone,
    "dropReason" text
);


ALTER TABLE public."BatchStudent" OWNER TO knowletive;

--
-- Name: BatchTeacher; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."BatchTeacher" (
    id text NOT NULL,
    "batchId" text NOT NULL,
    "teacherId" text NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "assignedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."BatchTeacher" OWNER TO knowletive;

--
-- Name: ClassLevel; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."ClassLevel" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE public."ClassLevel" OWNER TO knowletive;

--
-- Name: ExamEnrollment; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."ExamEnrollment" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "examId" text NOT NULL,
    "studentId" text NOT NULL,
    "rollNumber" text,
    status public."ExamEnrollmentStatus" DEFAULT 'ELIGIBLE'::public."ExamEnrollmentStatus" NOT NULL,
    remarks text,
    "preservedMarks" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ExamEnrollment" OWNER TO knowletive;

--
-- Name: COLUMN "ExamEnrollment"."preservedMarks"; Type: COMMENT; Schema: public; Owner: knowletive
--

COMMENT ON COLUMN public."ExamEnrollment"."preservedMarks" IS 'Stores previous subject marks state before candidate-level ABSENT/EXEMPTED override was applied';


--
-- Name: ExamMark; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."ExamMark" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "examId" text NOT NULL,
    "examSubjectId" text NOT NULL,
    "studentId" text NOT NULL,
    "enrollmentId" text NOT NULL,
    "marksObtained" double precision,
    "isAbsent" boolean DEFAULT false NOT NULL,
    "isExempted" boolean DEFAULT false NOT NULL,
    "evaluationStatus" public."ExamEvaluationStatus" DEFAULT 'PENDING'::public."ExamEvaluationStatus" NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    feedback text,
    "enteredById" text,
    "enteredAt" timestamp(3) without time zone,
    "verifiedById" text,
    "verifiedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ExamMark" OWNER TO knowletive;

--
-- Name: ExamMarksRevisionEvent; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."ExamMarksRevisionEvent" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "examId" text NOT NULL,
    "examSubjectId" text NOT NULL,
    "studentId" text NOT NULL,
    "markId" text NOT NULL,
    "actorId" text,
    "actorName" text NOT NULL,
    "oldMarks" double precision,
    "newMarks" double precision,
    "oldStatus" public."ExamEvaluationStatus",
    "newStatus" public."ExamEvaluationStatus" NOT NULL,
    reason text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ExamMarksRevisionEvent" OWNER TO knowletive;

--
-- Name: ExamResult; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."ExamResult" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "examId" text NOT NULL,
    "studentId" text NOT NULL,
    "enrollmentId" text NOT NULL,
    "totalMaxMarks" double precision NOT NULL,
    "totalMarksObtained" double precision NOT NULL,
    percentage double precision NOT NULL,
    grade text,
    "gradePoint" double precision,
    rank integer,
    "processingStatus" public."ExamResultState" DEFAULT 'DRAFT'::public."ExamResultState" NOT NULL,
    "resultStatus" public."ExamResultStatus" DEFAULT 'PASS'::public."ExamResultStatus" NOT NULL,
    "passedSubjectsCount" integer DEFAULT 0 NOT NULL,
    "failedSubjectsCount" integer DEFAULT 0 NOT NULL,
    remarks text,
    "publishedAt" timestamp(3) without time zone,
    "publishedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ExamResult" OWNER TO knowletive;

--
-- Name: ExamResultSnapshot; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."ExamResultSnapshot" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "examId" text NOT NULL,
    "studentId" text NOT NULL,
    "resultId" text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "snapshotData" jsonb NOT NULL,
    checksum text NOT NULL,
    "generatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ExamResultSnapshot" OWNER TO knowletive;

--
-- Name: ExamSubject; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."ExamSubject" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "examId" text NOT NULL,
    "subjectId" text NOT NULL,
    "examDate" timestamp(3) without time zone NOT NULL,
    "startTime" text,
    "endTime" text,
    "roomNo" text,
    "maxMarks" double precision DEFAULT 100 NOT NULL,
    "passingMarks" double precision DEFAULT 35 NOT NULL,
    weightage double precision DEFAULT 1.0 NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ExamSubject" OWNER TO knowletive;

--
-- Name: Examination; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Examination" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "academicYearId" text NOT NULL,
    "gradeScaleId" text NOT NULL,
    "syllabusTrackId" text,
    "targetType" public."ExamTargetType" DEFAULT 'CLASS_SECTION'::public."ExamTargetType" NOT NULL,
    "classId" text,
    "sectionId" text,
    "batchId" text,
    title text NOT NULL,
    code text NOT NULL,
    "examType" public."ExamType" DEFAULT 'UNIT_TEST'::public."ExamType" NOT NULL,
    status public."ExamStatus" DEFAULT 'DRAFT'::public."ExamStatus" NOT NULL,
    term text,
    instructions text,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    "isPublished" boolean DEFAULT false NOT NULL,
    "publishedAt" timestamp(3) without time zone,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT chk_examination_target_integrity CHECK (((("targetType" = 'CLASS_SECTION'::public."ExamTargetType") AND ("classId" IS NOT NULL) AND ("batchId" IS NULL)) OR (("targetType" = 'BATCH'::public."ExamTargetType") AND ("batchId" IS NOT NULL) AND ("classId" IS NULL) AND ("sectionId" IS NULL))))
);


ALTER TABLE public."Examination" OWNER TO knowletive;

--
-- Name: FeeInvoice; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."FeeInvoice" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "studentId" text NOT NULL,
    number text NOT NULL,
    title text NOT NULL,
    amount integer NOT NULL,
    "paidAmount" integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    status public."FeeStatus" DEFAULT 'PENDING'::public."FeeStatus" NOT NULL,
    "dueDate" timestamp(3) without time zone NOT NULL,
    "issuedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "paidAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."FeeInvoice" OWNER TO knowletive;

--
-- Name: FeePayment; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."FeePayment" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "feeInvoiceId" text NOT NULL,
    amount integer NOT NULL,
    method text DEFAULT 'CASH'::text NOT NULL,
    reference text,
    "paidAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "collectedById" text,
    provider text,
    "providerRef" text
);


ALTER TABLE public."FeePayment" OWNER TO knowletive;

--
-- Name: FeePaymentLink; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."FeePaymentLink" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "feeInvoiceId" text NOT NULL,
    token text NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    status public."PaymentLinkStatus" DEFAULT 'OPEN'::public."PaymentLinkStatus" NOT NULL,
    provider text DEFAULT 'manual'::text NOT NULL,
    "providerRef" text,
    url text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "paidAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "payerName" text,
    "payerNotes" text,
    "payerPhone" text,
    "submittedAt" timestamp(3) without time zone,
    "utrReference" text
);


ALTER TABLE public."FeePaymentLink" OWNER TO knowletive;

--
-- Name: FileAsset; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."FileAsset" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "studentId" text,
    kind public."FileKind" DEFAULT 'DOCUMENT'::public."FileKind" NOT NULL,
    name text NOT NULL,
    mime text NOT NULL,
    size integer NOT NULL,
    "storageKey" text NOT NULL,
    provider text DEFAULT 'local'::text NOT NULL,
    "uploadedById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."FileAsset" OWNER TO knowletive;

--
-- Name: GradeBand; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."GradeBand" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "scaleId" text NOT NULL,
    "letterGrade" text NOT NULL,
    "gradePoint" double precision NOT NULL,
    "minPercentage" double precision NOT NULL,
    "maxPercentage" double precision NOT NULL,
    "isPassing" boolean DEFAULT true NOT NULL,
    remarks text,
    "order" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."GradeBand" OWNER TO knowletive;

--
-- Name: GradeScale; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."GradeScale" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    "isDefault" boolean DEFAULT false NOT NULL,
    "isSystem" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."GradeScale" OWNER TO knowletive;

--
-- Name: Guardian; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Guardian" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    email text,
    phone text NOT NULL,
    relation text,
    occupation text,
    "userId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Guardian" OWNER TO knowletive;

--
-- Name: Invoice; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Invoice" (
    id text NOT NULL,
    number text NOT NULL,
    "tenantId" text NOT NULL,
    "subscriptionId" text,
    "planId" text,
    status public."InvoiceStatus" DEFAULT 'OPEN'::public."InvoiceStatus" NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    subtotal integer DEFAULT 0 NOT NULL,
    tax integer DEFAULT 0 NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    "periodStart" timestamp(3) without time zone NOT NULL,
    "periodEnd" timestamp(3) without time zone NOT NULL,
    "dueAt" timestamp(3) without time zone NOT NULL,
    "paidAt" timestamp(3) without time zone,
    notes text,
    lines jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "checkoutUrl" text,
    provider text,
    "providerRef" text
);


ALTER TABLE public."Invoice" OWNER TO knowletive;

--
-- Name: Lead; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Lead" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "studentName" text NOT NULL,
    dob timestamp(3) without time zone,
    "classInterested" text,
    "academicYearId" text,
    "guardianName" text NOT NULL,
    "guardianPhone" text NOT NULL,
    "guardianEmail" text,
    source text DEFAULT 'WALK_IN'::text NOT NULL,
    status public."LeadStatus" DEFAULT 'NEW'::public."LeadStatus" NOT NULL,
    "assignedToId" text,
    "nextFollowUp" timestamp(3) without time zone,
    notes text,
    "convertedStudentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Lead" OWNER TO knowletive;

--
-- Name: LeadActivity; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."LeadActivity" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "leadId" text NOT NULL,
    "actorId" text NOT NULL,
    action text NOT NULL,
    notes text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."LeadActivity" OWNER TO knowletive;

--
-- Name: LessonPlan; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."LessonPlan" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "syllabusId" text NOT NULL,
    "chapterId" text NOT NULL,
    "topicId" text NOT NULL,
    "teacherId" text NOT NULL,
    title text NOT NULL,
    objectives text,
    methodology text,
    materials text,
    "plannedDate" timestamp(3) without time zone NOT NULL,
    "durationMinutes" integer DEFAULT 45 NOT NULL,
    "completedDate" timestamp(3) without time zone,
    "actualDurationMinutes" integer,
    status public."LessonPlanStatus" DEFAULT 'PLANNED'::public."LessonPlanStatus" NOT NULL,
    remarks text,
    homework text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."LessonPlan" OWNER TO knowletive;

--
-- Name: Membership; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Membership" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "userId" text NOT NULL,
    "roleId" text NOT NULL,
    "employeeNo" text,
    designation text,
    phone text,
    "isOwner" boolean DEFAULT false NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    "extraPermissions" text[] DEFAULT ARRAY[]::text[],
    "denyPermissions" text[] DEFAULT ARRAY[]::text[],
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Membership" OWNER TO knowletive;

--
-- Name: NotificationLog; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."NotificationLog" (
    id text NOT NULL,
    "tenantId" text,
    "recipientUserId" text,
    channel public."NotificationChannel" NOT NULL,
    template text NOT NULL,
    "to" text NOT NULL,
    subject text,
    body text NOT NULL,
    status public."NotificationStatus" DEFAULT 'QUEUED'::public."NotificationStatus" NOT NULL,
    provider text,
    "providerRef" text,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    meta jsonb,
    "sentAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "isRead" boolean DEFAULT false NOT NULL,
    "readAt" timestamp(3) without time zone
);


ALTER TABLE public."NotificationLog" OWNER TO knowletive;

--
-- Name: PasswordResetToken; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."PasswordResetToken" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    ip text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."PasswordResetToken" OWNER TO knowletive;

--
-- Name: Payment; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "invoiceId" text NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    provider text DEFAULT 'manual'::text NOT NULL,
    "providerRef" text,
    "paidAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Payment" OWNER TO knowletive;

--
-- Name: Permission; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Permission" (
    key text NOT NULL,
    "group" text NOT NULL,
    label text NOT NULL,
    description text,
    scope public."RoleScope" DEFAULT 'TENANT'::public."RoleScope" NOT NULL
);


ALTER TABLE public."Permission" OWNER TO knowletive;

--
-- Name: Plan; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Plan" (
    id text NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    "priceMonthly" integer DEFAULT 0 NOT NULL,
    "priceYearly" integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    "maxStudents" integer DEFAULT 250 NOT NULL,
    "maxStaff" integer DEFAULT 25 NOT NULL,
    "maxStorageMb" integer DEFAULT 2048 NOT NULL,
    "aiCreditsMonthly" integer DEFAULT 50 NOT NULL,
    features text[] DEFAULT ARRAY[]::text[],
    "trialDays" integer DEFAULT 14 NOT NULL,
    "isPublic" boolean DEFAULT true NOT NULL,
    "isArchived" boolean DEFAULT false NOT NULL,
    highlighted boolean DEFAULT false NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Plan" OWNER TO knowletive;

--
-- Name: RateLimitBucket; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."RateLimitBucket" (
    key text NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    "resetAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."RateLimitBucket" OWNER TO knowletive;

--
-- Name: Role; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Role" (
    id text NOT NULL,
    scope public."RoleScope" DEFAULT 'TENANT'::public."RoleScope" NOT NULL,
    "tenantId" text,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    "isSystem" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Role" OWNER TO knowletive;

--
-- Name: RolePermission; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."RolePermission" (
    "roleId" text NOT NULL,
    "permissionKey" text NOT NULL
);


ALTER TABLE public."RolePermission" OWNER TO knowletive;

--
-- Name: Section; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Section" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "classId" text NOT NULL,
    name text NOT NULL,
    capacity integer DEFAULT 40 NOT NULL,
    "classTeacherId" text
);


ALTER TABLE public."Section" OWNER TO knowletive;

--
-- Name: Session; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Session" (
    id text NOT NULL,
    "tokenHash" text NOT NULL,
    "userId" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ip text,
    "userAgent" text,
    "revokedAt" timestamp(3) without time zone
);


ALTER TABLE public."Session" OWNER TO knowletive;

--
-- Name: Setting; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Setting" (
    key text NOT NULL,
    value jsonb NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Setting" OWNER TO knowletive;

--
-- Name: Student; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Student" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "admissionNo" text NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    email text,
    phone text,
    dob timestamp(3) without time zone,
    gender text,
    "bloodGroup" text,
    address text,
    status public."StudentStatus" DEFAULT 'ACTIVE'::public."StudentStatus" NOT NULL,
    "classId" text,
    "sectionId" text,
    "admissionDate" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "userId" text
);


ALTER TABLE public."Student" OWNER TO knowletive;

--
-- Name: StudentGuardian; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."StudentGuardian" (
    "studentId" text NOT NULL,
    "guardianId" text NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."StudentGuardian" OWNER TO knowletive;

--
-- Name: Subject; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Subject" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "classId" text,
    name text NOT NULL,
    code text,
    "teacherId" text
);


ALTER TABLE public."Subject" OWNER TO knowletive;

--
-- Name: SyllabusChapter; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."SyllabusChapter" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "syllabusId" text NOT NULL,
    title text NOT NULL,
    description text,
    "order" integer DEFAULT 0 NOT NULL,
    "estimatedHours" double precision DEFAULT 0 NOT NULL,
    "plannedStartDate" timestamp(3) without time zone,
    "plannedEndDate" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."SyllabusChapter" OWNER TO knowletive;

--
-- Name: SyllabusProgressEvent; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."SyllabusProgressEvent" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "syllabusId" text NOT NULL,
    "topicId" text NOT NULL,
    "actorId" text,
    "actorName" text NOT NULL,
    "previousStatus" public."TopicProgressStatus",
    "newStatus" public."TopicProgressStatus" NOT NULL,
    remarks text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SyllabusProgressEvent" OWNER TO knowletive;

--
-- Name: SyllabusTeacher; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."SyllabusTeacher" (
    id text NOT NULL,
    "syllabusId" text NOT NULL,
    "teacherId" text NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "assignedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SyllabusTeacher" OWNER TO knowletive;

--
-- Name: SyllabusTopic; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."SyllabusTopic" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "syllabusId" text NOT NULL,
    "chapterId" text NOT NULL,
    title text NOT NULL,
    description text,
    "order" integer DEFAULT 0 NOT NULL,
    "learningObjectives" text,
    "estimatedMinutes" integer DEFAULT 45 NOT NULL,
    "plannedDate" timestamp(3) without time zone,
    status public."TopicProgressStatus" DEFAULT 'NOT_STARTED'::public."TopicProgressStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."SyllabusTopic" OWNER TO knowletive;

--
-- Name: SyllabusTrack; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."SyllabusTrack" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "academicYearId" text NOT NULL,
    "subjectId" text NOT NULL,
    "targetType" public."SyllabusTargetType" DEFAULT 'CLASS_SECTION'::public."SyllabusTargetType" NOT NULL,
    "classId" text,
    "sectionId" text,
    "batchId" text,
    name text NOT NULL,
    code text NOT NULL,
    description text,
    status public."SyllabusStatus" DEFAULT 'DRAFT'::public."SyllabusStatus" NOT NULL,
    "startDate" timestamp(3) without time zone,
    "targetDate" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT chk_syllabustrack_target_integrity CHECK (((("targetType" = 'CLASS_SECTION'::public."SyllabusTargetType") AND ("classId" IS NOT NULL) AND ("batchId" IS NULL)) OR (("targetType" = 'BATCH'::public."SyllabusTargetType") AND ("batchId" IS NOT NULL) AND ("classId" IS NULL) AND ("sectionId" IS NULL))))
);


ALTER TABLE public."SyllabusTrack" OWNER TO knowletive;

--
-- Name: Tenant; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."Tenant" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    type public."TenantType" DEFAULT 'SCHOOL'::public."TenantType" NOT NULL,
    status public."TenantStatus" DEFAULT 'TRIAL'::public."TenantStatus" NOT NULL,
    email text NOT NULL,
    phone text,
    website text,
    address text,
    city text,
    state text,
    country text DEFAULT 'India'::text NOT NULL,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    "logoInitials" text NOT NULL,
    "accentColor" text DEFAULT '#4f46e5'::text NOT NULL,
    notes text,
    settings jsonb,
    "trialEndsAt" timestamp(3) without time zone,
    "approvedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Tenant" OWNER TO knowletive;

--
-- Name: TenantSubscription; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."TenantSubscription" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "planId" text NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'TRIALING'::public."SubscriptionStatus" NOT NULL,
    "billingCycle" public."BillingCycle" DEFAULT 'MONTHLY'::public."BillingCycle" NOT NULL,
    "currentPeriodStart" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "currentPeriodEnd" timestamp(3) without time zone NOT NULL,
    "trialEndsAt" timestamp(3) without time zone,
    "cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
    seats integer DEFAULT 1 NOT NULL,
    provider text DEFAULT 'manual'::text NOT NULL,
    "providerRef" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."TenantSubscription" OWNER TO knowletive;

--
-- Name: TenantUsage; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."TenantUsage" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "periodStart" timestamp(3) without time zone NOT NULL,
    "aiCreditsUsed" integer DEFAULT 0 NOT NULL,
    "aiCreditsLimit" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "storageBytes" bigint DEFAULT 0 NOT NULL
);


ALTER TABLE public."TenantUsage" OWNER TO knowletive;

--
-- Name: TopicProgress; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."TopicProgress" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "syllabusId" text NOT NULL,
    "topicId" text NOT NULL,
    "teacherId" text,
    status public."TopicProgressStatus" DEFAULT 'NOT_STARTED'::public."TopicProgressStatus" NOT NULL,
    "plannedDate" timestamp(3) without time zone,
    "completedDate" timestamp(3) without time zone,
    "completedHours" double precision DEFAULT 0 NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."TopicProgress" OWNER TO knowletive;

--
-- Name: User; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    "passwordHash" text NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    "isPlatformOwner" boolean DEFAULT false NOT NULL,
    "platformRoleId" text,
    "avatarColor" text DEFAULT '#4f46e5'::text NOT NULL,
    "lastLoginAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "emailVerifiedAt" timestamp(3) without time zone,
    "twoFactorEnabled" boolean DEFAULT false NOT NULL,
    "twoFactorSecret" text,
    "failedLoginAttempts" integer DEFAULT 0 NOT NULL,
    "lockedUntil" timestamp(3) without time zone
);


ALTER TABLE public."User" OWNER TO knowletive;

--
-- Name: WebhookEvent; Type: TABLE; Schema: public; Owner: knowletive
--

CREATE TABLE public."WebhookEvent" (
    id text NOT NULL,
    provider text NOT NULL,
    "eventId" text NOT NULL,
    "eventType" text,
    payload jsonb,
    "processedAt" timestamp(3) without time zone,
    error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."WebhookEvent" OWNER TO knowletive;

--
-- Name: AcademicYear AcademicYear_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."AcademicYear"
    ADD CONSTRAINT "AcademicYear_pkey" PRIMARY KEY (id);


--
-- Name: AiJob AiJob_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."AiJob"
    ADD CONSTRAINT "AiJob_pkey" PRIMARY KEY (id);


--
-- Name: Announcement Announcement_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Announcement"
    ADD CONSTRAINT "Announcement_pkey" PRIMARY KEY (id);


--
-- Name: Attendance Attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Attendance"
    ADD CONSTRAINT "Attendance_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: BatchEnrollmentEvent BatchEnrollmentEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchEnrollmentEvent"
    ADD CONSTRAINT "BatchEnrollmentEvent_pkey" PRIMARY KEY (id);


--
-- Name: BatchStudent BatchStudent_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchStudent"
    ADD CONSTRAINT "BatchStudent_pkey" PRIMARY KEY (id);


--
-- Name: BatchTeacher BatchTeacher_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchTeacher"
    ADD CONSTRAINT "BatchTeacher_pkey" PRIMARY KEY (id);


--
-- Name: Batch Batch_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Batch"
    ADD CONSTRAINT "Batch_pkey" PRIMARY KEY (id);


--
-- Name: ClassLevel ClassLevel_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ClassLevel"
    ADD CONSTRAINT "ClassLevel_pkey" PRIMARY KEY (id);


--
-- Name: ExamEnrollment ExamEnrollment_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamEnrollment"
    ADD CONSTRAINT "ExamEnrollment_pkey" PRIMARY KEY (id);


--
-- Name: ExamMark ExamMark_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_pkey" PRIMARY KEY (id);


--
-- Name: ExamMarksRevisionEvent ExamMarksRevisionEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMarksRevisionEvent"
    ADD CONSTRAINT "ExamMarksRevisionEvent_pkey" PRIMARY KEY (id);


--
-- Name: ExamResultSnapshot ExamResultSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResultSnapshot"
    ADD CONSTRAINT "ExamResultSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: ExamResult ExamResult_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResult"
    ADD CONSTRAINT "ExamResult_pkey" PRIMARY KEY (id);


--
-- Name: ExamSubject ExamSubject_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamSubject"
    ADD CONSTRAINT "ExamSubject_pkey" PRIMARY KEY (id);


--
-- Name: Examination Examination_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_pkey" PRIMARY KEY (id);


--
-- Name: FeeInvoice FeeInvoice_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeeInvoice"
    ADD CONSTRAINT "FeeInvoice_pkey" PRIMARY KEY (id);


--
-- Name: FeePaymentLink FeePaymentLink_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeePaymentLink"
    ADD CONSTRAINT "FeePaymentLink_pkey" PRIMARY KEY (id);


--
-- Name: FeePayment FeePayment_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeePayment"
    ADD CONSTRAINT "FeePayment_pkey" PRIMARY KEY (id);


--
-- Name: FileAsset FileAsset_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FileAsset"
    ADD CONSTRAINT "FileAsset_pkey" PRIMARY KEY (id);


--
-- Name: GradeBand GradeBand_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."GradeBand"
    ADD CONSTRAINT "GradeBand_pkey" PRIMARY KEY (id);


--
-- Name: GradeScale GradeScale_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."GradeScale"
    ADD CONSTRAINT "GradeScale_pkey" PRIMARY KEY (id);


--
-- Name: Guardian Guardian_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Guardian"
    ADD CONSTRAINT "Guardian_pkey" PRIMARY KEY (id);


--
-- Name: Invoice Invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_pkey" PRIMARY KEY (id);


--
-- Name: LeadActivity LeadActivity_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LeadActivity"
    ADD CONSTRAINT "LeadActivity_pkey" PRIMARY KEY (id);


--
-- Name: Lead Lead_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Lead"
    ADD CONSTRAINT "Lead_pkey" PRIMARY KEY (id);


--
-- Name: LessonPlan LessonPlan_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LessonPlan"
    ADD CONSTRAINT "LessonPlan_pkey" PRIMARY KEY (id);


--
-- Name: Membership Membership_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_pkey" PRIMARY KEY (id);


--
-- Name: NotificationLog NotificationLog_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."NotificationLog"
    ADD CONSTRAINT "NotificationLog_pkey" PRIMARY KEY (id);


--
-- Name: PasswordResetToken PasswordResetToken_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: Permission Permission_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Permission"
    ADD CONSTRAINT "Permission_pkey" PRIMARY KEY (key);


--
-- Name: Plan Plan_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Plan"
    ADD CONSTRAINT "Plan_pkey" PRIMARY KEY (id);


--
-- Name: RateLimitBucket RateLimitBucket_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."RateLimitBucket"
    ADD CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY (key);


--
-- Name: RolePermission RolePermission_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionKey");


--
-- Name: Role Role_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Role"
    ADD CONSTRAINT "Role_pkey" PRIMARY KEY (id);


--
-- Name: Section Section_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Section"
    ADD CONSTRAINT "Section_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: Setting Setting_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Setting"
    ADD CONSTRAINT "Setting_pkey" PRIMARY KEY (key);


--
-- Name: StudentGuardian StudentGuardian_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."StudentGuardian"
    ADD CONSTRAINT "StudentGuardian_pkey" PRIMARY KEY ("studentId", "guardianId");


--
-- Name: Student Student_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Student"
    ADD CONSTRAINT "Student_pkey" PRIMARY KEY (id);


--
-- Name: Subject Subject_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Subject"
    ADD CONSTRAINT "Subject_pkey" PRIMARY KEY (id);


--
-- Name: SyllabusChapter SyllabusChapter_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusChapter"
    ADD CONSTRAINT "SyllabusChapter_pkey" PRIMARY KEY (id);


--
-- Name: SyllabusProgressEvent SyllabusProgressEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusProgressEvent"
    ADD CONSTRAINT "SyllabusProgressEvent_pkey" PRIMARY KEY (id);


--
-- Name: SyllabusTeacher SyllabusTeacher_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTeacher"
    ADD CONSTRAINT "SyllabusTeacher_pkey" PRIMARY KEY (id);


--
-- Name: SyllabusTopic SyllabusTopic_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTopic"
    ADD CONSTRAINT "SyllabusTopic_pkey" PRIMARY KEY (id);


--
-- Name: SyllabusTrack SyllabusTrack_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTrack"
    ADD CONSTRAINT "SyllabusTrack_pkey" PRIMARY KEY (id);


--
-- Name: TenantSubscription TenantSubscription_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TenantSubscription"
    ADD CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY (id);


--
-- Name: TenantUsage TenantUsage_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TenantUsage"
    ADD CONSTRAINT "TenantUsage_pkey" PRIMARY KEY (id);


--
-- Name: Tenant Tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);


--
-- Name: TopicProgress TopicProgress_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TopicProgress"
    ADD CONSTRAINT "TopicProgress_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: WebhookEvent WebhookEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."WebhookEvent"
    ADD CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY (id);


--
-- Name: AcademicYear_tenantId_name_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "AcademicYear_tenantId_name_key" ON public."AcademicYear" USING btree ("tenantId", name);


--
-- Name: AiJob_feature_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "AiJob_feature_idx" ON public."AiJob" USING btree (feature);


--
-- Name: AiJob_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "AiJob_tenantId_createdAt_idx" ON public."AiJob" USING btree ("tenantId", "createdAt");


--
-- Name: Announcement_tenantId_publishedAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Announcement_tenantId_publishedAt_idx" ON public."Announcement" USING btree ("tenantId", "publishedAt");


--
-- Name: Attendance_studentId_date_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Attendance_studentId_date_key" ON public."Attendance" USING btree ("studentId", date);


--
-- Name: Attendance_tenantId_date_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Attendance_tenantId_date_idx" ON public."Attendance" USING btree ("tenantId", date);


--
-- Name: Attendance_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Attendance_tenantId_status_idx" ON public."Attendance" USING btree ("tenantId", status);


--
-- Name: AuditLog_action_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "AuditLog_action_idx" ON public."AuditLog" USING btree (action);


--
-- Name: AuditLog_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "AuditLog_createdAt_idx" ON public."AuditLog" USING btree ("createdAt");


--
-- Name: AuditLog_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON public."AuditLog" USING btree ("tenantId", "createdAt");


--
-- Name: BatchEnrollmentEvent_batchId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "BatchEnrollmentEvent_batchId_idx" ON public."BatchEnrollmentEvent" USING btree ("batchId");


--
-- Name: BatchEnrollmentEvent_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "BatchEnrollmentEvent_createdAt_idx" ON public."BatchEnrollmentEvent" USING btree ("createdAt");


--
-- Name: BatchEnrollmentEvent_studentId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "BatchEnrollmentEvent_studentId_idx" ON public."BatchEnrollmentEvent" USING btree ("studentId");


--
-- Name: BatchStudent_batchId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "BatchStudent_batchId_status_idx" ON public."BatchStudent" USING btree ("batchId", status);


--
-- Name: BatchStudent_batchId_studentId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "BatchStudent_batchId_studentId_key" ON public."BatchStudent" USING btree ("batchId", "studentId");


--
-- Name: BatchStudent_studentId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "BatchStudent_studentId_idx" ON public."BatchStudent" USING btree ("studentId");


--
-- Name: BatchTeacher_batchId_teacherId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "BatchTeacher_batchId_teacherId_key" ON public."BatchTeacher" USING btree ("batchId", "teacherId");


--
-- Name: BatchTeacher_teacherId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "BatchTeacher_teacherId_idx" ON public."BatchTeacher" USING btree ("teacherId");


--
-- Name: Batch_academicYearId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Batch_academicYearId_idx" ON public."Batch" USING btree ("academicYearId");


--
-- Name: Batch_subjectId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Batch_subjectId_idx" ON public."Batch" USING btree ("subjectId");


--
-- Name: Batch_tenantId_code_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Batch_tenantId_code_key" ON public."Batch" USING btree ("tenantId", code);


--
-- Name: Batch_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Batch_tenantId_status_idx" ON public."Batch" USING btree ("tenantId", status);


--
-- Name: ClassLevel_tenantId_name_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "ClassLevel_tenantId_name_key" ON public."ClassLevel" USING btree ("tenantId", name);


--
-- Name: ExamEnrollment_examId_studentId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "ExamEnrollment_examId_studentId_key" ON public."ExamEnrollment" USING btree ("examId", "studentId");


--
-- Name: ExamEnrollment_studentId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamEnrollment_studentId_idx" ON public."ExamEnrollment" USING btree ("studentId");


--
-- Name: ExamEnrollment_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamEnrollment_tenantId_status_idx" ON public."ExamEnrollment" USING btree ("tenantId", status);


--
-- Name: ExamMark_examId_studentId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamMark_examId_studentId_idx" ON public."ExamMark" USING btree ("examId", "studentId");


--
-- Name: ExamMark_examSubjectId_studentId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "ExamMark_examSubjectId_studentId_key" ON public."ExamMark" USING btree ("examSubjectId", "studentId");


--
-- Name: ExamMark_tenantId_evaluationStatus_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamMark_tenantId_evaluationStatus_idx" ON public."ExamMark" USING btree ("tenantId", "evaluationStatus");


--
-- Name: ExamMarksRevisionEvent_examId_examSubjectId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamMarksRevisionEvent_examId_examSubjectId_idx" ON public."ExamMarksRevisionEvent" USING btree ("examId", "examSubjectId");


--
-- Name: ExamMarksRevisionEvent_markId_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamMarksRevisionEvent_markId_createdAt_idx" ON public."ExamMarksRevisionEvent" USING btree ("markId", "createdAt");


--
-- Name: ExamResultSnapshot_examId_studentId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamResultSnapshot_examId_studentId_idx" ON public."ExamResultSnapshot" USING btree ("examId", "studentId");


--
-- Name: ExamResultSnapshot_resultId_version_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "ExamResultSnapshot_resultId_version_key" ON public."ExamResultSnapshot" USING btree ("resultId", version);


--
-- Name: ExamResult_enrollmentId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "ExamResult_enrollmentId_key" ON public."ExamResult" USING btree ("enrollmentId");


--
-- Name: ExamResult_examId_rank_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamResult_examId_rank_idx" ON public."ExamResult" USING btree ("examId", rank);


--
-- Name: ExamResult_examId_studentId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "ExamResult_examId_studentId_key" ON public."ExamResult" USING btree ("examId", "studentId");


--
-- Name: ExamResult_tenantId_resultStatus_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamResult_tenantId_resultStatus_idx" ON public."ExamResult" USING btree ("tenantId", "resultStatus");


--
-- Name: ExamSubject_examId_subjectId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "ExamSubject_examId_subjectId_key" ON public."ExamSubject" USING btree ("examId", "subjectId");


--
-- Name: ExamSubject_tenantId_examDate_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "ExamSubject_tenantId_examDate_idx" ON public."ExamSubject" USING btree ("tenantId", "examDate");


--
-- Name: Examination_academicYearId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Examination_academicYearId_idx" ON public."Examination" USING btree ("academicYearId");


--
-- Name: Examination_batchId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Examination_batchId_idx" ON public."Examination" USING btree ("batchId");


--
-- Name: Examination_classId_sectionId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Examination_classId_sectionId_idx" ON public."Examination" USING btree ("classId", "sectionId");


--
-- Name: Examination_gradeScaleId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Examination_gradeScaleId_idx" ON public."Examination" USING btree ("gradeScaleId");


--
-- Name: Examination_syllabusTrackId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Examination_syllabusTrackId_idx" ON public."Examination" USING btree ("syllabusTrackId");


--
-- Name: Examination_tenantId_code_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Examination_tenantId_code_key" ON public."Examination" USING btree ("tenantId", code);


--
-- Name: Examination_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Examination_tenantId_status_idx" ON public."Examination" USING btree ("tenantId", status);


--
-- Name: FeeInvoice_tenantId_dueDate_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeeInvoice_tenantId_dueDate_idx" ON public."FeeInvoice" USING btree ("tenantId", "dueDate");


--
-- Name: FeeInvoice_tenantId_number_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "FeeInvoice_tenantId_number_key" ON public."FeeInvoice" USING btree ("tenantId", number);


--
-- Name: FeeInvoice_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeeInvoice_tenantId_status_idx" ON public."FeeInvoice" USING btree ("tenantId", status);


--
-- Name: FeePaymentLink_feeInvoiceId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeePaymentLink_feeInvoiceId_idx" ON public."FeePaymentLink" USING btree ("feeInvoiceId");


--
-- Name: FeePaymentLink_provider_providerRef_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeePaymentLink_provider_providerRef_idx" ON public."FeePaymentLink" USING btree (provider, "providerRef");


--
-- Name: FeePaymentLink_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeePaymentLink_tenantId_status_idx" ON public."FeePaymentLink" USING btree ("tenantId", status);


--
-- Name: FeePaymentLink_tenantId_submittedAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeePaymentLink_tenantId_submittedAt_idx" ON public."FeePaymentLink" USING btree ("tenantId", "submittedAt");


--
-- Name: FeePaymentLink_token_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "FeePaymentLink_token_key" ON public."FeePaymentLink" USING btree (token);


--
-- Name: FeePayment_provider_providerRef_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeePayment_provider_providerRef_idx" ON public."FeePayment" USING btree (provider, "providerRef");


--
-- Name: FeePayment_tenantId_paidAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FeePayment_tenantId_paidAt_idx" ON public."FeePayment" USING btree ("tenantId", "paidAt");


--
-- Name: FileAsset_storageKey_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "FileAsset_storageKey_key" ON public."FileAsset" USING btree ("storageKey");


--
-- Name: FileAsset_studentId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FileAsset_studentId_idx" ON public."FileAsset" USING btree ("studentId");


--
-- Name: FileAsset_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FileAsset_tenantId_createdAt_idx" ON public."FileAsset" USING btree ("tenantId", "createdAt");


--
-- Name: FileAsset_tenantId_kind_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "FileAsset_tenantId_kind_idx" ON public."FileAsset" USING btree ("tenantId", kind);


--
-- Name: GradeBand_scaleId_letterGrade_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "GradeBand_scaleId_letterGrade_key" ON public."GradeBand" USING btree ("scaleId", "letterGrade");


--
-- Name: GradeBand_scaleId_order_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "GradeBand_scaleId_order_idx" ON public."GradeBand" USING btree ("scaleId", "order");


--
-- Name: GradeScale_tenantId_code_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "GradeScale_tenantId_code_key" ON public."GradeScale" USING btree ("tenantId", code);


--
-- Name: GradeScale_tenantId_isDefault_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "GradeScale_tenantId_isDefault_idx" ON public."GradeScale" USING btree ("tenantId", "isDefault");


--
-- Name: Guardian_tenantId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Guardian_tenantId_idx" ON public."Guardian" USING btree ("tenantId");


--
-- Name: Guardian_tenantId_phone_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Guardian_tenantId_phone_idx" ON public."Guardian" USING btree ("tenantId", phone);


--
-- Name: Guardian_userId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Guardian_userId_idx" ON public."Guardian" USING btree ("userId");


--
-- Name: Invoice_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Invoice_createdAt_idx" ON public."Invoice" USING btree ("createdAt");


--
-- Name: Invoice_number_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Invoice_number_key" ON public."Invoice" USING btree (number);


--
-- Name: Invoice_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Invoice_tenantId_status_idx" ON public."Invoice" USING btree ("tenantId", status);


--
-- Name: LeadActivity_leadId_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON public."LeadActivity" USING btree ("leadId", "createdAt");


--
-- Name: LeadActivity_tenantId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "LeadActivity_tenantId_idx" ON public."LeadActivity" USING btree ("tenantId");


--
-- Name: Lead_convertedStudentId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Lead_convertedStudentId_key" ON public."Lead" USING btree ("convertedStudentId");


--
-- Name: Lead_tenantId_guardianPhone_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Lead_tenantId_guardianPhone_idx" ON public."Lead" USING btree ("tenantId", "guardianPhone");


--
-- Name: Lead_tenantId_nextFollowUp_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Lead_tenantId_nextFollowUp_idx" ON public."Lead" USING btree ("tenantId", "nextFollowUp");


--
-- Name: Lead_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Lead_tenantId_status_idx" ON public."Lead" USING btree ("tenantId", status);


--
-- Name: LessonPlan_teacherId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "LessonPlan_teacherId_idx" ON public."LessonPlan" USING btree ("teacherId");


--
-- Name: LessonPlan_tenantId_plannedDate_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "LessonPlan_tenantId_plannedDate_idx" ON public."LessonPlan" USING btree ("tenantId", "plannedDate");


--
-- Name: LessonPlan_topicId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "LessonPlan_topicId_idx" ON public."LessonPlan" USING btree ("topicId");


--
-- Name: Membership_roleId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Membership_roleId_idx" ON public."Membership" USING btree ("roleId");


--
-- Name: Membership_tenantId_userId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON public."Membership" USING btree ("tenantId", "userId");


--
-- Name: Membership_userId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Membership_userId_idx" ON public."Membership" USING btree ("userId");


--
-- Name: NotificationLog_channel_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "NotificationLog_channel_idx" ON public."NotificationLog" USING btree (channel);


--
-- Name: NotificationLog_recipientUserId_isRead_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "NotificationLog_recipientUserId_isRead_idx" ON public."NotificationLog" USING btree ("recipientUserId", "isRead");


--
-- Name: NotificationLog_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "NotificationLog_status_idx" ON public."NotificationLog" USING btree (status);


--
-- Name: NotificationLog_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "NotificationLog_tenantId_createdAt_idx" ON public."NotificationLog" USING btree ("tenantId", "createdAt");


--
-- Name: PasswordResetToken_expiresAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "PasswordResetToken_expiresAt_idx" ON public."PasswordResetToken" USING btree ("expiresAt");


--
-- Name: PasswordResetToken_tokenHash_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON public."PasswordResetToken" USING btree ("tokenHash");


--
-- Name: PasswordResetToken_userId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "PasswordResetToken_userId_idx" ON public."PasswordResetToken" USING btree ("userId");


--
-- Name: Payment_provider_providerRef_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Payment_provider_providerRef_idx" ON public."Payment" USING btree (provider, "providerRef");


--
-- Name: Payment_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Payment_tenantId_status_idx" ON public."Payment" USING btree ("tenantId", status);


--
-- Name: Permission_scope_group_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Permission_scope_group_idx" ON public."Permission" USING btree (scope, "group");


--
-- Name: Plan_key_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Plan_key_key" ON public."Plan" USING btree (key);


--
-- Name: RateLimitBucket_resetAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "RateLimitBucket_resetAt_idx" ON public."RateLimitBucket" USING btree ("resetAt");


--
-- Name: RolePermission_permissionKey_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "RolePermission_permissionKey_idx" ON public."RolePermission" USING btree ("permissionKey");


--
-- Name: Role_scope_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Role_scope_idx" ON public."Role" USING btree (scope);


--
-- Name: Role_tenantId_key_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Role_tenantId_key_key" ON public."Role" USING btree ("tenantId", key);


--
-- Name: Section_classId_name_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Section_classId_name_key" ON public."Section" USING btree ("classId", name);


--
-- Name: Section_tenantId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Section_tenantId_idx" ON public."Section" USING btree ("tenantId");


--
-- Name: Session_expiresAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Session_expiresAt_idx" ON public."Session" USING btree ("expiresAt");


--
-- Name: Session_tokenHash_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Session_tokenHash_key" ON public."Session" USING btree ("tokenHash");


--
-- Name: Session_userId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Session_userId_idx" ON public."Session" USING btree ("userId");


--
-- Name: StudentGuardian_guardianId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "StudentGuardian_guardianId_idx" ON public."StudentGuardian" USING btree ("guardianId");


--
-- Name: Student_tenantId_admissionNo_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Student_tenantId_admissionNo_key" ON public."Student" USING btree ("tenantId", "admissionNo");


--
-- Name: Student_tenantId_classId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Student_tenantId_classId_idx" ON public."Student" USING btree ("tenantId", "classId");


--
-- Name: Student_tenantId_firstName_lastName_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Student_tenantId_firstName_lastName_idx" ON public."Student" USING btree ("tenantId", "firstName", "lastName");


--
-- Name: Student_tenantId_lastName_firstName_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Student_tenantId_lastName_firstName_idx" ON public."Student" USING btree ("tenantId", "lastName", "firstName");


--
-- Name: Student_tenantId_sectionId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Student_tenantId_sectionId_idx" ON public."Student" USING btree ("tenantId", "sectionId");


--
-- Name: Student_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Student_tenantId_status_idx" ON public."Student" USING btree ("tenantId", status);


--
-- Name: Student_userId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Student_userId_key" ON public."Student" USING btree ("userId");


--
-- Name: Subject_tenantId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Subject_tenantId_idx" ON public."Subject" USING btree ("tenantId");


--
-- Name: SyllabusChapter_syllabusId_order_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "SyllabusChapter_syllabusId_order_key" ON public."SyllabusChapter" USING btree ("syllabusId", "order");


--
-- Name: SyllabusChapter_tenantId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusChapter_tenantId_idx" ON public."SyllabusChapter" USING btree ("tenantId");


--
-- Name: SyllabusProgressEvent_syllabusId_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusProgressEvent_syllabusId_createdAt_idx" ON public."SyllabusProgressEvent" USING btree ("syllabusId", "createdAt");


--
-- Name: SyllabusProgressEvent_topicId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusProgressEvent_topicId_idx" ON public."SyllabusProgressEvent" USING btree ("topicId");


--
-- Name: SyllabusTeacher_syllabusId_teacherId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "SyllabusTeacher_syllabusId_teacherId_key" ON public."SyllabusTeacher" USING btree ("syllabusId", "teacherId");


--
-- Name: SyllabusTeacher_teacherId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTeacher_teacherId_idx" ON public."SyllabusTeacher" USING btree ("teacherId");


--
-- Name: SyllabusTopic_chapterId_order_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "SyllabusTopic_chapterId_order_key" ON public."SyllabusTopic" USING btree ("chapterId", "order");


--
-- Name: SyllabusTopic_syllabusId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTopic_syllabusId_idx" ON public."SyllabusTopic" USING btree ("syllabusId");


--
-- Name: SyllabusTopic_tenantId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTopic_tenantId_idx" ON public."SyllabusTopic" USING btree ("tenantId");


--
-- Name: SyllabusTrack_academicYearId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTrack_academicYearId_idx" ON public."SyllabusTrack" USING btree ("academicYearId");


--
-- Name: SyllabusTrack_batchId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTrack_batchId_idx" ON public."SyllabusTrack" USING btree ("batchId");


--
-- Name: SyllabusTrack_classId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTrack_classId_idx" ON public."SyllabusTrack" USING btree ("classId");


--
-- Name: SyllabusTrack_sectionId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTrack_sectionId_idx" ON public."SyllabusTrack" USING btree ("sectionId");


--
-- Name: SyllabusTrack_subjectId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTrack_subjectId_idx" ON public."SyllabusTrack" USING btree ("subjectId");


--
-- Name: SyllabusTrack_tenantId_code_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "SyllabusTrack_tenantId_code_key" ON public."SyllabusTrack" USING btree ("tenantId", code);


--
-- Name: SyllabusTrack_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "SyllabusTrack_tenantId_status_idx" ON public."SyllabusTrack" USING btree ("tenantId", status);


--
-- Name: TenantSubscription_planId_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "TenantSubscription_planId_idx" ON public."TenantSubscription" USING btree ("planId");


--
-- Name: TenantSubscription_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "TenantSubscription_status_idx" ON public."TenantSubscription" USING btree (status);


--
-- Name: TenantSubscription_tenantId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON public."TenantSubscription" USING btree ("tenantId");


--
-- Name: TenantUsage_tenantId_periodStart_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "TenantUsage_tenantId_periodStart_key" ON public."TenantUsage" USING btree ("tenantId", "periodStart");


--
-- Name: Tenant_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Tenant_createdAt_idx" ON public."Tenant" USING btree ("createdAt");


--
-- Name: Tenant_slug_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "Tenant_slug_key" ON public."Tenant" USING btree (slug);


--
-- Name: Tenant_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "Tenant_status_idx" ON public."Tenant" USING btree (status);


--
-- Name: TopicProgress_syllabusId_topicId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "TopicProgress_syllabusId_topicId_key" ON public."TopicProgress" USING btree ("syllabusId", "topicId");


--
-- Name: TopicProgress_tenantId_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "TopicProgress_tenantId_status_idx" ON public."TopicProgress" USING btree ("tenantId", status);


--
-- Name: TopicProgress_topicId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "TopicProgress_topicId_key" ON public."TopicProgress" USING btree ("topicId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_status_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "User_status_idx" ON public."User" USING btree (status);


--
-- Name: WebhookEvent_createdAt_idx; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE INDEX "WebhookEvent_createdAt_idx" ON public."WebhookEvent" USING btree ("createdAt");


--
-- Name: WebhookEvent_provider_eventId_key; Type: INDEX; Schema: public; Owner: knowletive
--

CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON public."WebhookEvent" USING btree (provider, "eventId");


--
-- Name: ExamMarksRevisionEvent trg_exam_revision_event_protect; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_exam_revision_event_protect BEFORE DELETE OR UPDATE ON public."ExamMarksRevisionEvent" FOR EACH ROW EXECUTE FUNCTION public.fn_protect_exam_revision_event_immutability();


--
-- Name: ExamMarksRevisionEvent trg_exam_revision_truncate; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_exam_revision_truncate BEFORE TRUNCATE ON public."ExamMarksRevisionEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.fn_protect_exam_revision_truncate();


--
-- Name: ExamResultSnapshot trg_exam_snapshot_protect; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_exam_snapshot_protect BEFORE DELETE OR UPDATE ON public."ExamResultSnapshot" FOR EACH ROW EXECUTE FUNCTION public.fn_protect_exam_snapshot_immutability();


--
-- Name: ExamResultSnapshot trg_exam_snapshot_truncate; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_exam_snapshot_truncate BEFORE TRUNCATE ON public."ExamResultSnapshot" FOR EACH STATEMENT EXECUTE FUNCTION public.fn_protect_exam_snapshot_truncate();


--
-- Name: BatchEnrollmentEvent trg_prevent_batch_event_tampering; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_prevent_batch_event_tampering BEFORE DELETE OR UPDATE ON public."BatchEnrollmentEvent" FOR EACH ROW EXECUTE FUNCTION public.prevent_batch_event_tampering();


--
-- Name: BatchEnrollmentEvent trg_prevent_batch_event_truncate; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_prevent_batch_event_truncate BEFORE TRUNCATE ON public."BatchEnrollmentEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_batch_event_tampering();


--
-- Name: SyllabusProgressEvent trg_protect_syllabustrack_event; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_protect_syllabustrack_event BEFORE DELETE OR UPDATE ON public."SyllabusProgressEvent" FOR EACH ROW EXECUTE FUNCTION public.trg_syllabustrack_event_immutability();


--
-- Name: SyllabusProgressEvent trg_protect_syllabustrack_event_truncate; Type: TRIGGER; Schema: public; Owner: knowletive
--

CREATE TRIGGER trg_protect_syllabustrack_event_truncate BEFORE TRUNCATE ON public."SyllabusProgressEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.trg_syllabustrack_event_immutability();


--
-- Name: AcademicYear AcademicYear_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."AcademicYear"
    ADD CONSTRAINT "AcademicYear_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiJob AiJob_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."AiJob"
    ADD CONSTRAINT "AiJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiJob AiJob_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."AiJob"
    ADD CONSTRAINT "AiJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Announcement Announcement_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Announcement"
    ADD CONSTRAINT "Announcement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Attendance Attendance_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Attendance"
    ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Attendance Attendance_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Attendance"
    ADD CONSTRAINT "Attendance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AuditLog AuditLog_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BatchEnrollmentEvent BatchEnrollmentEvent_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchEnrollmentEvent"
    ADD CONSTRAINT "BatchEnrollmentEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: BatchEnrollmentEvent BatchEnrollmentEvent_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchEnrollmentEvent"
    ADD CONSTRAINT "BatchEnrollmentEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: BatchStudent BatchStudent_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchStudent"
    ADD CONSTRAINT "BatchStudent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BatchStudent BatchStudent_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchStudent"
    ADD CONSTRAINT "BatchStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BatchTeacher BatchTeacher_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchTeacher"
    ADD CONSTRAINT "BatchTeacher_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BatchTeacher BatchTeacher_teacherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."BatchTeacher"
    ADD CONSTRAINT "BatchTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Batch Batch_academicYearId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Batch"
    ADD CONSTRAINT "Batch_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES public."AcademicYear"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Batch Batch_subjectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Batch"
    ADD CONSTRAINT "Batch_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES public."Subject"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Batch Batch_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Batch"
    ADD CONSTRAINT "Batch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ClassLevel ClassLevel_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ClassLevel"
    ADD CONSTRAINT "ClassLevel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamEnrollment ExamEnrollment_examId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamEnrollment"
    ADD CONSTRAINT "ExamEnrollment_examId_fkey" FOREIGN KEY ("examId") REFERENCES public."Examination"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamEnrollment ExamEnrollment_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamEnrollment"
    ADD CONSTRAINT "ExamEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamEnrollment ExamEnrollment_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamEnrollment"
    ADD CONSTRAINT "ExamEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMark ExamMark_enrollmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES public."ExamEnrollment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMark ExamMark_enteredById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ExamMark ExamMark_examId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_examId_fkey" FOREIGN KEY ("examId") REFERENCES public."Examination"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMark ExamMark_examSubjectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_examSubjectId_fkey" FOREIGN KEY ("examSubjectId") REFERENCES public."ExamSubject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMark ExamMark_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMark ExamMark_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMark ExamMark_verifiedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMark"
    ADD CONSTRAINT "ExamMark_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ExamMarksRevisionEvent ExamMarksRevisionEvent_examId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMarksRevisionEvent"
    ADD CONSTRAINT "ExamMarksRevisionEvent_examId_fkey" FOREIGN KEY ("examId") REFERENCES public."Examination"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMarksRevisionEvent ExamMarksRevisionEvent_examSubjectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMarksRevisionEvent"
    ADD CONSTRAINT "ExamMarksRevisionEvent_examSubjectId_fkey" FOREIGN KEY ("examSubjectId") REFERENCES public."ExamSubject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMarksRevisionEvent ExamMarksRevisionEvent_markId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMarksRevisionEvent"
    ADD CONSTRAINT "ExamMarksRevisionEvent_markId_fkey" FOREIGN KEY ("markId") REFERENCES public."ExamMark"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamMarksRevisionEvent ExamMarksRevisionEvent_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamMarksRevisionEvent"
    ADD CONSTRAINT "ExamMarksRevisionEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResultSnapshot ExamResultSnapshot_examId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResultSnapshot"
    ADD CONSTRAINT "ExamResultSnapshot_examId_fkey" FOREIGN KEY ("examId") REFERENCES public."Examination"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResultSnapshot ExamResultSnapshot_resultId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResultSnapshot"
    ADD CONSTRAINT "ExamResultSnapshot_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES public."ExamResult"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResultSnapshot ExamResultSnapshot_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResultSnapshot"
    ADD CONSTRAINT "ExamResultSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResultSnapshot ExamResultSnapshot_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResultSnapshot"
    ADD CONSTRAINT "ExamResultSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResult ExamResult_enrollmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResult"
    ADD CONSTRAINT "ExamResult_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES public."ExamEnrollment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResult ExamResult_examId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResult"
    ADD CONSTRAINT "ExamResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES public."Examination"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResult ExamResult_publishedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResult"
    ADD CONSTRAINT "ExamResult_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ExamResult ExamResult_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResult"
    ADD CONSTRAINT "ExamResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamResult ExamResult_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamResult"
    ADD CONSTRAINT "ExamResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamSubject ExamSubject_examId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamSubject"
    ADD CONSTRAINT "ExamSubject_examId_fkey" FOREIGN KEY ("examId") REFERENCES public."Examination"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamSubject ExamSubject_subjectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamSubject"
    ADD CONSTRAINT "ExamSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES public."Subject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExamSubject ExamSubject_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."ExamSubject"
    ADD CONSTRAINT "ExamSubject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Examination Examination_academicYearId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES public."AcademicYear"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Examination Examination_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Examination Examination_classId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_classId_fkey" FOREIGN KEY ("classId") REFERENCES public."ClassLevel"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Examination Examination_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Examination Examination_gradeScaleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_gradeScaleId_fkey" FOREIGN KEY ("gradeScaleId") REFERENCES public."GradeScale"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Examination Examination_sectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES public."Section"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Examination Examination_syllabusTrackId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_syllabusTrackId_fkey" FOREIGN KEY ("syllabusTrackId") REFERENCES public."SyllabusTrack"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Examination Examination_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Examination"
    ADD CONSTRAINT "Examination_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FeeInvoice FeeInvoice_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeeInvoice"
    ADD CONSTRAINT "FeeInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FeeInvoice FeeInvoice_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeeInvoice"
    ADD CONSTRAINT "FeeInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FeePaymentLink FeePaymentLink_feeInvoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeePaymentLink"
    ADD CONSTRAINT "FeePaymentLink_feeInvoiceId_fkey" FOREIGN KEY ("feeInvoiceId") REFERENCES public."FeeInvoice"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FeePaymentLink FeePaymentLink_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeePaymentLink"
    ADD CONSTRAINT "FeePaymentLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FeePayment FeePayment_feeInvoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeePayment"
    ADD CONSTRAINT "FeePayment_feeInvoiceId_fkey" FOREIGN KEY ("feeInvoiceId") REFERENCES public."FeeInvoice"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FeePayment FeePayment_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FeePayment"
    ADD CONSTRAINT "FeePayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FileAsset FileAsset_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FileAsset"
    ADD CONSTRAINT "FileAsset_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FileAsset FileAsset_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FileAsset"
    ADD CONSTRAINT "FileAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FileAsset FileAsset_uploadedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."FileAsset"
    ADD CONSTRAINT "FileAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: GradeBand GradeBand_scaleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."GradeBand"
    ADD CONSTRAINT "GradeBand_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES public."GradeScale"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: GradeBand GradeBand_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."GradeBand"
    ADD CONSTRAINT "GradeBand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: GradeScale GradeScale_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."GradeScale"
    ADD CONSTRAINT "GradeScale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Guardian Guardian_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Guardian"
    ADD CONSTRAINT "Guardian_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Guardian Guardian_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Guardian"
    ADD CONSTRAINT "Guardian_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Invoice Invoice_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES public."Plan"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Invoice Invoice_subscriptionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES public."TenantSubscription"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Invoice Invoice_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LeadActivity LeadActivity_actorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LeadActivity"
    ADD CONSTRAINT "LeadActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LeadActivity LeadActivity_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LeadActivity"
    ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public."Lead"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LeadActivity LeadActivity_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LeadActivity"
    ADD CONSTRAINT "LeadActivity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Lead Lead_academicYearId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Lead"
    ADD CONSTRAINT "Lead_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES public."AcademicYear"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Lead Lead_assignedToId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Lead"
    ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Lead Lead_convertedStudentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Lead"
    ADD CONSTRAINT "Lead_convertedStudentId_fkey" FOREIGN KEY ("convertedStudentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Lead Lead_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Lead"
    ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LessonPlan LessonPlan_chapterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LessonPlan"
    ADD CONSTRAINT "LessonPlan_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES public."SyllabusChapter"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LessonPlan LessonPlan_syllabusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LessonPlan"
    ADD CONSTRAINT "LessonPlan_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES public."SyllabusTrack"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LessonPlan LessonPlan_teacherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LessonPlan"
    ADD CONSTRAINT "LessonPlan_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LessonPlan LessonPlan_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LessonPlan"
    ADD CONSTRAINT "LessonPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: LessonPlan LessonPlan_topicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."LessonPlan"
    ADD CONSTRAINT "LessonPlan_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES public."SyllabusTopic"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Membership Membership_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Membership Membership_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Membership Membership_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: NotificationLog NotificationLog_recipientUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."NotificationLog"
    ADD CONSTRAINT "NotificationLog_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: NotificationLog NotificationLog_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."NotificationLog"
    ADD CONSTRAINT "NotificationLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PasswordResetToken PasswordResetToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Payment Payment_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Payment Payment_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RolePermission RolePermission_permissionKey_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES public."Permission"(key) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RolePermission RolePermission_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Role Role_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Role"
    ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Section Section_classId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Section"
    ADD CONSTRAINT "Section_classId_fkey" FOREIGN KEY ("classId") REFERENCES public."ClassLevel"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Section Section_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Section"
    ADD CONSTRAINT "Section_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StudentGuardian StudentGuardian_guardianId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."StudentGuardian"
    ADD CONSTRAINT "StudentGuardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES public."Guardian"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StudentGuardian StudentGuardian_studentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."StudentGuardian"
    ADD CONSTRAINT "StudentGuardian_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES public."Student"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Student Student_sectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Student"
    ADD CONSTRAINT "Student_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES public."Section"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Student Student_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Student"
    ADD CONSTRAINT "Student_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Student Student_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Student"
    ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Subject Subject_classId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Subject"
    ADD CONSTRAINT "Subject_classId_fkey" FOREIGN KEY ("classId") REFERENCES public."ClassLevel"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Subject Subject_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."Subject"
    ADD CONSTRAINT "Subject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusChapter SyllabusChapter_syllabusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusChapter"
    ADD CONSTRAINT "SyllabusChapter_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES public."SyllabusTrack"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusChapter SyllabusChapter_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusChapter"
    ADD CONSTRAINT "SyllabusChapter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusProgressEvent SyllabusProgressEvent_syllabusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusProgressEvent"
    ADD CONSTRAINT "SyllabusProgressEvent_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES public."SyllabusTrack"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusProgressEvent SyllabusProgressEvent_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusProgressEvent"
    ADD CONSTRAINT "SyllabusProgressEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusProgressEvent SyllabusProgressEvent_topicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusProgressEvent"
    ADD CONSTRAINT "SyllabusProgressEvent_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES public."SyllabusTopic"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTeacher SyllabusTeacher_syllabusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTeacher"
    ADD CONSTRAINT "SyllabusTeacher_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES public."SyllabusTrack"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTeacher SyllabusTeacher_teacherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTeacher"
    ADD CONSTRAINT "SyllabusTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTopic SyllabusTopic_chapterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTopic"
    ADD CONSTRAINT "SyllabusTopic_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES public."SyllabusChapter"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTopic SyllabusTopic_syllabusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTopic"
    ADD CONSTRAINT "SyllabusTopic_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES public."SyllabusTrack"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTopic SyllabusTopic_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTopic"
    ADD CONSTRAINT "SyllabusTopic_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTrack SyllabusTrack_academicYearId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTrack"
    ADD CONSTRAINT "SyllabusTrack_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES public."AcademicYear"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTrack SyllabusTrack_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTrack"
    ADD CONSTRAINT "SyllabusTrack_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SyllabusTrack SyllabusTrack_classId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTrack"
    ADD CONSTRAINT "SyllabusTrack_classId_fkey" FOREIGN KEY ("classId") REFERENCES public."ClassLevel"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SyllabusTrack SyllabusTrack_sectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTrack"
    ADD CONSTRAINT "SyllabusTrack_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES public."Section"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SyllabusTrack SyllabusTrack_subjectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTrack"
    ADD CONSTRAINT "SyllabusTrack_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES public."Subject"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyllabusTrack SyllabusTrack_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."SyllabusTrack"
    ADD CONSTRAINT "SyllabusTrack_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TenantSubscription TenantSubscription_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TenantSubscription"
    ADD CONSTRAINT "TenantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES public."Plan"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TenantSubscription TenantSubscription_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TenantSubscription"
    ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TenantUsage TenantUsage_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TenantUsage"
    ADD CONSTRAINT "TenantUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TopicProgress TopicProgress_syllabusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TopicProgress"
    ADD CONSTRAINT "TopicProgress_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES public."SyllabusTrack"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TopicProgress TopicProgress_teacherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TopicProgress"
    ADD CONSTRAINT "TopicProgress_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES public."Membership"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TopicProgress TopicProgress_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TopicProgress"
    ADD CONSTRAINT "TopicProgress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TopicProgress TopicProgress_topicId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."TopicProgress"
    ADD CONSTRAINT "TopicProgress_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES public."SyllabusTopic"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: User User_platformRoleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: knowletive
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO knowletive_app;


--
-- Name: TABLE "AcademicYear"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."AcademicYear" TO knowletive_app;


--
-- Name: TABLE "AiJob"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."AiJob" TO knowletive_app;


--
-- Name: TABLE "Announcement"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Announcement" TO knowletive_app;


--
-- Name: TABLE "Attendance"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Attendance" TO knowletive_app;


--
-- Name: TABLE "AuditLog"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."AuditLog" TO knowletive_app;


--
-- Name: TABLE "Batch"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Batch" TO knowletive_app;


--
-- Name: TABLE "BatchEnrollmentEvent"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT ON TABLE public."BatchEnrollmentEvent" TO knowletive_app;


--
-- Name: TABLE "BatchStudent"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."BatchStudent" TO knowletive_app;


--
-- Name: TABLE "BatchTeacher"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."BatchTeacher" TO knowletive_app;


--
-- Name: TABLE "ClassLevel"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."ClassLevel" TO knowletive_app;


--
-- Name: TABLE "FeeInvoice"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."FeeInvoice" TO knowletive_app;


--
-- Name: TABLE "FeePayment"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."FeePayment" TO knowletive_app;


--
-- Name: TABLE "FeePaymentLink"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."FeePaymentLink" TO knowletive_app;


--
-- Name: TABLE "FileAsset"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."FileAsset" TO knowletive_app;


--
-- Name: TABLE "Guardian"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Guardian" TO knowletive_app;


--
-- Name: TABLE "Invoice"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Invoice" TO knowletive_app;


--
-- Name: TABLE "Lead"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Lead" TO knowletive_app;


--
-- Name: TABLE "LeadActivity"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."LeadActivity" TO knowletive_app;


--
-- Name: TABLE "Membership"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Membership" TO knowletive_app;


--
-- Name: TABLE "NotificationLog"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."NotificationLog" TO knowletive_app;


--
-- Name: TABLE "PasswordResetToken"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."PasswordResetToken" TO knowletive_app;


--
-- Name: TABLE "Payment"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Payment" TO knowletive_app;


--
-- Name: TABLE "Permission"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Permission" TO knowletive_app;


--
-- Name: TABLE "Plan"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Plan" TO knowletive_app;


--
-- Name: TABLE "RateLimitBucket"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."RateLimitBucket" TO knowletive_app;


--
-- Name: TABLE "Role"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Role" TO knowletive_app;


--
-- Name: TABLE "RolePermission"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."RolePermission" TO knowletive_app;


--
-- Name: TABLE "Section"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Section" TO knowletive_app;


--
-- Name: TABLE "Session"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Session" TO knowletive_app;


--
-- Name: TABLE "Setting"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Setting" TO knowletive_app;


--
-- Name: TABLE "Student"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Student" TO knowletive_app;


--
-- Name: TABLE "StudentGuardian"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."StudentGuardian" TO knowletive_app;


--
-- Name: TABLE "Subject"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Subject" TO knowletive_app;


--
-- Name: TABLE "SyllabusProgressEvent"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT ON TABLE public."SyllabusProgressEvent" TO knowletive_app;


--
-- Name: TABLE "Tenant"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."Tenant" TO knowletive_app;


--
-- Name: TABLE "TenantSubscription"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."TenantSubscription" TO knowletive_app;


--
-- Name: TABLE "TenantUsage"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."TenantUsage" TO knowletive_app;


--
-- Name: TABLE "User"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."User" TO knowletive_app;


--
-- Name: TABLE "WebhookEvent"; Type: ACL; Schema: public; Owner: knowletive
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public."WebhookEvent" TO knowletive_app;


--
-- PostgreSQL database dump complete
--


