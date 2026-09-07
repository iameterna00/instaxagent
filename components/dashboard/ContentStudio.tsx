"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
    Loader2, Wand2, Copy, Check, Trash2, AlertTriangle, Eye, RotateCcw, ChevronDown, ChevronUp,
    Mic, PenLine,
} from "lucide-react"
import { cacheClear, cacheRead, cacheWrite } from "@/lib/client-cache"
import { archetypeLabel, pillarSpread } from "@/lib/ai/content"
import type { ContentIdea, ContentAnalysis, OwnPost, ScriptBeat } from "@/lib/ai/content"
import type { ScriptLine, ScriptScore, RewriteBeat, ScriptTone } from "@/lib/ai/script"
import type { WriterStructure, WrittenScript } from "@/lib/ai/writer"
import type { AccountSnapshot } from "@/lib/instagram-account"

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

/** A post in a saved plan. `transcribed` is stamped at generate time. */
type EvidencePost = OwnPost & { transcribed?: boolean }

interface ContentPlan {
    id: string
    goal: string
    niche: string | null
    audience: string | null
    formats: string[]
    reference_notes: string | null
    provider: string | null
    model: string | null
    analysis: ContentAnalysis | null
    ideas: ContentIdea[]
    posts: EvidencePost[] | null
    posts_analyzed: number
    account: AccountSnapshot | null
    transcripts_used: number
    created_at: string
}

interface ScriptAnalysis {
    id: string
    script: string
    format: string | null
    model: string | null
    score: number | null
    verdict: string | null
    scores: ScriptScore[]
    lines: ScriptLine[]
    keep: string[]
    fix: string[]
    rewrite: RewriteBeat[]
    rewrite_score: number | null
    rewrite_runtime: string | null
    posts_analyzed: number
    transcripts_used: number
    retention_estimate?: number | null
    created_at: string
}

interface AccessCheck {
    ok: boolean
    reason: string
    postsFound?: number
    reelsFound?: number
    insightsGranted?: boolean
    followersCount?: number
    canTranscribe?: boolean
}

// ------------------------------------------------------------
// Shared styling — the design's type scale, on the app's theme tokens so the
// studio still follows light/dark rather than pinning itself to one palette.
// ------------------------------------------------------------

const EYEBROW = "mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
const MICRO = "mono text-[9.5px] uppercase tracking-[0.1em]"
const CARD = "rounded-2xl border border-border bg-card"
const FIELD =
    "w-full rounded-[9px] border border-border bg-background px-3 py-2.5 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none"

const TONE_TEXT: Record<ScriptTone, string> = {
    good: "text-emerald-500",
    warn: "text-amber-500",
    neutral: "text-muted-foreground",
}
const TONE_BAR: Record<ScriptTone, string> = {
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    neutral: "bg-muted-foreground",
}

function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
    return String(n)
}

/** Fit is a judgement, so the colour has to agree with the number. */
function fitTone(fit: number): ScriptTone {
    if (fit >= 85) return "good"
    if (fit >= 75) return "neutral"
    return "warn"
}

function beatLabel(beat: ScriptBeat, index: number): string {
    return beat.t ?? String(index + 1)
}

/**
 * Rough spoken length for the chips beside the script box. Kept here rather
 * than imported from lib/ai/script so the provider code that module pulls in
 * never reaches the client bundle. ~2.6 words/sec is mid-range for short-form.
 */
function estimateSpokenSeconds(script: string): number {
    return Math.round(script.trim().split(/\s+/).filter(Boolean).length / 2.6)
}

function ideaToText(idea: ContentIdea): string {
    const archetype = archetypeLabel(idea.hook_archetype)
    return [
        idea.title,
        archetype ? `ARCHETYPE: ${archetype}` : "",
        idea.runtime ? `RUNTIME: ${idea.runtime}` : "",
        `HOOK: ${idea.hook}`,
        "",
        "SCRIPT:",
        ...idea.script.map((beat, i) => `${beatLabel(beat, i)}  ${beat.text}`),
        "",
        idea.caption ? `CAPTION:\n${idea.caption}` : "",
        idea.cta ? `\nCTA: ${idea.cta}` : "",
        idea.hashtags?.length ? `\n${idea.hashtags.map(h => `#${h}`).join(" ")}` : "",
    ].filter(Boolean).join("\n")
}

// ------------------------------------------------------------
// Primitives
// ------------------------------------------------------------

function Bar({ pct, tone = "neutral" }: { pct: number; tone?: ScriptTone }) {
    return (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
                className={`h-full rounded-full ${TONE_BAR[tone]}`}
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
        </div>
    )
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
            }}
            className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : label}
        </button>
    )
}

// ------------------------------------------------------------
// Access check
// ------------------------------------------------------------

