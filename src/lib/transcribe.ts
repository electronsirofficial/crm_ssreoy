
// Pluggable speech-to-text. Claude analyses text, so audio is transcribed first by a dedicated STT
// provider chosen with TRANSCRIPTION_PROVIDER. Calls in Hindi/Hinglish/regional languages work best
// with multilingual models (Deepgram nova-3 "multi", OpenAI gpt-4o-transcribe / whisper-1).

export type TranscriptionProvider = "deepgram" | "openai" | "none";

export function transcriptionProvider(): TranscriptionProvider {
  const p = (process.env.TRANSCRIPTION_PROVIDER ?? "none").toLowerCase();
  if (p === "deepgram" && process.env.DEEPGRAM_API_KEY) return "deepgram";
  if (p === "openai" && process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const provider = transcriptionProvider();
  if (provider === "deepgram") return deepgram(audio, mime);
  if (provider === "openai") return openai(audio, mime);
  throw new Error("No transcription provider configured (set TRANSCRIPTION_PROVIDER and its API key), or paste the transcript manually.");
}

async function deepgram(audio: Buffer, mime: string) {
  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL ?? "nova-3",
    language: process.env.DEEPGRAM_LANGUAGE ?? "multi",
    smart_format: "true",
    diarize: "true",
    paragraphs: "true",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": mime || "audio/mpeg" },
    body: new Uint8Array(audio),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const text: string | undefined = alt?.paragraphs?.transcript ?? alt?.transcript;
  if (!text?.trim()) throw new Error("Deepgram returned an empty transcript");
  return text.trim();
}

async function openai(audio: Buffer, mime: string) {
  const form = new FormData();
  const ext = mime.split("/")[1]?.split(";")[0] || "mp3";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `call.${ext}`);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (!json?.text?.trim()) throw new Error("Empty transcript");
  return String(json.text).trim();
}
