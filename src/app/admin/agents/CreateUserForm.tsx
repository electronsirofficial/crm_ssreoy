"use client";

import { useActionState } from "react";
import { createUserAction } from "@/app/actions/admin";

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUserAction, null);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <input name="name" placeholder="Full name" required className="input" />
      <input name="email" type="email" placeholder="Email (login)" required className="input" />
      <input name="phone" placeholder="Phone" className="input" />
      <select name="role" className="input" defaultValue="AGENT">
        <option value="AGENT">Sales agent</option>
        <option value="RECEPTION">Front desk</option>
        <option value="ADMIN">Admin</option>
      </select>
      <input name="password" type="text" placeholder="Initial password (8+ chars)" required minLength={8} className="input sm:col-span-2" />
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={pending}>
          Create user
        </button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state?.ok && <span className="text-sm text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
