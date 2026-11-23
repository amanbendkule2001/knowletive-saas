import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
    HRFlowable,
    Image as RLImage,
)
from reportlab.pdfgen import canvas

PDF_DIR = r"d:\IT\Saas\pdf"
IMAGES_DIR = os.path.join(PDF_DIR, "images")
OUTPUT_PATH = os.path.join(PDF_DIR, "Knowletive_Institute_Admin_Complete_Guide.pdf")

os.makedirs(PDF_DIR, exist_ok=True)

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_decorations(self, total_pages):
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#1e3a8a"))

        # Header (pages after page 1)
        if self._pageNumber > 1:
            self.drawString(40, 805, "KNOWLETIVE SMART INSTITUTE MANAGEMENT — VISUAL CLIENT MANUAL")
            self.setFont("Helvetica", 7.5)
            self.setFillColor(colors.HexColor("#64748b"))
            self.drawRightString(555, 805, "INTERACTIVE STEP-BY-STEP USER GUIDE")
            self.setStrokeColor(colors.HexColor("#cbd5e1"))
            self.setLineWidth(0.6)
            self.line(40, 798, 555, 798)

        # Footer (all pages)
        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.6)
        self.line(40, 42, 555, 42)

        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))
        self.drawString(40, 30, "Knowletive Cloud Platform — Client Onboarding & Interactive Staff Workflow Guide")
        page_str = f"Page {self._pageNumber} of {total_pages}"
        self.drawRightString(555, 30, page_str)
        self.restoreState()


