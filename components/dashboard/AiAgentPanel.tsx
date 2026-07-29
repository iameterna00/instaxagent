"use client"

import { useCallback, useEffect, useState } from "react"
import { Brain, Loader2, Sparkles, Eye, EyeOff, ChevronDown, Play, ExternalLink } from "lucide-react"
import { TagInput } from "@/components/ui/tag-input"
import { AUDIENCE_OPTIONS, PROVIDERS, defaultModelFor, modelsFor } from "@/lib/ai/catalog"
import type { AiProvider, AiSettings, AudienceMode } from "@/lib/types"

interface AiAgentPanelProps {
    userId: string
    onEnabledChange?: (enabled: boolean) => void
}

type Draft = Omit<AiSettings, "user_id" | "api_key"> & { api_key: string }

const EMPTY_DRAFT: Draft = {
    is_enabled: false,
    provider: "anthropic",
    model: "claude-opus-5",
    api_key: "",
    has_api_key: false,
    system_prompt: "",
    audience_mode: "all",
    blocklist: [],
    pause_on_human_reply: true,
    human_takeover_minutes: 60,
    history_limit: 12,
    max_reply_chars: 700,
    reply_delay_seconds: 0,
    typing_indicator: true,
}

const TAKEOVER_CHOICES = [
    { minutes: 30, label: "30 min" },
    { minutes: 60, label: "1 hour" },
    { minutes: 180, label: "3 hours" },
    { minutes: 1440, label: "1 day" },
    { minutes: 0, label: "Until I resume" },
]

const label = "text-[13px] font-medium text-foreground"
const field =
    "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none"

