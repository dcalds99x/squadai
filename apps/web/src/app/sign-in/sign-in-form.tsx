"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

export function SignInForm({ github }: { github: boolean }) {
  const t = useTranslations("signIn");
  const te = useTranslations("errors");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-up");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: String(data.get("name")), email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(errorMessage(result.error.code) ?? result.error.message ?? te("generic"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  function errorMessage(code: string | undefined): string | null {
    const key = code ? AUTH_ERRORS[code as keyof typeof AUTH_ERRORS] : undefined;
    return key ? t(`errors.${key}`) : null;
  }

  const isSignUp = mode === "sign-up";
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold">
          {isSignUp ? t("createTitle") : t("title")}
        </h2>
        <p className="text-muted">{isSignUp ? t("createSubtitle") : t("signInSubtitle")}</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {isSignUp && (
          <Field
            label={t("name")}
            name="name"
            autoComplete="name"
            placeholder={t("namePlaceholder")}
          />
        )}
        <Field label={t("email")} name="email" type="email" autoComplete="email" />
        <Field
          label={t("password")}
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={8}
          hint={isSignUp ? t("passwordHint") : undefined}
        />
        {error && (
          <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? t("wait") : isSignUp ? t("createSubmit") : t("signInSubmit")}
        </button>
      </form>

      {github && (
        <button
          type="button"
          onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/" })}
          className="h-12 rounded-xl border border-line-strong bg-surface font-semibold"
        >
          {t("github")}
        </button>
      )}

      <p className="text-sm text-muted">
        {isSignUp ? t("haveAccount") : t("noAccount")}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(isSignUp ? "sign-in" : "sign-up");
            setError(null);
          }}
          className="min-h-11 font-semibold text-brand-strong underline-offset-4 hover:underline"
        >
          {isSignUp ? t("toSignIn") : t("toCreate")}
        </button>
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <input
        required
        {...input}
        className="h-12 rounded-xl border border-line-strong bg-surface px-3.5 text-base font-normal"
      />
      {hint && <span className="text-xs font-normal text-subtle">{hint}</span>}
    </label>
  );
}

/** Better Auth error codes we explain in the person's language. */
const AUTH_ERRORS = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  USER_ALREADY_EXISTS: "userExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "userExists",
  PASSWORD_TOO_SHORT: "passwordTooShort",
} as const;
