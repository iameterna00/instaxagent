"use client"

import { useState, useCallback, useEffect } from "react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { AutomationList } from "@/components/dashboard/AutomationList"
import { CreateRuleForm } from "@/components/dashboard/CreateRuleForm"
import { AiAgentPanel } from "@/components/dashboard/AiAgentPanel"
import { MessageCircle, Send, Sparkles, Plus, Brain, Loader2 } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import type { Automation } from "@/lib/types"

export default function AutomationsPage() {
    const { userId, isLoading: isSessionLoading } = useInstagramSession()
    const [automations, setAutomations] = useState<Automation[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'comment' | 'dm' | 'story' | 'ai'>('comment')
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [editRule, setEditRule] = useState<Automation | null>(null)
    const [aiEnabled, setAiEnabled] = useState(false)

    const fetchAutomations = useCallback(async () => {
        if (!userId) return
        try {
            const res = await fetch(`/api/automations?userId=${userId}`)
            const data = await res.json()
            if (res.ok) setAutomations(Array.isArray(data) ? data : [])
        } catch (err) {
            console.error("Fetch error:", err)
        } finally {
            setIsLoading(false)
        }
    }, [userId])

    useEffect(() => {
        if (userId) fetchAutomations()
    }, [userId, fetchAutomations])

    // Just enough to label the button before the panel is opened.
    useEffect(() => {
        if (!userId) return
        fetch(`/api/ai/settings?userId=${userId}`)
            .then(res => res.json())
            .then(data => setAiEnabled(Boolean(data?.is_enabled)))
            .catch(() => { })
    }, [userId])

    const handleDeleteRule = async (id: string) => {
        await fetch(`/api/automations?id=${id}`, { method: "DELETE" })
        fetchAutomations()
    }

    const handleEditRule = (rule: Automation) => {
        setEditRule(rule)
        setShowCreateForm(true)
    }

    if (isSessionLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    if (!userId) return <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">Please log in</div>

    const filteredAutomations = automations.filter(a => a.trigger_source === activeTab)
    const counts = {
        comment: automations.filter(a => a.trigger_source === 'comment').length,
        dm: automations.filter(a => a.trigger_source === 'dm').length,
        story: automations.filter(a => a.trigger_source === 'story').length,
    }

    const tabs = [
        { key: 'comment' as const, icon: <MessageCircle className="w-4 h-4" />, label: 'Comments', count: counts.comment },
        { key: 'dm' as const, icon: <Send className="w-4 h-4" />, label: 'DMs', count: counts.dm },
        { key: 'story' as const, icon: <Sparkles className="w-4 h-4" />, label: 'Stories', count: counts.story },
        { key: 'ai' as const, icon: <Brain className="w-4 h-4" />, label: 'AI Agent', count: 0 },
    ]

    const isAiTab = activeTab === 'ai'
    // The AI tab isn't a rule source — fall back to a real one for the rule form.
    const ruleTab = isAiTab ? 'comment' : activeTab

    return (
        <div className="mx-auto max-w-5xl space-y-6 p-6 md:p-8">
            <PageHeader
                title="Automations"
                description="Triggers and replies that run while you're away."
            >
                {!isAiTab && (
                    <button
                        onClick={() => {
                            if (showCreateForm) setEditRule(null)
                            setShowCreateForm(!showCreateForm)
                        }}
                        className={`flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-colors ${
                            showCreateForm
                                ? 'border border-border text-foreground hover:bg-muted'
                                : 'bg-primary text-primary-foreground hover:opacity-90'
                        }`}
                    >
                        <Plus className={`h-4 w-4 transition-transform duration-200 ${showCreateForm ? 'rotate-45' : ''}`} />
                        {showCreateForm ? 'Close' : 'New rule'}
                    </button>
                )}
            </PageHeader>

            {/* Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
                {tabs.map((tab) => {
                    const active = activeTab === tab.key
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13px] transition-colors ${
                                active
                                    ? 'border-foreground font-medium text-foreground'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {tab.key === 'ai' ? (
                                // On/off at a glance, so the agent's state is never a surprise.
                                <span
                                    title={aiEnabled ? 'AI agent is on' : 'AI agent is off'}
                                    className={`h-1.5 w-1.5 rounded-full ${
                                        aiEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                                    }`}
                                />
                            ) : tab.count > 0 ? (
                                <span className={`numeric rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                                    active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                                }`}>
                                    {tab.count}
                                </span>
                            ) : null}
                        </button>
                    )
                })}
            </div>

            {isAiTab ? (
                <AiAgentPanel userId={userId} onEnabledChange={setAiEnabled} />
            ) : (
                <>
                    {/* Create Form (Collapsible) */}
                    {showCreateForm && (
                        <div className="rounded-xl border border-border bg-card p-5 duration-300 animate-in fade-in slide-in-from-top-2 md:p-6">
                            <CreateRuleForm
                                userId={userId}
                                triggerSource={editRule ? editRule.trigger_source : ruleTab}
                                editRule={editRule}
                                onSuccess={() => {
                                    fetchAutomations()
                                    setShowCreateForm(false)
                                    setEditRule(null)
                                }}
                            />
                        </div>
                    )}

                    {/* Automation List */}
                    {isLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <AutomationList
                            automations={filteredAutomations}
                            onDelete={handleDeleteRule}
                            onEdit={handleEditRule}
                            onChanged={fetchAutomations}
                            userId={userId}
                        />
                    )}
                </>
            )}
        </div>
    )
}
