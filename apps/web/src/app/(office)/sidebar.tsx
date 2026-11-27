"use client";

import type { SidebarDepartment } from "@squadai/db";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";

interface SidebarProps {
  departments: SidebarDepartment[];
  waiting: number;
  user: { name: string; email: string };
  workspaceName: string;
}

const ICONS = {
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  chip: "M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3M6 6h12v12H6z",
  plug: "M9 2v6m6-6v6M7 8h10v4a5 5 0 0 1-10 0zm5 9v5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  search: "m20 20-3.5-3.5M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14",
  panel: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm5 0v14",
  plus: "M12 5v14M5 12h14",
  chevron: "m6 9 6 6 6-6",
};

/** Per-browser conveniences: they may be unavailable (private mode), so never required. */
function remember<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function recall<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * The office navigation. Teams are grouped by department, each group folds
 * away, and a search (⌘K) finds a team when there are many. On desktop the
 * whole sidebar can shrink to a rail of icons.
 */
export function Sidebar({ departments, waiting, user, workspaceName }: SidebarProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const [rail, setRail] = useState(false);
  const [folded, setFolded] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // Restore after hydration, so the server and the first render agree.
  useEffect(() => {
    setRail(recall("squadai.sidebar.rail", false));
    setFolded(recall<string[]>("squadai.sidebar.folded", []));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setRail(false);
        requestAnimationFrame(() => search.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleRail = () => {
    setRail((r) => {
      remember("squadai.sidebar.rail", !r);
      return !r;
    });
  };
  const toggleFold = (id: string) => {
    setFolded((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      remember("squadai.sidebar.folded", next);
      return next;
    });
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return departments.flatMap((d) =>
      d.teams.filter((team) => `${team.name} ${d.name}`.toLowerCase().includes(q)),
    );
  }, [departments, query]);

  const itemClass = (active: boolean) =>
    `flex h-10 items-center gap-3 rounded-xl px-3 text-sm ${
      active
        ? "bg-brand-soft font-semibold text-brand-strong"
        : "font-medium text-ink-2 hover:bg-canvas"
    } ${rail ? "lg:justify-center lg:px-0" : ""}`;
  const label = rail ? "lg:sr-only" : "";

  const teamLink = (team: SidebarDepartment["teams"][number]) => {
    const href = `/teams/${team.slug}`;
    const active = pathname === href;
    return (
      <Link
        key={team.id}
        href={href}
        title={rail ? team.name : undefined}
        aria-current={active ? "page" : undefined}
        className={itemClass(active)}
      >
        <span
          className="relative size-2.5 shrink-0 rounded-[3px]"
          style={{ background: team.color }}
        >
          {team.working && (
            <span className="absolute -top-1 -right-1 size-2 animate-pulse rounded-full border border-surface bg-ok" />
          )}
        </span>
        <span className={`min-w-0 flex-1 truncate ${label}`}>{team.name}</span>
        {team.working && <span className="sr-only">{t("working")}</span>}
        {team.waiting > 0 && (
          <span
            className={`grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white ${rail ? "lg:hidden" : ""}`}
          >
            {team.waiting}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside
      className={`flex max-w-full flex-[1_1_240px] flex-col gap-4 border-line border-r bg-surface px-3 py-4 transition-[width] duration-200 md:max-w-[248px] lg:h-screen lg:flex-none lg:overflow-y-auto ${
        rail ? "lg:w-[68px] lg:px-2.5" : "lg:w-[248px]"
      }`}
    >
      <div className={`flex items-center justify-between gap-2 ${rail ? "lg:flex-col" : ""}`}>
        <Link href="/" className={`px-2 ${rail ? "lg:px-0" : ""}`} aria-label={t("home")}>
          <Logo />
        </Link>
        <button
          type="button"
          onClick={toggleRail}
          aria-label={rail ? t("expand") : t("collapse")}
          title={rail ? t("expand") : t("collapse")}
          className="hidden size-9 place-items-center rounded-lg text-subtle hover:bg-canvas hover:text-ink lg:grid"
        >
          <Icon d={ICONS.panel} />
        </button>
      </div>

      <Link
        href="/new-request"
        title={rail ? t("newRequest") : undefined}
        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand-strong"
      >
        <Icon d={ICONS.plus} />
        <span className={label}>{t("newRequest")}</span>
      </Link>

      <label
        className={`flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-subtle focus-within:border-brand ${rail ? "lg:hidden" : ""}`}
      >
        <Icon d={ICONS.search} size={16} />
        <span className="sr-only">{t("search")}</span>
        <input
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder={t("search")}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
        />
        <kbd className="rounded-md border border-line px-1.5 text-[11px] text-subtle">⌘K</kbd>
      </label>

      <nav aria-label={t("main")} className="flex flex-col gap-0.5">
        <Link
          href="/"
          title={rail ? t("home") : undefined}
          className={itemClass(pathname === "/")}
          aria-current={pathname === "/" ? "page" : undefined}
        >
          <Icon d={ICONS.home} />
          <span className={`flex-1 ${label}`}>{t("home")}</span>
        </Link>
        <Link
          href="/waiting"
          title={rail ? t("waiting") : undefined}
          className={`${itemClass(pathname === "/waiting")} relative`}
          aria-current={pathname === "/waiting" ? "page" : undefined}
        >
          <Icon d={ICONS.clock} />
          <span className={`flex-1 ${label}`}>{t("waiting")}</span>
          {waiting > 0 && (
            <span
              className={`grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#FFE4C2] px-1.5 text-xs font-bold text-warn ${rail ? "lg:absolute lg:-top-1 lg:right-0 lg:h-4 lg:min-w-4 lg:text-[10px]" : ""}`}
            >
              {waiting}
            </span>
          )}
        </Link>
      </nav>

      <nav aria-label={t("teams")} className="flex flex-col gap-3">
        {matches ? (
          <div className="flex flex-col gap-0.5">
            {matches.length === 0 && (
              <p className="px-3 py-2 text-sm text-subtle">{t("noMatch")}</p>
            )}
            {matches.map(teamLink)}
          </div>
        ) : (
          departments.map((d) => {
            const hasActive = d.teams.some((team) => pathname === `/teams/${team.slug}`);
            const open = rail || hasActive || !folded.includes(d.id);
            const waitingHere = d.teams.reduce((n, team) => n + team.waiting, 0);
            return (
              <div key={d.id} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleFold(d.id)}
                  aria-expanded={open}
                  className={`flex h-7 items-center gap-1.5 rounded-lg px-3 text-left text-[11px] font-bold tracking-wider text-subtle uppercase hover:text-ink ${rail ? "lg:hidden" : ""}`}
                >
                  <span className={`transition-transform ${open ? "" : "-rotate-90"}`}>
                    <Icon d={ICONS.chevron} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  {!open && waitingHere > 0 && (
                    <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-white normal-case">
                      {waitingHere}
                    </span>
                  )}
                  <span className="font-medium normal-case">{d.teams.length}</span>
                </button>
                {rail && <span className="mx-3 hidden border-line border-t lg:block" />}
                {open && d.teams.map(teamLink)}
              </div>
            );
          })
        )}
        <Link
          href="/hire"
          title={rail ? t("hire") : undefined}
          aria-current={pathname === "/hire" ? "page" : undefined}
          className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-xl border border-dashed px-3 text-sm font-semibold text-brand-strong ${
            pathname === "/hire" ? "border-brand bg-brand-soft" : "border-[#C9CDE0]"
          } ${rail ? "lg:justify-center lg:px-0" : ""}`}
        >
          <Icon d={ICONS.plus} size={16} />
          {/* The text starts with its own "+"; the icon stands in for it. */}
          <span className={label}>{t("hire").replace(/^\+\s*/, "")}</span>
        </Link>
      </nav>

      <div className="mt-auto flex flex-col gap-1.5 border-line border-t pt-3">
        {[
          ["/models", t("models"), ICONS.chip],
          ["/integrations", t("integrations"), ICONS.plug],
          ["/audit", t("audit"), ICONS.list],
        ].map(([href, text, icon]) => (
          <Link
            key={href}
            href={href as string}
            title={rail ? (text as string) : undefined}
            aria-current={pathname === href ? "page" : undefined}
            className={itemClass(pathname === href)}
          >
            <Icon d={icon as string} />
            <span className={`flex-1 ${label}`}>{text}</span>
          </Link>
        ))}
        <div
          className={`flex items-center gap-2.5 rounded-2xl bg-canvas px-3 py-2.5 ${rail ? "lg:justify-center lg:bg-transparent lg:px-0" : ""}`}
          title={rail ? `${user.name} · ${workspaceName}` : undefined}
        >
          <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-ink text-[13px] font-bold text-white">
            {initials(user.name)}
          </span>
          <div className={`flex min-w-0 flex-1 flex-col ${rail ? "lg:hidden" : ""}`}>
            <strong className="truncate text-sm">{user.name}</strong>
            <span className="truncate text-xs text-subtle">{workspaceName}</span>
          </div>
        </div>
        <div className={`flex items-center justify-between gap-2 ${rail ? "lg:hidden" : ""}`}>
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut();
              router.push("/sign-in");
              router.refresh();
            }}
            className="h-10 shrink-0 whitespace-nowrap rounded-xl px-3 text-left text-sm font-medium text-muted hover:bg-canvas"
          >
            {t("signOut")}
          </button>
          <LanguageSwitcher className="min-w-0 pr-1" />
        </div>
      </div>
    </aside>
  );
}

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}
