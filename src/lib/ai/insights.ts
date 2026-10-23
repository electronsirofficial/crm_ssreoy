import { z } from "zod";
import { structured, DATA_RULE } from "./claude";

export const LeadInsightSchema = z.object({
  conversionLikelihood: z.number().int().min(0).max(100),
  priority: z.number().int().min(0).max(100).describe("how urgently this lead needs attention now, considering likelihood and time since last contact"),
  nextAction: z.string(),
  talkingPoints: z.array(z.string()).describe("2-4 specific points the agent should raise next time, grounded in the history"),
  conversionFactors: z.array(z.string()).describe("factors most relevant to whether this family enrolls"),
  inconsistencies: z
    .array(z.object({ description: z.string(), severity: z.enum(["LOW", "MEDIUM", "HIGH"]) }))
    .describe("contradictions between call transcripts/summaries and visit questionnaire answers (e.g. different class, exam, decision maker); empty if none"),
});
export type LeadInsight = z.infer<typeof LeadInsightSchema>;

export async function leadInsight(history: string) {
  return structured({
    schema: LeadInsightSchema,
    effort: "medium",
    system:
      "You are a sales analyst for an IIT-JEE / NEET coaching institute. Given a lead's full history (calls, home visits, questionnaires, follow-ups), " +
      "estimate conversion likelihood, decide what the agent should do next, and point out contradictions between sources that could indicate " +
      "inaccurate reporting. Be concise and concrete. " +
      DATA_RULE,
    prompt: `<history>\n${history}\n</history>`,
  });
}

export const AgentInsightSchema = z.object({
  overallAssessment: z.string().describe("2-3 sentences on how this agent is performing"),
  strengths: z.array(z.string()),
  coachingTips: z.array(z.string()).describe("specific, actionable improvements"),
  integrityRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  integrityReasons: z.array(z.string()).describe("patterns that warrant review; these are signals, not proof of fraud"),
});
export type AgentInsight = z.infer<typeof AgentInsightSchema>;

export async function agentInsight(profile: string) {
  return structured({
    schema: AgentInsightSchema,
    effort: "medium",
    system:
      "You review the activity of a field sales agent at a coaching institute for the manager. Help genuine agents improve, and highlight " +
      "patterns that may indicate fabricated reporting (very short visits, reused locations, poor calls claimed as successes, claims on walk-ins). " +
      "Anomalies are signals for review, never proof. " +
      DATA_RULE,
    prompt: `<history>\n${profile}\n</history>`,
  });
}
