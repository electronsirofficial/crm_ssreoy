import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { leadForUser } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { CallUploadForm } from "./CallUploadForm";
import { transcriptionProvider } from "@/lib/transcribe";

export default async function LogCall({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const lead = await leadForUser(user, (await params).id);
  if (!lead) notFound();
  return (
    <>
      <PageHeader title="Log a call" subtitle={`${lead.studentName} · ${lead.phone}`} />
      <CallUploadForm leadId={lead.id} sttEnabled={transcriptionProvider() !== "none"} />
    </>
  );
}
