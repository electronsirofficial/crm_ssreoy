# Admissions CRM — IIT-JEE / NEET coaching institute

A CRM built around one question: **did this agent genuinely bring in this student?**
Commission is decided from evidence (recorded calls, GPS-verified visits, questionnaires, timestamps), never from data entry alone.

## Setup

1. **Database:** put your Postgres connection string in `.env` as `DATABASE_URL` (Prisma Postgres: the `postgres://…@db.prisma.io:5432/…` URL; Neon: the pooled URL). On Vercel, the same variable must be set in Project → Settings → Environment Variables; `npm run build` runs `prisma migrate deploy`, so tables are created/updated on each deploy.
2. **AI keys (optional but recommended):** in `.env`
   - `ANTHROPIC_API_KEY` — Claude analyses call transcripts, scores calls, gives lead/agent insights.
   - `TRANSCRIPTION_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` (handles Hindi/English mixing), or `openai` + `OPENAI_API_KEY`.
   Without these the CRM still works; calls are marked "skipped" and can be re-analysed later from the call page.
3. Install and create tables:
   ```bash
   npm install
   npx prisma migrate deploy            # creates tables
   npm run db:seed                       # config + demo data (SEED_DEMO=false for config only)
   npm run dev                           # http://localhost:3000
   ```

`AUTH_SECRET` and `CRON_SECRET` in `.env` were generated for you.

### Logins after seeding
| Role | Email | Password |
|---|---|---|
| Admin | admin@institute.test | Admin@12345 |
| Agents | ravi@ / priya@ / arjun@institute.test | Demo@12345 |
| Front desk | desk@institute.test | Demo@12345 |

**Change these passwords before real use** (Team → agent → Reset password), or seed with `SEED_DEMO=false` and your own `SEED_ADMIN_*` values.

The demo data covers scenarios A–E from the requirements; open **Commissions → All** to see each outcome and its reasoning.

## Who uses what
- **Agents** (`/agent`, phone-friendly): add leads, upload call recordings, GPS + live-camera visit check-in/out, mandatory post-visit questionnaire, follow-ups, AI next-best-action.
- **Front desk** (`/desk`): look up the family by phone at the counter, register walk-ins, record enrollments. *Every* family visiting the institute must be recorded here — this timestamp is what separates agent-generated admissions from walk-ins.
- **Admin** (`/admin`): dashboard, leads, calls (audio + transcript + AI evaluation), visits (photo, map, verification checks), follow-ups, flags, commission decisions, team comparison, settings, audit log.

## How attribution works (`src/lib/attribution.ts`)
1. **Cutoff** = first time the family was physically at the institute (walk-in or enrollment). Agent work after that can't have caused the visit.
2. **Qualifying call:** has a recording (typed transcripts don't count), long enough, AI says it was a real conversation, quality ≥ threshold, uploaded before the cutoff.
3. **Qualifying visit:** completed, ≥ minimum minutes, verification score ≥ threshold, questionnaire submitted, family not marked "not interested".
4. Open high-severity flags on a call/visit disqualify it until an admin dismisses them.
5. Outcome:
   - one agent qualifies → *Pending review* (or auto-approved, per settings);
   - several qualify → *Disputed*;
   - none → *Walk-in / no evidence*, no commission.

   Admins make the final decision, and any override needs a written reason.

## Anti-fraud measures
- Photos come from the live camera (no gallery upload). The server stamps time, GPS and agent name onto each photo and hashes it; exact and near-duplicate photos are detected.
- Server-side timestamps, GPS accuracy, check-in/out drift, distance from the family's verified home, impossible travel speed between visits, device clock skew, many families recorded at one spot.
- Duplicate phone detection across all leads, claims on walk-ins, recording re-use, late uploads, AI-detected mismatch between what the agent reported and what the recording shows.
- Hash-chained audit log (Admin → Audit → *Verify integrity*).

**Known limits:** a browser can't detect GPS-spoofing apps on rooted phones. The other checks (photo, home distance, travel speed, same spot) make spoofing hard to sustain, and a native Android app with mock-location detection is the next step if needed. Mobile browsers require **HTTPS** for camera and GPS, so test on phones through a deployed URL or an HTTPS tunnel.

## Production notes
- Uploaded photos and recordings are stored on local disk (`STORAGE_DIR`). Deploy to a server with a persistent disk, or swap `src/lib/storage.ts` for S3/R2. Serverless hosts like Vercel don't keep local files.
- Schedule `GET /api/cron/sweep` with header `Authorization: Bearer $CRON_SECRET` every 15–60 min. It runs pattern checks (repeated short visits, poor-call patterns, neglected hot leads, overdue questionnaires). It also runs when an admin opens the dashboard.
- Call recording laws: agents confirm consent on every upload; check your obligations under India's DPDP Act.
