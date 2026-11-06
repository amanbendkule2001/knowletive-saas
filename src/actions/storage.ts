"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { buildStorageKey, putObject, removeObject, storageProviderName } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import type { FileKind, Prisma } from "@prisma/client";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadStudentDocumentAction(formData: FormData): Promise<void> {
  const studentId = String(formData.get("studentId") ?? "").trim();
  const auth = await authorizeTenantWrite("tenant.students.write", "create");
  if (!auth.ok) redirect(studentId ? `/app/students/${studentId}?denied_action=create` : "/app/students?denied_action=create");
  const ctx = auth.ctx;
  const file = formData.get("file") as File | null;
  const rawKind = String(formData.get("kind") ?? "DOCUMENT").toUpperCase();
  const customName = String(formData.get("name") ?? "").trim();

  if (!studentId) {
    return;
  }

  if (!file || !(file instanceof File) || file.size === 0) {
    return;
  }

  const kind: FileKind = rawKind === "STUDENT_PHOTO" ? "STUDENT_PHOTO" : "DOCUMENT";
  const maxSize = kind === "STUDENT_PHOTO" ? MAX_IMAGE_SIZE : MAX_DOCUMENT_SIZE;

  if (file.size > maxSize) {
    return;
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return;
  }

  // Verify student exists in this tenant
  const student = await db.student.findFirst({
    where: { id: studentId, tenantId: ctx.tenant.id },
  });
  if (!student) {
    return;
  }

  const filename = customName ? `${customName}-${file.name}` : file.name;
  const storageKey = buildStorageKey(ctx.tenant.id, kind, filename);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    await putObject(storageKey, buffer, file.type);

    const asset = await db.fileAsset.create({
      data: {
        tenantId: ctx.tenant.id,
        studentId: student.id,
        kind,
        name: customName || file.name,
        mime: file.type,
        size: buffer.length,
        storageKey,
        provider: storageProviderName(),
        uploadedById: ctx.user.id,
      },
    });

    await writeAudit({
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "file.upload",
      entity: "FileAsset",
      entityId: asset.id,
      meta: { studentId: student.id, filename: asset.name, size: asset.size, mime: asset.mime },
    });

    revalidatePath(`/app/students/${studentId}`);
  } catch (error) {
    console.error("[storage] file upload failed", error);
  }
}

export async function deleteStudentDocumentAction(formData: FormData) {
  const fileId = String(formData.get("fileId") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const auth = await authorizeTenantWrite("tenant.students.write", "delete");
  if (!auth.ok) redirect(studentId ? `/app/students/${studentId}?denied_action=delete` : "/app/students?denied_action=delete");
  const ctx = auth.ctx;

  if (!fileId) return;

  const fileAsset = await db.fileAsset.findFirst({
    where: { id: fileId, tenantId: ctx.tenant.id },
  });

  if (!fileAsset) return;

  try {
    await removeObject(fileAsset.storageKey);
  } catch (err) {
    console.warn("[storage] local remove warning:", err);
  }

  await db.fileAsset.delete({ where: { id: fileAsset.id } });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "file.delete",
    entity: "FileAsset",
    entityId: fileAsset.id,
    meta: { filename: fileAsset.name, studentId: fileAsset.studentId },
  });

  if (studentId) {
    revalidatePath(`/app/students/${studentId}`);
  }
  revalidatePath("/app/students");
}

export async function uploadSchoolLogoAction(formData: FormData): Promise<void> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "update");
  if (!auth.ok) redirect("/app/settings?denied_action=update");
  const ctx = auth.ctx;
  const file = formData.get("logo") as File | null;

  if (!file || !(file instanceof File) || file.size === 0) {
    return;
  }

  const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);
  if (!allowedImageTypes.has(file.type)) {
    return;
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return;
  }

  const existingSettings =
    ctx.tenant.settings && typeof ctx.tenant.settings === "object" && !Array.isArray(ctx.tenant.settings)
      ? (ctx.tenant.settings as Record<string, unknown>)
      : {};

  // Clean up any previous logo asset
  const oldLogoFileId = typeof existingSettings.logoFileId === "string" ? existingSettings.logoFileId : null;
  if (oldLogoFileId) {
    const oldAsset = await db.fileAsset.findFirst({
      where: { id: oldLogoFileId, tenantId: ctx.tenant.id },
    });
    if (oldAsset) {
      try {
        await removeObject(oldAsset.storageKey);
      } catch (e) {
        console.warn("[storage:logo] cleanup old logo warning:", e);
      }
      await db.fileAsset.delete({ where: { id: oldAsset.id } }).catch(() => null);
    }
  }

  const storageKey = buildStorageKey(ctx.tenant.id, "LOGO", `logo-${file.name}`);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    await putObject(storageKey, buffer, file.type);

    const asset = await db.fileAsset.create({
      data: {
        tenantId: ctx.tenant.id,
        kind: "LOGO",
        name: `School Logo - ${file.name}`,
        mime: file.type,
        size: buffer.length,
        storageKey,
        provider: storageProviderName(),
        uploadedById: ctx.user.id,
      },
    });

    await db.tenant.update({
      where: { id: ctx.tenant.id },
      data: {
        settings: {
          ...existingSettings,
          logoFileId: asset.id,
        } as Prisma.InputJsonValue,
      },
    });

    await writeAudit({
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "settings.logo.upload",
      entity: "FileAsset",
      entityId: asset.id,
      meta: { filename: file.name, size: buffer.length },
    });

    revalidatePath("/app/settings");
    revalidatePath("/app");
    revalidatePath("/portal");
  } catch (error) {
    console.error("[storage:logo] upload failed", error);
  }
}

export async function deleteSchoolLogoAction(): Promise<void> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "delete");
  if (!auth.ok) redirect("/app/settings?denied_action=delete");
  const ctx = auth.ctx;

  const existingSettings =
    ctx.tenant.settings && typeof ctx.tenant.settings === "object" && !Array.isArray(ctx.tenant.settings)
      ? (ctx.tenant.settings as Record<string, unknown>)
      : {};

  const oldLogoFileId = typeof existingSettings.logoFileId === "string" ? existingSettings.logoFileId : null;
  if (oldLogoFileId) {
    const oldAsset = await db.fileAsset.findFirst({
      where: { id: oldLogoFileId, tenantId: ctx.tenant.id },
    });
    if (oldAsset) {
      try {
        await removeObject(oldAsset.storageKey);
      } catch (e) {
        console.warn("[storage:logo] remove warning:", e);
      }
      await db.fileAsset.delete({ where: { id: oldAsset.id } }).catch(() => null);
    }
  }

  const updatedSettings = { ...existingSettings };
  delete updatedSettings.logoFileId;

  await db.tenant.update({
    where: { id: ctx.tenant.id },
    data: { settings: updatedSettings as Prisma.InputJsonValue },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "settings.logo.delete",
    entity: "Tenant",
    entityId: ctx.tenant.id,
  });

  revalidatePath("/app/settings");
  revalidatePath("/app");
  revalidatePath("/portal");
}
