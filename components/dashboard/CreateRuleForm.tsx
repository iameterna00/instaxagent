"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Plus, Trash2, Film, Check, MessageCircle, Send, AtSign, Heart,
  MessageSquare, Image as ImageIcon, Timer, Eye, Megaphone, Lock,
  Link2, Zap, ChevronDown, ChevronRight, ChevronLeft, X, Loader2,
  ArrowLeft, Phone, Video, Info, Sparkles, Smile, Camera, Mic, Image as PicIcon,
  Globe
} from "lucide-react"
import { TagInput } from "@/components/ui/tag-input"
import type { ProButton, QuickReplyOption, Automation } from "@/lib/types"
import { toast } from "sonner"

/* ============================================================
   AESTHETIC & SEXY WIZARD FOR INSTAGRAM AUTOMATION RULES
   Step 1: TRIGGER  — Select Reel/Post first, then set keywords
   Step 2: RESPONSE — What do they get?
   Step 3: SETTINGS — Name it & delivery options
   ============================================================ */

interface CreateRuleFormProps {
  userId: string
  triggerSource: "comment" | "dm" | "story"
  onSuccess: () => void
  editRule?: Automation | null
}

const STEPS = [
  { key: "trigger", label: "Trigger Source", sub: "When does it fire?" },
  { key: "response", label: "Reply Payload", sub: "What do they get?" },
  { key: "settings", label: "Final Settings", sub: "Speed & restrictions" },
] as const

