# Knowletive SaaS — Teacher & Faculty Guide

## Document Information
- **Title:** Teacher & Faculty Operational Guide
- **Document ID:** DOC-04-TEACHER-GUIDE
- **Target Audience:** Subject Teachers, Class Tutors, Faculty Heads, Academic Instructors
- **Classification:** Standard Operating Procedure (SOP)
- **Repository Location:** `docs/knowletive-functional-handbook/04-TEACHER-GUIDE.md`

---

## Table of Contents
1. [Teacher Role Overview & Daily Responsibilities](#1-teacher-role-overview--daily-responsibilities)
2. [Login & Workspace Navigation](#2-login--workspace-navigation)
3. [Managing Assigned Batches (`/app/batches`)](#3-managing-assigned-batches-appbatches)
4. [Daily Attendance Marking (`/app/attendance`)](#4-daily-attendance-marking-appattendance)
5. [Syllabus Tracking & Lesson Planning (`/app/syllabus`)](#5-syllabus-tracking--lesson-planning-appsyllabus)
6. [AI Studio for Teachers (`/app/ai`)](#6-ai-studio-for-teachers-appai)
7. [Examination Marks Entry & Verification (`/app/exams`)](#7-examination-marks-entry--verification-appexams)
8. [Publishing Notices & Announcements (`/app/announcements`)](#8-publishing-notices--announcements-appannouncements)
9. [Operational Boundaries & Strict Restrictions](#9-operational-boundaries--strict-restrictions)
10. [Common Teacher FAQs & Troubleshooting](#10-common-teacher-faqs--troubleshooting)

---

## 1. Teacher Role Overview & Daily Responsibilities

The **Teacher** is the primary driver of daily classroom education within Knowletive. Teachers interact directly with student records, take daily roll call, ensure syllabus milestones are met according to academic schedules, prepare lesson plans, and grade examinations.

### Key Daily Tasks:
- Take batch attendance within the first 15 minutes of class.
- Mark syllabus topics as completed and record lesson logs.
- Generate lesson plans or quiz questions using AI Studio.
- Enter raw examination marks during active grading cycles.

---

## 2. Login & Workspace Navigation

- **Login URL:** `/login`
- **Credentials:** Your registered school email and password (Demo: `teacher@sunrise.test` / `Admin@123`).
- **Landing Page:** `/app/batches` (Directs you straight into your assigned classes).
- **Navigation Bar:**
  - **Batches:** Overview of all classes where you are assigned as subject teacher or class tutor.
  - **Syllabus:** Curriculum tracker, chapters, topics, and lesson plan repository.
  - **Attendance:** Daily attendance register.
  - **Exams:** Active examination mark sheets.
  - **Announcements:** Institute and class notice boards.
  - **AI Studio:** Generative AI assistant for teachers.

---

## 3. Managing Assigned Batches (`/app/batches`)

1. Navigate to **Batches** (`/app/batches`).
2. You will see a list of classroom batches assigned to you (e.g., "Grade 10 - Section A - Science").
3. Click on a batch card to open the **Batch Classroom Console** (`/app/batches/[id]`):
   - **Student Roster:** Complete list of enrolled students, roll numbers, and admission numbers.
   - **Teacher Team:** Other faculty assigned to this batch.
   - **Timetable Schedule:** Start and end times.
   - **Attendance Summary:** Batch average attendance rate.

---

## 4. Daily Attendance Marking (`/app/attendance`)

Attendance tracking is required for statutory records and parental notifications.

### Step-by-Step Attendance Procedure:
1. Navigate to **Attendance** (`/app/attendance`).
2. Select your **Batch** from the dropdown.
3. The date defaults to **Today** (you can select past dates if permitted by school policy).
4. The student roll call table appears with default status toggles:
   - **P (Present):** Student is physically present.
   - **A (Absent):** Student is absent without prior authorization.
   - **L (Late):** Student arrived after the morning bell.
   - **E (Excused):** Approved absence (medical leave or family emergency).
5. Add optional notes for individual students (e.g., "Arrived 20 mins late with doctor slip").
6. Click **Save Attendance Register**:
   - Invokes `markAttendanceAction` in `src/actions/operations.ts`.
   - Records are persisted to `AttendanceRecord` in the database.
   - Students marked **Absent** trigger automated absence notifications visible to parents in the portal.

---

## 5. Syllabus Tracking & Lesson Planning (`/app/syllabus`)

SyllabusTrack provides structured curriculum oversight.

### 5.1 Viewing Curriculum Structure
- Open **Syllabus** (`/app/syllabus`). Select your Subject and Grade.
- The curriculum tree displays:
  - **Chapters (Units):** Broad learning modules (e.g., "Unit 1: Thermodynamics").
  - **Topics:** Individual lessons under the chapter (e.g., "Topic 1.1: First Law of Thermodynamics").
  - **Target Completion Date & Planned Hours.**

### 5.2 Logging Topic Completion
When you finish teaching a topic in class:
1. Open the topic and click **Mark Completed**.
2. Select the **Batch** taught and the **Date of Delivery**.
3. Record brief teaching remarks (e.g., "Completed theory and solved problems 1 to 5. Assigned homework.").
4. Submitting invokes `recordTopicProgressAction` in `src/actions/syllabus.ts`.
5. The subject completion percentage automatically increments on the administrative progress dashboard.

### 5.3 Creating a Lesson Plan
- Click **+ New Lesson Plan** under any topic.
- Enter Learning Objectives, Required Teaching Materials, Homework Assignment, and Teaching Methodology.

---

## 6. AI Studio for Teachers (`/app/ai`)

Knowletive includes built-in generative AI tools powered by Google Gemini to assist teachers with lesson preparation:

### 6.1 AI Lesson Plan Generator
1. Navigate to **AI Studio** -> Select **Lesson Plan Generator**.
2. Input the Subject, Grade, Topic Name, and Duration (e.g., "45 minutes").
3. Click **Generate Plan**:
   - Invokes `generateLessonPlanAIAction` in `src/actions/ai.ts`.
   - Generates a structured plan including Warm-up Hook (5 mins), Direct Instruction (20 mins), Guided Practice (15 mins), and Exit Ticket (5 mins).
4. Save directly into your SyllabusTrack module.

### 6.2 AI Quiz & Question Paper Formatter
- Select **Question Generator**.
- Specify topic, difficulty level (Easy, Medium, Hard), and question types (Multiple Choice, Short Answer, Essay).
- Instantly export formatted questions for classroom quizzes.

---

## 7. Examination Marks Entry & Verification (`/app/exams`)

When an examination enters the `IN_PROGRESS` or `EVALUATING` state, teachers must enter student scores.

### 7.1 Entering Subject Marks
1. Navigate to **Exams** (`/app/exams`).
2. Select the active examination (e.g., "Mid-Term Exam 2026").
3. Click on your assigned **Subject Mark Sheet** (`/app/exams/[id]`).
4. The candidate roster appears with inputs for:
   - **Marks Obtained:** Numeric score (must be between `0` and the subject's `maxMarks`).
   - **Absent Toggle (`isAbsent`):** Check this if the student missed the exam; locks marks to `0` and flags the report card as Absent.
   - **Teacher Remarks:** Optional qualitative feedback (e.g., "Excellent analytical reasoning").
5. Click **Save Marks Draft**:
   - Invokes `enterMarksBulkAction` in `src/actions/exams.ts`.
   - Saves current scores without finalizing.

### 7.2 Verifying & Submitting to Principal
1. After all student papers are graded and entered, review the score distribution.
2. Click **Verify & Submit Marks**:
   - Invokes `verifyExamMarksAction` in `src/actions/exams.ts`.
   - Marks are locked against accidental edits and forwarded to the Principal/Admin for official publication.

---

## 8. Publishing Notices & Announcements (`/app/announcements`)

- Teachers can broadcast classroom announcements:
  - Homework reminders.
  - Upcoming class test schedules.
  - Field trip consent requirements.
- Select Audience: Target specific batch or whole grade.
- Submitting invokes `publishAnnouncementAction` in `src/actions/operations.ts`.

---

## 9. Operational Boundaries & Strict Restrictions

To maintain security and integrity, the Teacher role is strictly restricted:
- **Cannot Publish Exam Results:** Teachers enter and verify marks, but only the Institute Admin or Principal can execute final result publication.
- **Cannot Alter Published Results:** Once results are published, only the Admin can perform audited corrections.
- **Cannot View Fee Records:** Teachers have zero access to student financial ledgers, tuition dues, or invoices.
- **Cannot Delete Classes or Batches:** Academic structural changes are restricted to administrators.

---

## 10. Common Teacher FAQs & Troubleshooting

- **Q: I cannot see a batch in my list. What should I do?**
  - *Answer:* Ask your Institute Admin to check `/app/batches/[id]/settings` and ensure you are allocated as a teacher to that batch.
- **Q: I entered a mark higher than maximum marks and got an error.**
  - *Answer:* The system enforces `marksObtained <= maxMarks`. Check the subject maximum marks configured on the exam sheet.
- **Q: A student was absent during the exam. How do I record this?**
  - *Answer:* Check the **Absent** checkbox. Do not leave the field blank.
