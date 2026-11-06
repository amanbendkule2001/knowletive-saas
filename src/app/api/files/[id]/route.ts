import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { objectDownload } from "@/lib/storage";

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
    include: { student: true },
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
        { error: "Access denied. You do not have permission to view this page." },
        { status: 403 },
      );
    }

    // If the file is tied to a student, verify portal guardian/student authorization
    if (!isPlatformOwner && membership && fileAsset.studentId) {
      const isStaff = !["PARENT", "STUDENT"].includes(membership.roleName.toUpperCase());

      if (!isStaff) {
        // Check if this guardian is linked to the student
        const linkedGuardian = await db.studentGuardian.findFirst({
          where: {
            studentId: fileAsset.studentId,
            guardian: { userId: user.id, tenantId: fileAsset.tenantId },
          },
        });

        if (!linkedGuardian) {
          return Response.json(
            { error: "Access denied. You do not have permission to view this page." },
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
