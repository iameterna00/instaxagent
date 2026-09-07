"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
    Loader2, Sparkles, AlertTriangle, Search, ChevronDown, ChevronUp, Film, RefreshCw,
    Download, Star, Mic, Copy,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
    accountAverages, accountTotals, averageScore, band, compact, compareToAverage, engagementRate,
    formatLeaderboard, formatOf, scoreBands, BAND_LABEL,
} from "@/lib/ai/analysis"
import { cacheRead, cacheWrite } from "@/lib/client-cache"
import { isTimed, spokenText } from "@/lib/ai/transcribe"
import type { AnalysisSummary, AnalyzedPost, Band, PostFormat } from "@/lib/ai/analysis"
import type { AccountSnapshot } from "@/lib/instagram-account"

/** A row of the transcript cache, as /api/ai/transcripts returns it. */
interface CachedTranscript {
    media_id: string
    transcript: string
    duration_seconds: number | null
    model: string | null
    error: string | null
    created_at: string | null
}

interface SavedAnalysis {
    id: string
    provider: string | null
    model: string | null
    summary: AnalysisSummary | null
    posts: AnalyzedPost[]
    posts_analyzed: number
    account: AccountSnapshot | null
    has_insights: boolean
    created_at: string
}

const BAND_TEXT: Record<Band, string> = {
    top: "text-emerald-500",
    average: "text-muted-foreground",
    under: "text-amber-500",
}

const BAND_BAR: Record<Band, string> = {
    top: "bg-emerald-500",
    average: "bg-muted-foreground",
    under: "bg-amber-500",
}

const TONE_TEXT = { up: "text-emerald-500", down: "text-amber-500", flat: "text-muted-foreground" } as const
const TONE_BAR = { up: "bg-emerald-500", down: "bg-amber-500", flat: "bg-muted-foreground" } as const

/** The design's eyebrow: JetBrains Mono 10px, wide tracking, uppercase. */
const EYEBROW = "mono text-[10px] uppercase tracking-[0.1em]"

/** Chip shared by the search box, dropdowns and segmented controls. */
const CHIP = "rounded-[9px] border border-border bg-background"

/**
 * The design's column widths, verbatim:
 *   minmax(0,1fr) 84px 84px 84px 78px 78px 74px 104px 30px
 * Narrower breakpoints drop the middle metrics rather than crushing them.
 */
const GRID =
    "grid items-center gap-3.5 grid-cols-[minmax(0,1fr)_72px_92px_30px] " +
    "xl:grid-cols-[minmax(0,1fr)_84px_84px_84px_78px_78px_74px_104px_30px]"

const WIDE_CELL = "hidden xl:block text-right mono text-[14px] text-muted-foreground"

/** How many rows before "Load more". */
const PAGE_SIZE = 10

function titleOf(post: AnalyzedPost): string {
    const caption = (post.caption ?? "").trim()
    if (!caption) return "(no caption)"
    return (caption.split("\n").find((l) => l.trim().length > 0) ?? caption).trim().slice(0, 90)
}

function dateOf(post: AnalyzedPost): string {
    if (!post.timestamp) return "unknown date"
    return new Date(post.timestamp).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
    })
}

function metric(value: number | undefined): string {
    return value === undefined ? "—" : compact(value)
}

function erText(post: AnalyzedPost): string {
    const er = engagementRate(post)
    return er === undefined ? "—" : `${(er * 100).toFixed(1)}%`
}

// ------------------------------------------------------------

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-[18px] py-4">
            <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                <span>{label}</span>
            </div>
            <span className="mono text-[28px] font-semibold tracking-[-0.02em] text-foreground">{value}</span>
            <span className="text-[12px] text-muted-foreground">{note ?? " "}</span>
        </div>
    )
}

function Bullets({ items, tone }: { items: string[]; tone: "up" | "down" }) {
    return (
        <div className="flex flex-col gap-2 text-[13.5px] leading-[1.5] text-muted-foreground">
            {items.map((item, i) => (
                <div key={i} className="flex gap-2.5">
                    <span
                        className={cn(
                            "mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full",
                            tone === "up" ? "bg-emerald-500" : "bg-amber-500",
                        )}
                    />
                    <span>{item}</span>
                </div>
            ))}
        </div>
    )
}

/**
 * Account-level read as a table. Rows pair by index — the two lists are
 * independent, so a short one leaves blanks rather than stretching a cell.
 */
