import "server-only";

import { db } from "@/lib/db";
import { AI_FEATURE_MAP } from "@/lib/catalog";
import { startOfMonth } from "@/lib/format";

export type AiRunInput = {
  tenantId: string;
  userId: string;
  featureKey: string;
  prompt: string;
  creditLimit: number;
  instituteName: string;
  instituteType: string;
};

type Generation = {
  text: string;
  provider: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
};

const SYSTEM_BASE =
  "You are an experienced school administrator and curriculum expert in India. Be accurate, concise and practical. Never invent student data that is not in the brief. Use plain text with short headings and bullet points.";

const SYSTEM_BY_FEATURE: Record<string, string> = {
  report_card_remarks:
    "Write a balanced report card remark of 90-140 words: strengths, one growth area, and a concrete suggestion for parents. Warm, professional, no labels.",
  lesson_plan:
    "Produce a 45-minute lesson plan with learning outcomes, prior knowledge, hook, guided practice, independent task, differentiation and a 3-question exit ticket. Include one low-cost classroom activity.",
  question_paper:
    "Create a question paper with sections A-E, clear marks per question, instructions, and a short answer key. Match the requested blueprint and total marks.",
  fee_reminder:
    "Draft a polite but clear fee reminder of 100-150 words with amount, due date, payment options and an offer to discuss a payment plan. Keep dignity and relationship intact.",
  admission_reply:
    "Draft an admission enquiry reply with a warm opening, the requested details (fees, transport, documents, timeline) as bullets, and one clear next step with a call to action. Note any information the school must confirm.",
  attendance_insight:
    "Analyse the attendance brief. List 3 likely causes, 3 prioritized interventions with owners and timelines, and one parent-communication template. Flag anything that needs a counsellor.",
};

function mockGeneration(featureKey: string, prompt: string, instituteName: string): Generation {
  const topic = prompt.trim().replace(/\s+/g, " ");
  const excerpt = topic.length > 220 ? `${topic.slice(0, 220)}…` : topic;

  const outputs: Record<string, string> = {
    report_card_remarks: `Report card remark — ${instituteName}

Overall, this has been a steady and encouraging term. The student shows genuine curiosity in class discussions and is beginning to apply feedback independently. Performance in Science is a clear strength, while Mathematics is improving with consistent practice.

Growth area: written accuracy and classroom participation. Encourage a short 15-minute daily revision routine and one question asked in class each day.

Suggested note to parents:
"Your child is making steady progress and responds well to encouragement. We would value your support in maintaining a regular study routine at home. Please feel free to meet the class teacher to plan the next steps together."

(Based on: ${excerpt})`,
    lesson_plan: `Lesson plan — ${instituteName}

Topic: ${excerpt.slice(0, 90)}
Duration: 45 minutes

Learning outcomes
• Explain the core concept in their own words.
• Apply it to one familiar, real-life example.
• Identify and correct a common misconception.

Prior knowledge check (5 min): two quick questions; record misconceptions on the board.

Hook (5 min): a local, low-cost demonstration or a 30-second story that creates a question in students' minds.

Guided practice (15 min): model the concept, then solve one example together. Ask two students to explain the reasoning aloud.

Independent task (12 min): three graduated questions — recall, application, challenge. Circulate and support the middle band.

Differentiation: scaffolded sentence starters for students who need support; an extension question comparing two approaches for advanced learners.

Exit ticket (5 min): three questions, collected at the door. Sort into "secure / practice / reteach" for tomorrow.

Low-cost activity: use paper strips or a bottle cap to model the process kinesthetically.`,
    question_paper: `Question paper — ${instituteName}

Based on: ${excerpt.slice(0, 120)}

General instructions
1. All questions are compulsory.
2. Marks are indicated against each question.
3. Draw neat diagrams wherever necessary.

Section A — Objective (1 mark each)
1. Define the key term introduced in the chapter.
2. State whether the statement is true or false, with a reason.
3. Choose the correct option and justify it in one line.

Section B — Short answer (2 marks each)
4. Explain the process with one example.
5. Differentiate between the two related concepts.

Section C — Application (3 marks each)
6. Apply the concept to the given situation and show your reasoning.
7. Interpret the result and state one limitation.

Section D — Long answer (5 marks)
8. Derive/explain the concept in detail with a labelled diagram and two examples.

Section E — Challenge (4 marks)
9. Solve the unseen problem. Show all steps.

Answer key (summary)
1. Accept any accurate definition with the key term. 2. False — reason must cite the exception. 3. Option B, with a valid justification. 4–9. Award step marks; full marks require correct reasoning and units.`,
    fee_reminder: `Fee reminder — ${instituteName}

Dear Parent,

A gentle reminder that ₹12,500 towards Term 2 fees for your child is currently pending. The due date was five days ago, and we would appreciate your help in closing this at the earliest.

You can pay by UPI, card or net banking through the parent portal, or at the accounts office between 9:00 am and 3:00 pm on working days. If you would like to split the amount into instalments, please reply to this message and our accounts team will be glad to work out a plan with you.

If you have already made the payment, kindly share the reference number so we can update our records.

Thank you for your continued partnership.

Accounts Office
${instituteName}

(Context: ${excerpt})`,
    admission_reply: `Admission enquiry reply — ${instituteName}

Dear Parent,

Thank you for your interest in ${instituteName}. We would be delighted to help with the admission enquiry you shared.

Next steps
• Share the student's current grade, city and preferred start date.
• Our admissions team will confirm seat availability within one working day.
• A campus visit can be scheduled Monday to Saturday, 10:00 am – 4:00 pm.

Documents checklist
• Birth certificate
• Previous school report card and transfer certificate
• Address proof and passport-size photographs
• Aadhaar (student and parent)

Fees and transport: exact figures depend on the grade and route. We will send the current fee sheet and transport map along with the availability confirmation.

Please reply with the grade and preferred start date, or call the admissions desk to book a visit. We look forward to welcoming your family.

(Context: ${excerpt})`,
    attendance_insight: `Attendance insight — ${instituteName}

What the numbers suggest
• Six students below 75% is a pattern, not six separate incidents. Check whether absences cluster on Mondays, exam days or a particular subject period.
• Monsoon-related illness is plausible, but two medical notes should be verified and recorded consistently.
• Look for a shared factor: transport route, sibling pickup, or a specific classroom.

Priority actions (this week)
1. Owner: class teacher — call the six families, log the reason and agree a return date. Deadline: Wednesday.
2. Owner: attendance coordinator — pull a 30-day heatmap for the section and flag repeat patterns. Deadline: Thursday.
3. Owner: counsellor — meet any student with three consecutive unexplained absences. Deadline: Friday.

Parent message template
"Dear Parent, we noticed that [Student] has missed [n] days this month. We would like to understand how we can support a consistent routine. Could we speak briefly this week? — [Teacher], ${instituteName}"

Escalate to the counsellor if absences continue after two contacts.`,
  };

  return {
    text:
      outputs[featureKey] ??
      `Draft — ${instituteName}\n\n${excerpt}\n\n(This module is ready to connect to your AI provider.)`,
    provider: "mock",
    model: "knowletive-demo",
  };
}