function AccessCheckCard({
    check, checking, onRun, ranAt,
}: { check: AccessCheck | null; checking: boolean; onRun: () => void; ranAt: Date | null }) {
    const rows = check
        ? [
              {
                  label: "Views & reach readable",
                  value: check.insightsGranted ? "OK" : "off",
                  ok: Boolean(check.insightsGranted),
              },
              {
                  label: "Reels available",
                  value: check.reelsFound !== undefined ? `${check.reelsFound} of ${check.postsFound ?? 0}` : "—",
                  ok: Boolean(check.reelsFound),
              },
              {
                  label: "Follower count visible",
                  value: check.followersCount !== undefined ? check.followersCount.toLocaleString("en-US") : "hidden",
                  ok: check.followersCount !== undefined,
              },
              {
                  label: "Transcription configured",
                  value: check.canTranscribe ? "ready" : "missing",
                  ok: Boolean(check.canTranscribe),
              },
          ]
        : []

    return (
        <div className={`${CARD} flex flex-col gap-3 p-5`}>
            <div className="flex items-center justify-between gap-3">
                <span className={EYEBROW}>Access check</span>
                <button
                    onClick={onRun}
                    disabled={checking}
                    className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                    {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                    {ranAt ? "Re-run" : "Run"}
                </button>
            </div>

            <p className="text-[12px] leading-relaxed text-muted-foreground">
                Verifies Instagram is readable before you spend AI tokens.
            </p>

            {rows.map(row => (
                <div key={row.label} className="flex items-center gap-2.5 border-t border-border py-2">
                    <span className={`w-3.5 text-[12px] ${row.ok ? "text-emerald-500" : "text-amber-500"}`}>
                        {row.ok ? "✓" : "⚠"}
                    </span>
                    <span className="flex-1 text-[13px] text-foreground">{row.label}</span>
                    <span className={`mono text-[11.5px] ${row.ok ? "text-emerald-500" : "text-amber-500"}`}>
                        {row.value}
                    </span>
                </div>
            ))}

            {check && !check.ok && (
                <div className="flex items-start gap-2.5 rounded-[9px] border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                    <span className="text-[12px] leading-relaxed text-muted-foreground">{check.reason}</span>
                </div>
            )}
        </div>
    )
}

// ------------------------------------------------------------
// Pillar check
// ------------------------------------------------------------

function PillarCheck({
    ideas, pillars, onRegenerate,
}: { ideas: ContentIdea[]; pillars: string[]; onRegenerate: () => void }) {
    if (!ideas.length) return null

    const { pillars: distinct, largestShare } = pillarSpread(ideas)
    const tooNarrow = ideas.length >= 3 && (distinct < 3 || largestShare > 0.5)

    const counts = pillars.map(p => ({
        name: p,
        count: ideas.filter(i => i.pillar?.trim().toLowerCase() === p.trim().toLowerCase()).length,
    }))
    const biggest = [...counts].sort((a, b) => b.count - a.count)[0]

    if (!tooNarrow) {
        if (!counts.length) return null
        return (
            <div className={`${CARD} flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4`}>
                <span className={`${MICRO} text-muted-foreground`}>Pillars</span>
                {counts.map(p => (
                    <span key={p.name} className="rounded-lg border border-border bg-background/40 px-2.5 py-1 text-[11px] text-foreground">
                        {p.name}
                        <span className="numeric ml-1.5 text-muted-foreground">{p.count}</span>
                    </span>
                ))}
                <span className="ml-auto text-[11.5px] text-muted-foreground">
                    {distinct} across {ideas.length} idea{ideas.length === 1 ? "" : "s"}
                </span>
            </div>
        )
    }

    return (
        <div className="flex flex-wrap items-start gap-3.5 rounded-2xl border border-amber-500/[0.28] bg-amber-500/[0.07] px-5 py-4">
            <span className={`${MICRO} whitespace-nowrap pt-1 text-amber-500`}>Pillar check</span>
            <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
                <span className="text-[14px] font-semibold text-foreground">
                    {biggest && biggest.count > 1
                        ? `${biggest.count} of ${ideas.length} ideas sit in “${biggest.name}”`
                        : `Only ${distinct} subject${distinct === 1 ? "" : "s"} across ${ideas.length} ideas`}
                </span>
                <span className="text-[13px] leading-relaxed text-muted-foreground">
                    They&apos;d be served to roughly the same viewers, so reach compounds instead of widening.
                    Regenerate, or name the angles you want in the goal box.
                </span>
            </div>
            <button
                onClick={onRegenerate}
                className="whitespace-nowrap rounded-lg border border-border bg-background px-3.5 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted"
            >
                Rebalance
            </button>
        </div>
    )
}

// ------------------------------------------------------------
// Ideas
// ------------------------------------------------------------

function IdeaRow({
    idea, index, open, onToggle,
}: { idea: ContentIdea; index: number; open: boolean; onToggle: () => void }) {
    const archetype = archetypeLabel(idea.hook_archetype)
    const tone = idea.fit !== undefined ? fitTone(idea.fit) : "neutral"

    return (
        <div className="border-b border-border last:border-b-0">
            <button
                onClick={onToggle}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/60"
            >
                <span className="mono w-5 shrink-0 text-[11px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-[15px] font-semibold leading-snug text-foreground">{idea.title}</span>
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
                        <span className="mono rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase text-foreground">
                            {idea.format}
                        </span>
                        {idea.pillar && <span>{idea.pillar}</span>}
                        {archetype && <><span className="opacity-40">·</span><span>{archetype}</span></>}
                        {idea.runtime && <><span className="opacity-40">·</span><span className="mono">{idea.runtime}</span></>}
                    </div>
                </div>

                {idea.fit !== undefined && (
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className={`mono text-[15px] font-semibold ${TONE_TEXT[tone]}`}>{idea.fit}</span>
                        <span className={`${MICRO} text-muted-foreground`}>Fit</span>
                    </div>
                )}

                {open
                    ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>

            {open && (
                <div className="bg-background/40 px-5 pb-5 sm:pl-[54px]">
                    <div className="grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                        {/* Hook, why, script */}
                        <div className="flex min-w-0 flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <span className={`${MICRO} text-muted-foreground`}>
                                    Hook{archetype ? ` · ${archetype}` : ""}
                                </span>
                                <span className="text-[16px] font-semibold leading-snug text-foreground">
                                    “{idea.hook}”
                                </span>
                            </div>

                            {idea.why_it_works && (
                                <div className="flex items-start gap-3 rounded-[10px] border border-border bg-background/60 px-4 py-3">
                                    <span className={`${MICRO} whitespace-nowrap pt-0.5 text-muted-foreground`}>Why it works</span>
                                    <p className="text-[13px] leading-relaxed text-foreground">{idea.why_it_works}</p>
                                </div>
                            )}

                            {idea.script.length > 0 && (
                                <div className="flex flex-col gap-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className={`${MICRO} text-muted-foreground`}>Script · beat by beat</span>
                                        <CopyButton
                                            text={idea.script.map((b, i) => `${beatLabel(b, i)}  ${b.text}`).join("\n")}
                                            label="Copy script"
                                        />
                                    </div>
                                    {idea.script.map((beat, i) => (
                                        <div key={i} className="flex gap-3">
                                            <span className="mono w-10 shrink-0 pt-0.5 text-[11.5px] text-muted-foreground">
                                                {beatLabel(beat, i)}
                                            </span>
                                            <div className="w-px shrink-0 bg-border" />
                                            <span className="text-[13px] leading-relaxed text-foreground">{beat.text}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Caption, CTA, tags */}
                        <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-border lg:pl-6">
                            {idea.caption && (
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className={`${MICRO} text-muted-foreground`}>Caption</span>
                                        <CopyButton text={idea.caption} />
                                    </div>
                                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
                                        {idea.caption}
                                    </p>
                                </div>
                            )}

                            {idea.cta && (
                                <div className="flex flex-col gap-1.5">
                                    <span className={`${MICRO} text-muted-foreground`}>CTA</span>
                                    <span className="text-[13px] leading-relaxed text-foreground">{idea.cta}</span>
                                </div>
                            )}

                            {idea.hashtags && idea.hashtags.length > 0 && (
                                <div className="flex flex-col gap-2">
                                    <span className={`${MICRO} text-muted-foreground`}>Hashtags</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {idea.hashtags.map(tag => (
                                            <span key={tag} className="mono rounded-md border border-border bg-muted px-2 py-1 text-[10.5px] text-muted-foreground">
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="h-px bg-border" />
                            <button
                                onClick={() => navigator.clipboard.writeText(ideaToText(idea))}
                                className="rounded-lg bg-primary px-3 py-2.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                            >
                                Copy whole idea
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ------------------------------------------------------------
// Evidence
// ------------------------------------------------------------

function EvidenceSection({ plan }: { plan: ContentPlan }) {
    const [expanded, setExpanded] = useState(false)
    const posts = plan.posts ?? []
    if (!posts.length && !plan.account) return null

    const ranked = [...posts].sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
    const shown = expanded ? ranked : ranked.slice(0, 5)
    const hasInsights = posts.some(p => p.views !== undefined || p.reach !== undefined)

    const { profile, insights, demographics } = plan.account ?? { profile: {}, insights: undefined, demographics: undefined }

    // Demographics are already percentages of their own group; the bar just
    // shows the share so the reader can compare slices at a glance.
    const slices = (rows?: { key: string; value: number }[], prefix?: string) => {
        if (!rows?.length) return []
        const total = rows.reduce((sum, r) => sum + r.value, 0) || 1
        return rows.slice(0, 2).map(r => ({
            label: prefix ? `${prefix} ${r.key}` : r.key,
            pct: Math.round((r.value / total) * 100),
        }))
    }

    const audience = [
        ...slices(demographics?.age, "Age"),
        ...slices(demographics?.country),
        ...slices(demographics?.gender),
    ].slice(0, 5)

    return (
        <div className={`${CARD} flex flex-col gap-4 p-5 sm:p-6`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className={EYEBROW}>Evidence this plan was built from</span>
                <span className="text-[12px] text-muted-foreground">
                    Snapshot {new Date(plan.created_at).toLocaleString()} · frozen with the plan
                </span>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-2.5">
                    <span className="text-[12.5px] text-muted-foreground">
                        {plan.posts_analyzed} posts read live
                        {plan.transcripts_used > 0 && ` · ${plan.transcripts_used} reels transcribed`}
                    </span>

                    {!hasInsights && posts.length > 0 && (
                        <div className="flex items-start gap-2 text-[11.5px] text-muted-foreground">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                            <span>
                                No view or reach numbers came back, so this plan rests on captions and formats.
                                Add <code className="text-foreground">instagram_business_manage_insights</code> in your
                                Meta app, then reconnect Instagram and regenerate.
                            </span>
                        </div>
                    )}

                    {shown.map((post, i) => {
                        const thumb = post.thumbnail_url || post.media_url
                        const metric = post.views ?? post.reach
                        const title = (post.caption ?? "").split("\n").find(l => l.trim())?.trim() || "(no caption)"
                        return (
                            <a
                                key={post.id ?? i}
                                href={post.permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-3 border-t border-border py-2.5 transition-colors hover:bg-muted/40"
                            >
                                <div className="h-9 w-7 shrink-0 overflow-hidden rounded-[5px] border border-border bg-muted">
                                    {thumb && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                                    )}
                                </div>
                                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{title}</span>
                                {metric !== undefined && (
                                    <span className="mono whitespace-nowrap text-[11.5px] text-muted-foreground">
                                        {compact(metric)} views
                                    </span>
                                )}
                                <span
                                    className={`mono whitespace-nowrap rounded-[5px] border border-border px-1.5 py-0.5 text-[9.5px] uppercase ${
                                        post.transcribed ? "text-emerald-500" : "text-muted-foreground"
                                    }`}
                                >
                                    {post.transcribed ? "Transcribed" : "Caption only"}
                                </span>
                            </a>
                        )
                    })}

                    {ranked.length > 5 && (
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="self-start text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {expanded ? "Show fewer ↑" : `Show all ${ranked.length} posts ↓`}
                        </button>
                    )}
                </div>

                <div className="flex flex-col gap-3.5 lg:border-l lg:border-border lg:pl-6">
                    <span className={`${MICRO} text-muted-foreground`}>Audience snapshot</span>

                    {audience.length > 0 ? (
                        audience.map(row => (
                            <div key={row.label} className="flex flex-col gap-1.5">
                                <div className="flex justify-between text-[12.5px]">
                                    <span className="text-muted-foreground">{row.label}</span>
                                    <span className="mono text-foreground">{row.pct}%</span>
                                </div>
                                <Bar pct={row.pct} />
                            </div>
                        ))
                    ) : (
                        <span className="text-[12px] leading-relaxed text-muted-foreground">
                            No follower demographics were returned for this account.
                        </span>
                    )}

                    <div className="h-px bg-border" />
                    <span className="text-[12px] leading-relaxed text-muted-foreground">
                        {profile?.followers_count !== undefined && `Followers ${profile.followers_count.toLocaleString("en-US")}`}
                        {insights?.reach !== undefined && ` · ${insights.window_days}d reach ${compact(insights.reach)}`}
                        {" · "}Stored so this plan stays interpretable months later.
                    </span>

                    {(plan.account?.notes?.length ?? 0) > 0 && (
                        <div className="flex flex-col gap-1 border-t border-border pt-3">
                            {plan.account!.notes.map((note, i) => (
                                <p key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                    {note}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ------------------------------------------------------------
// Script analysis tab
// ------------------------------------------------------------

const SCRIPT_FORMATS = ["reel", "carousel", "story", "post"]

function ScriptTab({ userId }: { userId: string }) {
    const [script, setScript] = useState("")
    const [format, setFormat] = useState("reel")
    const [running, setRunning] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<ScriptAnalysis | null>(null)

    // Last analysis, so the tab has something to show before a fresh run.
    useEffect(() => {
        if (!userId) return

        const apply = (latest: any) => {
            if (!latest) return
            setResult(latest)
            // Only seed the box while it is untouched — a revalidation landing
            // mid-edit must not overwrite what is being typed.
            setScript(current => current || latest.script || "")
            if (latest.format) setFormat(current => current === "reel" ? latest.format : current)
        }

        apply(cacheRead<any[]>(`script:${userId}`)?.[0])

        fetch(`/api/ai/script?userId=${userId}`)
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) {
                    cacheWrite(`script:${userId}`, data)
                    apply(data[0])
                }
            })
            .catch(() => { /* first run has nothing saved */ })
    }, [userId])

    const words = useMemo(() => script.trim().split(/\s+/).filter(Boolean).length, [script])
    const seconds = useMemo(() => estimateSpokenSeconds(script), [script])

    const analyze = async () => {
        if (!script.trim() || running) return
        setRunning(true)
        setError(null)
        try {
            const res = await fetch("/api/ai/script", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, script, format }),
            })
            const data = await res.json()
            if (!res.ok) setError(data?.error || "Analysis failed")
            else {
                setResult(data)
                cacheClear(`script:${userId}`)
            }
        } catch {
            setError("Analysis failed — check your connection and try again")
        } finally {
            setRunning(false)
        }
    }

    const rewriteText = result?.rewrite
        ?.map(beat => `${beat.t ? `${beat.t}  ` : ""}${beat.text}${beat.dir ? `\n      (${beat.dir})` : ""}`)
        .join("\n") ?? ""

    return (
        <div className="grid items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
            {/* Input */}
            <div className={`${CARD} flex flex-col gap-4 p-5 lg:sticky lg:top-5`}>
                <span className={EYEBROW}>Paste a script</span>

                <textarea
                    value={script}
                    onChange={e => setScript(e.target.value)}
                    rows={14}
                    placeholder="Paste the script you're about to film. Write it the way you'd say it out loud — the timings and the line-by-line read are both based on how it reads as speech."
                    className={`${FIELD} resize-y leading-relaxed`}
                />

                <div className="flex flex-wrap gap-2">
                    <span className="mono rounded-full border border-border bg-muted px-2.5 py-1.5 text-[10.5px] uppercase text-muted-foreground">
                        {words} words
                    </span>
                    <span className="mono rounded-full border border-border bg-muted px-2.5 py-1.5 text-[10.5px] uppercase text-muted-foreground">
                        ~{seconds}s spoken
                    </span>
                    {SCRIPT_FORMATS.map(f => (
                        <button
                            key={f}
                            onClick={() => setFormat(f)}
                            className={`mono rounded-full border px-2.5 py-1.5 text-[10.5px] uppercase transition-colors ${
                                format === f
                                    ? "border-foreground/40 bg-foreground text-background"
                                    : "border-border bg-muted text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>

                <button
                    onClick={analyze}
                    disabled={running || !script.trim()}
                    className="flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {running ? "Analysing…" : "Analyze script"}
                </button>

                {error && <span className="text-[12px] text-destructive">{error}</span>}

                <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                    Scored against your own posts, not a generic rubric. Retention figures are the model&apos;s
                    estimates — Instagram publishes no retention data.
                </span>
            </div>

            {/* Result */}
            {!result ? (
                <div className={`${CARD} flex min-h-[220px] items-center justify-center p-8 text-center`}>
                    <span className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                        Paste a script and run it. You&apos;ll get a score out of 100, where the payoff lands,
                        whether it sounds like you, a line-by-line read, and a rewrite.
                    </span>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {/* Headline */}
                    <div className={`${CARD} flex flex-col gap-4 p-5 sm:p-6`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className={EYEBROW}>Script analysis</span>
                            <div className="flex items-baseline gap-2.5">
                                <span className="mono text-[34px] font-semibold leading-none tracking-tight text-foreground">
                                    {result.score ?? "—"}
                                </span>
                                <span className="text-[13px] text-muted-foreground">
                                    / 100
                                    {result.retention_estimate != null && ` · est. retention ${result.retention_estimate}%`}
                                </span>
                            </div>
                        </div>

                        {result.verdict && (
                            <p className="max-w-[66ch] text-[17px] leading-relaxed tracking-tight text-foreground">
                                {result.verdict}
                            </p>
                        )}

                        {result.scores.length > 0 && (
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                {result.scores.map(score => (
                                    <div key={score.label} className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-4">
                                        <span className={`${MICRO} text-muted-foreground`}>{score.label}</span>
                                        <div className="flex items-baseline gap-1.5">
                                            <span className={`mono text-[22px] font-semibold ${TONE_TEXT[score.tone ?? "neutral"]}`}>
                                                {score.value}
                                            </span>
                                            {score.baseline && (
                                                <span className="text-[11px] text-muted-foreground">{score.baseline}</span>
                                            )}
                                        </div>
                                        {score.pct !== undefined && <Bar pct={score.pct} tone={score.tone ?? "neutral"} />}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Line by line */}
                    {result.lines.length > 0 && (
                        <div className={`${CARD} flex flex-col gap-4 p-5 sm:p-6`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className={EYEBROW}>Line by line · predicted drop-off</span>
                                <span className="mono rounded-md border border-border bg-muted px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
                                    est.
                                </span>
                            </div>

                            {result.lines.map((line, i) => (
                                <div key={i} className="grid gap-4 border-t border-border pt-3 sm:grid-cols-[46px_minmax(0,1fr)_132px]">
                                    <span className="mono pt-0.5 text-[11.5px] text-muted-foreground">{line.t ?? "—"}</span>

                                    <div className="flex min-w-0 flex-col gap-1.5">
                                        <span className="text-[14px] leading-relaxed text-foreground">{line.text}</span>
                                        {line.note && (
                                            <div className="flex items-start gap-2">
                                                <span className={`pt-1.5 text-[8px] ${TONE_TEXT[line.tone ?? "neutral"]}`}>●</span>
                                                <span className="text-[12.5px] leading-relaxed text-muted-foreground">{line.note}</span>
                                            </div>
                                        )}
                                    </div>

                                    {line.retention !== undefined && (
                                        <div className="flex flex-col gap-1.5 pt-0.5">
                                            <div className="mono flex justify-between text-[11px] text-muted-foreground">
                                                <span>est. watching</span>
                                                <span className={TONE_TEXT[line.tone ?? "neutral"]}>{line.retention}%</span>
                                            </div>
                                            <Bar pct={line.retention} tone={line.tone ?? "neutral"} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Keep / Fix */}
                    {(result.keep.length > 0 || result.fix.length > 0) && (
                        <div className="grid gap-4 lg:grid-cols-2">
                            {result.keep.length > 0 && (
                                <div className={`${CARD} flex flex-col gap-3 p-5 sm:p-6`}>
                                    <span className={`${MICRO} text-emerald-500`}>Keep this</span>
                                    {result.keep.map((item, i) => (
                                        <div key={i} className="flex gap-2.5">
                                            <span className="pt-1.5 text-[8px] text-emerald-500">●</span>
                                            <span className="text-[13.5px] leading-relaxed text-muted-foreground">{item}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {result.fix.length > 0 && (
                                <div className={`${CARD} flex flex-col gap-3 p-5 sm:p-6`}>
                                    <span className={`${MICRO} text-amber-500`}>Fix this</span>
                                    {result.fix.map((item, i) => (
                                        <div key={i} className="flex gap-2.5">
                                            <span className="pt-1.5 text-[8px] text-amber-500">●</span>
                                            <span className="text-[13.5px] leading-relaxed text-muted-foreground">{item}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Rewrite */}
                    {result.rewrite.length > 0 && (
                        <div className={`${CARD} flex flex-col gap-4 p-5 sm:p-6`}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className={EYEBROW}>
                                    Rewrite{result.rewrite_runtime ? ` · ${result.rewrite_runtime}` : ""}
                                </span>
                                <div className="flex items-center gap-3">
                                    {result.rewrite_score != null && (
                                        <span className="mono text-[11px] text-emerald-500">
                                            Score {result.rewrite_score}
                                        </span>
                                    )}
                                    <CopyButton text={rewriteText} label="Copy rewrite" />
                                </div>
                            </div>

                            {result.rewrite.map((beat, i) => (
                                <div key={i} className="flex gap-3.5 border-t border-border pt-3">
                                    <span className="mono w-11 shrink-0 pt-0.5 text-[11.5px] text-muted-foreground">
                                        {beat.t ?? String(i + 1)}
                                    </span>
                                    <div className="w-px shrink-0 bg-border" />
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[14px] leading-relaxed text-foreground">{beat.text}</span>
                                        {beat.dir && <span className="text-[12px] text-muted-foreground">{beat.dir}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <span className="px-1 text-[11.5px] text-muted-foreground">
                        Calibrated against {result.posts_analyzed} of your posts
                        {result.transcripts_used > 0 && `, ${result.transcripts_used} transcribed`}
                        {result.model && ` · ${result.model}`}
                    </span>
                </div>
            )}
        </div>
    )
}

// ------------------------------------------------------------
// Script writer tab
//
// The transcript list below is not decoration: it is ordered best performing
// first, and that is the exact order the prompt weights by. What the owner
// reads here is what the model writes from, so the ranking is shown rather
// than hidden behind the button.
// ------------------------------------------------------------

interface LibraryItem {
    rank: number
    media_id: string
    title: string
    permalink?: string
    thumbnail_url?: string
    timestamp?: string
    views?: number
    reach?: number
    like_count?: number
    comments_count?: number
    transcript: string
    duration_seconds?: number
    words: number
    pace?: number
    error?: string
    transcribed: boolean
}

interface GeneratedScript {
    id: string
    topic: string | null
    format: string | null
    model: string | null
    structure: WriterStructure | null
    script: WrittenScript | null
    modeled_on: string[] | null
    notes: string[] | null
    transcripts_used: number
    posts_analyzed: number
    created_at: string
}

interface WriterLibrary {
    library: LibraryItem[]
    scripts: GeneratedScript[]
    transcribed: number
    /** Reels whose last transcription attempt failed and was cached. */
    failed: number
    reelsTotal: number
    canTranscribe: boolean
    connected: boolean
}

function mmss(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}

/**
 * Transcripts are stored as `[12.5] line` per segment, or as one flat paragraph
 * for rows cached before timestamps were kept. Both have to read well, so the
 * mark is pulled into its own column when it's there and the line stands alone
 * when it isn't.
 */
function transcriptLines(text: string): { t?: string; text: string }[] {
    return text
        .split("\n")
        .map(line => {
            const match = line.match(/^\[(\d+(?:\.\d+)?)\]\s*(.*)$/)
            return match ? { t: mmss(Number(match[1])), text: match[2] } : { text: line }
        })
        .filter(line => line.text.trim().length > 0)
}

/**
 * The spoken script as plain paragraphs. Scripts saved before the writer went
 * plain-text carry `t` timestamps and `dir` stage directions on each beat;
 * those are dropped here so an old script reads the same as a new one.
 */
function scriptParagraphs(script: WrittenScript): string[] {
    return (script.beats ?? [])
        .map(beat => (beat.text ?? "").trim())
        .filter(Boolean)
}

/**
 * The generated script as one plain block. Kept here rather than imported from
 * lib/ai/writer so the provider code that module pulls in never reaches the
 * client bundle.
 */
function writtenScriptToText(script: WrittenScript): string {
    return [
        script.title,
        "",
        scriptParagraphs(script).join("\n\n"),
        "",
        script.caption ? `CAPTION:\n${script.caption}` : "",
        script.cta ? `\nCTA: ${script.cta}` : "",
        script.hashtags?.length ? `\n${script.hashtags.map(h => `#${h}`).join(" ")}` : "",
    ].filter(Boolean).join("\n")
}

function TranscriptRow({ item, open, onToggle, onTranscribe, busy, canTranscribe }: {
    item: LibraryItem
    open: boolean
    onToggle: () => void
    onTranscribe: (mediaId: string) => void
    busy: boolean
    canTranscribe: boolean
}) {
    const metric = item.views ?? item.reach
    const lines = useMemo(
        () => (item.transcript ? transcriptLines(item.transcript) : []),
        [item.transcript],
    )

    // A failed row can be opened too — otherwise the reason it failed is
    // written into the panel that can never be expanded.
    const expandable = item.transcribed || Boolean(item.error)

    return (
        <div className="border-b border-border last:border-b-0">
            <div className="flex items-center">
                <button
                    onClick={onToggle}
                    disabled={!expandable}
                    className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3.5 text-left transition-colors enabled:hover:bg-muted/60 disabled:cursor-default"
                >
                    <span className={`mono w-6 shrink-0 text-[12px] ${item.rank <= 3 ? "text-foreground" : "text-muted-foreground"}`}>
                        {String(item.rank).padStart(2, "0")}
                    </span>

                    <div className="h-9 w-7 shrink-0 overflow-hidden rounded-[5px] border border-border bg-muted">
                        {item.thumbnail_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-[13.5px] text-foreground">{item.title}</span>
                        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                            {item.rank <= 3 && item.transcribed && (
                                <span className="mono rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[9.5px] uppercase text-emerald-500">
                                    Primary template
                                </span>
                            )}
                            {item.timestamp && <span>{new Date(item.timestamp).toLocaleDateString()}</span>}
                            {item.words > 0 && <><span className="opacity-40">·</span><span className="mono">{item.words} words</span></>}
                            {item.duration_seconds && (
                                <><span className="opacity-40">·</span><span className="mono">{Math.round(item.duration_seconds)}s</span></>
                            )}
                            {item.pace && (
                                <><span className="opacity-40">·</span><span className="mono">{item.pace} w/s</span></>
                            )}
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="mono text-[13px] text-foreground">
                            {metric !== undefined ? compact(metric) : "—"}
                        </span>
                        <span className={`${MICRO} text-muted-foreground`}>
                            {item.views !== undefined ? "Views" : item.reach !== undefined ? "Reach" : "No data"}
                        </span>
                    </div>

                    {item.transcribed ? (
                        open
                            ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                            : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                        <span className="mono whitespace-nowrap rounded-[5px] border border-border px-1.5 py-0.5 text-[9.5px] uppercase text-amber-500">
                            {item.error ? "Failed" : "Not transcribed"}
                        </span>
                    )}
                </button>

                {/* Transcribe this one reel. It sits outside the row button
                    because a button cannot be nested inside another button. */}
                {!item.transcribed && (
                    <button
                        onClick={() => onTranscribe(item.media_id)}
                        disabled={busy || !canTranscribe}
                        title={
                            canTranscribe
                                ? item.error
                                    ? "Try transcribing this reel again"
                                    : "Transcribe this reel"
                                : "Add a Groq or OpenAI transcription key under Automations → AI Agent"
                        }
                        className="mr-5 flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3 w-3" />}
                        {busy ? "Transcribing…" : item.error ? "Retry" : "Transcribe"}
                    </button>
                )}
            </div>

            {open && item.transcribed && (
                <div className="flex flex-col gap-2.5 bg-background/40 px-5 pb-5 pt-1 sm:pl-[74px]">
                    <div className="flex items-center justify-between">
                        <span className={`${MICRO} text-muted-foreground`}>
                            Spoken word for word{item.pace ? ` · ${item.pace} words/sec` : ""}
                        </span>
                        <div className="flex items-center gap-3">
                            {item.permalink && (
                                <a
                                    href={item.permalink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    Open reel ↗
                                </a>
                            )}
                            <CopyButton text={item.transcript} label="Copy transcript" />
                        </div>
                    </div>

                    {lines.map((line, i) => (
                        <div key={i} className="flex gap-3">
                            <span className="mono w-10 shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                                {line.t ?? ""}
                            </span>
                            <span className="text-[13px] leading-relaxed text-foreground">{line.text}</span>
                        </div>
                    ))}
                </div>
            )}

            {open && !item.transcribed && item.error && (
                <div className="px-5 pb-4 text-[12px] text-muted-foreground sm:pl-[74px]">{item.error}</div>
            )}
        </div>
    )
}

function TranscriptLibrary({ items, loading, onTranscribe, busyId, canTranscribe }: {
    items: LibraryItem[]
    loading: boolean
    onTranscribe: (mediaId: string) => void
    busyId: string | null
    canTranscribe: boolean
}) {
    const [open, setOpen] = useState<string | null>(null)
    const [limit, setLimit] = useState(10)

    if (loading) {
        return (
            <div className={`${CARD} flex min-h-[140px] items-center justify-center gap-2 p-8`}>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-[13px] text-muted-foreground">Reading your reels…</span>
            </div>
        )
    }

    if (!items.length) {
        return (
            <div className={`${CARD} flex min-h-[140px] items-center justify-center p-8 text-center`}>
                <span className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
                    No reels came back from Instagram, so there is nothing to learn a format from.
                    Connect Instagram and post a reel, then transcribe it here.
                </span>
            </div>
        )
    }

    const shown = items.slice(0, limit)

    return (
        <div className={`${CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-5 py-3.5">
                <span className={EYEBROW}>Your transcripts · best performing first</span>
                <span className="text-[12px] text-muted-foreground">
                    The top three are weighted hardest when writing
                </span>
            </div>

            {shown.map(item => (
                <TranscriptRow
                    key={item.media_id}
                    item={item}
                    open={open === item.media_id}
                    onToggle={() => setOpen(open === item.media_id ? null : item.media_id)}
                    onTranscribe={onTranscribe}
                    busy={busyId === item.media_id}
                    canTranscribe={canTranscribe}
                />
            ))}

            <div className="flex items-center justify-between px-5 py-3.5 text-[12.5px] text-muted-foreground">
                <span>{shown.length} of {items.length} reels shown</span>
                {limit < items.length && (
                    <button onClick={() => setLimit(items.length)} className="text-foreground hover:underline">
                        Show all ↓
                    </button>
                )}
            </div>
        </div>
    )
}

function StructureCard({ structure }: { structure: WriterStructure }) {
    const steps = structure.steps ?? []
    const voice = structure.voice ?? []
    if (!steps.length && !voice.length && !structure.summary) return null

    return (
        <div className={`${CARD} flex flex-col gap-4 p-5 sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={EYEBROW}>The format it copied</span>
                {structure.pacing && (
                    <span className="mono text-[11.5px] text-muted-foreground">{structure.pacing}</span>
                )}
            </div>

            {structure.summary && (
                <p className="max-w-[70ch] text-[14px] leading-relaxed text-foreground">{structure.summary}</p>
            )}

            {steps.map((step, i) => (
                <div key={i} className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[132px_minmax(0,1fr)]">
                    <div className="flex flex-col gap-0.5">
                        <span className="mono text-[11px] uppercase tracking-[0.08em] text-foreground">{step.label}</span>
                        {step.t && <span className="mono text-[11px] text-muted-foreground">{step.t}</span>}
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-[13.5px] leading-relaxed text-muted-foreground">{step.purpose}</span>
                        {step.evidence && (
                            <span className="border-l border-border pl-3 text-[12.5px] leading-relaxed text-muted-foreground/80">
                                {step.evidence}
                            </span>
                        )}
                    </div>
                </div>
            ))}

            {voice.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-3.5">
                    <span className={`${MICRO} text-muted-foreground`}>How you actually talk</span>
                    {voice.map((rule, i) => (
                        <div key={i} className="flex gap-2.5">
                            <span className="pt-1.5 text-[8px] text-muted-foreground">●</span>
                            <span className="text-[13px] leading-relaxed text-muted-foreground">{rule}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function WrittenScriptCard({ entry }: { entry: GeneratedScript }) {
    const script = entry.script
    if (!script) return null

    const paragraphs = scriptParagraphs(script)

    return (
        <div className="flex flex-col gap-4">
            <div className={`${CARD} flex flex-col gap-4 p-5 sm:p-6`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                        <span className={EYEBROW}>Your next script</span>
                        {script.title && (
                            <span className="text-[19px] font-semibold tracking-tight text-foreground">
                                {script.title}
                            </span>
                        )}
                        {script.topic && (
                            <span className="text-[12.5px] text-muted-foreground">{script.topic}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {script.runtime && (
                            <span className="mono rounded-full border border-border bg-muted px-2.5 py-1.5 text-[10.5px] uppercase text-muted-foreground">
                                {script.runtime}
                            </span>
                        )}
                        <CopyButton text={writtenScriptToText(script)} label="Copy script" />
                    </div>
                </div>

                {script.hook && (
                    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-background/50 px-4 py-3.5">
                        <span className={`${MICRO} text-muted-foreground`}>Hook · first line out of your mouth</span>
                        <span className="text-[17px] font-semibold leading-snug text-foreground">“{script.hook}”</span>
                    </div>
                )}

                {/* The script itself: what you say, as prose. No timestamps and
                    no on-screen directions — those live in the format card below. */}
                {paragraphs.length > 0 && (
                    <div className="flex flex-col gap-3.5 border-t border-border pt-4">
                        {paragraphs.map((paragraph, i) => (
                            <p
                                key={i}
                                className="max-w-[68ch] whitespace-pre-line text-[15px] leading-[1.7] text-foreground"
                            >
                                {paragraph}
                            </p>
                        ))}
                    </div>
                )}

                {(script.caption || script.cta || script.hashtags?.length) && (
                    <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                        {script.caption && (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <span className={`${MICRO} text-muted-foreground`}>Caption</span>
                                    <CopyButton text={script.caption} />
                                </div>
                                <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
                                    {script.caption}
                                </p>
                            </div>
                        )}
                        <div className="flex flex-col gap-3 lg:border-l lg:border-border lg:pl-6">
                            {script.cta && (
                                <div className="flex flex-col gap-1.5">
                                    <span className={`${MICRO} text-muted-foreground`}>CTA</span>
                                    <span className="text-[13px] leading-relaxed text-foreground">{script.cta}</span>
                                </div>
                            )}
                            {script.hashtags?.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {script.hashtags.map(tag => (
                                        <span key={tag} className="mono rounded-md border border-border bg-muted px-2 py-1 text-[10.5px] text-muted-foreground">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {entry.structure && <StructureCard structure={entry.structure} />}

            {(entry.modeled_on?.length || entry.notes?.length) && (
                <div className="grid gap-4 lg:grid-cols-2">
                    {entry.modeled_on && entry.modeled_on.length > 0 && (
                        <div className={`${CARD} flex flex-col gap-3 p-5 sm:p-6`}>
                            <span className={`${MICRO} text-muted-foreground`}>Modelled on</span>
                            {entry.modeled_on.map((item, i) => (
                                <div key={i} className="flex gap-2.5">
                                    <span className="mono pt-0.5 text-[10px] text-muted-foreground">{i + 1}</span>
                                    <span className="text-[13px] leading-relaxed text-muted-foreground">{item}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {entry.notes && entry.notes.length > 0 && (
                        <div className={`${CARD} flex flex-col gap-3 p-5 sm:p-6`}>
                            <span className={`${MICRO} text-amber-500`}>Worth knowing</span>
                            {entry.notes.map((note, i) => (
                                <div key={i} className="flex gap-2.5">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                                    <span className="text-[13px] leading-relaxed text-muted-foreground">{note}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <span className="px-1 text-[11.5px] text-muted-foreground">
                Written from {entry.transcripts_used} transcript{entry.transcripts_used === 1 ? "" : "s"} of your own reels
                {entry.posts_analyzed > 0 && ` across ${entry.posts_analyzed} posts`}
                {entry.model && ` · ${entry.model}`}
                {" · "}{new Date(entry.created_at).toLocaleString()}
            </span>
        </div>
    )
}

function WriterTab({ userId, openScript, onScriptsChanged }: {
    userId: string
    /** A script picked in the History tab, opened here. */
    openScript?: GeneratedScript | null
    onScriptsChanged?: () => void
}) {
    // This panel's GET builds the reference library from Instagram, so it is
    // the slowest read in the studio and the one whose spinner was most felt on
    // every return to the tab. Mount from the cache when there is one.
    const cacheKey = `writer:${userId}`
    const [topic, setTopic] = useState("")
    const [format, setFormat] = useState("reel")
    const [data, setData] = useState<WriterLibrary | null>(() => cacheRead<WriterLibrary>(cacheKey) ?? null)
    const [loading, setLoading] = useState(() => !cacheRead(cacheKey))
    const [writing, setWriting] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [transcribingId, setTranscribingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [note, setNote] = useState<string | null>(null)
    const [current, setCurrent] = useState<GeneratedScript | null>(openScript ?? null)

    const load = useCallback(async () => {
        if (!userId) return
        // A revalidation behind cached content must not blank the panel — only
        // a cold mount has nothing to show while it waits.
        if (!cacheRead(`writer:${userId}`)) setLoading(true)
        try {
            const res = await fetch(`/api/ai/writer?userId=${userId}`)
            const body = await res.json()
            if (!res.ok) setError(body?.error || "Could not read your transcripts")
            else {
                cacheWrite(`writer:${userId}`, body)
                setData(body)
                // Show the last script on arrival rather than an empty panel.
                setCurrent(existing => existing ?? body.scripts?.[0] ?? null)
            }
        } catch {
            setError("Could not reach the server")
        } finally {
            setLoading(false)
        }
    }, [userId])

    useEffect(() => { load() }, [load])

    // Opening a script from History selects it here.
    useEffect(() => { if (openScript) setCurrent(openScript) }, [openScript])

    const write = async () => {
        if (writing) return
        setWriting(true)
        setError(null)
        setNote(null)
        try {
            const res = await fetch("/api/ai/writer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, topic, format }),
            })
            const body = await res.json()
            if (!res.ok) setError(body?.error || "Could not write the script")
            else {
                setCurrent(body)
                setData(prev => {
                    const next = prev ? { ...prev, scripts: [body, ...prev.scripts] } : prev
                    // Keep the cache level with the panel, or coming back to the
                    // tab would show a library missing the script just written.
                    if (next) cacheWrite(`writer:${userId}`, next)
                    return next
                })
                // It is saved server-side; tell History so it shows up there too.
                onScriptsChanged?.()
            }
        } catch {
            setError("Could not write the script — check your connection and try again")
        } finally {
            setWriting(false)
        }
    }

    /** `mediaIds` transcribes exactly those reels; omitted means "the next batch". */
    const runTranscription = async (mediaIds?: string[]) => {
        if (transcribing || transcribingId) return
        if (mediaIds?.length) setTranscribingId(mediaIds[0])
        else setTranscribing(true)
        setError(null)
        setNote(null)
        try {
            const res = await fetch("/api/ai/writer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, mode: "transcribe", mediaIds }),
            })
            const body = await res.json()
            if (!res.ok) setError(body?.error || "Transcription failed")
            else {
                const done = body.transcribedNow ?? 0
                setNote(
                    done > 0
                        ? `Transcribed ${done} reel${done === 1 ? "" : "s"}.` +
                          (body.missing ? ` ${body.missing} still to go.` : "")
                        // No work done is worth explaining precisely — "nothing to
                        // transcribe" next to a list of untranscribed reels is what
                        // made this button look broken.
                        : body.notes?.[0] ||
                          (mediaIds?.length
                              ? "That reel could not be transcribed — Instagram returned no downloadable video for it."
                              : "Nothing new to transcribe."),
                )
                await load()
            }
        } catch {
            setError("Transcription failed — check your connection and try again")
        } finally {
            setTranscribing(false)
            setTranscribingId(null)
        }
    }

    const transcribe = () => runTranscription()
    const transcribeOne = (mediaId: string) => runTranscription([mediaId])

    const remove = async (id: string) => {
        await fetch(`/api/ai/writer?id=${id}`, { method: "DELETE" })
        setData(prev => {
            const next = prev ? { ...prev, scripts: prev.scripts.filter(s => s.id !== id) } : prev
            if (next) cacheWrite(`writer:${userId}`, next)
            return next
        })
        setCurrent(prev => (prev?.id === id ? null : prev))
        onScriptsChanged?.()
    }

    const library = data?.library ?? []
    const transcribed = data?.transcribed ?? 0
    const failed = data?.failed ?? 0
    const missing = Math.max(0, (data?.reelsTotal ?? 0) - transcribed)
    const saved = data?.scripts ?? []

    return (
        <div className="flex flex-col gap-4">
            <div className="grid items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
                {/* Controls */}
                <div className="flex flex-col gap-3.5 lg:sticky lg:top-5">
                    <div className={`${CARD} flex flex-col gap-4 p-5`}>
                        <span className={EYEBROW}>Next topic</span>

                        <textarea
                            value={topic}
                            onChange={e => setTopic(e.target.value)}
                            rows={3}
                            placeholder="Why most editors quit at 10K followers — leave blank and I'll pick a topic that fits what already works for you."
                            className={`${FIELD} resize-y leading-relaxed`}
                        />

                        <div className="flex flex-wrap gap-2">
                            {SCRIPT_FORMATS.map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFormat(f)}
                                    className={`mono rounded-full border px-2.5 py-1.5 text-[10.5px] uppercase transition-colors ${
                                        format === f
                                            ? "border-foreground/40 bg-foreground text-background"
                                            : "border-border bg-muted text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={write}
                            disabled={writing}
                            className="flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                            {writing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                            {writing ? "Writing…" : "Generate my next script"}
                        </button>

                        {error && <span className="text-[12px] text-destructive">{error}</span>}
                        {writing && (
                            <span className="text-[11.5px] text-muted-foreground">
                                Reading your transcripts, pulling out the format, then writing to it — usually 40–90 seconds.
                            </span>
                        )}

                        <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                            The model doesn&apos;t invent a style. It reads the reels below in performance order,
                            extracts the structure and delivery of your best ones, and refills that shape with the
                            new topic.
                        </span>
                    </div>

                    {/* Transcript coverage */}
                    <div className={`${CARD} flex flex-col gap-3 p-5`}>
                        <div className="flex items-center justify-between gap-3">
                            <span className={EYEBROW}>Reference library</span>
                            <span className="mono text-[11.5px] text-muted-foreground">
                                {transcribed} / {data?.reelsTotal ?? 0}
                            </span>
                        </div>

                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                            {transcribed === 0
                                ? "Nothing transcribed yet — without transcripts the writer has never heard you speak and can only work from captions."
                                : `${transcribed} of your reels are transcribed word for word. The more of your winners are in here, the closer the script sounds to you.`}
                        </p>

                        {missing > 0 && (
                            <button
                                onClick={transcribe}
                                disabled={transcribing || Boolean(transcribingId) || !data?.canTranscribe}
                                className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3.5 py-2.5 text-[12.5px] text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                            >
                                {transcribing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
                                {transcribing
                                    ? "Transcribing…"
                                    : failed >= missing
                                        ? `Retry ${Math.min(missing, 8)} failed`
                                        : `Transcribe ${Math.min(missing, 8)} more`}
                            </button>
                        )}

                        {failed > 0 && (
                            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                                {failed} reel{failed === 1 ? "" : "s"} failed before — open one in the list below to
                                see why, or transcribe it on its own row.
                            </span>
                        )}

                        {data && !data.canTranscribe && (
                            <span className="text-[11.5px] leading-relaxed text-amber-500">
                                No transcription key — add a Groq or OpenAI key under Automations → AI Agent.
                            </span>
                        )}
                        {note && <span className="text-[11.5px] leading-relaxed text-muted-foreground">{note}</span>}
                    </div>

                    {/* Past scripts */}
                    {saved.length > 0 && (
                        <div className={`${CARD} overflow-hidden`}>
                            <div className="border-b border-border bg-muted/40 px-5 py-3">
                                <span className={EYEBROW}>Written so far</span>
                            </div>
                            {saved.slice(0, 8).map(item => (
                                <div
                                    key={item.id}
                                    onClick={() => setCurrent(item)}
                                    className={`flex cursor-pointer items-center gap-3 border-b border-border px-5 py-3 transition-colors last:border-b-0 hover:bg-muted/60 ${
                                        current?.id === item.id ? "bg-muted/40" : ""
                                    }`}
                                >
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate text-[13px] text-foreground">
                                            {item.script?.title || item.topic || "Untitled script"}
                                        </span>
                                        <span className="text-[11.5px] text-muted-foreground">
                                            {new Date(item.created_at).toLocaleDateString()} · {item.transcripts_used} transcripts
                                        </span>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); remove(item.id) }}
                                        title="Delete"
                                        className="text-muted-foreground transition-colors hover:text-destructive"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Output */}
                {current ? (
                    <WrittenScriptCard entry={current} />
                ) : (
                    <div className={`${CARD} flex min-h-[220px] items-center justify-center p-8 text-center`}>
                        <span className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                            Type a topic and generate. You&apos;ll get the script, plus the beat template and
                            delivery rules it copied from your own best reels — so you can check it followed your
                            format rather than a generic one.
                        </span>
                    </div>
                )}
            </div>

            <TranscriptLibrary
                items={library}
                loading={loading && !data}
                onTranscribe={transcribeOne}
                busyId={transcribingId}
                canTranscribe={Boolean(data?.canTranscribe)}
            />
        </div>
    )
}

// ------------------------------------------------------------
// History tab
// ------------------------------------------------------------

/** Saved scripts, newest first. Clicking one opens it in the Script writer. */
function ScriptHistory({
    scripts, onOpen, onDelete,
}: {
    scripts: GeneratedScript[]
    onOpen: (script: GeneratedScript) => void
    onDelete: (id: string) => void
}) {
    const [limit, setLimit] = useState(8)

    if (!scripts.length) {
        return (
            <div className={`${CARD} flex min-h-[120px] items-center justify-center p-8`}>
                <span className="text-[13px] text-muted-foreground">
                    No scripts yet — write one in Script writer and it&apos;ll be saved here.
                </span>
            </div>
        )
    }

    const GRID = "grid gap-3.5 grid-cols-[46px_minmax(0,1fr)_110px] md:grid-cols-[46px_minmax(0,1fr)_110px_90px_150px]"
    const shown = scripts.slice(0, limit)

    return (
        <div className={`${CARD} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3.5">
                <span className={EYEBROW}>Scripts written · last 20</span>
                <span className="text-[12px] text-muted-foreground">Open one to read it in the writer</span>
            </div>

            <div className={`${GRID} ${MICRO} items-center border-b border-border px-5 py-3 text-muted-foreground`}>
                <span>Script</span>
                <span>Title</span>
                <span className="hidden md:block">Format</span>
                <span className="hidden md:block">Transcripts</span>
                <span className="text-right">Written</span>
            </div>

            {shown.map((item, i) => (
                <div
                    key={item.id}
                    onClick={() => onOpen(item)}
                    className={`${GRID} cursor-pointer items-center border-b border-border px-5 py-3.5 transition-colors last:border-b-0 hover:bg-muted/60`}
                >
                    <span className={`mono text-[12.5px] ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                        #{scripts.length - i}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[13.5px] text-foreground">
                            {item.script?.title || item.topic || "Untitled script"}
                        </span>
                        {item.script?.hook && (
                            <span className="truncate text-[12px] text-muted-foreground">{item.script.hook}</span>
                        )}
                    </div>
                    <span className="mono hidden truncate text-[12.5px] uppercase text-muted-foreground md:block">
                        {item.format || "reel"}
                    </span>
                    <span className="mono hidden text-[12.5px] text-muted-foreground md:block">
                        {item.transcripts_used}
                    </span>
                    <div className="flex items-center justify-end gap-3">
                        <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">
                            {new Date(item.created_at).toLocaleDateString()}
                        </span>
                        <button
                            onClick={(e) => { e.stopPropagation(); onOpen(item) }}
                            title="Open this script"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(item.id) }}
                            title="Delete"
                            className="text-muted-foreground transition-colors hover:text-destructive"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            ))}

            <div className="flex items-center justify-between px-5 py-3.5 text-[12.5px] text-muted-foreground">
                <span>{shown.length} of {scripts.length} scripts shown</span>
                {limit < scripts.length && (
                    <button onClick={() => setLimit(scripts.length)} className="text-foreground hover:underline">
                        Load more ↓
                    </button>
                )}
            </div>
        </div>
    )
}

function PlanHistory({
    history, onOpen, onDelete,
}: { history: ContentPlan[]; onOpen: (plan: ContentPlan) => void; onDelete: (id: string) => void }) {
    const [limit, setLimit] = useState(8)

    if (!history.length) {
        return (
            <div className={`${CARD} flex min-h-[120px] items-center justify-center p-8`}>
                <span className="text-[13px] text-muted-foreground">
                    No saved plans yet — generate one and it&apos;ll appear here.
                </span>
            </div>
        )
    }

    const GRID = "grid gap-3.5 grid-cols-[46px_minmax(0,1fr)_110px] md:grid-cols-[46px_minmax(0,1fr)_150px_80px_80px_150px]"
    const shown = history.slice(0, limit)

    return (
        <div className={`${CARD} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3.5">
                <span className={EYEBROW}>Saved plans · last 20</span>
                <span className="text-[12px] text-muted-foreground">Older plans are dropped automatically</span>
            </div>

            <div className={`${GRID} ${MICRO} items-center border-b border-border px-5 py-3 text-muted-foreground`}>
                <span>Plan</span>
                <span>Goal</span>
                <span className="hidden md:block">Pillars</span>
                <span className="hidden md:block">Ideas</span>
                <span className="hidden md:block">Posts</span>
                <span className="text-right">Generated</span>
            </div>

            {shown.map((item, i) => (
                <div
                    key={item.id}
                    onClick={() => onOpen(item)}
                    className={`${GRID} cursor-pointer items-center border-b border-border px-5 py-3.5 transition-colors last:border-b-0 hover:bg-muted/60`}
                >
                    <span className={`mono text-[12.5px] ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                        #{history.length - i}
                    </span>
                    <span className="min-w-0 truncate text-[13.5px] text-foreground">{item.goal}</span>
                    <span className="hidden min-w-0 truncate text-[12.5px] text-muted-foreground md:block">
                        {item.analysis?.pillars?.join(", ") || "—"}
                    </span>
                    <span className="mono hidden text-[12.5px] text-muted-foreground md:block">
                        {item.ideas?.length ?? 0}
                    </span>
                    <span className="mono hidden text-[12.5px] text-muted-foreground md:block">
                        {item.posts_analyzed}
                    </span>
                    <div className="flex items-center justify-end gap-3">
                        <span className="whitespace-nowrap text-[12.5px] text-muted-foreground">
                            {new Date(item.created_at).toLocaleDateString()}
                        </span>
                        <button
                            onClick={(e) => { e.stopPropagation(); onOpen(item) }}
                            title="Open this plan"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(item.id) }}
                            title="Delete"
                            className="text-muted-foreground transition-colors hover:text-destructive"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            ))}

            <div className="flex items-center justify-between px-5 py-3.5 text-[12.5px] text-muted-foreground">
                <span>{shown.length} of {history.length} plans shown</span>
                {limit < history.length && (
                    <button onClick={() => setLimit(history.length)} className="text-foreground hover:underline">
                        Load more ↓
                    </button>
                )}
            </div>
        </div>
    )
}

/**
 * Everything the studio has produced: idea plans and written scripts. Both are
 * saved server-side, so this is the one place to find work from an earlier
 * session regardless of which tab made it.
 */
function HistoryTab({
    history, scripts, onOpen, onDelete, onOpenScript, onDeleteScript,
}: {
    history: ContentPlan[]
    scripts: GeneratedScript[]
    onOpen: (plan: ContentPlan) => void
    onDelete: (id: string) => void
    onOpenScript: (script: GeneratedScript) => void
    onDeleteScript: (id: string) => void
}) {
    const [section, setSection] = useState<"plans" | "scripts">("plans")

    const TAB = "rounded-[7px] px-3 py-1.5 text-[12.5px] transition-colors"

    return (
        <div className="flex flex-col gap-4">
            <div className="flex gap-1 self-start rounded-[9px] border border-border bg-card p-1">
                {([
                    ["plans", `Idea plans (${history.length})`],
                    ["scripts", `Scripts (${scripts.length})`],
                ] as ["plans" | "scripts", string][]).map(([id, name]) => (
                    <button
                        key={id}
                        onClick={() => setSection(id)}
                        className={`${TAB} ${
                            section === id
                                ? "bg-foreground font-semibold text-background"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {name}
                    </button>
                ))}
            </div>

            {section === "plans" ? (
                <PlanHistory history={history} onOpen={onOpen} onDelete={onDelete} />
            ) : (
                <ScriptHistory scripts={scripts} onOpen={onOpenScript} onDelete={onDeleteScript} />
            )}
        </div>
    )
}

// ------------------------------------------------------------
// Root
// ------------------------------------------------------------

const FORMATS = ["reel", "carousel", "story", "post"]
type Tab = "generate" | "writer" | "script" | "history"

export function ContentStudio({ userId }: { userId: string }) {
    const [tab, setTab] = useState<Tab>("generate")

    const [goal, setGoal] = useState("")
    const [niche, setNiche] = useState("")
    const [audience, setAudience] = useState("")
    const [formats, setFormats] = useState<string[]>(["reel"])
    const [ideaCount, setIdeaCount] = useState(6)
    const [referenceNotes, setReferenceNotes] = useState("")

    const [generating, setGenerating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [checking, setChecking] = useState(false)
    const [check, setCheck] = useState<AccessCheck | null>(null)
    const [checkedAt, setCheckedAt] = useState<Date | null>(null)

    // Seeded from the cache so re-entering the studio opens on the last plan
    // instead of an empty shell that fills in a moment later.
    const cachedPlans = cacheRead<ContentPlan[]>(`content:${userId}`)
    const [plan, setPlan] = useState<ContentPlan | null>(cachedPlans?.[0] ?? null)
    const [history, setHistory] = useState<ContentPlan[]>(cachedPlans ?? [])
    const [scripts, setScripts] = useState<GeneratedScript[]>(
        () => cacheRead<GeneratedScript[]>(`scripts:${userId}`) ?? [],
    )
    const [openScript, setOpenScript] = useState<GeneratedScript | null>(null)
    const [openIdea, setOpenIdea] = useState(0)

    const loadHistory = useCallback(async () => {
        if (!userId) return
        try {
            const res = await fetch(`/api/ai/content?userId=${userId}`)
            const data = await res.json()
            if (Array.isArray(data)) {
                cacheWrite(`content:${userId}`, data)
                setHistory(data)
                // Show the newest plan on arrival rather than an empty studio.
                setPlan(current => current ?? data[0] ?? null)
            }
        } catch { /* history is a nicety — don't surface */ }
    }, [userId])

    // Scripts only — the writer's own GET also builds the reference library,
    // which costs an Instagram round trip History has no use for.
    const loadScripts = useCallback(async () => {
        if (!userId) return
        try {
            const res = await fetch(`/api/ai/writer?userId=${userId}&only=scripts`)
            const data = await res.json()
            if (Array.isArray(data?.scripts)) {
                cacheWrite(`scripts:${userId}`, data.scripts)
                setScripts(data.scripts)
            }
        } catch { /* history is a nicety — don't surface */ }
    }, [userId])

    useEffect(() => { loadHistory() }, [loadHistory])
    useEffect(() => { loadScripts() }, [loadScripts])

    const removeScript = async (id: string) => {
        await fetch(`/api/ai/writer?id=${id}`, { method: "DELETE" })
        setScripts(prev => {
            const next = prev.filter(s => s.id !== id)
            cacheWrite(`scripts:${userId}`, next)
            return next
        })
        setOpenScript(prev => (prev?.id === id ? null : prev))
        // The writer panel holds its own copy of this list; drop it rather than
        // let that tab reopen showing a script History has already deleted.
        cacheClear(`writer:${userId}`)
    }

    const toggleFormat = (f: string) =>
        setFormats(prev => (prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]))

    const generate = async () => {
        if (!goal.trim() || generating) return
        setGenerating(true)
        setError(null)
        try {
            const res = await fetch("/api/ai/content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, goal, niche, audience, formats, referenceNotes, ideaCount }),
            })
            const data = await res.json()
            if (!res.ok) setError(data?.error || "Generation failed")
            else {
                setPlan(data)
                setOpenIdea(0)
                setTab("generate")
                loadHistory()
            }
        } catch {
            setError("Generation failed — check your connection and try again")
        } finally {
            setGenerating(false)
        }
    }

    const runCheck = async () => {
        setChecking(true)
        try {
            const res = await fetch(`/api/ai/content/check?userId=${userId}`)
            const data = await res.json()
            setCheck({ ...data, ok: Boolean(data.ok), reason: data.reason || data.error || "Check failed" })
            setCheckedAt(new Date())
        } catch {
            setCheck({ ok: false, reason: "Check failed — could not reach the server" })
            setCheckedAt(new Date())
        } finally {
            setChecking(false)
        }
    }

    const remove = async (id: string) => {
        await fetch(`/api/ai/content?id=${id}`, { method: "DELETE" })
        if (plan?.id === id) setPlan(null)
        loadHistory()
    }

    const planIndex = plan ? history.findIndex(h => h.id === plan.id) : -1
    const allIdeasText = plan?.ideas.map(ideaToText).join("\n\n———\n\n") ?? ""

    const TAB_BUTTON = "rounded-[7px] px-3.5 py-2 text-[13.5px] transition-colors"

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="flex flex-col gap-1.5">
                    <h1 className="text-[26px] font-bold tracking-tight text-foreground">Content Studio</h1>
                    <p className="text-[14px] text-muted-foreground">
                        Ideas built from your own last 25 posts — not from a generic prompt.
                    </p>
                </div>

                <div className="flex items-center gap-2.5">
                    {plan && (
                        <div className="flex items-center gap-2 rounded-[9px] border border-border bg-card px-3 py-2 text-[12.5px] text-muted-foreground">
                            <span className="text-[9px] text-emerald-500">●</span>
                            {planIndex >= 0 && `Plan #${history.length - planIndex} · `}
                            {new Date(plan.created_at).toLocaleDateString()}
                        </div>
                    )}
                    {plan && plan.ideas.length > 0 && (
                        <button
                            onClick={() => navigator.clipboard.writeText(allIdeasText)}
                            className="rounded-[9px] border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground transition-colors hover:bg-muted"
                        >
                            Copy all ideas
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 self-start rounded-[10px] border border-border bg-card p-1">
                {([
                    ["generate", "Generate ideas"],
                    ["writer", "Script writer"],
                    ["script", "Script analysis"],
                    ["history", "History"],
                ] as [Tab, string][]).map(([id, name]) => (
                    <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={`${TAB_BUTTON} ${
                            tab === id
                                ? "bg-foreground font-semibold text-background"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {name}
                    </button>
                ))}
            </div>

            {tab === "generate" && (
                <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                    {/* Brief */}
                    <div className="flex flex-col gap-3.5 lg:sticky lg:top-5">
                        <div className={`${CARD} flex flex-col gap-4 p-5`}>
                            <span className={EYEBROW}>Input</span>

                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-[13px] font-semibold text-foreground">Goal</span>
                                    <span className="text-[11px] text-amber-500">required</span>
                                </div>
                                <textarea
                                    value={goal}
                                    onChange={e => setGoal(e.target.value)}
                                    rows={3}
                                    placeholder="Get to 100K followers by December and sell 200 preset packs"
                                    className={`${FIELD} resize-y leading-relaxed`}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[13px] font-semibold text-foreground">Niche</span>
                                    <input value={niche} onChange={e => setNiche(e.target.value)} placeholder="Video editing" className={FIELD} />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[13px] font-semibold text-foreground">Audience</span>
                                    <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="New creators" className={FIELD} />
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <span className="text-[13px] font-semibold text-foreground">Formats</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {FORMATS.map(f => (
                                        <button
                                            key={f}
                                            onClick={() => toggleFormat(f)}
                                            className={`rounded-full px-3 py-1.5 text-[12.5px] capitalize transition-colors ${
                                                formats.includes(f)
                                                    ? "bg-foreground font-semibold text-background"
                                                    : "border border-border bg-background text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            {f}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between text-[13px]">
                                    <span className="font-semibold text-foreground">How many ideas</span>
                                    <span className="mono text-foreground">{ideaCount}</span>
                                </div>
                                <input
                                    type="range"
                                    min={3}
                                    max={10}
                                    value={ideaCount}
                                    onChange={e => setIdeaCount(Number(e.target.value))}
                                    className="w-full accent-foreground"
                                />
                                <div className="mono flex justify-between text-[10px] text-muted-foreground">
                                    <span>3</span><span>10</span>
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-baseline justify-between">
                                    <span className="text-[13px] font-semibold text-foreground">Competitor accounts</span>
                                    <span className="text-[11px] text-muted-foreground">manual — not fetched</span>
                                </div>
                                <textarea
                                    value={referenceNotes}
                                    onChange={e => setReferenceNotes(e.target.value)}
                                    rows={3}
                                    placeholder="@edit.with.sam — fast tutorial reels, meme captions. @framedbyleo — cinematic BTS, slow pacing, sells LUTs."
                                    className={`${FIELD} resize-y leading-relaxed`}
                                />
                                <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                                    Describe them in words. The API can&apos;t read other accounts, so what you type
                                    here is what the AI reasons against.
                                </span>
                            </div>

                            <button
                                onClick={generate}
                                disabled={generating || !goal.trim()}
                                className="flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                            >
                                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                                {generating ? "Planning…" : `Generate ${ideaCount} ideas`}
                            </button>

                            {error && <span className="text-[12px] text-destructive">{error}</span>}
                            {generating && (
                                <span className="text-[11.5px] text-muted-foreground">
                                    Reading your posts and thinking it through — usually 30–90 seconds.
                                </span>
                            )}
                        </div>

                        <AccessCheckCard check={check} checking={checking} onRun={runCheck} ranAt={checkedAt} />
                    </div>

                    {/* Result */}
                    <div className="flex flex-col gap-4">
                        {!plan ? (
                            <div className={`${CARD} flex min-h-[220px] items-center justify-center p-8 text-center`}>
                                <span className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                                    Describe what you&apos;re trying to achieve, then generate. Ideas come back with a
                                    fit score, a beat-by-beat script and the evidence they were built from.
                                </span>
                            </div>
                        ) : (
                            <>
                                <PillarCheck
                                    ideas={plan.ideas}
                                    pillars={plan.analysis?.pillars ?? []}
                                    onRegenerate={generate}
                                />

                                <div className={`${CARD} overflow-hidden`}>
                                    <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3.5">
                                        <span className={EYEBROW}>
                                            {plan.ideas.length} idea{plan.ideas.length === 1 ? "" : "s"}
                                        </span>
                                        <span className="text-[12px] text-muted-foreground">
                                            Click an idea for the beat-by-beat script
                                        </span>
                                    </div>
                                    {plan.ideas.map((idea, i) => (
                                        <IdeaRow
                                            key={i}
                                            idea={idea}
                                            index={i}
                                            open={openIdea === i}
                                            onToggle={() => setOpenIdea(openIdea === i ? -1 : i)}
                                        />
                                    ))}
                                </div>

                                <EvidenceSection plan={plan} />
                            </>
                        )}
                    </div>
                </div>
            )}

            {tab === "writer" && (
                <WriterTab userId={userId} openScript={openScript} onScriptsChanged={loadScripts} />
            )}

            {tab === "script" && <ScriptTab userId={userId} />}

            {tab === "history" && (
                <HistoryTab
                    history={history}
                    scripts={scripts}
                    onOpen={(item) => { setPlan(item); setOpenIdea(0); setTab("generate") }}
                    onDelete={remove}
                    onOpenScript={(item) => { setOpenScript(item); setTab("writer") }}
                    onDeleteScript={removeScript}
                />
            )}
        </div>
    )
}
