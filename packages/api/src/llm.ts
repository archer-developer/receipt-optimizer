// @ts-ignore
const provider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
// @ts-ignore
const customModel = process.env.LLM_MODEL;

const DEFAULTS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-3.1-flash-lite-preview",
};

function resolvedModel(): string {
  return customModel || DEFAULTS[provider] || DEFAULTS["anthropic"];
}

async function callAnthropic(prompt: string): Promise<string> {
  // @ts-ignore
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: resolvedModel(),
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic request failed: ${await response.text()}`);

  const data = await response.json() as { content: { type: string; text: string }[] };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

async function callGemini(prompt: string): Promise<string> {
  // @ts-ignore
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const model = resolvedModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) throw new Error(`Gemini request failed: ${await response.text()}`);

  const data = await response.json() as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return data.candidates[0]?.content.parts[0]?.text ?? "";
}

export async function callLLM(prompt: string): Promise<string> {
  console.log(`\n[LLM] provider=${provider} model=${resolvedModel()}\n--- REQUEST ---\n${prompt}\n---`);
  const response = provider === "gemini" ? await callGemini(prompt) : await callAnthropic(prompt);
  console.log(`[LLM] --- RESPONSE ---\n${response}\n---`);
  return response;
}

export function parseJsonArray<T>(text: string): T[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in LLM response");
  return JSON.parse(match[0]);
}
