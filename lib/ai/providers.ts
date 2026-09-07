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
  /**
   * A JSON schema the answer must satisfy. This is not a hint — the provider
   * constrains generation to it, so the reply cannot come back as prose, cannot
   * arrive wrapped in a code fence, and cannot be a nearly-valid object with one
   * trailing comma. Asking for JSON in the system prompt only ever made those
   * failures rare, and rare is what made them expensive: the call was already
   * paid for by the time the parse threw.
   */
  jsonSchema?: Record<string, unknown>
}

export interface GenerateResult {
  ok: boolean
  text?: string
  error?: string
  /**
   * The model hit `max_tokens` and was cut off mid-sentence. The text is still
   * returned — a caller parsing JSON can salvage the complete entries rather
   * than throw away a call that has already been paid for.
   */
  truncated?: boolean
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

  const jsonSchema = args.jsonSchema

  try {
    if (provider === "anthropic") {
      return await generateAnthropic({ apiKey, model, systemPrompt, history, maxTokens, effort, jsonSchema })
    }
    return await generateOpenAiCompatible({ provider, apiKey, model, systemPrompt, history, maxTokens, jsonSchema })
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
  jsonSchema?: Record<string, unknown>
}): Promise<GenerateResult> {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1 })

  const build = (withSchema: boolean): Anthropic.MessageCreateParamsNonStreaming => {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.systemPrompt,
      messages: opts.history.map((t) => ({ role: t.role, content: t.content })),
    }

    // Both settings live under output_config, so they are assembled together.
    const outputConfig: Record<string, unknown> = {}
    // Prefer shallow thinking over no thinking — disabling it outright degrades
    // output quality, whereas a low effort setting just keeps it brief.
    if (supportsEffort(opts.model)) outputConfig.effort = opts.effort
    if (withSchema && opts.jsonSchema) {
      outputConfig.format = { type: "json_schema", schema: opts.jsonSchema }
    }
    if (Object.keys(outputConfig).length) (params as any).output_config = outputConfig

    return params
  }

  // Thinking tokens are billed against max_tokens on the Claude 5 family, so a
  // long answer can run for minutes. A non-streaming request that long trips
  // the SDK's HTTP timeout and the whole call is lost after being paid for —
  // stream anything with real room to breathe and let the SDK reassemble it.
  const send = (params: Anthropic.MessageCreateParamsNonStreaming) =>
    opts.maxTokens > 8000
      ? client.messages.stream(params).finalMessage()
      : client.messages.create(params)

  let response
  try {
    response = await send(build(true))
  } catch (e: any) {
    // Older or third-party-hosted models reject output_config.format outright.
    // Falling back to the plain request keeps them working on the system
    // prompt's instructions alone, which is where they were before.
    if (opts.jsonSchema && isSchemaRejection(e)) {
      console.warn(`[ai] ${opts.model} rejected a JSON schema — retrying unconstrained:`, e?.message)
      response = await send(build(false))
    } else {
      throw e
    }
  }

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

  if (!text) {
    // An empty answer under a max_tokens stop means thinking consumed the whole
    // budget. Saying so beats "Empty response", which reads like a fluke.
    return {
      ok: false,
      error:
        response.stop_reason === "max_tokens"
          ? "The model spent its whole token budget thinking and never answered — lower the effort or raise max tokens."
          : "Empty response from Claude",
    }
  }

  return { ok: true, text, truncated: response.stop_reason === "max_tokens" }
}

/**
 * A 400 about the schema, rather than about the key, the model or the quota.
 * Only these are worth a second attempt without the constraint.
 */
function isSchemaRejection(error: any): boolean {
  if (error?.status !== 400) return false
  const message: string = error?.message || String(error)
  return /output_config|json_schema|structured output|format/i.test(message)
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
  jsonSchema?: Record<string, unknown>
}): Promise<GenerateResult> {
  const base = OPENAI_COMPATIBLE_BASE[opts.provider]
  if (!base) return { ok: false, error: `Unsupported provider: ${opts.provider}` }

  // OpenAI can hold the reply to the schema itself; DeepSeek only offers plain
  // JSON mode, which at least rules out prose and code fences.
  const responseFormat = !opts.jsonSchema
    ? undefined
    : opts.provider === "openai"
      ? { type: "json_schema", json_schema: { name: "result", strict: true, schema: opts.jsonSchema } }
      : { type: "json_object" }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      ...(responseFormat ? { response_format: responseFormat } : {}),
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

  const choice = json?.choices?.[0]
  const text = String(choice?.message?.content ?? "").trim()
  if (!text) return { ok: false, error: `Empty response from ${opts.provider}` }
  return { ok: true, text, truncated: choice?.finish_reason === "length" }
}
