import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  Badge,
  Card,
  EmptyState,
  Progress,
  Tone,
} from "@/components/ui/primitives";
import {
  AddChapterButton,
  AddTopicButton,
  UpdateProgressButton,
  AddLessonPlanButton,
  CompleteSyllabusButton,
} from "@/components/syllabus/syllabus-client-bits";
import type { TopicProgressStatus, SyllabusStatus } from "@prisma/client";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Syllabus ${id} — SyllabusTrack` };
}

function topicTone(status: TopicProgressStatus): Tone {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "IN_PROGRESS":
      return "brand";
    case "SKIPPED":
      return "warning";
    case "NOT_STARTED":
    default:
      return "neutral";
  }
}

function syllabusStatusTone(status: SyllabusStatus): Tone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "DRAFT":
      return "warning";
    case "COMPLETED":
      return "info";
    case "ARCHIVED":
      return "neutral";
    default:
      return "neutral";
  }
}

export default async function SyllabusDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "curriculum" } = await searchParams;

  const ctx = await requireTenantPermission("tenant.syllabus.read");
  const canWrite = hasTenantPermission(ctx, "tenant.syllabus.write");
  const canManageStructure = hasTenantPermission(ctx, "tenant.syllabus.manage_structure");
  const canManageLessons = hasTenantPermission(ctx, "tenant.syllabus.manage_lessons");
  const canUpdateProgress = hasTenantPermission(ctx, "tenant.syllabus.update_progress");

  const syllabus = await db.syllabusTrack.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      academicYear: true,
      subject: true,
      class: true,
      section: true,
      batch: true,
      teachers: {
        include: {
          teacher: {
            include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
          },
        },
      },
      chapters: {
        orderBy: { order: "asc" },
        include: {
          topics: {
            orderBy: { order: "asc" },
            include: {
              progress: true,
            },
          },
        },
      },
      lessonPlans: {
        orderBy: { plannedDate: "desc" },
        include: {
          topic: { select: { id: true, title: true } },
          teacher: { include: { user: { select: { id: true, name: true } } } },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!syllabus) notFound();

  // Teacher Scoping: Verify assignment
  if (ctx.membership?.roleKey === "TEACHER") {
    const isAssigned = syllabus.teachers.some((t) => t.teacher.user.id === ctx.user.id);
    if (!isAssigned) {
      redirect("/app/forbidden?p=tenant.syllabus.read");
    }
  }

  // Calculate metrics
  const allTopics = syllabus.chapters.flatMap((c) => c.topics);
  const totalTopics = allTopics.length;
  const completedTopics = allTopics.filter((t) => t.status === "COMPLETED").length;
  const inProgressTopics = allTopics.filter((t) => t.status === "IN_PROGRESS").length;
  const pendingTopics = allTopics.filter((t) => t.status === "NOT_STARTED").length;
  const progressPct = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

  const now = new Date();
  const delayedTopics = allTopics.filter(
    (t) => t.status !== "COMPLETED" && t.plannedDate && new Date(t.plannedDate) < now
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/app/syllabus" className="hover:text-foreground flex items-center gap-1 transition">
          <ArrowLeft className="size-3.5" />
          <span>Back to SyllabusTrack</span>
        </Link>
      </div>

      {/* Main Header */}
      <div className="card p-6 border border-[var(--border)] shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-mono bg-[var(--accent)] text-muted px-2 py-0.5 rounded">
                {syllabus.code}
              </span>
              <Badge tone={syllabusStatusTone(syllabus.status)}>{syllabus.status}</Badge>
              {syllabus.targetType === "CLASS_SECTION" ? (
                <span className="badge badge-brand text-xs">
                  {syllabus.class?.name} {syllabus.section ? `• ${syllabus.section.name}` : ""}
                </span>
              ) : (
                <span className="badge badge-info text-xs">
                  Batch: {syllabus.batch?.name || syllabus.batch?.code}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-foreground mt-2">{syllabus.name}</h1>
            <p className="text-xs text-muted mt-1">
              Subject: <span className="font-semibold text-foreground">{syllabus.subject.name}</span> &bull; Academic Year: {syllabus.academicYear.name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canWrite && syllabus.status === "ACTIVE" && (
              <CompleteSyllabusButton syllabusId={syllabus.id} syllabusName={syllabus.name} />
            )}
            {canManageStructure && <AddChapterButton syllabusId={syllabus.id} />}
          </div>
        </div>

        {/* Progress Bar & Summary */}
        <div className="pt-3 border-t border-[var(--border)] grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
          <div className="col-span-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Curriculum Delivered</span>
              <span className="font-semibold text-foreground">
                {completedTopics}/{totalTopics} Topics ({progressPct}%)
              </span>
            </div>
            <Progress value={progressPct} tone={progressPct === 100 ? "success" : "brand"} />
          </div>

          <div className="text-xs">
            <span className="text-muted">In-Progress:</span>{" "}
            <span className="font-semibold text-foreground">{inProgressTopics}</span>
          </div>

          <div className="text-xs">
            <span className="text-muted">Pending:</span>{" "}
            <span className="font-semibold text-foreground">{pendingTopics}</span>
          </div>

          <div className="text-xs">
            <span className="text-muted">Delayed:</span>{" "}
            <span className={`font-semibold ${delayedTopics.length > 0 ? "text-[var(--danger)]" : "text-foreground"}`}>
              {delayedTopics.length}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] pb-1">
        <Link
          href={`/app/syllabus/${id}?tab=curriculum`}
          className={`px-3 py-1.5 rounded-t text-xs font-medium transition ${
            tab === "curriculum"
              ? "border-b-2 border-[var(--brand)] text-[var(--brand)] font-semibold"
              : "text-muted hover:text-foreground"
          }`}
        >
          Curriculum Hierarchy ({syllabus.chapters.length})
        </Link>
        <Link
          href={`/app/syllabus/${id}?tab=lessons`}
          className={`px-3 py-1.5 rounded-t text-xs font-medium transition ${
            tab === "lessons"
              ? "border-b-2 border-[var(--brand)] text-[var(--brand)] font-semibold"
              : "text-muted hover:text-foreground"
          }`}
        >
          Lesson Plans ({syllabus.lessonPlans.length})
        </Link>
        <Link
          href={`/app/syllabus/${id}?tab=delays`}
          className={`px-3 py-1.5 rounded-t text-xs font-medium transition ${
            tab === "delays"
              ? "border-b-2 border-[var(--brand)] text-[var(--brand)] font-semibold"
              : "text-muted hover:text-foreground"
          }`}
        >
          Progress & Delays ({delayedTopics.length})
        </Link>
        <Link
          href={`/app/syllabus/${id}?tab=faculty`}
          className={`px-3 py-1.5 rounded-t text-xs font-medium transition ${
            tab === "faculty"
              ? "border-b-2 border-[var(--brand)] text-[var(--brand)] font-semibold"
              : "text-muted hover:text-foreground"
          }`}
        >
          Faculty & Audit ({syllabus.teachers.length})
        </Link>
      </div>

      {/* TAB CONTENT: CURRICULUM */}
      {tab === "curriculum" && (
        <div className="space-y-4">
          {syllabus.chapters.length === 0 ? (
            <EmptyState
              icon="layers"
              title="No units or chapters yet"
              description="Break down the curriculum into chapters and topics to track classroom coverage."
              action={canManageStructure ? <AddChapterButton syllabusId={syllabus.id} /> : undefined}
            />
          ) : (
            syllabus.chapters.map((chap, cIdx) => {
              const chapCompleted = chap.topics.filter((t) => t.status === "COMPLETED").length;
              const chapTotal = chap.topics.length;
              const chapPct = chapTotal > 0 ? Math.round((chapCompleted / chapTotal) * 100) : 0;

              return (
                <Card key={chap.id} className="p-5 border border-[var(--border)] space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted">Unit {cIdx + 1}</span>
                        <h2 className="text-sm font-semibold text-foreground">{chap.title}</h2>
                      </div>
                      {chap.description && <p className="text-xs text-muted mt-0.5">{chap.description}</p>}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs">
                        <span className="text-muted">Coverage: </span>
                        <span className="font-semibold text-foreground">
                          {chapCompleted}/{chapTotal} ({chapPct}%)
                        </span>
                      </div>
                      {canManageStructure && (
                        <AddTopicButton
                          syllabusId={syllabus.id}
                          chapterId={chap.id}
                          chapterTitle={chap.title}
                        />
                      )}
                    </div>
                  </div>

                  {/* Topic List */}
                  {chap.topics.length === 0 ? (
                    <p className="text-xs text-muted italic py-2">No topics added to this chapter yet.</p>
                  ) : (
                    <div className="divide-y divide-[var(--border)]">
                      {chap.topics.map((top, tIdx) => (
                        <div
                          key={top.id}
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[var(--accent)] px-2 rounded transition"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-muted">{cIdx + 1}.{tIdx + 1}</span>
                              <h3 className="text-xs font-medium text-foreground">{top.title}</h3>
                              <Badge tone={topicTone(top.status)}>{top.status.replace("_", " ")}</Badge>
                            </div>
                            {top.learningObjectives && (
                              <p className="text-[11px] text-muted line-clamp-1 ml-5">
                                Obj: {top.learningObjectives}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-3 self-end sm:self-auto text-xs">
                            <span className="text-muted text-[11px]">
                              {top.estimatedMinutes} mins
                              {top.plannedDate && ` • ${new Date(top.plannedDate).toLocaleDateString()}`}
                            </span>

                            {canUpdateProgress && (
                              <UpdateProgressButton
                                syllabusId={syllabus.id}
                                topicId={top.id}
                                topicTitle={top.title}
                                currentStatus={top.status}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* TAB CONTENT: LESSON PLANS */}
      {tab === "lessons" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              Structured lesson plans detailing objectives, methodology, and homework.
            </p>
            {canManageLessons && (
              <AddLessonPlanButton
                syllabusId={syllabus.id}
                chapters={syllabus.chapters.map((c) => ({
                  id: c.id,
                  title: c.title,
                  topics: c.topics.map((t) => ({ id: t.id, title: t.title })),
                }))}
              />
            )}
          </div>

          {syllabus.lessonPlans.length === 0 ? (
            <EmptyState
              icon="book"
              title="No lesson plans drafted"
              description="Teachers can plan 45-minute structured lessons with automated pedagogy templates."
              action={
                canManageLessons && syllabus.chapters.length > 0 ? (
                  <AddLessonPlanButton
                    syllabusId={syllabus.id}
                    chapters={syllabus.chapters.map((c) => ({
                      id: c.id,
                      title: c.title,
                      topics: c.topics.map((t) => ({ id: t.id, title: t.title })),
                    }))}
                  />
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {syllabus.lessonPlans.map((lp) => (
                <Card key={lp.id} className="p-4 border border-[var(--border)] space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-muted bg-[var(--accent)] px-1.5 py-0.5 rounded">
                        {lp.topic.title}
                      </span>
                      <h4 className="text-xs font-semibold text-foreground mt-1.5">{lp.title}</h4>
                      <p className="text-[11px] text-muted">Faculty: {lp.teacher.user.name}</p>
                    </div>
                    <Badge tone={lp.status === "COMPLETED" ? "success" : "brand"}>{lp.status}</Badge>
                  </div>

                  {lp.objectives && (
                    <div className="text-xs">
                      <span className="font-medium text-foreground">Objectives:</span>
                      <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{lp.objectives}</p>
                    </div>
                  )}

                  {lp.methodology && (
                    <div className="text-xs">
                      <span className="font-medium text-foreground">Methodology:</span>
                      <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{lp.methodology}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] text-[11px] text-muted">
                    <span>Date: {new Date(lp.plannedDate).toLocaleDateString()}</span>
                    <span>Duration: {lp.durationMinutes} mins</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: PROGRESS & DELAYS */}
      {tab === "delays" && (
        <Card className="p-5 border border-[var(--border)] space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Delayed & Pending Topics</h3>
            <p className="text-xs text-muted">Topics whose scheduled teaching milestone has passed without verified completion.</p>
          </div>

          {delayedTopics.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted">
              <CheckCircle2 className="size-8 text-[var(--success)] mx-auto mb-2 opacity-80" />
              <span>All scheduled topics are on track or completed. Zero delay detected!</span>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {delayedTopics.map((dt) => (
                <div key={dt.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-medium text-foreground">{dt.title}</p>
                    <p className="text-[11px] text-[var(--danger)]">
                      Scheduled: {new Date(dt.plannedDate!).toLocaleDateString()} &bull; Status: {dt.status}
                    </p>
                  </div>
                  {canUpdateProgress && (
                    <UpdateProgressButton
                      syllabusId={syllabus.id}
                      topicId={dt.id}
                      topicTitle={dt.title}
                      currentStatus={dt.status}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* TAB CONTENT: FACULTY & AUDIT */}
      {tab === "faculty" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5 border border-[var(--border)] space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Assigned Faculty Members</h3>
            <div className="divide-y divide-[var(--border)]">
              {syllabus.teachers.length === 0 ? (
                <p className="text-xs text-muted py-2">No teachers assigned to this syllabus structure.</p>
              ) : (
                syllabus.teachers.map((st) => (
                  <div key={st.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-medium text-foreground">{st.teacher.user.name}</p>
                      <p className="text-[11px] text-muted">{st.teacher.user.email}</p>
                    </div>
                    {st.isPrimary && <span className="badge badge-brand text-[10px]">Lead Faculty</span>}
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-5 border border-[var(--border)] space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Recent Progress Activity</h3>
            <div className="divide-y divide-[var(--border)]">
              {syllabus.events.length === 0 ? (
                <p className="text-xs text-muted py-2">No progress events recorded yet.</p>
              ) : (
                syllabus.events.map((ev) => (
                  <div key={ev.id} className="py-2.5 text-xs">
                    <p className="font-medium text-foreground">
                      {ev.actorName} marked topic {ev.newStatus}
                    </p>
                    <p className="text-[11px] text-muted">
                      {new Date(ev.createdAt).toLocaleString()} {ev.remarks ? `• ${ev.remarks}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
