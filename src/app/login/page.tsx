"use client";

import { useActionState } from "react";
import { login } from "../actions/auth";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={action} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="text-xs font-semibold tracking-widest text-brand-600 uppercase">Admissions CRM</div>
          <h1 className="mt-1 text-xl font-semibold">Sign in</h1>
        </div>
        <label className="block">
          <span className="label">Email</span>
          <input name="email" type="email" required autoComplete="username" className="input" />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="input" />
        </label>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