export function AiAgentPanel({ userId, onEnabledChange }: AiAgentPanelProps) {
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const [showKey, setShowKey] = useState(false)
    const [showAdvanced, setShowAdvanced] = useState(false)

    const [testInput, setTestInput] = useState("hey! do you have any openings this week?")
    const [testing, setTesting] = useState(false)
    const [testReply, setTestReply] = useState<string | null>(null)
    const [testError, setTestError] = useState<string | null>(null)

    const patch = (changes: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...changes }))

    useEffect(() => {
        if (!userId) return
        let cancelled = false
        fetch(`/api/ai/settings?userId=${userId}`)
            .then((res) => res.json())
            .then((data) => {
                if (cancelled || data?.error) return
                setDraft({ ...EMPTY_DRAFT, ...data, api_key: "" })
                onEnabledChange?.(Boolean(data.is_enabled))
            })
            .catch(() => setError("Could not load AI settings"))
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
        // onEnabledChange is a callback from the parent; only re-run on userId
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])

    const save = useCallback(
        async (overrides: Partial<Draft> = {}) => {
            setSaving(true)
            setError(null)
            const next = { ...draft, ...overrides }
            try {
                const res = await fetch("/api/ai/settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId,
                        ...next,
                        // An empty box means "leave the stored key alone".
                        api_key: next.api_key.trim() || undefined,
                    }),
                })
                const data = await res.json()
                if (!res.ok) {
                    setError(data?.error || "Could not save")
                    return false
                }
                setDraft({ ...EMPTY_DRAFT, ...data, api_key: "" })
                onEnabledChange?.(Boolean(data.is_enabled))
                setSaved(true)
                setTimeout(() => setSaved(false), 2000)
                return true
            } catch {
                setError("Could not save")
                return false
            } finally {
                setSaving(false)
            }
        },
        [draft, userId, onEnabledChange],
    )

    const runTest = async () => {
        setTesting(true)
        setTestReply(null)
        setTestError(null)
        try {
            const res = await fetch("/api/ai/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, message: testInput }),
            })
            const data = await res.json()
            if (!res.ok) setTestError(data?.error || "Test failed")
            else setTestReply(data.reply)
        } catch {
            setTestError("Test failed")
        } finally {
            setTesting(false)
        }
    }

    if (loading) {
        return (
            <div className="rounded-2xl border border-border bg-card p-8 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            </div>
        )
    }

    const provider = PROVIDERS.find((p) => p.id === draft.provider) ?? PROVIDERS[0]
    const canEnable = draft.has_api_key || draft.api_key.trim().length > 0

    return (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {/* Header + master switch */}
            <div className="p-6 flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                        <Brain className="h-4 w-4" strokeWidth={1.8} />
                    </div>
                    <div>
                        <h2 className="text-sm font-medium text-foreground">AI agent</h2>
                        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                            Answers DMs that none of your rules match. Each person gets their own conversation, with the
                            recent history as context.
                        </p>
                    </div>
                </div>
                {/* Master switch. Deliberately loud — an agent that is saved but
                    switched off looks identical to a broken one. */}
                <div
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                        draft.is_enabled ? "border-border bg-muted" : "border-border bg-background"
                    }`}
                >
                    <div className="text-right">
                        <div
                            className={`text-[13px] font-medium ${
                                draft.is_enabled ? "text-foreground" : "text-muted-foreground"
                            }`}
                        >
                            {draft.is_enabled ? "Agent on" : "Agent off"}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {draft.is_enabled ? "Replying to DMs" : "Not replying"}
                        </div>
                    </div>
                    <button
                        onClick={() => save({ is_enabled: !draft.is_enabled })}
                        disabled={saving || (!draft.is_enabled && !canEnable)}
                        title={!canEnable ? "Add an API key first" : draft.is_enabled ? "Turn the agent off" : "Turn the agent on"}
                        aria-pressed={draft.is_enabled}
                        className={`shrink-0 w-14 h-8 rounded-full transition-colors relative disabled:opacity-40 disabled:cursor-not-allowed ${
                            draft.is_enabled ? "bg-primary" : "bg-muted"
                        }`}
                    >
                        <span
                            className={`absolute top-1 w-6 h-6 rounded-full bg-background flex items-center justify-center transition-transform ${
                                draft.is_enabled ? "translate-x-7" : "translate-x-1"
                            }`}
                        >
                            {saving
                                ? <Loader2 className="w-3 h-3 text-foreground animate-spin" />
                                : <Sparkles className={`w-3 h-3 ${draft.is_enabled ? "text-foreground" : "text-muted-foreground"}`} />}
                        </span>
                    </button>
                </div>
            </div>

            {/* Provider + model + key */}
            <div className="p-6 space-y-4">
                <div>
                    <span className={label}>Provider</span>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                        {PROVIDERS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() =>
                                    patch({ provider: p.id as AiProvider, model: defaultModelFor(p.id as AiProvider) })
                                }
                                className={`h-10 rounded-xl text-sm font-medium transition-colors border ${
                                    draft.provider === p.id
                                        ? "bg-primary text-primary-foreground border-foreground"
                                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <span className={label}>Model</span>
                    <select
                        value={draft.model}
                        onChange={(e) => patch({ model: e.target.value })}
                        className={`${field} mt-2 appearance-none`}
                    >
                        {modelsFor(draft.provider).map((m) => (
                            <option key={m.id} value={m.id} className="bg-card">
                                {m.label}
                                {m.hint ? ` — ${m.hint}` : ""}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <div className="flex items-center justify-between">
                        <span className={label}>{provider.label} API key</span>
                        <a
                            href={provider.keyUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                            Get a key <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>
                    <div className="relative mt-2">
                        <input
                            type={showKey ? "text" : "password"}
                            value={draft.api_key}
                            onChange={(e) => patch({ api_key: e.target.value })}
                            placeholder={draft.has_api_key ? "•••••••••• (saved — type to replace)" : provider.keyPlaceholder}
                            className={`${field} pr-11 font-mono text-xs`}
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                        Your key is stored on your Supabase project and is never sent to the browser. Usage is billed to
                        your own {provider.label} account.
                    </p>
                </div>
            </div>

            {/* Prompt */}
            <div className="p-6 space-y-2">
                <span className={label}>Prompt</span>
                <p className="text-xs text-muted-foreground">
                    Who you are, what you sell, your tone, what to say and what to avoid. The more specific, the better it
                    sounds.
                </p>
                <textarea
                    value={draft.system_prompt}
                    onChange={(e) => patch({ system_prompt: e.target.value })}
                    rows={6}
                    placeholder={`e.g. This is a fitness coaching account. I sell online training programs (₹2999/mo). My tone is motivating but chill — short replies, no corporate speak.

If someone asks about pricing, quote ₹2999/mo and offer a free 15-min consultation call.
If someone asks about refunds or complains, say a real person will follow up and don't promise anything.
Never promise specific results or timelines.`}
                    className={`${field} resize-y leading-relaxed`}
                />
            </div>

            {/* Audience rules */}
            <div className="p-6 space-y-4">
                <div>
                    <span className={label}>Who it replies to</span>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                        {AUDIENCE_OPTIONS.map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => patch({ audience_mode: opt.id as AudienceMode })}
                                className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                                    draft.audience_mode === opt.id
                                        ? "border-foreground/40 bg-muted"
                                        : "border-border hover:border-foreground/30"
                                }`}
                            >
                                <div
                                    className={`text-sm font-medium ${
                                        draft.audience_mode === opt.id ? "text-foreground" : "text-foreground"
                                    }`}
                                >
                                    {opt.label}
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">{opt.hint}</div>
                            </button>
                        ))}
                    </div>
                    {draft.audience_mode !== "all" && (
                        <p className="text-[11px] text-muted-foreground mt-2">
                            If Instagram doesn&apos;t tell us the follow status for someone, the agent stays quiet rather
                            than guessing.
                        </p>
                    )}
                </div>

                <div>
                    <span className={label}>Never reply to</span>
                    <div className="mt-2">
                        <TagInput
                            value={draft.blocklist}
                            onChange={(blocklist) => patch({ blocklist })}
                            placeholder="@username, then Enter"
                        />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                        Usernames or Instagram IDs. These are skipped no matter which audience rule is set.
                    </p>
                </div>
            </div>

            {/* Human takeover */}
            <div className="p-6 space-y-3">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <span className={label}>When you reply yourself</span>
                        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                            Reply from the inbox or the Instagram app and the agent steps back so it doesn&apos;t talk over
                            you.
                        </p>
                    </div>
                    <button
                        onClick={() => patch({ pause_on_human_reply: !draft.pause_on_human_reply })}
                        className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                            draft.pause_on_human_reply ? "bg-primary" : "bg-muted"
                        }`}
                    >
                        <span
                            className={`absolute top-1 w-4 h-4 rounded-full bg-background transition-transform ${
                                draft.pause_on_human_reply ? "translate-x-6" : "translate-x-1"
                            }`}
                        />
                    </button>
                </div>

                {draft.pause_on_human_reply && (
                    <div className="flex flex-wrap gap-2">
                        {TAKEOVER_CHOICES.map((choice) => (
                            <button
                                key={choice.minutes}
                                onClick={() => patch({ human_takeover_minutes: choice.minutes })}
                                className={`px-3 h-8 rounded-lg text-xs font-medium border transition-colors ${
                                    draft.human_takeover_minutes === choice.minutes
                                        ? "bg-muted border-foreground/40 text-foreground"
                                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                                }`}
                            >
                                {choice.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Advanced */}
            <div className="p-6">
                <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                    <span className={label}>Delivery</span>
                </button>

                {showAdvanced && (
                    <div className="grid sm:grid-cols-2 gap-4 mt-4">
                        <div>
                            <span className={label}>Wait before replying</span>
                            <select
                                value={draft.reply_delay_seconds}
                                onChange={(e) => patch({ reply_delay_seconds: Number(e.target.value) })}
                                className={`${field} mt-2 appearance-none`}
                            >
                                {[0, 2, 4, 6, 8].map((s) => (
                                    <option key={s} value={s} className="bg-card">
                                        {s === 0 ? "Reply instantly" : `${s} seconds`}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <span className={label}>Max reply length</span>
                            <select
                                value={draft.max_reply_chars}
                                onChange={(e) => patch({ max_reply_chars: Number(e.target.value) })}
                                className={`${field} mt-2 appearance-none`}
                            >
                                {[300, 500, 700, 1000].map((c) => (
                                    <option key={c} value={c} className="bg-card">
                                        {c} characters
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <span className={label}>History it can see</span>
                            <select
                                value={draft.history_limit}
                                onChange={(e) => patch({ history_limit: Number(e.target.value) })}
                                className={`${field} mt-2 appearance-none`}
                            >
                                {[6, 12, 20, 30].map((n) => (
                                    <option key={n} value={n} className="bg-card">
                                        Last {n} messages
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-end justify-between gap-4 pb-1">
                            <div>
                                <span className={label}>Typing indicator</span>
                                <p className="text-[11px] text-muted-foreground mt-1">Show &ldquo;typing…&rdquo; first</p>
                            </div>
                            <button
                                onClick={() => patch({ typing_indicator: !draft.typing_indicator })}
                                className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                                    draft.typing_indicator ? "bg-primary" : "bg-muted"
                                }`}
                            >
                                <span
                                    className={`absolute top-1 w-4 h-4 rounded-full bg-background transition-transform ${
                                        draft.typing_indicator ? "translate-x-6" : "translate-x-1"
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Test */}
            <div className="p-6 space-y-3">
                <span className={label}>Try it</span>
                <div className="flex gap-2">
                    <input
                        value={testInput}
                        onChange={(e) => setTestInput(e.target.value)}
                        placeholder="Type a DM as if you were a follower…"
                        className={`${field} flex-1`}
                    />
                    <button
                        onClick={runTest}
                        disabled={testing || !draft.has_api_key}
                        title={!draft.has_api_key ? "Save an API key first" : undefined}
                        className="shrink-0 px-4 rounded-xl border border-border text-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 flex items-center gap-2 text-sm"
                    >
                        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Test
                    </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                    Uses your saved settings — save changes first. Nothing is sent to Instagram.
                </p>
                {testReply && (
                    <div className="rounded-xl bg-primary text-primary-foreground px-4 py-3 text-sm max-w-[85%]">{testReply}</div>
                )}
                {testError && <div className="text-xs text-destructive">{testError}</div>}
            </div>

            {/* Save */}
            <div className="p-6 flex items-center justify-between gap-4">
                <div className="text-xs">
                    {error ? (
                        <span className="text-destructive">{error}</span>
                    ) : !draft.is_enabled && canEnable ? (
                        // Saving settings does not switch the agent on — say so, and offer the switch.
                        <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-muted-foreground">
                                {saved ? "Saved, but the agent is still off." : "The agent is off — it won't reply yet."}
                            </span>
                            <button
                                onClick={() => save({ is_enabled: true })}
                                disabled={saving}
                                className="text-foreground underline underline-offset-2 hover:brightness-110 disabled:opacity-50"
                            >
                                Turn it on
                            </button>
                        </span>
                    ) : saved ? (
                        <span className="text-foreground">Saved</span>
                    ) : (
                        <span className="text-muted-foreground">Changes apply to new messages right away.</span>
                    )}
                </div>
                <button
                    onClick={() => save()}
                    disabled={saving}
                    className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    {saving ? "Saving…" : "Save"}
                </button>
            </div>
        </div>
    )
}
