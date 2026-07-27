import Anthropic from "@anthropic-ai/sdk"
import type { AiProvider } from "@/lib/types"

// ============================================================
// Multi-provider chat completion. SERVER ONLY — importing this pulls in the
// Anthropic SDK; the dashboard should import `./catalog` instead.
//
// Claude goes through the official Anthropic SDK. OpenAI and DeepSeek share a
// single fetch path because DeepSeek's API is OpenAI-compatible — one code path
// covers both without pulling in a second SDK.
// ============================================================

export { defaultModelFor, isKnownProvider, modelsFor, PROVIDERS } from "./catalog"
export type { ModelOption, ProviderInfo } from "./catalog"
export type { AiProvider }

export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export interface GenerateArgs {
  provider: AiProvider
  apiKey: string
  model: string
  systemPrompt: string
  history: ChatTurn[]
  maxTokens?: number
  /**
   * How hard the model should think. DM replies are short and latency-sensitive
   * ("low"); content planning is worth the extra reasoning ("high").
   */
  effort?: "low" | "medium" | "high"
}

export interface GenerateResult {
  ok: boolean
  text?: string
  error?: string
}

// The `effort` control only exists on the Claude 5 family — sending it to
// Haiku 4.5 is an error.
function supportsEffort(model: string): boolean {
  return model.startsWith("claude-opus-5") || model.startsWith("claude-sonnet-5")
}

const OPENAI_COMPATIBLE_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
}

export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { provider, apiKey, model, systemPrompt, history } = args
  const maxTokens = args.maxTokens ?? 2048

  if (!apiKey) return { ok: false, error: "No API key configured" }
  if (!history.length) return { ok: false, error: "No conversation history to reply to" }

  const effort = args.effort ?? "low"

  try {
    if (provider === "anthropic") {
      return await generateAnthropic({ apiKey, model, systemPrompt, history, maxTokens, effort })
    }
    return await generateOpenAiCompatible({ provider, apiKey, model, systemPrompt, history, maxTokens })
  } catch (e: any) {
    const message = e?.message || String(e)
    console.error(`[ai] ${provider} call failed:`, message)
    return { ok: false, error: message }
  }
}

// ------------------------------------------------------------
// Claude (official SDK)
// ------------------------------------------------------------
async function generateAnthropic(opts: {
  apiKey: string
  model: string
  systemPrompt: string
  history: ChatTurn[]
  maxTokens: number
  effort: "low" | "medium" | "high"
}): Promise<GenerateResult> {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1 })

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.systemPrompt,
    messages: opts.history.map((t) => ({ role: t.role, content: t.content })),
  }

  // Prefer shallow thinking over no thinking — disabling it outright degrades
  // output quality, whereas a low effort setting just keeps it brief.
  if (supportsEffort(opts.model)) {
    ;(params as any).output_config = { effort: opts.effort }
  }

  const response = await client.messages.create(params)

  // Safety classifiers can decline a request — this comes back as a normal 200,
  // so check stop_reason before touching content.
  if (response.stop_reason === "refusal") {
    return { ok: false, error: "The model declined to answer this message" }
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()

  if (!text) return { ok: false, error: "Empty response from Claude" }
  return { ok: true, text }
}

// ------------------------------------------------------------
// OpenAI / DeepSeek (shared OpenAI-compatible chat completions API)
// ------------------------------------------------------------
async function generateOpenAiCompatible(opts: {
  provider: AiProvider
  apiKey: string
  model: string
  systemPrompt: string
  history: ChatTurn[]
  maxTokens: number
}): Promise<GenerateResult> {
  const base = OPENAI_COMPATIBLE_BASE[opts.provider]
  if (!base) return { ok: false, error: `Unsupported provider: ${opts.provider}` }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.systemPrompt },
        ...opts.history.map((t) => ({ role: t.role, content: t.content })),
      ],
    }),
  })

  const json = await res.json().catch(() => null)

  if (!res.ok || json?.error) {
    const detail = json?.error?.message || `HTTP ${res.status}`
    return { ok: false, error: detail }
  }

  const text = String(json?.choices?.[0]?.message?.content ?? "").trim()
  if (!text) return { ok: false, error: `Empty response from ${opts.provider}` }
  return { ok: true, text }
}
