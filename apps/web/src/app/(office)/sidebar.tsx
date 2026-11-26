"use client";

import type { SidebarDepartment } from "@squadai/db";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
};

export function Sidebar({ departments, waiting, user, workspaceName }: SidebarProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();

  const itemClass = (active: boolean) =>
    `flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] ${
      active
        ? "bg-brand-soft font-semibold text-brand-strong"
        : "font-medium text-ink-2 hover:bg-canvas"
    }`;

  return (
    <aside className="flex max-w-full flex-[1_1_240px] flex-col gap-6 border-line border-r bg-surface px-3.5 py-5 md:max-w-[264px]">
      <Link href="/" className="px-2.5">
        <Logo />
      </Link>

      <Link
        href="/new-request"
        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white hover:bg-brand-strong"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {t("newRequest")}
      </Link>

      <nav aria-label={t("main")} className="flex flex-col gap-0.5">
        <Link
          href="/"
          className={itemClass(pathname === "/")}
          aria-current={pathname === "/" ? "page" : undefined}
        >
          <Icon d={ICONS.home} />
          <span className="flex-1">{t("home")}</span>
        </Link>
        <Link
          href="/waiting"
          className={itemClass(pathname === "/waiting")}
          aria-current={pathname === "/waiting" ? "page" : undefined}
        >
          <Icon d={ICONS.clock} />
          <span className="flex-1">{t("waiting")}</span>
          {waiting > 0 && (
            <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#FFE4C2] px-1.5 text-xs font-bold text-warn">
              {waiting}
            </span>
          )}
        </Link>
      </nav>

      <nav aria-label={t("teams")} className="flex flex-col gap-3.5">
        {departments.map((d) => (
          <div key={d.id} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 text-xs font-semibold tracking-wider text-subtle uppercase">
              {d.name}
            </span>
            {d.teams.map((t) => {
              const href = `/teams/${t.slug}`;
              const active = pathname === href;
              return (
                <Link
                  key={t.id}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`${itemClass(active)} h-10 text-sm`}
                >
                  <span className="size-2.5 rounded-[3px]" style={{ background: t.color }} />
                  <span className="flex-1">{t.name}</span>
                  {t.waiting > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">
                      {t.waiting}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
        <Link
          href="/hire"
          aria-current={pathname === "/hire" ? "page" : undefined}
          className={`flex h-10 items-center whitespace-nowrap rounded-xl border border-dashed px-3 text-sm font-semibold text-brand-strong ${
            pathname === "/hire" ? "border-brand bg-brand-soft" : "border-[#C9CDE0]"
          }`}
        >
          {t("hire")}
        </Link>
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <Link
          href="/models"
          aria-current={pathname === "/models" ? "page" : undefined}
          className={`${itemClass(pathname === "/models")} h-10 text-sm`}
        >
          <Icon d={ICONS.chip} />
          <span className="flex-1">{t("models")}</span>
        </Link>
        {[
          ["/integrations", t("integrations"), ICONS.plug],
          ["/audit", t("audit"), ICONS.list],
        ].map(([href, label, icon]) => (
          <Link
            key={href}
            href={href as string}
            aria-current={pathname === href ? "page" : undefined}
            className={`${itemClass(pathname === href)} h-10 text-sm`}
          >
            <Icon d={icon as string} />
            <span className="flex-1">{label}</span>
          </Link>
        ))}
        <div className="flex items-center gap-2.5 rounded-2xl bg-canvas px-3 py-2.5">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-ink text-[13px] font-bold text-white">
            {initials(user.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <strong className="truncate text-sm">{user.name}</strong>
            <span className="truncate text-xs text-subtle">{workspaceName}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
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

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
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
