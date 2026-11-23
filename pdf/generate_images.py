import os
from PIL import Image, ImageDraw, ImageFont

IMAGES_DIR = r"d:\IT\Saas\pdf\images"
os.makedirs(IMAGES_DIR, exist_ok=True)

# Fonts
font_sm = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 11)
font_md = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 13)
font_lg = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 16)
font_bold_sm = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 11)
font_bold_md = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 13)
font_bold_lg = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 16)
font_badge = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 12)

def draw_browser_frame(draw, width, height, title, url):
    # Background
    draw.rectangle([0, 0, width, height], fill="#f8fafc")
    # Top title bar
    draw.rectangle([0, 0, width, 36], fill="#e2e8f0")
    # Window buttons
    draw.ellipse([14, 13, 24, 23], fill="#ef4444")
    draw.ellipse([30, 13, 40, 23], fill="#f59e0b")
    draw.ellipse([46, 13, 56, 23], fill="#10b981")
    # URL bar
    draw.rounded_rectangle([120, 6, width - 120, 30], radius=5, fill="#ffffff", outline="#cbd5e1")
    draw.text((135, 10), url, fill="#64748b", font=font_sm)
    # Outer border
    draw.rectangle([0, 0, width - 1, height - 1], outline="#cbd5e1", width=1)

def draw_sidebar(draw, height, active_tab="Leads"):
    sidebar_w = 190
    draw.rectangle([0, 36, sidebar_w, height], fill="#0f172a")
    
    # Brand logo
    draw.rounded_rectangle([16, 50, 42, 76], radius=4, fill="#2563eb")
    draw.text((23, 53), "K", fill="#ffffff", font=font_bold_lg)
    draw.text((50, 55), "Knowletive", fill="#ffffff", font=font_bold_md)
    
    # Nav items
    nav_items = [
        "Overview",
        "Leads & Inquiries",
        "Students",
        "Attendance",
        "Fee Management",
        "SyllabusTrack",
        "Examinations",
        "Staff Directory",
        "School Settings",
    ]
    
    y = 95
    for item in nav_items:
        is_active = (active_tab.lower() in item.lower())
        if is_active:
            draw.rounded_rectangle([10, y - 2, sidebar_w - 10, y + 24], radius=4, fill="#2563eb")
            draw.text((22, y + 2), item, fill="#ffffff", font=font_bold_sm)
        else:
            draw.text((22, y + 2), item, fill="#94a3b8", font=font_sm)
        y += 32

def draw_callout_arrow(draw, start_pt, end_pt, badge_text, label_text, label_align="right"):
    """
    Draws a vivid red callout arrow pointing at end_pt with a numbered badge and tooltip box.
    """
    red_color = "#dc2626"
    arrow_color = "#ef4444"
    
    # Draw arrow pointer line
    draw.line([start_pt, end_pt], fill=arrow_color, width=3)
    
    # Arrow head pointing at end_pt
    ex, ey = end_pt
    sx, sy = start_pt
    dx = ex - sx
    dy = ey - sy
    import math
    angle = math.atan2(dy, dx)
    head_len = 10
    head_angle = math.pi / 6
    
    p1 = (ex - head_len * math.cos(angle - head_angle), ey - head_len * math.sin(angle - head_angle))
    p2 = (ex - head_len * math.cos(angle + head_angle), ey - head_len * math.sin(angle + head_angle))
    draw.polygon([end_pt, p1, p2], fill=red_color)
    
    # Draw callout box near start_pt
    bx, by = start_pt
    text_bbox = font_bold_sm.getbbox(label_text)
    tw = text_bbox[2] - text_bbox[0] + 35
    th = 24
    
    if label_align == "right":
        box_rect = [bx - tw, by - 12, bx, by + 12]
        badge_center = (bx - tw + 12, by)
        text_pos = (bx - tw + 26, by - 7)
    else:
        box_rect = [bx, by - 12, bx + tw, by + 12]
        badge_center = (bx + 12, by)
        text_pos = (bx + 26, by - 7)
        
    draw.rounded_rectangle(box_rect, radius=5, fill=red_color)
    draw.text(text_pos, label_text, fill="#ffffff", font=font_bold_sm)


