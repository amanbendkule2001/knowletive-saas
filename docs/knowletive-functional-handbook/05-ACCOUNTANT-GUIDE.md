# Knowletive SaaS — Accountant & Financial Operations Guide

## Document Information
- **Title:** Financial Management & Fee Collection Guide
- **Document ID:** DOC-05-ACCOUNTANT-GUIDE
- **Target Audience:** School Bursars, Chief Financial Officers, Accountants, Cashiers
- **Classification:** Standard Operating Procedure (SOP)
- **Repository Location:** `docs/knowletive-functional-handbook/05-ACCOUNTANT-GUIDE.md`

---

## Table of Contents
1. [Financial Architecture & Accountant Role](#1-financial-architecture--accountant-role)
2. [Login & Financial Dashboard (`/app/fees`)](#2-login--financial-dashboard-appfees)
3. [Fee Structures & Invoicing Architecture](#3-fee-structures--invoicing-architecture)
4. [Creating Fee Invoices (`/app/fees/new`)](#4-creating-fee-invoices-appfeesnew)
5. [Recording Payments & Issuing Receipts](#5-recording-payments--issuing-receipts)
6. [Managing Outstanding Dues & Overdue Accounts](#6-managing-outstanding-dues--overdue-accounts)
7. [Automated Fee Reminders (`/app/fees`)](#7-automated-fee-reminders-appfees)
8. [Daily & Monthly Financial Reconciliation](#8-daily--monthly-financial-reconciliation)
9. [Role Boundaries & Financial Controls](#9-role-boundaries--financial-controls)
10. [Accountant FAQs & Audit Compliance](#10-accountant-faqs--audit-compliance)

---

## 1. Financial Architecture & Accountant Role

The **Accountant** is responsible for the financial solvency and fee lifecycle of the educational institution. This includes drafting fee schedules, issuing term invoices, processing tuition payments across multiple payment channels, issuing stamped receipts, and pursuing overdue accounts.

---

## 2. Login & Financial Dashboard (`/app/fees`)

- **Login URL:** `/login`
- **Credentials:** `accountant@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/app/fees`
- **Dashboard Summary Widgets:**
  - **Total Invoiced (Term):** Aggregate sum of all generated invoices.
  - **Total Collected:** Total cash, card, and digital funds collected.
  - **Total Outstanding Dues:** Uncollected balances across all active students.
  - **Collection Efficiency (%):** `(Total Collected / Total Invoiced) * 100`.

---

## 3. Fee Structures & Invoicing Architecture

Fee invoices in Knowletive are composed of itemized line items:
- **Tuition Fee:** Core academic instruction charges.
- **Laboratory / Practical Fee:** Science and computer lab usage.
- **Library & Resource Fee:** Books, digital media, subscriptions.
- **Transportation Fee:** Bus and transit route charges.
- **Examination Fee:** Term exam administrative costs.

---

## 4. Creating Fee Invoices (`/app/fees/new`)

Invoices can be generated individually or in bulk for an entire batch.

### 4.1 Invoicing Wizard Procedure:
1. Navigate to **Fees** -> Click **+ Create Invoice** (`/app/fees/new`).
2. **Select Scope:**
   - **Single Student:** Search student by name or admission number.
   - **Entire Batch:** Select grade and section (e.g., "Grade 10 - Section A").
3. **Invoice Details:**
   - **Title / Reference:** e.g., "Term 2 Tuition & Lab Fee 2026".
   - **Due Date:** Payment deadline date.
4. **Line Items:** Add one or more fee heads with amounts.
5. Click **Generate Invoice**:
   - Invokes `createFeeInvoiceAction` in `src/actions/operations.ts`.
   - Creates `FeeInvoice` and `FeeLineItem` database records.
   - Status defaults to `PENDING`.
   - Invoices become immediately visible to parents in the **Parent Portal** (`/portal`).

---

## 5. Recording Payments & Issuing Receipts

When a parent or student pays fees:
1. Open **Fees** (`/app/fees`) and locate the invoice by Student Name or Invoice Number.
2. Click on the invoice to open the **Invoice Statement** (`/app/fees/[id]`).
3. Click **Record Payment**:
   - **Amount Received:** Enter numeric payment. Supports **partial payments** (e.g., paying $500 against a $1,200 invoice).
   - **Payment Method:** Select `CASH`, `CREDIT_CARD`, `DEBIT_CARD`, `BANK_TRANSFER`, or `UPI`.
   - **Transaction Reference / Cheque No:** Bank reference or transaction ID.
   - **Payment Date:** Date funds were received.
4. Click **Confirm Payment**:
   - Invokes `recordFeePaymentAction` in `src/actions/operations.ts`.
   - Persists a `FeePayment` record.
   - Updates `FeeInvoice.paidAmount` and recalculates invoice status:
     - If `paidAmount == 0`: `PENDING`
     - If `paidAmount < totalAmount`: `PARTIAL`
     - If `paidAmount >= totalAmount`: `PAID`
5. **Print Receipt:** Click **Generate Receipt** to produce an official printable payment receipt featuring transaction timestamp, student details, payment method, and institute seal.

---

## 6. Managing Outstanding Dues & Overdue Accounts

- Use the status filter on `/app/fees` to isolate `PENDING` and `PARTIAL` invoices.
- Filter by **Overdue** to flag invoices where `dueDate < TODAY` and balance > 0.
- Export debtor reports for administrative review.

---

## 7. Automated Fee Reminders (`/app/fees`)

- Select unpaid invoices and click **Send Reminders**.
- Invokes `sendFeeReminderNotificationAction` in `src/actions/notifications.ts`.
- Dispatches electronic notices to linked guardians via SMS/email and the Parent Portal.

---

## 8. Daily & Monthly Financial Reconciliation

- **Daily Cashier Reconciliation:** At the close of each day, filter payments by `paymentDate == TODAY` to reconcile cash on hand against recorded transactions.
- **Monthly Close:** Export full transaction logs to CSV and reconcile with the institute's bank statements.

---

## 9. Role Boundaries & Financial Controls

- **Cannot Edit Exam Marks:** The accountant is blocked from academic marks entry.
- **Cannot Alter Curriculum:** No access to SyllabusTrack.
- **Audit Logging:** Every fee payment deletion or cancellation is recorded in the permanent audit trail to prevent fraud.

---

## 10. Accountant FAQs & Audit Compliance

- **Q: Can I cancel an invoice issued in error?**
  - *Answer:* Yes, if no payments have been recorded against it. Open the invoice and click Cancel. If payments exist, refund payments must be recorded first.
- **Q: How does the system handle overpayments?**
  - *Answer:* The system validates that `amountReceived <= remainingBalance`, preventing accidental over-collection.