export function CreateRuleForm({ userId, triggerSource, onSuccess, editRule }: CreateRuleFormProps) {
  const isEditing = !!editRule
  const [step, setStep] = useState(0)

  /* ---------- WHEN ---------- */
  const [triggers, setTriggers] = useState<string[]>([])
  const [storyTriggerType, setStoryTriggerType] = useState<"mention" | "reaction" | "reply">("mention")
  const [selectedReel, setSelectedReel] = useState<any | null>(null)
  const [hasSelectedReelOption, setHasSelectedReelOption] = useState<boolean>(false)

  /* ---------- THEN ---------- */
  const [type, setType] = useState<"text" | "card" | "media">("text")
  const [messageText, setMessageText] = useState("")
  const [cardTitle, setCardTitle] = useState("")
  const [cardSubtitle, setCardSubtitle] = useState("")
  const [cardImage, setCardImage] = useState("")
  const [buttons, setButtons] = useState<ProButton[]>([])
  const [mediaUrl, setMediaUrl] = useState("")
  const [mediaType, setMediaType] = useState<"image" | "video" | "audio">("image")
  const [quickReplies, setQuickReplies] = useState<QuickReplyOption[]>([])

  /* ---------- Public comment reply ---------- */
  const [replyMode, setReplyMode] = useState<"both" | "dm_only" | "public_only">("both")
  const [publicReplies, setPublicReplies] = useState<string[]>([])
  const [includeReplies, setIncludeReplies] = useState(false)

  /* ---------- EXTRAS ---------- */
  const [name, setName] = useState("")
  const [checkFollow, setCheckFollow] = useState(false)
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [typingIndicator, setTypingIndicator] = useState(false)

  const [saving, setSaving] = useState(false)
  const [reels, setReels] = useState<any[]>([])
  const [loadingReels, setLoadingReels] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoadingReels(true)
    fetch(`/api/instagram/media?userId=${userId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        const list = j.data && Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : []
        setReels(list)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingReels(false))
    return () => { cancelled = true }
  }, [userId])

  /* Prefill on edit */
  useEffect(() => {
    if (!editRule) return
    const content: any =
      typeof editRule.response_content === "string"
        ? JSON.parse(editRule.response_content as any)
        : editRule.response_content || {}

    setName(editRule.name)
    if (["mention", "reaction", "reply"].includes(editRule.trigger_type)) {
      setStoryTriggerType(editRule.trigger_type as any)
    }
    const rawTriggers = (editRule.trigger_value || "")
      .split(",").map((t) => t.trim())
      .filter((t) => t && !["ALL", "ALL_COMMENTS", "ALL_MENTIONS", "ALL_REACTIONS"].includes(t.toUpperCase()))
    setTriggers(rawTriggers)

    if (content.media?.url) {
      setType("media"); setMediaUrl(content.media.url); setMediaType(content.media.type || "image"); setMessageText(content.message || "")
    } else if (content.card) {
      setType("card"); setCardTitle(content.card.title || ""); setCardSubtitle(content.card.subtitle || ""); setCardImage(content.card.image_url || "")
      setButtons((content.card.buttons || []).map((b: any, i: number) => ({ id: `${Date.now()}_${i}`, ...b })))
    } else {
      setType("text"); setMessageText(content.message || "")
    }
    setQuickReplies((content.quick_replies || []).map((q: any, i: number) => ({ id: `${Date.now()}_qr${i}`, title: q.title, payload: q.payload })))
    setReplyMode(content.reply_mode || "both")
    setPublicReplies(content.public_replies || [])
    setIncludeReplies(content.include_replies === true)
    setCheckFollow(content.check_follow === true)
    setDelaySeconds(Number(content.delay_seconds) || 0)
    setTypingIndicator(content.typing_indicator === true)
    
    if (editRule.specific_media_id) {
      setSelectedReel({ id: editRule.specific_media_id, caption: "Selected post" })
      setHasSelectedReelOption(true)
    } else {
      setHasSelectedReelOption(false)
    }
  }, [editRule])

  /* Auto name */
  useEffect(() => {
    if (name || isEditing) return
    const isReplyAll = triggerSource === "comment" && triggers.length === 0
    if (isReplyAll) setName("Reply to every comment")
    else if (triggers.length > 0) setName(`Reply to "${triggers[0]}"`)
  }, [triggers, name, isEditing, triggerSource])

  /* ---------- helpers ---------- */
  const addButton = () => {
    if (buttons.length >= 3) return
    setButtons([...buttons, { id: Date.now().toString(), type: "web_url", title: "", url: "", payload: "" }])
  }
  const updateButton = (id: string, field: keyof ProButton, value: string) =>
    setButtons(buttons.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
  const removeButton = (id: string) => setButtons(buttons.filter((b) => b.id !== id))

  const addQuickReply = () => {
    if (quickReplies.length >= 4) return
    setQuickReplies([...quickReplies, { id: Date.now().toString(), title: "" }])
  }
  const updateQuickReply = (id: string, title: string) =>
    setQuickReplies(quickReplies.map((q) => (q.id === id ? { ...q, title } : q)))
  const removeQuickReply = (id: string) => setQuickReplies(quickReplies.filter((q) => q.id !== id))

  const needsKeywords = triggerSource === "dm" || (triggerSource === "story" && storyTriggerType !== "mention")

  const whenValid = triggerSource === "comment" 
    ? hasSelectedReelOption // Comment trigger is valid once they select a specific post or global option
    : !needsKeywords || triggers.length > 0

  const thenValid =
    replyMode === "public_only" ||
    (type === "text" ? messageText.trim().length > 0 : type === "card" ? cardTitle.trim().length > 0 : mediaUrl.trim().length > 0)
  const canSave = whenValid && thenValid && name.trim().length > 0

  const stepValid = [
    whenValid,  // step 0
    thenValid,  // step 1
    name.trim().length > 0, // step 2
  ]

  /* Plain-language summary sentence */
  const summary = useMemo(() => {
    const isReplyAll = triggerSource === "comment" && triggers.length === 0
    const who =
      triggerSource === "comment"
        ? isReplyAll ? "anyone comments on your post" : `someone comments ${triggers.length ? `"${triggers[0]}"` : "a keyword"}`
        : triggerSource === "dm"
          ? `someone DMs you ${triggers.length ? `"${triggers[0]}"` : "a keyword"}`
          : storyTriggerType === "mention" ? "someone mentions you in a story"
            : storyTriggerType === "reaction" ? "someone reacts to your story"
              : "someone replies to your story"
    const what =
      replyMode === "public_only" ? "reply publicly"
        : type === "card" ? "send them a card with buttons"
          : type === "media" ? `send them ${mediaType === "image" ? "an image" : `a ${mediaType}`}`
            : "send them a DM"
    return { who, what }
  }, [triggerSource, triggers, storyTriggerType, replyMode, type, mediaType])

  /* ---------- save ---------- */
  const handleSubmit = async () => {
    if (!canSave || saving) return
    setSaving(true)

    const isReplyAll = triggerSource === "comment" && triggers.length === 0

    const content: any = { check_follow: checkFollow }
    if (delaySeconds > 0) content.delay_seconds = delaySeconds
    if (typingIndicator) content.typing_indicator = true
    if (triggerSource === "comment") {
      content.reply_mode = replyMode
      if (publicReplies.length > 0) content.public_replies = publicReplies
      if (includeReplies) content.include_replies = true
    }
    if (quickReplies.filter((q) => q.title.trim()).length > 0) {
      content.quick_replies = quickReplies.filter((q) => q.title.trim()).map((q) => ({ title: q.title.trim(), payload: q.payload }))
    }

    if (type === "text") {
      content.message = messageText
    } else if (type === "media") {
      content.media = { type: mediaType, url: mediaUrl.trim() }
      if (messageText.trim()) content.message = messageText
    } else {
      const cleanButtons = buttons
        .map((b) => {
          if (b.type === "web_url") {
            let cleanUrl = b.url?.trim() || ""
            if (cleanUrl.startsWith("https://https://")) cleanUrl = cleanUrl.replace("https://https://", "https://")
            return { type: "web_url" as const, title: b.title, url: cleanUrl }
          }
          return { type: "postback" as const, title: b.title, payload: b.payload }
        })
        .filter((b) => b.title)
      content.card = { title: cardTitle, subtitle: cardSubtitle || undefined, image_url: cardImage || undefined, buttons: cleanButtons }
    }

    const payload = {
      userId,
      name,
      trigger_source: triggerSource,
      trigger_type: isReplyAll ? "reply_all" : triggerSource === "story" ? storyTriggerType : "keyword",
      trigger_value: isReplyAll ? "ALL_COMMENTS"
        : triggerSource === "story" && storyTriggerType === "mention" ? "ALL_MENTIONS"
          : triggerSource === "story" && storyTriggerType === "reaction" && triggers.length === 0 ? "ALL_REACTIONS"
            : triggers.length > 0 ? triggers.join(", ") : "ALL",
      content,
      specific_media_id: selectedReel?.id || null,
    }

    try {
      const res = await fetch("/api/automations", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEditing ? { ...payload, id: editRule!.id } : payload),
      })
      if (res.ok) {
        toast.success(isEditing ? "Automation updated" : "Automation is live")
        onSuccess()
      } else {
        toast.error("Could not save — try again")
      }
    } catch {
      toast.error("Network error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Sexy Stepper Timeline ── */}
      <div className="relative rounded-xl border border-border bg-card p-4 md:px-6">
        <div className="flex items-center justify-between gap-4 relative">
          {STEPS.map((s, i) => {
            const isActive = i === step
            const isCompleted = i < step
            return (
              <div key={s.key} className="flex items-center gap-3 flex-1 last:flex-initial">
                <button
                  type="button"
                  onClick={() => { if (i < step || stepValid[step]) setStep(i) }}
                  className="flex items-center gap-3 group text-left focus:outline-none"
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-medium transition-colors ${
                    isCompleted
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-background text-muted-foreground"
                  }`}>
                    {isCompleted ? <Check className="w-4 h-4 stroke-[3]" /> : i + 1}
                  </div>
                  <div className="hidden md:block">
                    <p className={`text-[13px] font-medium ${isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                      {s.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{s.sub}</p>
                  </div>
                </button>
                {i < STEPS.length - 1 && (
                  <div className="relative mx-2 h-px flex-1 overflow-hidden bg-border">
                    <div className={`absolute inset-y-0 left-0 transition-all duration-500 bg-foreground ${
                      isCompleted ? "w-full" : "w-0"
                    }`} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Two Column Workspace ── */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
        {/* ── LEFT: Config Form ── */}
        <div className="space-y-6 rounded-xl border border-border bg-card p-5 md:p-6">
          {/* ===== STEP 1: TRIGGER ===== */}
          {step === 0 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <StepHeader
                number={1}
                title={triggerSource === "comment" ? "Select the target post/reel" : triggerSource === "dm" ? "When someone DMs you" : "When someone interacts with your story"}
                description={triggerSource === "comment" ? "Choose the specific media to automate." : "Set the conditions that launch this automation."}
              />

              {triggerSource === "story" && (
                <div className="space-y-3">
                  <FieldLabel>Select Story Interaction Type</FieldLabel>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { key: "mention" as const, icon: <AtSign className="w-5 h-5" />, label: "Mentions me", desc: "Tagged in a story" },
                      { key: "reaction" as const, icon: <Heart className="w-5 h-5" />, label: "Reacts", desc: "Sends emoji reaction" },
                      { key: "reply" as const, icon: <MessageSquare className="w-5 h-5" />, label: "Replies", desc: "Text reply to story" },
                    ]).map(({ key, icon, label, desc }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStoryTriggerType(key)}
                        className={`p-4 rounded-xl border text-left flex flex-col gap-2 transition-all duration-200 ${
                          storyTriggerType === key
                            ? "border-foreground bg-muted text-foreground"
                            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground bg-muted/60"
                        }`}
                      >
                        <span className={storyTriggerType === key ? "text-foreground" : "text-muted-foreground"}>{icon}</span>
                        <div>
                          <p className="text-[13px] font-medium">{label}</p>
                          <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">{desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {triggerSource === "comment" && (
                <div className="space-y-4">
                  <FieldLabel>Automate which post or reel?</FieldLabel>
                  {loadingReels ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8">
                      <Loader2 className="w-6 h-6 animate-spin text-foreground" />
                      <span className="text-xs text-muted-foreground">Fetching Instagram feed...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto pr-1">
                      {/* Option: Global Post Rule */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReel(null)
                          setHasSelectedReelOption(true)
                        }}
                        className={`aspect-square rounded-xl border flex flex-col items-center justify-center p-4 text-center transition-all duration-200 ${
                          hasSelectedReelOption && selectedReel === null
                            ? "border-foreground bg-muted text-foreground"
                            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground bg-muted/60"
                        }`}
                      >
                        <Globe className="w-8 h-8 mb-2 opacity-80" />
                        <span className="text-[13px] font-medium">All posts & reels</span>
                        <span className="text-[10px] text-muted-foreground mt-1">Global Trigger</span>
                      </button>

                      {reels.map((reel) => {
                        const isSelected = hasSelectedReelOption && selectedReel?.id === reel.id
                        return (
                          <button
                            key={reel.id}
                            type="button"
                            onClick={() => {
                              setSelectedReel(reel)
                              setHasSelectedReelOption(true)
                            }}
                            className={`aspect-square rounded-xl border overflow-hidden relative group text-left transition-all duration-200 ${
                              isSelected
                                ? "border-foreground ring-2 ring-foreground/20"
                                : "border-border bg-muted hover:border-foreground/30"
                            }`}
                          >
                            {reel.image_url ? (
                              <img src={reel.image_url} alt="" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
                            ) : (
                              <div className="w-full h-full bg-card flex items-center justify-center">
                                <Film className="w-6 h-6 text-muted-foreground" />
                              </div>
                            )}

                            {/* Type Overlay */}
                            <span className="absolute left-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground backdrop-blur-sm">
                              {reel.media_type === "STORY" ? "Story" : reel.media_type === "VIDEO" ? "Reel" : "Post"}
                            </span>

                            {/* Selected Check overlay */}
                            {isSelected && (
                              <div className="absolute inset-0 bg-muted flex items-center justify-center backdrop-blur-[1px]">
                                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                                  <Check className="w-4 h-4 stroke-[3]" />
                                </div>
                              </div>
                            )}

                            {/* Caption snippet at bottom */}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent p-2 pt-6">
                              <p className="text-[10px] text-foreground line-clamp-1 font-sans">{reel.caption || "Untitled"}</p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Configure keywords only after selection (for Comment triggers) or always for others */}
              {(triggerSource !== "comment" || hasSelectedReelOption) && (
                <div className="space-y-4 pt-3 border-t border-border animate-in fade-in slide-in-from-top-2 duration-300">
                  {triggerSource === "comment" ? (
                    <div className="space-y-2">
                      <FieldLabel>Keywords to match</FieldLabel>
                      <p className="text-[11px] text-muted-foreground">
                        What keyword triggers this DM? <span className="text-foreground font-semibold">Keep empty to reply to every comment.</span>
                      </p>
                      <TagInput
                        value={triggers}
                        onChange={setTriggers}
                        placeholder="type keyword, press Enter (e.g. guide)"
                      />
                    </div>
                  ) : needsKeywords ? (
                    <div className="space-y-2 rounded-xl border border-border bg-background p-4">
                      <FieldLabel>
                        {triggerSource === "story" && storyTriggerType === "reaction"
                          ? "Only react on these emojis"
                          : "Trigger keywords"}
                      </FieldLabel>
                      <p className="text-[11px] text-muted-foreground mb-3">
                        {triggerSource === "story" && storyTriggerType === "reaction"
                          ? "Leave empty to trigger on any emoji reaction."
                          : "Matches exact phrases or words (case-insensitive)."}
                      </p>
                      <TagInput
                        value={triggers}
                        onChange={setTriggers}
                        placeholder={
                          triggerSource === "story" && storyTriggerType === "reaction" ? "e.g. ❤️, 🔥, 👍" : "type keyword, press Enter (e.g. price)"
                        }
                      />
                    </div>
                  ) : null}

                  {triggerSource === "comment" && triggers.length > 0 && (
                    <ToggleRow
                      icon={<MessageSquare className="w-5 h-5" />}
                      title="Check replies to comments"
                      sub="Normally only primary post comments trigger replies"
                      on={includeReplies}
                      onToggle={() => setIncludeReplies(!includeReplies)}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== STEP 2: RESPONSE ===== */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <StepHeader
                number={2}
                title="Compose response message"
                description="Pick the format and craft the message sent to prospects."
              />

              {triggerSource === "comment" && (
                <div className="space-y-2">
                  <FieldLabel>Flow direction</FieldLabel>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: "both" as const, label: "Reply + DM" },
                      { key: "public_only" as const, label: "Reply only" },
                      { key: "dm_only" as const, label: "DM only" },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setReplyMode(key)}
                        className={`h-10 rounded-lg border text-[13px] font-medium transition-colors ${
                          replyMode === key ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {triggerSource === "comment" && replyMode !== "dm_only" && (
                <div className="space-y-2 rounded-xl border border-border bg-background p-4">
                  <FieldLabel>Public comments rotation</FieldLabel>
                  <p className="text-[11px] text-muted-foreground mb-3">Add multiple phrases. We rotate them dynamically to look human.</p>
                  <TagInput value={publicReplies} onChange={setPublicReplies} placeholder={'e.g. "Sent you a DM!", "Check your inbox!"'} />
                </div>
              )}

              {replyMode !== "public_only" && (
                <div className="space-y-5 pt-2">
                  <div className="space-y-2">
                    <FieldLabel>Direct Message Format</FieldLabel>
                    <div className="grid grid-cols-3 gap-3">
                      {([
                        { key: "text" as const, icon: <MessageCircle className="w-4.5 h-4.5" />, label: "Text Only" },
                        { key: "card" as const, icon: <Link2 className="w-4.5 h-4.5" />, label: "Card / Link" },
                        { key: "media" as const, icon: <ImageIcon className="w-4.5 h-4.5" />, label: "Rich Media" },
                      ]).map(({ key, icon, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setType(key)}
                          className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-[13px] font-medium transition-colors ${
                            type === key ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {icon}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {type === "text" && (
                    <div className="space-y-2">
                      <FieldLabel>DM Message Text</FieldLabel>
                      <textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        rows={5}
                        maxLength={1000}
                        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                        placeholder="Type the message to send in DMs..."
                      />
                      <p className="numeric text-right text-[11px] text-muted-foreground">{messageText.length}/1000</p>
                    </div>
                  )}

                  {type === "card" && (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <FieldLabel>Card configuration</FieldLabel>
                        <TextField value={cardTitle} onChange={setCardTitle} placeholder="Card main title" />
                        <TextField value={cardSubtitle} onChange={setCardSubtitle} placeholder="Subtitle description (optional)" />
                        <TextField value={cardImage} onChange={setCardImage} placeholder="Cover image URL (optional)" />
                      </div>
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between border-b border-border pb-2">
                          <FieldLabel>Interactive buttons ({buttons.length}/3)</FieldLabel>
                          <button type="button" onClick={addButton} disabled={buttons.length >= 3}
                            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1 transition-colors">
                            <Plus className="w-3 h-3" /> Add button
                          </button>
                        </div>
                        {buttons.map((btn) => (
                          <div key={btn.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5">
                            <input
                              value={btn.title}
                              onChange={(e) => updateButton(btn.id, "title", e.target.value)}
                              className="h-8 text-xs flex-1 bg-transparent border-none px-2 text-foreground placeholder:text-muted-foreground focus:outline-none"
                              placeholder="Button label"
                            />
                            <select
                              value={btn.type}
                              onChange={(e) => updateButton(btn.id, "type", e.target.value)}
                              className="h-8 text-[11px] bg-background border border-border rounded-lg px-2 text-foreground focus:outline-none"
                            >
                              <option value="web_url">Open Link</option>
                              <option value="postback">Trigger Flow</option>
                            </select>
                            <input
                              value={btn.type === "web_url" ? btn.url : btn.payload}
                              onChange={(e) => updateButton(btn.id, btn.type === "web_url" ? "url" : "payload", e.target.value)}
                              className="h-8 text-xs flex-1 bg-transparent border-none px-2 text-foreground placeholder:text-muted-foreground focus:outline-none font-mono"
                              placeholder={btn.type === "web_url" ? "https://link" : "flow_keyword"}
                            />
                            <button type="button" onClick={() => removeButton(btn.id)} className="text-muted-foreground hover:text-destructive p-1.5 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {type === "media" && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <FieldLabel>Select File Type</FieldLabel>
                        <div className="grid grid-cols-3 gap-2">
                          {(["image", "video", "audio"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setMediaType(m)}
                              className={`h-10 rounded-lg border text-[13px] font-medium transition-colors ${
                                mediaType === m ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {m === "image" ? "Photo" : m === "video" ? "Video" : "Audio"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <TextField value={mediaUrl} onChange={setMediaUrl} placeholder="Link to public media file (e.g. mp4, jpg)" />
                      <TextField value={messageText} onChange={setMessageText} placeholder="Optional caption message to send after..." />
                    </div>
                  )}

                  {type !== "card" && (
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between border-b border-border pb-2">
                        <FieldLabel>Quick Reply chips ({quickReplies.length}/4)</FieldLabel>
                        <button type="button" onClick={addQuickReply} disabled={quickReplies.length >= 4}
                          className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1 transition-colors">
                          <Plus className="w-3 h-3" /> Add chip
                        </button>
                      </div>
                      {quickReplies.length > 0 && (
                        <div className="space-y-2">
                          {quickReplies.map((q) => (
                            <div key={q.id} className="flex gap-2 items-center">
                              <input
                                value={q.title}
                                onChange={(e) => updateQuickReply(q.id, e.target.value)}
                                maxLength={20}
                                className="h-10 text-xs flex-1 bg-muted/60 border border-border rounded-xl px-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40"
                                placeholder='e.g. "Send Details!"'
                              />
                              <button type="button" onClick={() => removeQuickReply(q.id)} className="text-muted-foreground hover:text-destructive p-1.5 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===== STEP 3: SETTINGS ===== */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <StepHeader
                number={3}
                title="Configure rules & name"
                description="Finalize performance parameters and activate the automation."
              />

              <div className="space-y-2">
                <FieldLabel>Automation identifier name</FieldLabel>
                <TextField value={name} onChange={setName} placeholder='e.g. "Free Ebook Download Trigger"' />
              </div>

              <div className="space-y-4">
                <FieldLabel>Delivery options</FieldLabel>
                <ToggleRow icon={<Lock className="w-5 h-5" />} title="Follow gate required" sub="Only followers get the payload. Non-followers get follow prompt first." on={checkFollow} onToggle={() => setCheckFollow(!checkFollow)} />
                <ToggleRow icon={<Eye className="w-5 h-5" />} title="Mimic active typing status" sub="Displays typing bubble indicators to look completely organic." on={typingIndicator} onToggle={() => setTypingIndicator(!typingIndicator)} />
                
                <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                      <Timer className="h-4 w-4" strokeWidth={1.8} />
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-foreground">Randomized delivery delay</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Waits before sending to simulate real human delays.</p>
                    </div>
                  </div>
                  <select
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Number(e.target.value))}
                    className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none hover:border-foreground/30 transition-all cursor-pointer"
                  >
                    <option value={0}>Send Immediately</option>
                    <option value={3}>3s delay</option>
                    <option value={5}>5s delay</option>
                    <option value={10}>10s delay</option>
                    <option value={30}>30s delay</option>
                  </select>
                </div>
              </div>

              {/* Plain-text Summary Panel */}
              <div className="space-y-2 rounded-xl border border-border bg-muted/50 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[13px] font-medium text-foreground">Rule summary</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed">
                  When <span className="text-foreground font-semibold underline decoration-border decoration-2 underline-offset-2">{summary.who}</span>, we will <span className="text-foreground font-semibold">{summary.what}</span>.
                </p>
              </div>
            </div>
          )}

          {/* ── Wizard Foot Navigation ── */}
          <div className="flex items-center justify-between border-t border-border pt-6">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            ) : <div />}

            {step < 2 ? (
              <button
                type="button"
                onClick={() => { if (stepValid[step]) setStep(step + 1) }}
                disabled={!stepValid[step]}
                className="ml-auto flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSave || saving}
                className="ml-auto flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {saving ? "Saving…" : isEditing ? "Save automation" : "Go live"}
              </button>
            )}
          </div>
        </div>

        {/* ── RIGHT: iPhone Mockup ── */}
        {replyMode !== "public_only" && (
          <div className="hidden lg:block sticky top-6">
            <div className="text-center mb-3">
              <span className="text-[11px] text-muted-foreground">Live preview</span>
            </div>
            
            {/* iPhone Outer Frame */}
            <div className="relative flex h-[580px] w-[320px] flex-col overflow-hidden rounded-[2.5rem] border-[10px] border-foreground/85 bg-background shadow-xl">
              
              {/* iPhone Dynamic Island */}
              <div className="absolute left-1/2 top-2 z-50 flex h-5 w-24 -translate-x-1/2 items-center justify-center rounded-full bg-foreground/85">
                <div className="ml-auto mr-3 h-2 w-2 rounded-full bg-background/40" />
              </div>

              {/* Status Bar Mockup */}
              <div className="h-8 bg-background flex items-end justify-between px-6 pb-1 text-[10px] text-foreground/80 z-40 select-none">
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <span>5G</span>
                  <div className="w-4 h-2 border border-border rounded-sm p-[1px] flex items-center"><div className="w-2 h-full bg-foreground rounded-2xs" /></div>
                </div>
              </div>

              {/* True-to-life Instagram DM Header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
                <div className="flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4 shrink-0 text-foreground cursor-pointer" />
                  <div className="relative shrink-0 w-8 h-8">
                    <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-tr from-[#8a3ab9] via-[#e95950] to-[#fccc63] p-[1.5px]">
                      <div className="w-full h-full rounded-full bg-background flex items-center justify-center text-[10px] leading-none font-bold text-foreground font-mono">
                        {(editRule?.name || "T").substring(0,1).toUpperCase()}
                      </div>
                    </div>
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-background" />
                  </div>
                  <div className="leading-tight min-w-0">
                    <p className="text-[11px] font-semibold text-foreground truncate max-w-[100px]">@{userId ? "anuzz.joshi" : "creator"}</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Active now</p>
                  </div>
                </div>
                <div className="flex items-center gap-3.5 text-foreground">
                  <Phone className="w-3.5 h-3.5" />
                  <Video className="w-3.5 h-3.5" />
                  <Info className="w-3.5 h-3.5" />
                </div>
              </div>

              {/* Screen Body */}
              <div className="flex-1 bg-background px-3 py-4 space-y-4 overflow-y-auto font-sans flex flex-col justify-end">
                {/* Incoming bubble */}
                <div className="flex justify-start items-end gap-1.5">
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] text-foreground">U</div>
                  <div className="bg-muted text-foreground rounded-2xl rounded-bl-sm px-3.5 py-2 text-xs max-w-[75%] shadow-md">
                    {incomingMsg(triggerSource, triggers)}
                  </div>
                </div>

                {/* Typing indicator simulator */}
                {typingIndicator && (
                  <div className="flex justify-end pr-1 animate-pulse">
                    <span className="text-[10px] text-muted-foreground italic">typing indicator active...</span>
                  </div>
                )}

                {/* Outgoing Reply Bubble */}
                {hasDMContent(type, messageText, cardTitle, mediaUrl) ? (
                  <div className="flex justify-end items-end gap-1.5 animate-in fade-in zoom-in-95 duration-200">
                    <div className="max-w-[80%] space-y-1.5 flex flex-col items-end">
                      {type === "text" && (
                        <div className="bg-[#3797f0] text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-xs whitespace-pre-wrap break-words leading-relaxed shadow-lg">
                          {messageText || "Type message content..."}
                        </div>
                      )}
                      {type === "card" && (
                        <div className="w-48 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                          {cardImage && cardImage.startsWith("http") && (
                            <img src={cardImage} alt="" className="w-full h-24 object-cover" loading="lazy" />
                          )}
                          <div className="p-3">
                            <p className="line-clamp-1 text-xs font-medium text-foreground">{cardTitle || "Card title"}</p>
                            {cardSubtitle && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 leading-tight">{cardSubtitle}</p>}
                          </div>
                          {buttons.filter((b) => b.title).map((b) => (
                            <div key={b.id} className="cursor-pointer border-t border-border bg-muted/50 py-2 text-center text-[11px] font-medium text-foreground transition-colors hover:bg-muted">
                              {b.title}
                            </div>
                          ))}
                        </div>
                      )}
                      {type === "media" && (
                        <div className="group relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card">
                          {mediaType === "image" && mediaUrl.startsWith("http") ? (
                            <img src={mediaUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                              <ImageIcon className="w-6 h-6" />
                              <span className="text-[11px]">{mediaType}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {type === "media" && messageText && (
                        <div className="bg-[#3797f0] text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-xs leading-relaxed shadow-lg">{messageText}</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end animate-pulse">
                    <div className="border border-dashed border-border bg-muted/60 rounded-2xl px-4 py-3 text-[10px] text-muted-foreground italic text-center w-full">
                      Configure step 2 to build payload
                    </div>
                  </div>
                )}

                {/* Quick Reply Pills */}
                {type !== "card" && quickReplies.filter((q) => q.title.trim()).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 justify-end pt-2">
                    {quickReplies.filter((q) => q.title.trim()).map((q) => (
                      <span key={q.id} className="border border-[#3797f0] text-[#3797f0] hover:bg-[#3797f0]/5 cursor-pointer rounded-full px-3 py-1 text-[10px] font-bold transition-all">
                        {q.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* iPhone Footer Navigation Bar */}
              <div className="h-12 bg-background border-t border-border flex items-center justify-between px-5 text-muted-foreground">
                <Camera className="w-4 h-4" />
                <div className="flex-1 max-w-[150px] h-7 bg-card border border-border rounded-full px-3 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Message...</span>
                  <Smile className="w-3 h-3" />
                </div>
                <Mic className="w-4 h-4" />
                <PicIcon className="w-4 h-4" />
              </div>

              {/* iPhone Bottom Bar Indicator */}
              <div className="h-5 bg-background flex items-center justify-center pb-1">
                <div className="w-24 h-1 bg-foreground/40 rounded-full" />
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   Helper renders & string parsers
   ============================================================ */

function incomingMsg(triggerSource: string, triggers: string[]): string {
  const primaryKw = triggers.length > 0 ? triggers[0] : null
  if (triggerSource === "comment") {
    return primaryKw ? `Commented "${primaryKw}"` : "Commented on post"
  }
  if (triggerSource === "story") {
    return "Interacted with your Story"
  }
  return primaryKw ? `DMed keyword "${primaryKw}"` : "Sent you a message"
}

function hasDMContent(type: string, messageText: string, cardTitle: string, mediaUrl: string): boolean {
  if (type === "text" && messageText.trim().length > 0) return true
  if (type === "card" && cardTitle.trim().length > 0) return true
  if (type === "media" && mediaUrl.trim().length > 0) return true
  return false
}

function StepHeader({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="border-b border-border pb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="px-2 py-0.5 rounded-md bg-muted border border-foreground/40 text-[10px] font-bold uppercase tracking-wider text-foreground">
          Phase {number}
        </div>
      </div>
      <h3 className="text-xl font-bold text-foreground tracking-tight">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[13px] font-medium text-foreground">{children}</p>
}

function TextField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 bg-muted/60 border border-border rounded-xl px-4 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 focus:bg-muted/60 transition-all"
    />
  )
}

function ToggleRow({
  icon, title, sub, on, onToggle,
}: {
  icon: React.ReactNode
  title: string
  sub: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3.5 rounded-xl border p-4 text-left transition-colors ${
        on ? "border-border bg-muted" : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <span className={on ? "text-foreground" : "text-muted-foreground"}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">{sub}</span>
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-border"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  )
}
