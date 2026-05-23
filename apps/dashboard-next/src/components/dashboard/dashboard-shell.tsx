"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  AudioLines,
  BarChart3,
  Boxes,
  Cable,
  ClipboardList,
  Gauge,
  Layers3,
  Menu,
  Network,
  Route,
  Settings,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/routing", label: "Routing", icon: Route },
  { href: "/providers", label: "Providers", icon: Cable },
  { href: "/usage", label: "Usage", icon: BarChart3 },
  { href: "/quota", label: "Quota", icon: ShieldCheck },
  { href: "/media", label: "Media", icon: AudioLines },
  { href: "/proxy", label: "Proxy", icon: Network },
  { href: "/logs", label: "Logs", icon: TerminalSquare },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function DashboardShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-72 shrink-0 border-r bg-sidebar lg:flex">
        <SidebarContent />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
              <SidebarContent onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Activity className="size-4 text-emerald-600" />
            <span className="truncate text-sm font-medium">Pie Lab Router Console</span>
          </div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span>API</span>
            <code className="rounded border bg-muted px-1.5 py-0.5">127.0.0.1:4873</code>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex min-h-full w-full flex-col">
      <div className="px-5 py-5">
        <Link href="/" className="flex items-center gap-3" onClick={onNavigate}>
          <div className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
            <Boxes className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">Pie Lab</p>
            <p className="truncate text-xs text-muted-foreground">Agentic development kit</p>
          </div>
        </Link>
      </div>
      <Separator />
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
      <Separator />
      <div className="space-y-2 px-5 py-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Layers3 className="size-4" />
          <span>Next.js 16 + shadcn/ui</span>
        </div>
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4" />
          <span>9router-style pages</span>
        </div>
      </div>
    </div>
  )
}

function NavLink({
  item,
  onNavigate,
}: {
  item: (typeof navItems)[number]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}
