import { requireUser } from "@/lib/auth";
import { Shell } from "@/components/Shell";

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["RECEPTION", "ADMIN"]);
  return (
    <Shell user={user} narrow nav={[{ href: "/desk", label: "Front desk" }, ...(user.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : [])]}>
      {children}
    </Shell>
  );
}
