import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/rbac";
import { hasPlatformPermission } from "@/lib/auth";
import { platformNav } from "@/components/shell/nav";
import { Shell } from "@/components/shell/shell";

export const metadata = { title: "Platform console" };

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformPermission("platform.overview.read");
  const nav = platformNav.filter((item) => !item.permission || hasPlatformPermission(user, item.permission));

  if (nav.length === 0) {
    redirect("/login");
  }

  return (
    <Shell
      area="platform"
      nav={nav}
      user={{
        name: user.name,
        email: user.email,
        avatarColor: user.avatarColor,
        isPlatformOwner: user.isPlatformOwner,
      }}
      canViewPlatform
    >
      {children}
    </Shell>
  );
}