function SummaryTable({ working, improve }: { working: string[]; improve: string[] }) {
    const rows = Math.max(working.length, improve.length)
    if (rows === 0) return null

    const cell = "align-top py-2.5 text-[13.5px] leading-[1.5] text-muted-foreground"

    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left">
                <thead>
                    <tr className="border-b border-border">
                        <th className={cn(EYEBROW, "w-1/2 border-r border-border py-2 pr-5 text-emerald-500")}>
                            What&apos;s working
                        </th>
                        <th className={cn(EYEBROW, "w-1/2 py-2 pl-5 text-amber-500")}>What to improve</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }, (_, i) => (
                        <tr key={i} className="border-b border-border last:border-b-0">
                            <td className={cn(cell, "border-r border-border pr-5")}>
                                {working[i] && (
                                    <span className="flex gap-2.5">
                                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-emerald-500" />
                                        <span>{working[i]}</span>
                                    </span>
                                )}
                            </td>
                            <td className={cn(cell, "pl-5")}>
                                {improve[i] && (
                                    <span className="flex gap-2.5">
                                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-amber-500" />
                                        <span>{improve[i]}</span>
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function SummaryPanel({ summary, postCount }: { summary: AnalysisSummary; postCount: number }) {
    return (
        <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-card px-[22px] py-5">
            <div className="flex items-center gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                    <Sparkles className="h-3 w-3" strokeWidth={2.2} />
                </div>
                <span className={cn(EYEBROW, "text-muted-foreground")}>
                    AI summary · all {postCount} posts
                </span>
            </div>

            {summary.headline && (
                <p className="max-w-[62ch] text-pretty text-[18px] leading-[1.5] tracking-[-0.01em] text-foreground">
                    {summary.headline}
                </p>
            )}

            <SummaryTable working={summary.what_is_working} improve={summary.what_to_improve} />

            {summary.next_post && (
                <div className="flex flex-col gap-2 rounded-[11px] border border-border bg-muted/40 px-4 py-3.5 sm:flex-row sm:gap-3.5">
                    <span className={cn(EYEBROW, "shrink-0 whitespace-nowrap tracking-[0.09em] text-muted-foreground sm:pt-0.5")}>
                        Next post
                    </span>
                    <p className="text-[13.5px] leading-[1.55] text-foreground">{summary.next_post}</p>
                </div>
            )}
        </div>
    )
}

function ScorePanel({ posts }: { posts: AnalyzedPost[] }) {
    const score = averageScore(posts)
    const bands = scoreBands(posts)
    const leaderboard = formatLeaderboard(posts)
    const scored = bands.top + bands.average + bands.under

    return (
        <div className="flex flex-col gap-[18px] rounded-[14px] border border-border bg-card px-[22px] py-5">
            <span className={cn(EYEBROW, "text-muted-foreground")}>Content score</span>

            <div className="flex items-baseline gap-2.5">
                <span className="mono text-[46px] font-semibold leading-none tracking-[-0.03em] text-foreground">
                    {score}
                </span>
                <span className="text-[15px] text-muted-foreground">/ 100 avg</span>
            </div>

            <div className="h-[7px] overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground" style={{ width: `${score}%` }} />
            </div>

            {scored > 0 && (
                <div className="mono flex gap-1.5 text-[10.5px]">
                    {bands.top > 0 && (
                        <span className="rounded-[7px] bg-emerald-500/10 px-2 py-1.5 text-center text-emerald-500" style={{ flex: bands.top }}>
                            {bands.top} top
                        </span>
                    )}
                    {bands.average > 0 && (
                        <span className="rounded-[7px] bg-muted px-2 py-1.5 text-center text-muted-foreground" style={{ flex: bands.average }}>
                            {bands.average} average
                        </span>
                    )}
                    {bands.under > 0 && (
                        <span className="rounded-[7px] bg-amber-500/10 px-2 py-1.5 text-center text-amber-500" style={{ flex: bands.under }}>
                            {bands.under} under
                        </span>
                    )}
                </div>
            )}

            {leaderboard.length > 0 && (
                <>
                    <div className="h-px bg-border" />
                    <span className={cn(EYEBROW, "text-muted-foreground")}>Format leaderboard</span>
                    <div className="flex flex-col gap-3">
                        {leaderboard.map((row) => (
                            <div key={row.format} className="flex flex-col gap-1.5">
                                <div className="flex justify-between text-[13px]">
                                    <span className="text-foreground">
                                        {row.format[0] + row.format.slice(1).toLowerCase()}s · {row.count}{" "}
                                        {row.count === 1 ? "post" : "posts"}
                                    </span>
                                    <span className="mono text-muted-foreground">avg {row.avgScore}</span>
                                </div>
                                <div className="h-[5px] rounded-full bg-muted">
                                    <div
                                        className={cn("h-full rounded-full", BAND_BAR[band(row.avgScore)])}
                                        style={{ width: `${row.avgScore}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

// ------------------------------------------------------------

type SortKey = "views" | "likes" | "reach" | "er" | "score"

const SORTS: { key: SortKey; label: string }[] = [
    { key: "views", label: "Views ↓" },
    { key: "likes", label: "Likes" },
    { key: "reach", label: "Reach" },
    { key: "er", label: "ER" },
    { key: "score", label: "Score" },
]

const FORMATS: (PostFormat | "ALL")[] = ["ALL", "REEL", "CAROUSEL", "STATIC", "STORY"]

type PerformanceFilter = "all" | Band
type RangeFilter = "all" | "7" | "30" | "90"

const RANGE_LABEL: Record<RangeFilter, string> = {
    all: "All time",
    "7": "Last 7 days",
    "30": "Last 30 days",
    "90": "Last 90 days",
}

/** The design's chip-styled dropdowns. A native select keeps them accessible. */
function SelectChip({ prefix, value, options, onChange }: {
    prefix?: string
    value: string
    options: { value: string; label: string }[]
    onChange: (value: string) => void
}) {
    return (
        <div className={cn(CHIP, "relative flex items-center gap-1.5 px-3 py-2 text-[13px] text-muted-foreground")}>
            {prefix && <span>{prefix}</span>}
            <span className="font-semibold text-foreground">
                {options.find((o) => o.value === value)?.label}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0" />
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={prefix ?? "Filter"}
            >
                {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
        </div>
    )
}

/** `[12.5] line` → `0:12` + the line. Untimed transcripts keep an empty stamp. */
function transcriptLines(text: string): { at: string; text: string }[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const timed = line.match(/^\[(\d+(?:\.\d+)?)\]\s*(.*)$/)
            if (!timed) return { at: "", text: line }
            const seconds = Number(timed[1])
            const stamp = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
            return { at: stamp, text: timed[2] }
        })
}

/**
 * The reel's own words, from the cached Whisper run the analysis was scored
 * against. Collapsed by default — it is the longest thing in an expanded row,
 * and most of the time the verdict above it is the answer.
 */
function TranscriptPanel({ transcript }: { transcript: CachedTranscript }) {
    const [open, setOpen] = useState(false)

    const lines = useMemo(() => transcriptLines(transcript.transcript), [transcript.transcript])
    const words = useMemo(
        () => spokenText(transcript.transcript).split(/\s+/).filter(Boolean).length,
        [transcript.transcript],
    )
    const timed = isTimed(transcript.transcript)

    // A cached failure is worth showing: it says why the model judged this reel
    // on its caption alone, rather than leaving the gap unexplained.
    if (transcript.error || !transcript.transcript.trim()) {
        return (
            <div className="flex items-start gap-2 rounded-[10px] border border-dashed border-border px-[15px] py-3 text-[12px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Not transcribed — {transcript.error || "no speech was detected"}.</span>
            </div>
        )
    }

    const pace =
        transcript.duration_seconds && transcript.duration_seconds > 0
            ? `${Math.round(transcript.duration_seconds)}s · ${(words / transcript.duration_seconds).toFixed(1)} words/sec`
            : `${words} words`

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(spokenText(transcript.transcript))
            toast.success("Transcript copied")
        } catch {
            toast.error("Could not copy the transcript")
        }
    }

    return (
        <div className="overflow-hidden rounded-[10px] border border-border bg-muted/40">
            <div className="flex items-center gap-2.5 px-[15px] py-2.5">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="flex flex-1 items-center gap-2.5 text-left"
                >
                    <Mic className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className={cn(EYEBROW, "text-[9.5px] text-muted-foreground")}>Transcript</span>
                    <span className="mono text-[10.5px] text-muted-foreground">{pace}</span>
                    <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        {open ? "Hide" : "Show"}
                        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </span>
                </button>
                {open && (
                    <button
                        type="button"
                        onClick={copy}
                        className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <Copy className="h-3 w-3" />
                        Copy
                    </button>
                )}
            </div>

            {open && (
                <div className="max-h-[280px] overflow-y-auto border-t border-border px-[15px] py-3">
                    {timed ? (
                        <div className="flex flex-col gap-1.5">
                            {lines.map((line, i) => (
                                <div key={i} className="grid grid-cols-[40px_minmax(0,1fr)] gap-2.5">
                                    <span className="mono pt-[3px] text-[10.5px] text-muted-foreground">{line.at}</span>
                                    <span className="text-[13px] leading-[1.55] text-foreground">{line.text}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-foreground">
                            {transcript.transcript}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}

function PostRow({ post, averages, transcript, open, onToggle }: {
    post: AnalyzedPost
    averages: Record<string, number>
    transcript?: CachedTranscript
    open: boolean
    onToggle: () => void
}) {
    const verdict = post.analysis
    const tone = verdict ? band(verdict.score) : "average"
    const thumb = post.thumbnail_url || post.media_url
    const comparisons = useMemo(() => compareToAverage(post, averages), [post, averages])

    return (
        <div className="border-b border-border last:border-b-0">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className={cn(GRID, "w-full px-5 py-3 text-left transition-colors hover:bg-muted/40")}
            >
                <div className="flex min-w-0 items-center gap-3.5">
                    <div className="relative h-[60px] w-[46px] shrink-0 overflow-hidden rounded-[7px] border border-border bg-muted">
                        {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <Film className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                        )}
                        <span className="mono absolute bottom-[3px] left-[3px] rounded-[3px] bg-black/70 px-1 py-px text-[7.5px] tracking-[0.06em] text-white">
                            {formatOf(post)}
                        </span>
                    </div>

                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-[14px] font-medium tracking-[-0.005em] text-foreground">
                            {titleOf(post)}
                        </span>
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <span className="truncate">{dateOf(post)}</span>
                            {verdict && (
                                <>
                                    <span className="opacity-40">·</span>
                                    <span className={cn("shrink-0 font-semibold", BAND_TEXT[tone])}>
                                        {BAND_LABEL[tone]}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <span className="mono text-right text-[14px] font-medium text-foreground">{metric(post.views)}</span>
                <span className={WIDE_CELL}>{metric(post.reach)}</span>
                <span className={WIDE_CELL}>{metric(post.like_count)}</span>
                <span className={WIDE_CELL}>{metric(post.saved)}</span>
                <span className={WIDE_CELL}>{metric(post.comments_count)}</span>
                <span className={WIDE_CELL}>{erText(post)}</span>

                <div className="flex items-center justify-end gap-2.5">
                    {verdict ? (
                        <>
                            <div className="hidden h-[5px] w-8 overflow-hidden rounded-full bg-muted sm:block">
                                <div className={cn("h-full rounded-full", BAND_BAR[tone])} style={{ width: `${verdict.score}%` }} />
                            </div>
                            <span className={cn("mono text-[14px] font-semibold", BAND_TEXT[tone])}>{verdict.score}</span>
                        </>
                    ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                </div>

                <span className="flex justify-end text-muted-foreground">
                    {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </span>
            </button>

            {open && verdict && (
                <div className="bg-muted/20 px-5 pb-5 xl:pl-20">
                    <div className="grid gap-[22px] rounded-xl border border-border bg-card px-5 py-[18px] xl:grid-cols-[1.35fr_1fr]">
                        <div className="flex flex-col gap-[15px]">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-foreground text-background">
                                    <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
                                </div>
                                <span className={cn(EYEBROW, "text-[9.5px] text-muted-foreground")}>Post analysis</span>
                                {verdict.verdict && (
                                    <span className="text-[12px] text-muted-foreground">· {verdict.verdict}</span>
                                )}
                            </div>

                            <div className="grid gap-5 sm:grid-cols-2">
                                {verdict.working.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <span className={cn(EYEBROW, "text-[9.5px] text-emerald-500")}>Working</span>
                                        <Bullets items={verdict.working} tone="up" />
                                    </div>
                                )}
                                {verdict.improve.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <span className={cn(EYEBROW, "text-[9.5px] text-amber-500")}>To improve</span>
                                        <Bullets items={verdict.improve} tone="down" />
                                    </div>
                                )}
                            </div>

                            {verdict.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {verdict.tags.map((tag, i) => (
                                        <span
                                            key={i}
                                            className="mono rounded-full border border-border bg-muted px-[9px] py-[5px] text-[10px] tracking-[0.04em] text-muted-foreground"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {verdict.next && (
                                <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-muted/50 px-[15px] py-3.5 sm:flex-row sm:gap-3.5">
                                    <span className={cn(EYEBROW, "shrink-0 whitespace-nowrap text-[9.5px] tracking-[0.09em] text-muted-foreground sm:pt-0.5")}>
                                        Do next
                                    </span>
                                    <p className="text-[13px] leading-[1.55] text-foreground">{verdict.next}</p>
                                </div>
                            )}

                            {transcript && <TranscriptPanel transcript={transcript} />}

                            {post.permalink && (
                                <a
                                    href={post.permalink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[12px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                                >
                                    View on Instagram
                                </a>
                            )}
                        </div>

                        <div className="flex flex-col gap-3.5 xl:border-l xl:border-border xl:pl-[22px]">
                            {comparisons.length > 0 && (
                                <>
                                    <span className={cn(EYEBROW, "text-[9.5px] text-muted-foreground")}>vs. your average</span>
                                    <div className="flex flex-col gap-[11px]">
                                        {comparisons.map((row) => (
                                            <div key={row.label} className="flex flex-col gap-[5px]">
                                                <div className="flex justify-between text-[12.5px]">
                                                    <span className="text-muted-foreground">{row.label}</span>
                                                    <span className={cn("mono font-semibold", TONE_TEXT[row.tone])}>{row.delta}</span>
                                                </div>
                                                <div className="h-1 rounded-full bg-muted">
                                                    <div className={cn("h-full rounded-full", TONE_BAR[row.tone])} style={{ width: `${row.pct}%` }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {verdict.lift && (
                                <>
                                    <div className="h-px bg-border" />
                                    <div className="flex flex-col gap-1.5">
                                        <span className={cn(EYEBROW, "text-[9.5px] text-muted-foreground")}>Predicted lift if fixed</span>
                                        <span className="mono text-[24px] font-semibold text-emerald-500">{verdict.lift}</span>
                                        {verdict.lift_note && (
                                            <span className="text-[12px] leading-[1.45] text-muted-foreground">{verdict.lift_note}</span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* A post the model returned no verdict for still has its own words. */}
            {open && !verdict && transcript && (
                <div className="bg-muted/20 px-5 pb-5 xl:pl-20">
                    <div className="rounded-xl border border-border bg-card px-5 py-[18px]">
                        <TranscriptPanel transcript={transcript} />
                    </div>
                </div>
            )}
        </div>
    )
}

// ------------------------------------------------------------

const PRESET_KEY = "deep-analysis-preset"

/** How long an automatic metrics refresh stands before another may fire. */
const AUTO_REFRESH_COOLDOWN_MS = 10 * 60_000

export function DeepAnalysis({ userId }: { userId: string }) {
    const [saved, setSaved] = useState<SavedAnalysis | null>(null)
    const [transcripts, setTranscripts] = useState<Record<string, CachedTranscript>>({})
    const [loading, setLoading] = useState(true)
    const [running, setRunning] = useState(false)

    // Metrics-only refresh: the four headline figures and the table's numbers,
    // without spending a model call. `stale` says the numbers have moved since
    // the verdicts were written, which is what makes a re-run worth offering.
    const [refreshing, setRefreshing] = useState(false)
    const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
    const [stale, setStale] = useState(false)
    const [newPosts, setNewPosts] = useState(0)
    const [autoRefreshed, setAutoRefreshed] = useState(false)
    // Why the numbers on screen are not moving. The silent pass has no toast to
    // put this in, and frozen metrics with no explanation read as a dead page.
    const [refreshNote, setRefreshNote] = useState<string | null>(null)

    const [search, setSearch] = useState("")
    const [format, setFormat] = useState<PostFormat | "ALL">("ALL")
    const [performance, setPerformance] = useState<PerformanceFilter>("all")
    const [range, setRange] = useState<RangeFilter>("all")
    const [sort, setSort] = useState<SortKey>("views")
    const [open, setOpen] = useState<string | null>(null)
    const [shown, setShown] = useState(PAGE_SIZE)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/ai/analysis?userId=${userId}`)
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return
                if (data && !data.error) setSaved(data)
            })
            .catch(() => { })
            .finally(() => !cancelled && setLoading(false))
        return () => { cancelled = true }
    }, [userId])

    // Cached transcripts for the reels on screen. They live in their own table
    // rather than on the analysis row, so they load as a second, optional pass:
    // the page is fully usable whether or not this ever comes back.
    useEffect(() => {
        const ids = (saved?.posts ?? [])
            .filter((post) => post.id && formatOf(post) === "REEL")
            .map((post) => post.id!)

        if (!ids.length) return

        let cancelled = false
        fetch(`/api/ai/transcripts?userId=${userId}&mediaIds=${encodeURIComponent(ids.join(","))}`)
            .then((r) => r.json())
            .then((data) => {
                if (cancelled || !Array.isArray(data?.transcripts)) return
                setTranscripts(
                    Object.fromEntries(
                        (data.transcripts as CachedTranscript[]).map((row) => [row.media_id, row]),
                    ),
                )
            })
            .catch(() => { /* no transcripts is a missing extra, not an error */ })
        return () => { cancelled = true }
    }, [userId, saved])

    // Restore the saved filter preset, if there is one.
    useEffect(() => {
        try {
            const raw = localStorage.getItem(PRESET_KEY)
            if (!raw) return
            const preset = JSON.parse(raw)
            if (preset.format) setFormat(preset.format)
            if (preset.performance) setPerformance(preset.performance)
            if (preset.range) setRange(preset.range)
            if (preset.sort) setSort(preset.sort)
        } catch { /* a corrupt preset should never block the page */ }
    }, [])

    /**
     * Pull today's views, reach, engagement rate and follower numbers onto the
     * saved analysis. No AI runs — a silent pass fires once on load, and the
     * Refresh button repeats it on demand.
     */
    const refreshMetrics = useCallback(async (silent = false) => {
        setRefreshing(true)
        try {
            const res = await fetch("/api/ai/analysis", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Could not refresh the metrics")

            setSaved(data.analysis)
            setRefreshedAt(new Date())
            setNewPosts(data.new_posts ?? 0)
            setStale(Boolean(data.changed) || (data.new_posts ?? 0) > 0)

            // Instagram returning no insights is the one way this call succeeds
            // and still leaves every number exactly where it was.
            if (data.insights === false) {
                // Throttling and a missing permission look identical on screen —
                // frozen numbers — but need opposite advice: wait, or reconnect.
                const throttled = Boolean(data.throttled)
                setRefreshNote(
                    throttled
                        ? "Instagram is rate limiting this account, so the numbers below are the ones from the last analysis. It clears on its own — try again in about an hour. Accounts with a lot of posts hit this because metrics cost one call per post."
                        : "Instagram returned no view or reach data on this pass — the numbers below are the ones from the last analysis. Reconnect the account if this keeps happening.",
                )
                if (!silent) {
                    toast.error(throttled ? "Instagram is rate limiting — try again in an hour" : "Instagram returned no metrics — reconnect the account")
                }
            } else {
                setRefreshNote(null)
                if (!silent) {
                    toast.success(
                        data.new_posts > 0
                            ? `Metrics updated · ${data.new_posts} new post${data.new_posts === 1 ? "" : "s"} not analysed yet`
                            : "Metrics updated",
                    )
                }
            }
        } catch (e: any) {
            // The auto-pass has no toast to fail into, so it leaves a note on
            // the page instead — silent used to mean invisible, which is what
            // made frozen numbers look like a bug rather than a failed fetch.
            setRefreshNote(e.message || "Could not refresh the metrics")
            if (!silent) toast.error(e.message || "Could not refresh the metrics")
        } finally {
            setRefreshing(false)
        }
    }, [userId])

    // One silent refresh per visit — but not more often than the cooldown.
    //
    // A refresh costs Instagram one insights call PER POST, and the per-user
    // hourly ceiling is only a couple of hundred. Firing on every mount meant a
    // 60-post account spent its whole allowance flipping between tabs, and then
    // the numbers stopped moving for an hour. The button is always there for an
    // immediate one.
    useEffect(() => {
        if (loading || !saved || autoRefreshed) return
        setAutoRefreshed(true)
        if (cacheRead(`analysis-refreshed:${userId}`, AUTO_REFRESH_COOLDOWN_MS)) return
        cacheWrite(`analysis-refreshed:${userId}`, Date.now())
        refreshMetrics(true)
    }, [loading, saved, autoRefreshed, refreshMetrics, userId])

    const run = useCallback(async () => {
        setRunning(true)
        try {
            const res = await fetch("/api/ai/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Analysis failed")
            setSaved(data)
            setOpen(null)
            // The verdicts now match the numbers again.
            setStale(false)
            setNewPosts(0)
            setRefreshedAt(new Date())
            toast.success(`Analysed ${data.posts_analyzed} posts`)
        } catch (e: any) {
            toast.error(e.message || "Analysis failed")
        } finally {
            setRunning(false)
        }
    }, [userId])

    const posts = useMemo(() => saved?.posts ?? [], [saved])
    const account = saved?.account ?? null
    const averages = useMemo(() => accountAverages(posts), [posts])
    const totals = useMemo(() => accountTotals(posts, account), [posts, account])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        const cutoff = range === "all" ? null : Date.now() - Number(range) * 86_400_000

        const filtered = posts.filter((post) => {
            if (format !== "ALL" && formatOf(post) !== format) return false
            if (performance !== "all" && (!post.analysis || band(post.analysis.score) !== performance)) return false
            if (cutoff && (!post.timestamp || new Date(post.timestamp).getTime() < cutoff)) return false
            if (!needle) return true
            return (post.caption ?? "").toLowerCase().includes(needle)
        })

        const rank = (post: AnalyzedPost): number => {
            switch (sort) {
                case "views": return post.views ?? -1
                case "reach": return post.reach ?? -1
                case "likes": return post.like_count ?? -1
                case "er": return engagementRate(post) ?? -1
                case "score": return post.analysis?.score ?? -1
            }
        }

        return [...filtered].sort((a, b) => rank(b) - rank(a))
    }, [posts, search, format, performance, range, sort])

    const exportCsv = useCallback(() => {
        const header = ["Date", "Format", "Caption", "Views", "Reach", "Likes", "Saves", "Comments", "ER", "AI score", "Verdict", "Do next", "Permalink"]
        const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`

        const rows = visible.map((p) => [
            p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : "",
            formatOf(p),
            (p.caption ?? "").replace(/\s+/g, " ").trim(),
            p.views ?? "", p.reach ?? "", p.like_count ?? "", p.saved ?? "", p.comments_count ?? "",
            erText(p),
            p.analysis?.score ?? "",
            p.analysis?.verdict ?? "",
            p.analysis?.next ?? "",
            p.permalink ?? "",
        ].map(escape).join(","))

        const blob = new Blob([[header.map(escape).join(","), ...rows].join("\n")], {
            type: "text/csv;charset=utf-8",
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `deep-analysis-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
        toast.success(`Exported ${visible.length} posts`)
    }, [visible])

    const savePreset = useCallback(() => {
        localStorage.setItem(PRESET_KEY, JSON.stringify({ format, performance, range, sort }))
        toast.success("Preset saved — these filters load by default now")
    }, [format, performance, range, sort])

    const header = (
        <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
                <h1 className="text-[26px] font-bold tracking-[-0.02em] text-foreground">Deep Analysis</h1>
                <p className="text-[14px] text-muted-foreground">
                    What worked, what didn&apos;t, and what to post next.
                </p>
            </div>
            {saved && (
                <div className="flex flex-wrap items-center gap-2.5">
                    {refreshedAt && (
                        <span className="mono text-[11px] text-muted-foreground">
                            Metrics {refreshing ? "updating…" : `updated ${refreshedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
                        </span>
                    )}

                    <button
                        onClick={exportCsv}
                        className="inline-flex items-center gap-2 rounded-[9px] border border-border bg-card px-3.5 py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Export CSV
                    </button>

                    {/* Numbers only — no model call, so it is cheap to press. */}
                    <button
                        onClick={() => refreshMetrics()}
                        disabled={refreshing || running}
                        title="Refresh views, reach, engagement rate and followers"
                        className="inline-flex items-center gap-2 rounded-[9px] border border-border bg-card px-3.5 py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                        {refreshing ? "Refreshing…" : "Refresh metrics"}
                    </button>

                    <div className="group relative">
                        <button
                            onClick={run}
                            disabled={running}
                            className={cn(
                                "inline-flex items-center gap-2 rounded-[9px] px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-60",
                                stale
                                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                    : "bg-foreground text-background hover:opacity-90",
                            )}
                        >
                            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            {running ? "Analysing…" : "Re-run AI analysis"}
                            {stale && !running && (
                                <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
                            )}
                        </button>

                        {!running && (
                            <span className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-10 whitespace-nowrap rounded-[7px] border border-border bg-card px-2.5 py-1.5 text-[12px] text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                {stale
                                    ? newPosts > 0
                                        ? `Analyse new data · ${newPosts} new post${newPosts === 1 ? "" : "s"}`
                                        : "Analyse new data"
                                    : "Re-score every post with AI"}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    )

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!saved) {
        return (
            <div className="type-design flex flex-col gap-[18px]">
                {header}
                <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border px-6 py-20 text-center">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                        <Sparkles className="h-5 w-5" strokeWidth={1.8} />
                    </div>
                    <h2 className="text-[15px] font-medium text-foreground">Analyse your recent posts</h2>
                    <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                        Scores every post against the rest of your account and tells you what worked,
                        what didn&apos;t, and what to post next.
                    </p>
                    <button
                        onClick={run}
                        disabled={running}
                        className="mt-6 inline-flex items-center gap-2 rounded-[9px] bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {running ? "Analysing…" : "Run AI analysis"}
                    </button>
                    {running && (
                        <p className="mt-3 text-[12px] text-muted-foreground">
                            This reads every post and can take a minute or two.
                        </p>
                    )}
                </div>
            </div>
        )
    }

    return (
        <div className="type-design flex flex-col gap-[18px]">
            {header}

            {!saved.has_insights && (
                <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        No view or reach numbers came back, so this analysis rests on captions, formats and
                        likes alone. To fix it, both steps are needed:
                        <span className="mt-1.5 block">
                            1. In your Meta app dashboard → Instagram API → Customize use case, add the{" "}
                            <code className="text-foreground">instagram_business_manage_insights</code> permission.
                        </span>
                        <span className="mt-0.5 block">
                            2. Log out and reconnect Instagram so the new token carries it, then re-run.
                        </span>
                    </span>
                </div>
            )}

            {/* Only when the permission banner above is not already explaining
                it — two warnings about the same frozen numbers is noise. */}
            {refreshNote && saved.has_insights && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-[12px] text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>{refreshNote}</span>
                </div>
            )}

            <div
                className={cn(
                    "grid gap-3.5 transition-opacity sm:grid-cols-2 xl:grid-cols-4",
                    refreshing && "opacity-60",
                )}
            >
                <StatCard label="Views" value={metric(totals.views)} note={`across ${totals.measured} measured posts`} />
                <StatCard
                    label="Reach"
                    value={metric(totals.reach)}
                    note={account?.profile.followers_count ? `${compact(account.profile.followers_count)} followers` : undefined}
                />
                <StatCard
                    label="Engagement rate"
                    value={totals.engagementRate === undefined ? "—" : `${(totals.engagementRate * 100).toFixed(1)}%`}
                    note="interactions over reach"
                />
                <StatCard
                    label="Followers gained"
                    value={totals.netFollows === undefined ? "—" : `${totals.netFollows > 0 ? "+" : ""}${compact(totals.netFollows)}`}
                    note={account?.insights?.window_days ? `last ${account.insights.window_days} days` : "not reported"}
                />
            </div>

            <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_360px]">
                {saved.summary && <SummaryPanel summary={saved.summary} postCount={saved.posts_analyzed} />}
                <ScorePanel posts={posts} />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className={cn(CHIP, "flex min-w-[220px] flex-1 items-center gap-2.5 px-3 py-2")}>
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search caption or #hashtag"
                        className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </div>

                <div className={cn(CHIP, "flex gap-[3px] p-[3px]")}>
                    {FORMATS.map((option) => (
                        <button
                            key={option}
                            onClick={() => setFormat(option)}
                            className={cn(
                                "rounded-[7px] px-3 py-1.5 text-[13px] transition-colors",
                                format === option
                                    ? "bg-muted font-semibold text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {option === "ALL" ? "All" : option[0] + option.slice(1).toLowerCase() + "s"}
                        </button>
                    ))}
                </div>

                <SelectChip
                    prefix="Performance:"
                    value={performance}
                    onChange={(v) => setPerformance(v as PerformanceFilter)}
                    options={[
                        { value: "all", label: "All" },
                        { value: "top", label: "Top" },
                        { value: "average", label: "Average" },
                        { value: "under", label: "Under" },
                    ]}
                />

                <SelectChip
                    value={range}
                    onChange={(v) => setRange(v as RangeFilter)}
                    options={(Object.keys(RANGE_LABEL) as RangeFilter[]).map((k) => ({
                        value: k, label: RANGE_LABEL[k],
                    }))}
                />

                <button
                    onClick={savePreset}
                    className="flex items-center gap-1.5 rounded-[9px] border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                >
                    <Star className="h-3 w-3" />
                    Save preset
                </button>

                <div className="flex flex-1 items-center justify-end gap-2">
                    <span className="text-[12px] text-muted-foreground">Sort</span>
                    <div className={cn(CHIP, "flex gap-[3px] p-[3px]")}>
                        {SORTS.map((option) => (
                            <button
                                key={option.key}
                                onClick={() => setSort(option.key)}
                                className={cn(
                                    "rounded-[7px] px-[11px] py-1.5 text-[13px] transition-colors",
                                    sort === option.key
                                        ? "bg-foreground font-semibold text-background"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-[14px] border border-border bg-card">
                <div
                    className={cn(
                        GRID,
                        EYEBROW,
                        "border-b border-border bg-muted/40 px-5 py-[11px] text-[9.5px] tracking-[0.09em] text-muted-foreground",
                    )}
                >
                    <span>Post</span>
                    <span className="text-right">Views</span>
                    <span className="hidden text-right xl:block">Reach</span>
                    <span className="hidden text-right xl:block">Likes</span>
                    <span className="hidden text-right xl:block">Saves</span>
                    <span className="hidden text-right xl:block">Comm.</span>
                    <span className="hidden text-right xl:block">ER</span>
                    <span className="text-right">AI score</span>
                    <span />
                </div>

                {visible.length === 0 ? (
                    <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">
                        No posts match those filters.
                    </p>
                ) : (
                    visible.slice(0, shown).map((post, i) => {
                        const key = post.id ?? String(i)
                        return (
                            <PostRow
                                key={key}
                                post={post}
                                averages={averages}
                                transcript={post.id ? transcripts[post.id] : undefined}
                                open={open === key}
                                onToggle={() => setOpen(open === key ? null : key)}
                            />
                        )
                    })
                )}

                {visible.length > 0 && (
                    <div className="flex items-center justify-between px-5 py-[13px] text-[12.5px] text-muted-foreground">
                        <span>Showing {Math.min(shown, visible.length)} of {visible.length} posts</span>
                        {shown < visible.length && (
                            <button
                                onClick={() => setShown((n) => n + PAGE_SIZE)}
                                className="text-foreground transition-opacity hover:opacity-70"
                            >
                                Load more ↓
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
