import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { objectDownload } from "@/lib/storage";
import { resolveUserBranchScope } from "@/lib/branch";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return new Response("Missing file ID", { status: 400 });
  }

  const fileAsset = await db.fileAsset.findUnique({
    where: { id },
    include: {
      student: {
        select: { id: true, tenantId: true, branchId: true, userId: true },
      },
    },
  });

  if (!fileAsset) {
    return new Response("File not found", { status: 404 });
  }

  // School logos are public branding assets; all other documents require tenant auth
  if (fileAsset.kind !== "LOGO") {
    const user = await getSession();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const isPlatformOwner = user.isPlatformOwner;
    const membership = user.memberships.find((m) => m.tenantId === fileAsset.tenantId);

    if (!isPlatformOwner && !membership) {
      return Response.json(
        { error: "Access denied. You do not have permission to view this file." },
        { status: 403 },
      );
    }

    if (!isPlatformOwner && membership) {
      const roleUpper = (membership.roleName || "").toUpperCase();
      const roleKeyUpper = (membership.roleKey || "").toUpperCase();
      const isParent = roleUpper === "PARENT" || roleKeyUpper === "PARENT";
      const isStudent = roleUpper === "STUDENT" || roleKeyUpper === "STUDENT";
      const isStaff = !isParent && !isStudent;

      if (fileAsset.studentId && fileAsset.student) {
        // 1. Student self-access
        if (isStudent) {
          if (fileAsset.student.userId !== user.id) {
            return Response.json(
              { error: "Access denied. You can only view your own student files." },
              { status: 403 },
            );
          }
        }

        // 2. Parent / Guardian relationship verification
        if (isParent) {
          const linkedGuardian = await db.studentGuardian.findFirst({
            where: {
              studentId: fileAsset.studentId,
              guardian: { userId: user.id, tenantId: fileAsset.tenantId },
            },
          });

          if (!linkedGuardian) {
            return Response.json(
              { error: "Access denied. You do not have permission to view files for this student." },
              { status: 403 },
            );
          }
        }

        // 3. Staff branch authorization check
        if (isStaff && !membership.isOwner && roleKeyUpper !== "INSTITUTE_ADMIN") {
          const branchScope = await resolveUserBranchScope({
            user,
            tenant: { id: fileAsset.tenantId } as any,
            membership: membership as any,
            permissions: new Set(membership.permissions || []),
            isOwnerView: false,
            subscriptionBlocked: false,
            branchId: membership.branchId,
          });

          if (branchScope.isBranchScoped) {
            const studentBranchId = fileAsset.student.branchId;
            if (!studentBranchId || !branchScope.allowedBranchIds.includes(studentBranchId)) {
              return Response.json(
                { error: "Access denied. You do not have permission to access records for this branch." },
                { status: 403 },
              );
            }
          }
        }
      } else {
        // General tenant documents without student association
        // Deny parents and students by default
        if (isParent || isStudent) {
          return Response.json(
            { error: "Access denied. You do not have permission to access internal institute documents." },
            { status: 403 },
          );
        }

        // Staff access check for unassociated documents
        const perms = new Set(membership.permissions || []);
        const isAuthorizedStaff =
          membership.isOwner ||
          roleKeyUpper === "INSTITUTE_ADMIN" ||
          fileAsset.uploadedById === user.id ||
          perms.has("tenant.settings.read") ||
          perms.has("tenant.staff.read") ||
          perms.has("tenant.reports.read") ||
          perms.has("tenant.fees.read");

        if (!isAuthorizedStaff) {
          return Response.json(
            { error: "Access denied. You do not have authorization to view this document." },
            { status: 403 },
          );
        }
      }
    }
  }

  try {
    const download = await objectDownload(fileAsset.storageKey);

    if (download.kind === "redirect") {
      return Response.redirect(download.url);
    }

    const safeFilename = encodeURIComponent(fileAsset.name.replace(/["\r\n]/g, "_"));

    return new Response(new Uint8Array(download.body), {
      status: 200,
      headers: {
        "Content-Type": fileAsset.mime || "application/octet-stream",
        "Content-Length": String(download.body.length),
        "Content-Disposition": `inline; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error(`[storage] failed to stream file asset ${id}:`, error);
    return new Response("Unable to retrieve file from local storage", { status: 500 });
  }
}
