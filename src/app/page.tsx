import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { homeFor } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  redirect(session ? homeFor(session.role) : "/login");
}