async function generate(input: AiRunInput): Promise<Generation> {
  const provider = (process.env.AI_PROVIDER ?? "").toLowerCase();
  const apiKey = process.env.OPENAI_API_KEY;

  if (provider === "openai" && apiKey) {
    const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const feature = AI_FEATURE_MAP.get(input.featureKey);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: `${SYSTEM_BASE} ${SYSTEM_BY_FEATURE[input.featureKey] ?? ""}`,
          },
          {
            role: "user",
            content: `Institute: ${input.instituteName} (${input.instituteType}). Module: ${
              feature?.label ?? input.featureKey
            }.\n\nBrief:\n${input.prompt}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI provider error ${response.status}: ${detail.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("AI provider returned an empty response");

    return {
      text,
      provider: "openai",
      model,
      tokensIn: json.usage?.prompt_tokens,
      tokensOut: json.usage?.completion_tokens,
    };
  }

  // Demo mode: no key required, so the whole product is explorable offline.
  return mockGeneration(input.featureKey, input.prompt, input.instituteName);
}

/**
 * Atomically reserves credits, runs the model, and records the job. Failed
 * generations are refunded so users never lose credits to a provider outage.
 */
export async function runAiJob(input: AiRunInput) {
  const feature = AI_FEATURE_MAP.get(input.featureKey);
  if (!feature) throw new Error("Unknown AI module");

  const cost = feature.credits;
  const periodStart = startOfMonth();

  if (input.creditLimit <= 0) {
    throw new Error("Your plan does not include AI credits. Upgrade in Billing to use AI Studio.");
  }

  // Ensure a usage row exists, then reserve credits with a conditional update.
  await db.tenantUsage.upsert({
    where: { tenantId_periodStart: { tenantId: input.tenantId, periodStart } },
    update: {},
    create: {
      tenantId: input.tenantId,
      periodStart,
      aiCreditsUsed: 0,
      aiCreditsLimit: input.creditLimit,
    },
  });

  const reserved = await db.tenantUsage.updateMany({
    where: {
      tenantId: input.tenantId,
      periodStart,
      aiCreditsUsed: { lte: input.creditLimit - cost },
    },
    data: { aiCreditsUsed: { increment: cost }, aiCreditsLimit: input.creditLimit },
  });

  if (reserved.count === 0) {
    const usage = await db.tenantUsage.findUnique({
      where: { tenantId_periodStart: { tenantId: input.tenantId, periodStart } },
    });
    throw new Error(
      `Not enough AI credits. ${Math.max(
        0,
        input.creditLimit - (usage?.aiCreditsUsed ?? 0),
      )} left this month — this module needs ${cost}.`,
    );
  }

  const started = Date.now();
  try {
    const generation = await generate(input);
    const job = await db.aiJob.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        feature: input.featureKey,
        prompt: input.prompt,
        output: generation.text,
        credits: cost,
        status: "SUCCEEDED",
        provider: generation.provider,
        model: generation.model,
        tokensIn: generation.tokensIn,
        tokensOut: generation.tokensOut,
        durationMs: Date.now() - started,
      },
    });

    return { job, text: generation.text, credits: cost };
  } catch (error) {
    // Refund reserved credits.
    await db.tenantUsage.updateMany({
      where: { tenantId: input.tenantId, periodStart, aiCreditsUsed: { gte: cost } },
      data: { aiCreditsUsed: { decrement: cost } },
    });
    await db.aiJob.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        feature: input.featureKey,
        prompt: input.prompt,
        credits: 0,
        status: "FAILED",
        provider: process.env.AI_PROVIDER ?? "mock",
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
        durationMs: Date.now() - started,
      },
    });
    throw error;
  }
}
