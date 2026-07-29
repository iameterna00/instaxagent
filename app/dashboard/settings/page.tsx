"use client"

import { Settings } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { ThemeToggle } from "@/components/layout/theme-toggle"

export default function SettingsPage() {
    return (
        <div className="mx-auto max-w-3xl space-y-6 p-6 md:p-8">
            <PageHeader
                title="Settings"
                description="Account preferences, notifications, and integrations."
            />

            <div className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-5 py-4">
                    <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                </div>
                <div className="flex items-center justify-between gap-4 px-5 py-4">
                    <div>
                        <p className="text-[13px] font-medium text-foreground">Theme</p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                            Light, dark, or match your system.
                        </p>
                    </div>
                    <ThemeToggle />
                </div>
            </div>

            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                    <Settings className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h2 className="text-base font-medium text-foreground">More settings coming soon</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Account preferences, notification rules, and integration keys will live here.
                </p>
            </div>
        </div>
    )
}