def build_pdf():
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        leftMargin=40,
        rightMargin=40,
        topMargin=50,
        bottomMargin=50,
    )

    styles = getSampleStyleSheet()

    # Premium Color Palette
    primary = "#1e3a8a"       # Deep Navy
    secondary = "#2563eb"     # Royal Blue
    dark = "#0f172a"          # Slate 900
    gray = "#475569"          # Slate 600
    card_bg = "#f8fafc"       # Soft Slate
    border_color = "#e2e8f0"  # Light Border
    accent_green = "#15803d"  # Forest Green
    callout_red = "#dc2626"   # Callout Red

    title_style = ParagraphStyle(
        "CoverTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor(primary),
        spaceAfter=4,
    )

    subtitle_style = ParagraphStyle(
        "CoverSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=14,
        textColor=colors.HexColor(secondary),
        spaceAfter=8,
    )

    h1_style = ParagraphStyle(
        "Heading1_Custom",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        textColor=colors.HexColor(primary),
        spaceBefore=4,
        spaceAfter=4,
        keepWithNext=True,
    )

    h2_style = ParagraphStyle(
        "Heading2_Custom",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13.5,
        textColor=colors.HexColor(secondary),
        spaceBefore=4,
        spaceAfter=2,
        keepWithNext=True,
    )

    h3_style = ParagraphStyle(
        "Heading3_Custom",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor(dark),
        spaceBefore=3,
        spaceAfter=1.5,
        keepWithNext=True,
    )

    body_style = ParagraphStyle(
        "Body_Custom",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11.5,
        textColor=colors.HexColor(dark),
        spaceAfter=2,
    )

    bullet_style = ParagraphStyle(
        "Bullet_Custom",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.8,
        leading=11,
        textColor=colors.HexColor(dark),
        leftIndent=10,
        firstLineIndent=-7,
        spaceAfter=2,
    )

    callout_style = ParagraphStyle(
        "Callout_Text",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.8,
        leading=11,
        textColor=colors.HexColor("#1e3a8a"),
    )

    legend_num_style = ParagraphStyle(
        "LegendNum",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=12,
        textColor=colors.HexColor(callout_red),
    )

    legend_text_style = ParagraphStyle(
        "LegendText",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11.5,
        textColor=colors.HexColor(dark),
    )

    faq_q_style = ParagraphStyle(
        "FAQQ",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor(primary),
        spaceBefore=2,
        spaceAfter=1,
        keepWithNext=True,
    )

    faq_a_style = ParagraphStyle(
        "FAQA",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.6,
        leading=10.5,
        textColor=colors.HexColor(dark),
        spaceAfter=2,
    )

    table_header_style = ParagraphStyle(
        "TableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=colors.white,
    )

    table_cell_style = ParagraphStyle(
        "TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.2,
        leading=9.5,
        textColor=colors.HexColor(dark),
    )

    table_bold_style = ParagraphStyle(
        "TableBold",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor(primary),
    )

    story = []

    # =============================================================
    # PAGE 1: WELCOME & 5-STEP QUICK START ROADMAP
    # =============================================================
    story.append(Paragraph("Knowletive Smart School Management", title_style))
    story.append(Paragraph("Visual Client Manual: Step-by-Step Interactive Guides, UI Callouts & Practical FAQ", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.8, color=colors.HexColor(primary), spaceAfter=8))

    # Welcome Card
    welcome_data = [[
        Paragraph(
            "<b>Welcome to Knowletive:</b> This interactive manual is designed for school owners, directors, principals, "
            "teachers, and office staff subscribing to our platform. It includes <b>annotated UI screenshots with directional "
            "click arrows</b>, exact step-by-step module workflows, real-life school situations, and a comprehensive non-technical FAQ.",
            callout_style
        )
    ]]
    t_welcome = Table(welcome_data, colWidths=[515])
    t_welcome.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
        ("BORDER", (0, 0), (-1, -1), 1, colors.HexColor("#86efac")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t_welcome)
    story.append(Spacer(1, 6))

    story.append(Paragraph("Getting Started: The 5-Step Setup Roadmap", h1_style))
    story.append(Paragraph(
        "Setting up your institute in Knowletive takes less than an hour. Follow these 5 chronological steps to launch:",
        body_style
    ))

    setup_steps = [
        ("Step 1: Institute Profile & Academic Year", "Open <b>Settings</b> in the left sidebar menu. Enter your official School Name, Address, Affiliation, and upload your School Logo. Select your active Academic Session (e.g. 2026–2027) so all fee invoices and student records tie correctly to the current school year."),
        ("Step 2: Class & Subject Architecture", "Click <b>Academics</b> in the menu. Add your classes (e.g. Nursery, Grade 1 to Grade 12) and sections (A, B, C). Define the subjects taught for each class. In <b>Batches</b>, link each classroom section with its primary Class Teacher."),
        ("Step 3: Staff & Teacher Onboarding", "Open <b>Staff Management</b>. Click <i>'Invite Staff Member'</i> and enter the teacher or employee's email. Assign their exact role (Teacher, Accountant, Principal, or Front Desk). Staff receive an automated welcome email with login instructions."),
        ("Step 4: Student Admissions & Parent Linking", "Go to <b>Students</b>. You can register students individually or import them in bulk from an Excel/CSV sheet. Make sure to attach the parent's mobile phone number and email address so parents receive automated notices, fee receipts, and report cards."),
        ("Step 5: Go Live with Daily Operations", "Your school is now ready! Teachers take roll-call attendance in under 30 seconds from their phones, the front desk tracks prospective inquiries, accountants generate fee receipts, and principals oversee academic progress in real time."),
    ]

    for title, desc in setup_steps:
        box_data = [[
            Paragraph(f"<b>{title}</b><br/>{desc}", body_style)
        ]]
        box_table = Table(box_data, colWidths=[515])
        box_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(card_bg)),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_color)),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(box_table)
        story.append(Spacer(1, 3))

    # =============================================================
    # PAGE 2: STAFF ROLES & OPERATIONAL RESPONSIBILITIES
    # =============================================================
    story.append(PageBreak())
    story.append(Paragraph("Staff Roles & Operational Permissions", h1_style))
    story.append(Paragraph(
        "Knowletive keeps school data organized and secure by showing each employee only the features they need for their job. "
        "Here is what each role does inside the platform:",
        body_style
    ))

    matrix_data = [
        [
            Paragraph("Staff Role", table_header_style),
            Paragraph("What They Use Daily", table_header_style),
            Paragraph("What They Can Do", table_header_style),
            Paragraph("Security & Privacy Boundary", table_header_style),
        ],
        [
            Paragraph("Institute Admin<br/><i>(Owner / Director)</i>", table_bold_style),
            Paragraph("Settings<br/>Staff Management<br/>System Roles", table_cell_style),
            Paragraph("Full control over school settings, user accounts, fee rules, classes, and administrative audit logs.", table_cell_style),
            Paragraph("Complete visibility across all school departments and branches.", table_cell_style),
        ],
        [
            Paragraph("Principal<br/><i>(Academic Head)</i>", table_bold_style),
            Paragraph("Class Batches<br/>Syllabus Tracker<br/>Examinations", table_cell_style),
            Paragraph("Approves syllabus schedules, reviews classroom attendance, verifies marks, and publishes final report cards.", table_cell_style),
            Paragraph("Focuses on academic quality; cannot edit fee records or change system roles.", table_cell_style),
        ],
        [
            Paragraph("Teacher<br/><i>(Subject Faculty)</i>", table_bold_style),
            Paragraph("Attendance Register<br/>Syllabus Progress<br/>Exam Marks Entry", table_cell_style),
            Paragraph("Marks daily morning attendance, logs completed chapters, inputs student test marks, and uses AI for lesson plans.", table_cell_style),
            Paragraph("Strictly confidential: cannot see fee balances, payments, or other staff details.", table_cell_style),
        ],
        [
            Paragraph("Accountant<br/><i>(Fee Clerk)</i>", table_bold_style),
            Paragraph("Fee Management<br/>Invoice Register<br/>Collection Reports", table_cell_style),
            Paragraph("Creates fee bills, records cash/UPI/cheque collections, issues official receipts, and tracks pending dues.", table_cell_style),
            Paragraph("Handles financial ledger only; cannot modify syllabus or change student grades.", table_cell_style),
        ],
        [
            Paragraph("Front Desk<br/><i>(Receptionist)</i>", table_bold_style),
            Paragraph("Inquiry CRM<br/>Student Directory<br/>School Notices", table_cell_style),
            Paragraph("Logs phone calls and walk-ins, books campus tours, converts registered inquiries to students, and sends circulars.", table_cell_style),
            Paragraph("Admissions and front-office only; cannot modify fees, marks, or staff rosters.", table_cell_style),
        ],
        [
            Paragraph("Parent & Student<br/><i>(Parent Portal)</i>", table_bold_style),
            Paragraph("Mobile Portal<br/>Digital Notices", table_cell_style),
            Paragraph("View-only access to their own child's attendance percentage, paid fee receipts, dues, and report cards.", table_cell_style),
            Paragraph("Strict privacy: parents can only see information belonging to their own children.", table_cell_style),
        ],
    ]

    t_matrix = Table(matrix_data, colWidths=[85, 90, 195, 145], repeatRows=1)
    t_matrix.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(primary)),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#f8fafc"), colors.white]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t_matrix)
    story.append(Spacer(1, 8))

    story.append(Paragraph("Why School Owners Love This Structure:", h2_style))
    story.append(Paragraph("• <b>Zero Leaks & Complete Privacy:</b> Teachers cannot see who has paid or who owes fees. Students are never embarrassed in front of their peers.", bullet_style))
    story.append(Paragraph("• <b>Zero Mark Tampering:</b> Once the Principal locks exam results, grades cannot be changed without an official audited re-evaluation request.", bullet_style))
    story.append(Paragraph("• <b>Easy Delegation:</b> School owners don't need to do everything. Front desk handles admissions, accountants handle money, and teachers handle academics.", bullet_style))

    # =============================================================
    # PAGE 3: MODULE 1 VISUAL GUIDE — ADMISSIONS & LEADS
    # =============================================================
    story.append(PageBreak())
    story.append(Paragraph("Module 1 Visual Guide: Admissions & Lead Conversion", h1_style))
    story.append(Paragraph(
        "Follow the numbered callout arrows below to see exactly where to click when logging inquiries and admitting students:",
        body_style
    ))
    story.append(Spacer(1, 2))

    # Admissions Image
    img_admissions = os.path.join(IMAGES_DIR, "ui_admissions.png")
    if os.path.exists(img_admissions):
        story.append(RLImage(img_admissions, width=490, height=240))
        story.append(Spacer(1, 6))

    # Step Legend Table
    legend_admissions = [
        [
            Paragraph("➊", legend_num_style),
            Paragraph("<b>Click '+ New Lead' (Top Right):</b> When a parent visits or calls, click this button to open the inquiry form. Enter student name, prospective grade, parent contact details, and source (Walk-in, Referral, Banner).", legend_text_style),
        ],
        [
            Paragraph("➋", legend_num_style),
            Paragraph("<b>Click 'Convert Lead' (Table Row):</b> When the parent confirms admission and pays the registration fee, click Convert Lead. The system instantly creates official Student and Parent records without manual re-typing.", legend_text_style),
        ],
        [
            Paragraph("➌", legend_num_style),
            Paragraph("<b>Choose Classroom Section & Save:</b> Select the student's assigned classroom section (e.g. Grade 9 - Section A). Click <b>'Complete Admission'</b>. The student is immediately placed onto the Class Teacher's daily roll call.", legend_text_style),
        ],
    ]
    t_leg_adm = Table(legend_admissions, colWidths=[20, 495])
    t_leg_adm.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t_leg_adm)
    story.append(Spacer(1, 4))

    callout_adm = [[
        Paragraph("<b>Pro-Tip for Front Desk:</b> You can add follow-up interaction notes after every phone call (e.g. <i>'Parent requested fee structure; campus visit on Saturday'</i>) to ensure no lead is ever forgotten.", callout_style)
    ]]
    t_c_adm = Table(callout_adm, colWidths=[515])
    t_c_adm.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(card_bg)),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_color)),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c_adm)

    # =============================================================
    # PAGE 4: MODULE 2 VISUAL GUIDE — DAILY ATTENDANCE
    # =============================================================
    story.append(PageBreak())
    story.append(Paragraph("Module 2 Visual Guide: Daily Classroom Attendance", h1_style))
    story.append(Paragraph(
        "Teachers take roll call in under 30 seconds directly from their mobile phone, tablet, or classroom PC:",
        body_style
    ))
    story.append(Spacer(1, 2))

    # Attendance Image
    img_attendance = os.path.join(IMAGES_DIR, "ui_attendance.png")
    if os.path.exists(img_attendance):
        story.append(RLImage(img_attendance, width=490, height=240))
        story.append(Spacer(1, 6))

    # Step Legend Table
    legend_attendance = [
        [
            Paragraph("➊", legend_num_style),
            Paragraph("<b>Select Class & Section:</b> In the top selector bar, pick your assigned class section (e.g. Grade 10 - Sec A). The date automatically defaults to today.", legend_text_style),
        ],
        [
            Paragraph("➋", legend_num_style),
            Paragraph("<b>Tap 'Absent' for Missing Students:</b> By default, all students are marked <b>Present (Green)</b>. Simply tap on any missing student to toggle them to <b>Absent (Red)</b> or <b>Late (Yellow)</b>.", legend_text_style),
        ],
        [
            Paragraph("➌", legend_num_style),
            Paragraph("<b>Click 'Submit Register' (Top Right):</b> Click Submit Register. The roll call is saved permanently, and Knowletive automatically sends instant SMS/WhatsApp alerts to the parents of absent students.", legend_text_style),
        ],
    ]
    t_leg_att = Table(legend_attendance, colWidths=[20, 495])
    t_leg_att.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t_leg_att)
    story.append(Spacer(1, 4))

    callout_att = [[
        Paragraph("<b>Same-Day Late Arrival:</b> If a student arrives at 9:30 AM after roll call, the teacher can re-open the register, tap <b>'Late'</b>, and click <b>'Update Register'</b>. The parent's absence alert is updated automatically.", callout_style)
    ]]
    t_c_att = Table(callout_att, colWidths=[515])
    t_c_att.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(card_bg)),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_color)),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c_att)

    # =============================================================
    # PAGE 5: MODULE 3 VISUAL GUIDE — FEES & RECEIPTS
    # =============================================================
    story.append(PageBreak())
    story.append(Paragraph("Module 3 Visual Guide: Fee Collection & Instant Receipts", h1_style))
    story.append(Paragraph(
        "Clear, itemized billing with zero accounting confusion. Follow the arrows to record payments and print receipts:",
        body_style
    ))
    story.append(Spacer(1, 2))

    # Fees Image
    img_fees = os.path.join(IMAGES_DIR, "ui_fees.png")
    if os.path.exists(img_fees):
        story.append(RLImage(img_fees, width=490, height=240))
        story.append(Spacer(1, 6))

    # Step Legend Table
    legend_fees = [
        [
            Paragraph("➊", legend_num_style),
            Paragraph("<b>Search Student by Name or Roll No:</b> Type the student's name in the top search bar. The system pulls up their active invoice, bill breakdown, and previous payment history.", legend_text_style),
        ],
        [
            Paragraph("➋", legend_num_style),
            Paragraph("<b>Enter Amount Paid (Supports Partial Installments):</b> Type the amount collected today. If the total bill is ₹15,000 and the parent pays ₹5,000, simply type ₹5,000. Choose payment mode (Cash, UPI, Cheque).", legend_text_style),
        ],
        [
            Paragraph("➌", legend_num_style),
            Paragraph("<b>Click 'Confirm Payment & Print Receipt':</b> Generates an official branded school receipt showing: <b>Total Bill: ₹15,000 | Paid Today: ₹5,000 | Balance Due: ₹10,000</b>. The remaining balance rolls forward automatically.", legend_text_style),
        ],
    ]
    t_leg_fee = Table(legend_fees, colWidths=[20, 495])
    t_leg_fee.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t_leg_fee)
    story.append(Spacer(1, 4))

    callout_fee = [[
        Paragraph("<b>1-Click Overdue Reminders:</b> Filter by 'Overdue' on the 10th of the month and click <b>'Broadcast Reminder'</b>. All unpaid parents receive a polite SMS/WhatsApp with their balance and payment link.", callout_style)
    ]]
    t_c_fee = Table(callout_fee, colWidths=[515])
    t_c_fee.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(card_bg)),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_color)),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c_fee)

    # =============================================================
    # PAGE 6: MODULE 4 VISUAL GUIDE — EXAMS & REPORT CARDS
    # =============================================================
    story.append(PageBreak())
    story.append(Paragraph("Module 4 Visual Guide: Exam Mark Entry & Digital Report Cards", h1_style))
    story.append(Paragraph(
        "Streamlined grading with zero tampering. Teachers submit scores; Principals lock and publish 1-click report cards:",
        body_style
    ))
    story.append(Spacer(1, 2))

    # Exams Image
    img_exams = os.path.join(IMAGES_DIR, "ui_exams.png")
    if os.path.exists(img_exams):
        story.append(RLImage(img_exams, width=490, height=240))
        story.append(Spacer(1, 6))

    # Step Legend Table
    legend_exams = [
        [
            Paragraph("➊", legend_num_style),
            Paragraph("<b>Teacher Enters Subject Scores:</b> The subject teacher selects their class and inputs marks obtained. The system automatically verifies that entered scores do not exceed maximum threshold marks.", legend_text_style),
        ],
        [
            Paragraph("➋", legend_num_style),
            Paragraph("<b>Save Draft While Grading:</b> Teachers can save progress as drafts and return later. Once all papers are evaluated, click <b>'Submit for Verification'</b> to hand off scores to the Principal.", legend_text_style),
        ],
        [
            Paragraph("➌", legend_num_style),
            Paragraph("<b>Principal Locks & Publishes Report Cards:</b> The Principal reviews overall distributions, clicks <b>'Lock Marks'</b> (freezing scores against tampering), and clicks <b>'Publish Results'</b> to release digital report cards.", legend_text_style),
        ],
    ]
    t_leg_ex = Table(legend_exams, colWidths=[20, 495])
    t_leg_ex.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t_leg_ex)
    story.append(Spacer(1, 4))

    callout_ex = [[
        Paragraph("<b>AI Educational Assistant (AI Studio):</b> Teachers can open <b>AI Studio</b> to automatically draft chapter worksheets, generate test questions, and write personalized report card remarks in seconds.", callout_style)
    ]]
    t_c_ex = Table(callout_ex, colWidths=[515])
    t_c_ex.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(card_bg)),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_color)),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c_ex)

    # =============================================================
    # PAGE 7: REAL-LIFE SCHOOL SCENARIOS & SOLUTIONS
    # =============================================================
    story.append(PageBreak())
    story.append(Paragraph("Real-Life School Situations: Everyday Practical Solutions", h1_style))
    story.append(Paragraph(
        "Here is how Knowletive effortlessly handles everyday challenges that happen in every school:",
        body_style
    ))

    scenarios = [
        ("Scenario 1: A Student Joins in the Middle of the Year (Late Admission)",
         "Register the student in <b>Students</b> with their mid-session joining date and allocate them to their class. The Accountant creates a prorated fee invoice covering only the remaining months. The student automatically starts appearing on the teacher's roll-call register from that day onward."),
        ("Scenario 2: Moving a Student from Section A to Section B",
         "The Principal opens <b>Class Batches</b>, selects the student, and clicks <i>'Transfer Batch'</i> to Section B. <b>Key Benefit:</b> Past attendance and test marks from Section A remain 100% preserved; future attendance registers reflect Section B automatically."),
        ("Scenario 3: Teacher Resigns or Takes Extended Leave Mid-Session",
         "Invite the new teacher under <b>Staff Management</b>. Deactivate the departing teacher's login. Reassign the classroom subject batch to the new teacher. Past marks and attendance logs recorded by the previous teacher remain permanently intact for inspection."),
        ("Scenario 4: Exam Mark Correction After Report Cards Are Already Published",
         "If a re-totaling request reveals that a student missed 5 marks, regular teachers cannot alter locked marks. The Principal goes to <b>Examinations</b>, clicks <i>'Request Mark Revision'</i>, inputs the corrected score, and enters a mandatory reason. The report card updates immediately with an immutable audit log."),
        ("Scenario 5: Emergency Weather Holiday Notice (Heavy Rain or Extreme Heat)",
         "Open <b>Notices & Circulars</b>. Click <i>'New Announcement'</i>. Title: <i>'Emergency School Closure - Heavy Rain'</i>. Select Audience: <i>'All Staff, Parents & Students'</i>. Check <i>'Urgent Alert'</i>. Click Publish. The alert is sent immediately via WhatsApp, SMS, and portal push notifications."),
        ("Scenario 6: Parent Pays by Cheque and the Cheque Bounces",
         "Open <b>Fee Management</b>. Locate the receipt in Payment History. Click <i>'Mark Cheque Bounced'</i>. The system instantly reinstates the unpaid fee balance on the student's bill and adds a bounce notification without messing up accounting books."),
        ("Scenario 7: Student Transfer Certificate (TC) & School Leaving",
         "Verify zero fee dues in <b>Fee Management</b>. Download the student's complete academic transcript in <b>Examinations</b>. In <b>Students</b>, set status to <i>'Archived / Transferred'</i>. Portal access is closed, but records stay safely stored in your permanent archive."),
    ]

    for title, desc in scenarios:
        box_data = [[
            Paragraph(f"<b>{title}</b><br/>{desc}", body_style)
        ]]
        box_table = Table(box_data, colWidths=[515])
        box_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(card_bg)),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_color)),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(box_table)
        story.append(Spacer(1, 2.5))

    # =============================================================
    # PAGE 8: NON-TECHNICAL FAQ & CLIENT ONBOARDING SIGN-OFF
    # =============================================================
    story.append(PageBreak())
    story.append(Paragraph("Frequently Asked Questions (Non-Technical FAQ)", h1_style))
    story.append(Paragraph(
        "Clear, everyday answers to questions school administrators, teachers, accountants, and parents ask:",
        body_style
    ))

    faqs = [
        ("Q1: What should a staff member do if they forget their password?",
         "Click <i>'Forgot Password'</i> on the login screen to receive an instant reset email. Alternatively, the School Admin can open <b>Staff Management</b>, click on the employee's name, and click <i>'Send Password Reset Link'</i>."),
        ("Q2: Can teachers see how much fee a student has paid or owes?",
         "No, never. Knowletive strictly separates academic and financial records. Teachers only see classroom registers, lessons, and test scores. Only the Accountant and School Owner can view fee invoices and receipts."),
        ("Q3: Can our teachers use Knowletive on their mobile phones in the classroom?",
         "Yes! Knowletive runs seamlessly on any smartphone, iPad, tablet, or laptop browser (Chrome, Safari, Edge). Teachers can mark morning roll call in 30 seconds directly from their mobile phones."),
        ("Q4: Can parents pay fees in multiple partial installments?",
         "Yes. When collecting fees, the Accountant can type any partial amount paid (e.g. ₹4,000 towards an ₹12,000 fee). The generated receipt displays: Total Due, Paid Today, and Remaining Balance. The remaining balance carries over automatically."),
        ("Q5: What happens at the end of the school year? Do we have to re-enter all students?",
         "Not at all! When the academic year ends, simply start a <b>'New Academic Session'</b> (e.g. 2027–2028). Knowletive offers 1-click bulk promotion (promoting Grade 4-A students to Grade 5-A) while safely archiving all past year test scores and receipts."),
        ("Q6: How do parents get their login to see attendance and report cards?",
         "When a student is registered with the parent's phone number and email, an automated invitation is dispatched. Parents log in to view daily roll call records, fee payment receipts, school circulars, and published report cards."),
    ]

    for q, a in faqs:
        box_data = [[
            Paragraph(f"<b>{q}</b>", faq_q_style),
        ], [
            Paragraph(a, faq_a_style),
        ]]
        box_table = Table(box_data, colWidths=[515])
        box_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(card_bg)),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(border_color)),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(box_table)
        story.append(Spacer(1, 2))

    story.append(Spacer(1, 4))

    # Implementation sign-off box
    signoff_data = [
        [
            Paragraph("<b>Institute Adoption & Client Sign-Off:</b>", table_bold_style),
            Paragraph("<b>Subscription Plan / Trial:</b> ____________________", table_cell_style),
        ],
        [
            Paragraph("School Director / Administrator Name: ___________________________", table_cell_style),
            Paragraph("Principal / Head of Academics: ___________________________", table_cell_style),
        ],
        [
            Paragraph("Signature & School Seal: ___________________________", table_cell_style),
            Paragraph("Date of Onboarding: ___________________________", table_cell_style),
        ]
    ]
    t_signoff = Table(signoff_data, colWidths=[260, 255])
    t_signoff.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#94a3b8")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t_signoff)

    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#cbd5e1"), spaceAfter=4))
    story.append(Paragraph(
        "<i>Knowletive SaaS — Cloud School Management System | Confidential Client Manual</i>",
        ParagraphStyle("Footnote", parent=styles["Normal"], fontName="Helvetica-Oblique", fontSize=7.5, textColor=colors.HexColor("#64748b"), alignment=1)
    ))

    # Build document
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"SUCCESS: Document created at {OUTPUT_PATH}")

if __name__ == "__main__":
    build_pdf()
