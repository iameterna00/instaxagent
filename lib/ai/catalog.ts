import type { AiProvider } from "@/lib/types"

// Provider/model catalog. Kept free of any SDK import so the dashboard can
// import it without dragging the Anthropic SDK into the browser bundle.

export interface ModelOption {
  id: string
  label: string
  hint?: string
}

export interface ProviderInfo {
  id: AiProvider
  label: string
  keyPlaceholder: string
  keyUrl: string
  models: ModelOption[]
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Claude",
    keyPlaceholder: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5", hint: "Most capable" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "Balanced" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Fastest, cheapest" },
    ],
  },
  {
    id: "openai",
    label: "ChatGPT",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o", label: "GPT-4o", hint: "Balanced" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", hint: "Fastest, cheapest" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", hint: "General purpose" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", hint: "Slower, thinks first" },
    ],
  },
]

export function defaultModelFor(provider: AiProvider): string {
  return PROVIDERS.find((p) => p.id === provider)?.models[0]?.id ?? "claude-opus-5"
}

export function modelsFor(provider: AiProvider): ModelOption[] {
  return PROVIDERS.find((p) => p.id === provider)?.models ?? []
}

export function isKnownProvider(value: any): value is AiProvider {
  return value === "anthropic" || value === "openai" || value === "deepseek"
}

export const AUDIENCE_OPTIONS: { id: "all" | "followers" | "following" | "mutuals"; label: string; hint: string }[] = [
  { id: "all", label: "Everyone", hint: "Reply to anyone who DMs you" },
  { id: "followers", label: "Followers only", hint: "Only people who follow you" },
  { id: "following", label: "People you follow", hint: "Only accounts you follow" },
  { id: "mutuals", label: "Mutuals only", hint: "You follow each other" },
]