# ------------------------------------------------------------------------------
# 1. ADMISSIONS MODULE IMAGE
# ------------------------------------------------------------------------------
def generate_admissions_image():
    W, H = 960, 480
    img = Image.new("RGB", (W, H), color="#ffffff")
    draw = ImageDraw.Draw(img)
    
    draw_browser_frame(draw, W, H, "Knowletive - Admissions", "https://school.knowletive.com/leads")
    draw_sidebar(draw, H, active_tab="Leads")
    
    # Header area
    draw.text((215, 55), "Leads & Prospective Inquiries", fill="#0f172a", font=font_bold_lg)
    draw.text((215, 78), "Track walk-ins, phone calls, and convert inquiries to enrolled students.", fill="#64748b", font=font_sm)
    
    # "+ New Lead" Button
    btn_rect = [W - 145, 58, W - 25, 90]
    draw.rounded_rectangle(btn_rect, radius=4, fill="#16a34a")
    draw.text((W - 132, 66), "+ New Lead", fill="#ffffff", font=font_bold_md)
    
    # Main Table Card
    card_rect = [215, 108, W - 25, H - 25]
    draw.rounded_rectangle(card_rect, radius=6, fill="#ffffff", outline="#e2e8f0", width=1)
    
    # Table Header
    draw.rectangle([216, 109, W - 26, 142], fill="#f1f5f9")
    headers = [("STUDENT NAME", 230), ("GRADE", 370), ("PARENT / CONTACT", 450), ("STATUS", 620), ("ACTION", 740)]
    for h, x in headers:
        draw.text((x, 120), h, fill="#475569", font=font_bold_sm)
        
    # Row 1 (Ready to convert)
    draw.line([216, 142, W - 26, 142], fill="#e2e8f0", width=1)
    draw.text((230, 160), "Aarav Sharma", fill="#0f172a", font=font_bold_sm)
    draw.text((230, 175), "Inquiry #LD-1042", fill="#94a3b8", font=font_sm)
    draw.text((370, 168), "Grade 9", fill="#334155", font=font_sm)
    draw.text((450, 160), "Rajesh Sharma (Father)", fill="#334155", font=font_sm)
    draw.text((450, 175), "+91 98765 43210", fill="#64748b", font=font_sm)
    
    # Status Badge
    draw.rounded_rectangle([620, 163, 715, 185], radius=10, fill="#fef3c7")
    draw.text((630, 167), "Ready to Enroll", fill="#b45309", font=font_bold_sm)
    
    # Action Button "Convert to Student"
    draw.rounded_rectangle([740, 160, 860, 188], radius=4, fill="#2563eb")
    draw.text((752, 167), "Convert Lead", fill="#ffffff", font=font_bold_sm)
    
    # Row 2
    draw.line([216, 205, W - 26, 205], fill="#f1f5f9", width=1)
    draw.text((230, 220), "Ananya Verma", fill="#0f172a", font=font_bold_sm)
    draw.text((230, 235), "Inquiry #LD-1043", fill="#94a3b8", font=font_sm)
    draw.text((370, 228), "Grade 5", fill="#334155", font=font_sm)
    draw.text((450, 220), "Sunita Verma (Mother)", fill="#334155", font=font_sm)
    draw.text((450, 235), "+91 98123 45678", fill="#64748b", font=font_sm)
    draw.rounded_rectangle([620, 223, 710, 245], radius=10, fill="#e0f2fe")
    draw.text((632, 227), "Campus Visit", fill="#0369a1", font=font_bold_sm)
    draw.rounded_rectangle([740, 220, 835, 248], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((752, 227), "Add Notes", fill="#475569", font=font_bold_sm)
    
    # Admission Modal Simulation Box
    modal_rect = [460, 275, W - 40, H - 40]
    draw.rounded_rectangle(modal_rect, radius=6, fill="#ffffff", outline="#2563eb", width=2)
    draw.rectangle([462, 277, W - 42, 305], fill="#eff6ff")
    draw.text((475, 284), "Step 3: Confirm Admission & Class Batch", fill="#1e3a8a", font=font_bold_sm)
    draw.text((475, 318), "Select Section:", fill="#475569", font=font_sm)
    draw.rounded_rectangle([565, 313, 700, 335], radius=3, fill="#ffffff", outline="#cbd5e1")
    draw.text((575, 317), "Grade 9 - Section A  v", fill="#0f172a", font=font_sm)
    draw.rounded_rectangle([720, 313, 840, 335], radius=3, fill="#16a34a")
    draw.text((735, 317), "Complete Admission", fill="#ffffff", font=font_bold_sm)
    
    # ---------------- Arrows & Callouts ----------------
    # Arrow 1: Point to + New Lead
    draw_callout_arrow(draw, (W - 250, 74), (W - 148, 74), "1", "[ 1 ] Click '+ New Lead' for walk-in parent", label_align="right")
    
    # Arrow 2: Point to Convert Lead button
    draw_callout_arrow(draw, (620, 174), (735, 174), "2", "[ 2 ] Click 'Convert Lead' once fee paid", label_align="right")
    
    # Arrow 3: Point to Complete Admission button
    draw_callout_arrow(draw, (560, 385), (720, 325), "3", "[ 3 ] Choose Section & Save", label_align="right")
    
    path = os.path.join(IMAGES_DIR, "ui_admissions.png")
    img.save(path)
    print(f"Saved: {path}")


# ------------------------------------------------------------------------------
# 2. ATTENDANCE MODULE IMAGE
# ------------------------------------------------------------------------------
def generate_attendance_image():
    W, H = 960, 480
    img = Image.new("RGB", (W, H), color="#ffffff")
    draw = ImageDraw.Draw(img)
    
    draw_browser_frame(draw, W, H, "Knowletive - Daily Attendance", "https://school.knowletive.com/attendance")
    draw_sidebar(draw, H, active_tab="Attendance")
    
    # Header area
    draw.text((215, 55), "Daily Morning Attendance", fill="#0f172a", font=font_bold_lg)
    draw.text((215, 78), "Take classroom roll call in under 30 seconds. Absentees trigger instant parent alerts.", fill="#64748b", font=font_sm)
    
    # Class Selector Bar
    bar_rect = [215, 105, W - 25, 148]
    draw.rounded_rectangle(bar_rect, radius=5, fill="#ffffff", outline="#cbd5e1", width=1)
    draw.text((230, 118), "Class & Section:", fill="#475569", font=font_bold_sm)
    draw.rounded_rectangle([325, 112, 450, 140], radius=4, fill="#ffffff", outline="#2563eb", width=1)
    draw.text((335, 119), "Grade 10 - Sec A  v", fill="#0f172a", font=font_bold_sm)
    
    draw.text((475, 118), "Date:", fill="#475569", font=font_bold_sm)
    draw.rounded_rectangle([515, 112, 630, 140], radius=4, fill="#f8fafc", outline="#cbd5e1")
    draw.text((525, 119), "Today (Nov 19)", fill="#0f172a", font=font_sm)
    
    # Submit Register Button
    draw.rounded_rectangle([W - 165, 112, W - 35, 142], radius=4, fill="#16a34a")
    draw.text((W - 152, 120), "Submit Register", fill="#ffffff", font=font_bold_sm)
    
    # Student Roster Table Card
    card_rect = [215, 160, W - 25, H - 25]
    draw.rounded_rectangle(card_rect, radius=6, fill="#ffffff", outline="#e2e8f0", width=1)
    
    draw.rectangle([216, 161, W - 26, 192], fill="#f1f5f9")
    draw.text((230, 172), "ROLL", fill="#475569", font=font_bold_sm)
    draw.text((280, 172), "STUDENT NAME", fill="#475569", font=font_bold_sm)
    draw.text((480, 172), "ATTENDANCE STATUS (CLICK TO TOGGLE)", fill="#475569", font=font_bold_sm)
    draw.text((750, 172), "MONTHLY RATE", fill="#475569", font=font_bold_sm)
    
    # Student 1: Present
    draw.line([216, 192, W - 26, 192], fill="#e2e8f0")
    draw.text((235, 208), "01", fill="#64748b", font=font_bold_sm)
    draw.text((280, 208), "Aarav Sharma", fill="#0f172a", font=font_bold_sm)
    draw.rounded_rectangle([480, 202, 550, 226], radius=4, fill="#22c55e")
    draw.text((495, 207), "Present", fill="#ffffff", font=font_bold_sm)
    draw.rounded_rectangle([560, 202, 625, 226], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((575, 207), "Absent", fill="#64748b", font=font_sm)
    draw.rounded_rectangle([635, 202, 690, 226], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((648, 207), "Late", fill="#64748b", font=font_sm)
    draw.text((760, 208), "96.4%", fill="#16a34a", font=font_bold_sm)
    
    # Student 2: Absent
    draw.line([216, 238, W - 26, 238], fill="#f1f5f9")
    draw.text((235, 254), "02", fill="#64748b", font=font_bold_sm)
    draw.text((280, 254), "Ananya Patel", fill="#0f172a", font=font_bold_sm)
    draw.rounded_rectangle([480, 248, 550, 272], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((495, 253), "Present", fill="#64748b", font=font_sm)
    draw.rounded_rectangle([560, 248, 625, 272], radius=4, fill="#ef4444")
    draw.text((573, 253), "Absent", fill="#ffffff", font=font_bold_sm)
    draw.rounded_rectangle([635, 248, 690, 272], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((648, 253), "Late", fill="#64748b", font=font_sm)
    draw.text((760, 254), "88.1%", fill="#b45309", font=font_bold_sm)
    
    # Student 3: Late
    draw.line([216, 284, W - 26, 284], fill="#f1f5f9")
    draw.text((235, 300), "03", fill="#64748b", font=font_bold_sm)
    draw.text((280, 300), "Rohan Gupta", fill="#0f172a", font=font_bold_sm)
    draw.rounded_rectangle([480, 294, 550, 318], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((495, 299), "Present", fill="#64748b", font=font_sm)
    draw.rounded_rectangle([560, 294, 625, 318], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((575, 299), "Absent", fill="#64748b", font=font_sm)
    draw.rounded_rectangle([635, 294, 690, 318], radius=4, fill="#f59e0b")
    draw.text((648, 299), "Late", fill="#ffffff", font=font_bold_sm)
    draw.text((760, 300), "92.0%", fill="#16a34a", font=font_bold_sm)
    
    # ---------------- Arrows & Callouts ----------------
    # Arrow 1: Point to Class dropdown
    draw_callout_arrow(draw, (230, 80), (325, 115), "1", "[ 1 ] Select Class & Section", label_align="right")
    
    # Arrow 2: Point to Absent button
    draw_callout_arrow(draw, (715, 260), (628, 260), "2", "[ 2 ] Tap 'Absent' for missing students", label_align="left")
    
    # Arrow 3: Point to Submit Register button
    draw_callout_arrow(draw, (W - 270, 126), (W - 168, 126), "3", "[ 3 ] Click 'Submit Register' to notify parents", label_align="right")
    
    path = os.path.join(IMAGES_DIR, "ui_attendance.png")
    img.save(path)
    print(f"Saved: {path}")


# ------------------------------------------------------------------------------
# 3. FEE MANAGEMENT MODULE IMAGE
# ------------------------------------------------------------------------------
def generate_fees_image():
    W, H = 960, 480
    img = Image.new("RGB", (W, H), color="#ffffff")
    draw = ImageDraw.Draw(img)
    
    draw_browser_frame(draw, W, H, "Knowletive - Fee Management & Collections", "https://school.knowletive.com/fees")
    draw_sidebar(draw, H, active_tab="Fee Management")
    
    # Header area
    draw.text((215, 55), "Fee Collection & Instant Receipts", fill="#0f172a", font=font_bold_lg)
    draw.text((215, 78), "Record cash/UPI/cheque payments, accept partial installments, and print receipts.", fill="#64748b", font=font_sm)
    
    # Search Bar
    draw.text((215, 105), "Search Student:", fill="#475569", font=font_bold_sm)
    draw.rounded_rectangle([310, 100, 540, 128], radius=4, fill="#ffffff", outline="#2563eb", width=1)
    draw.text((320, 107), "Aarav Sharma (Gr 10-A)", fill="#0f172a", font=font_sm)
    
    # Main split view: Invoice Card (Left) + Payment Recording Box (Right)
    # Left Card: Outstanding Bill
    card_l = [215, 140, 550, H - 25]
    draw.rounded_rectangle(card_l, radius=6, fill="#ffffff", outline="#e2e8f0", width=1)
    draw.rectangle([216, 141, 549, 170], fill="#f1f5f9")
    draw.text((228, 150), "ACTIVE INVOICE #INV-2026-0891", fill="#1e3a8a", font=font_bold_sm)
    
    draw.text((230, 185), "Tuition Fee (Q3 - Term 2):", fill="#475569", font=font_sm)
    draw.text((460, 185), "₹12,000", fill="#0f172a", font=font_bold_sm)
    draw.text((230, 208), "Science Lab & Library:", fill="#475569", font=font_sm)
    draw.text((460, 208), "₹3,000", fill="#0f172a", font=font_bold_sm)
    draw.line([230, 230, 530, 230], fill="#cbd5e1")
    draw.text((230, 240), "TOTAL DUE TODAY:", fill="#0f172a", font=font_bold_md)
    draw.text((450, 240), "₹15,000", fill="#dc2626", font=font_bold_lg)
    
    draw.rounded_rectangle([230, 275, 535, 340], radius=5, fill="#fef2f2", outline="#fca5a5")
    draw.text((240, 285), "Payment Status: PENDING / OVERDUE", fill="#991b1b", font=font_bold_sm)
    draw.text((240, 305), "Due Date: 10th November 2026", fill="#7f1d1d", font=font_sm)
    
    # Right Card: Payment Entry Box
    card_r = [565, 140, W - 25, H - 25]
    draw.rounded_rectangle(card_r, radius=6, fill="#ffffff", outline="#2563eb", width=1)
    draw.rectangle([566, 141, W - 26, 170], fill="#eff6ff")
    draw.text((580, 150), "RECORD PAYMENT TRANSACTION", fill="#1e3a8a", font=font_bold_sm)
    
    draw.text((580, 185), "Enter Amount Paid Today:", fill="#334155", font=font_bold_sm)
    draw.rounded_rectangle([580, 202, 750, 234], radius=4, fill="#ffffff", outline="#2563eb", width=2)
    draw.text((595, 210), "₹ 5,000", fill="#0f172a", font=font_bold_md)
    draw.text((760, 212), "(Partial Installment)", fill="#16a34a", font=font_bold_sm)
    
    draw.text((580, 250), "Payment Mode:", fill="#334155", font=font_bold_sm)
    draw.rounded_rectangle([580, 268, 635, 294], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((592, 274), "Cash", fill="#475569", font=font_sm)
    draw.rounded_rectangle([645, 268, 730, 294], radius=4, fill="#2563eb")
    draw.text((655, 274), "UPI / GPay", fill="#ffffff", font=font_bold_sm)
    draw.rounded_rectangle([740, 268, 810, 294], radius=4, fill="#f1f5f9", outline="#cbd5e1")
    draw.text((752, 274), "Cheque", fill="#475569", font=font_sm)
    
    # Action Button "Confirm Payment & Print Receipt"
    draw.rounded_rectangle([580, 320, W - 45, 360], radius=5, fill="#16a34a")
    draw.text((615, 332), "Confirm Payment & Print Receipt", fill="#ffffff", font=font_bold_md)
    
    # ---------------- Arrows & Callouts ----------------
    # Arrow 1: Point to Search box
    draw_callout_arrow(draw, (620, 114), (545, 114), "1", "[ 1 ] Search student by Name or ID", label_align="left")
    
    # Arrow 2: Point to Amount Paid Input
    draw_callout_arrow(draw, (830, 175), (752, 215), "2", "[ 2 ] Type amount paid (supports partial)", label_align="left")
    
    # Arrow 3: Point to Confirm & Print button
    draw_callout_arrow(draw, (440, 340), (575, 340), "3", "[ 3 ] Click to issue official tax receipt", label_align="right")
    
    path = os.path.join(IMAGES_DIR, "ui_fees.png")
    img.save(path)
    print(f"Saved: {path}")


# ------------------------------------------------------------------------------
# 4. EXAMS & REPORT CARDS MODULE IMAGE
# ------------------------------------------------------------------------------
def generate_exams_image():
    W, H = 960, 480
    img = Image.new("RGB", (W, H), color="#ffffff")
    draw = ImageDraw.Draw(img)
    
    draw_browser_frame(draw, W, H, "Knowletive - Examinations & Grading", "https://school.knowletive.com/exams")
    draw_sidebar(draw, H, active_tab="Examinations")
    
    # Header area
    draw.text((215, 55), "Mid-Term Examination 2026 — Grade 10 Science", fill="#0f172a", font=font_bold_lg)
    draw.text((215, 78), "Teacher enters subject scores. Principal locks grades and publishes 1-click report cards.", fill="#64748b", font=font_sm)
    
    # Action Buttons Top Bar
    draw.rounded_rectangle([W - 310, 58, W - 170, 90], radius=4, fill="#2563eb")
    draw.text((W - 295, 66), "Save Draft", fill="#ffffff", font=font_bold_sm)
    
    draw.rounded_rectangle([W - 160, 58, W - 25, 90], radius=4, fill="#16a34a")
    draw.text((W - 150, 66), "Lock & Publish", fill="#ffffff", font=font_bold_sm)
    
    # Main Table Card
    card_rect = [215, 108, W - 25, H - 25]
    draw.rounded_rectangle(card_rect, radius=6, fill="#ffffff", outline="#e2e8f0", width=1)
    
    draw.rectangle([216, 109, W - 26, 142], fill="#f1f5f9")
    draw.text((230, 120), "ROLL", fill="#475569", font=font_bold_sm)
    draw.text((280, 120), "STUDENT NAME", fill="#475569", font=font_bold_sm)
    draw.text((450, 120), "MARKS OBTAINED (MAX: 100)", fill="#475569", font=font_bold_sm)
    draw.text((680, 120), "GRADE", fill="#475569", font=font_bold_sm)
    draw.text((780, 120), "EVALUATION STATUS", fill="#475569", font=font_bold_sm)
    
    # Row 1
    draw.line([216, 142, W - 26, 142], fill="#e2e8f0")
    draw.text((235, 160), "01", fill="#64748b", font=font_bold_sm)
    draw.text((280, 160), "Aarav Sharma", fill="#0f172a", font=font_bold_sm)
    draw.rounded_rectangle([450, 152, 530, 180], radius=4, fill="#ffffff", outline="#2563eb", width=1)
    draw.text((475, 158), "88", fill="#0f172a", font=font_bold_md)
    draw.text((545, 160), "/ 100", fill="#94a3b8", font=font_sm)
    draw.text((690, 160), "A", fill="#16a34a", font=font_bold_md)
    draw.rounded_rectangle([780, 155, 875, 178], radius=10, fill="#dcfce7")
    draw.text((795, 160), "Evaluated", fill="#15803d", font=font_bold_sm)
    
    # Row 2
    draw.line([216, 192, W - 26, 192], fill="#f1f5f9")
    draw.text((235, 210), "02", fill="#64748b", font=font_bold_sm)
    draw.text((280, 210), "Ananya Patel", fill="#0f172a", font=font_bold_sm)
    draw.rounded_rectangle([450, 202, 530, 230], radius=4, fill="#ffffff", outline="#2563eb", width=1)
    draw.text((475, 208), "94", fill="#0f172a", font=font_bold_md)
    draw.text((545, 210), "/ 100", fill="#94a3b8", font=font_sm)
    draw.text((690, 210), "A+", fill="#16a34a", font=font_bold_md)
    draw.rounded_rectangle([780, 205, 875, 228], radius=10, fill="#dcfce7")
    draw.text((795, 210), "Evaluated", fill="#15803d", font=font_bold_sm)
    
    # Row 3 (Input in progress)
    draw.line([216, 242, W - 26, 242], fill="#f1f5f9")
    draw.text((235, 260), "03", fill="#64748b", font=font_bold_sm)
    draw.text((280, 260), "Rohan Gupta", fill="#0f172a", font=font_bold_sm)
    draw.rounded_rectangle([450, 252, 530, 280], radius=4, fill="#ffffff", outline="#cbd5e1", width=1)
    draw.text((475, 258), "76", fill="#0f172a", font=font_bold_md)
    draw.text((545, 260), "/ 100", fill="#94a3b8", font=font_sm)
    draw.text((690, 260), "B+", fill="#2563eb", font=font_bold_md)
    draw.rounded_rectangle([780, 255, 875, 278], radius=10, fill="#fef3c7")
    draw.text((795, 260), "Draft Entry", fill="#b45309", font=font_bold_sm)
    
    # Digital Report Card Simulation Preview Box
    report_box = [230, 310, W - 40, H - 40]
    draw.rounded_rectangle(report_box, radius=6, fill="#f8fafc", outline="#16a34a", width=1)
    draw.rectangle([232, 312, W - 42, 338], fill="#dcfce7")
    draw.text((245, 318), "1-CLICK DIGITAL REPORT CARDS: Automated rank, percentage & remarks published directly to parents.", fill="#14532d", font=font_bold_sm)
    
    # ---------------- Arrows & Callouts ----------------
    # Arrow 1: Point to Marks Input box
    draw_callout_arrow(draw, (320, 166), (445, 166), "1", "[ 1 ] Teacher inputs score", label_align="right")
    
    # Arrow 2: Point to Save Draft button
    draw_callout_arrow(draw, (W - 380, 74), (W - 315, 74), "2", "[ 2 ] Save draft while grading", label_align="right")
    
    # Arrow 3: Point to Lock & Publish button
    draw_callout_arrow(draw, (W - 100, 135), (W - 95, 93), "3", "[ 3 ] Principal locks & publishes report cards", label_align="left")
    
    path = os.path.join(IMAGES_DIR, "ui_exams.png")
    img.save(path)
    print(f"Saved: {path}")

if __name__ == "__main__":
    generate_admissions_image()
    generate_attendance_image()
    generate_fees_image()
    generate_exams_image()
    print("ALL UI WALKTHROUGH IMAGES GENERATED SUCCESSFULLY!")
