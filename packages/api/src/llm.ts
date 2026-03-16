// @ts-ignore
const provider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
// @ts-ignore
const customModel = process.env.LLM_MODEL;
// @ts-ignore
const proxyUrl = process.env.LLM_PROXY_URL;

const DEFAULTS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-3.1-flash-lite-preview",
};

function resolvedModel(): string {
  return customModel || DEFAULTS[provider] || DEFAULTS["anthropic"];
}

let _proxyFetch: typeof fetch | null = null;

function isSocksProxy(url: string): boolean {
  return /^socks[45]?:\/\//i.test(url);
}

async function buildProxyFetch(url: string): Promise<typeof fetch> {
  const { fetch: undiciFetch, Agent, ProxyAgent } = await import("undici");

  let dispatcher;
  if (isSocksProxy(url)) {
    const { SocksClient } = await import("socks");
    // @ts-ignore
    const tls = await import("tls");
    const parsed = new URL(url);
    const type = parsed.protocol === "socks4:" ? 4 : 5;
    dispatcher = new Agent({
      connect: async (options: any, callback: any) => {
        try {
          const { socket } = await SocksClient.createConnection({
            proxy: {
              host: parsed.hostname,
              port: Number(parsed.port),
              type,
              ...(parsed.username ? { userId: decodeURIComponent(parsed.username) } : {}),
              ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
            },
            command: "connect",
            destination: {
              host: options.hostname,
              port: Number(options.port) || (options.protocol === "https:" ? 443 : 80),
            },
          });
          socket.setKeepAlive(true);
          if (options.protocol === "https:") {
            const tlsSocket = tls.connect({
              socket,
              servername: options.servername || options.hostname,
              rejectUnauthorized: options.rejectUnauthorized !== false,
            });
            tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
            tlsSocket.once("error", (err: Error) => callback(err, null));
          } else {
            callback(null, socket);
          }
        } catch (err) {
          callback(err, null);
        }
      },
    });
  } else {
    dispatcher = new ProxyAgent(url);
  }

  return (reqUrl, init) =>
    undiciFetch(reqUrl as string, { ...init, dispatcher } as any) as unknown as Promise<Response>;
}

async function getFetch(): Promise<typeof fetch> {
  if (!proxyUrl) return fetch;
  if (_proxyFetch) return _proxyFetch;
  _proxyFetch = await buildProxyFetch(proxyUrl);
  return _proxyFetch;
}

async function callAnthropic(prompt: string): Promise<string> {
  // @ts-ignore
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const f = await getFetch();
  const response = await f("https://api.anthropic.com/v1/messages", {
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

  const f = await getFetch();
  const response = await f(url, {
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
  const proxyInfo = proxyUrl ? ` proxy=${proxyUrl} (${isSocksProxy(proxyUrl) ? "socks" : "http"})` : "";
  console.log(`\n[LLM] provider=${provider} model=${resolvedModel()}${proxyInfo}\n--- REQUEST ---\n${prompt}\n---`);
  const response = provider === "gemini" ? await callGemini(prompt) : await callAnthropic(prompt);
  console.log(`[LLM] --- RESPONSE ---\n${response}\n---`);
  return response;
}

export function parseJsonArray<T>(text: string): T[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in LLM response");
  return JSON.parse(match[0]);
}
