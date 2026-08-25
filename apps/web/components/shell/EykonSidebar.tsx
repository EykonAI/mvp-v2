'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Globe2,
  Sparkles,
  Bell,
  LayoutDashboard,
  Rss,
  Users,
  Trophy,
  MessagesSquare,
  Mail,
  UserCircle,
  Rocket,
  FileText,
  Newspaper,
  Target,
  GitMerge,
  SlidersHorizontal,
  Settings,
  CreditCard,
  ChevronRight,
} from 'lucide-react';

import { MODULE_LABELS, MODULE_SLUGS } from '@/lib/intel/modules';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// ── Nav data ─────────────────────────────────────────────────────────
// Routes mirror the six-pillar TopNav cluster + the CommMenu / BriefsMenu
// dropdown contents. Intel sub-items come from the canonical module
// registry (lib/intel/modules) so a new workspace shows up here for free.

const PLATFORM = [
  { href: '/app', label: 'Globe', icon: Globe2 },
  { href: '/analyst', label: 'AI Analyst', icon: Sparkles },
  { href: '/notif', label: 'Notifications', icon: Bell },
];

const COMMUNITY = [
  { href: '/radar', label: 'Radar', icon: Rss },
  { href: '/rooms', label: 'Rooms', icon: Users },
  { href: '/spaces', label: 'Spaces', icon: Rocket },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/messages', label: 'Messages', icon: Mail },
  { href: '/me', label: 'Profile', icon: UserCircle },
];

const BRIEFS = [
  { href: '/briefs', label: 'Today', icon: Newspaper, exact: true },
  { href: '/briefs/briefings', label: 'Briefings', icon: FileText },
  { href: '/briefs/forecasts', label: 'Forecasts', icon: Target },
  { href: '/briefs/convergence', label: 'Convergence', icon: GitMerge },
  { href: '/briefs/preferences', label: 'Delivery', icon: SlidersHorizontal },
];

const ACCOUNT = [
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/billing', label: 'Billing', icon: CreditCard },
];

const INTEL_ITEMS = MODULE_SLUGS.map((slug) => ({
  href: `/intel/${slug}`,
  label: MODULE_LABELS[slug],
}));

function isActive(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function EykonSidebar() {
  const pathname = usePathname() ?? '';
  const intelOpen = pathname.startsWith('/intel');

  return (
    <Sidebar collapsible="icon">
      {/* Brand — same mark + wordmark as the old TopNav */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="eYKON.ai — back to the globe">
              <Link href="/app">
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/10">
                  <svg viewBox="0 0 28 18" width="22" height="14" aria-hidden="true" focusable="false">
                    <path
                      d="M2 9 L14 2 L26 9 L14 16 Z"
                      fill="none"
                      stroke="var(--teal)"
                      strokeWidth="1.4"
                    />
                    <circle cx="14" cy="9" r="1.8" fill="var(--teal)" />
                  </svg>
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span
                    className="truncate font-display text-base font-medium"
                    style={{ letterSpacing: '0.12em' }}
                  >
                    eYKON
                    <sup
                      className="font-mono text-primary"
                      style={{ fontSize: 9, letterSpacing: '0.15em', marginLeft: 2 }}
                    >
                      .ai
                    </sup>
                  </span>
                  <span className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    Geopolitical Intelligence
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Platform */}
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            {PLATFORM.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(pathname, item.href)}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    <item.icon aria-hidden="true" focusable="false" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}

            {/* Intel — collapsible with the nine workspaces */}
            <Collapsible asChild defaultOpen={intelOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    isActive={intelOpen}
                    tooltip="Intelligence Center"
                  >
                    <LayoutDashboard aria-hidden="true" focusable="false" />
                    <span>Intel</span>
                    <ChevronRight aria-hidden="true" focusable="false" className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild isActive={pathname === '/intel'}>
                        <Link href="/intel">
                          <span>Dashboard</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    {INTEL_ITEMS.map((item) => (
                      <SidebarMenuSubItem key={item.href}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isActive(pathname, item.href)}
                        >
                          <Link href={item.href}>
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>

        {/* Briefs */}
        <SidebarGroup>
          <SidebarGroupLabel>Briefs</SidebarGroupLabel>
          <SidebarMenu>
            {BRIEFS.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(pathname, item.href, item.exact)}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    <item.icon aria-hidden="true" focusable="false" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Community */}
        <SidebarGroup>
          <SidebarGroupLabel>Community</SidebarGroupLabel>
          <SidebarMenu>
            {COMMUNITY.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(pathname, item.href)}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    <item.icon aria-hidden="true" focusable="false" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* Account */}
      <SidebarFooter>
        <SidebarMenu>
          {ACCOUNT.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={isActive(pathname, item.href)}
                tooltip={item.label}
              >
                <Link href={item.href}>
                  <item.icon aria-hidden="true" focusable="false" />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
