"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const ROLES = ["admin", "manager", "sales", "marketing", "viewer"] as const;

export function InviteMemberForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("sales");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setLink(null);

    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setLink(`${window.location.origin}/invite/${body.invite.token}`);
    setEmail("");
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        + Invite member
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">
        No email is sent yet (build-spec §14 cost discipline) — share the generated link yourself.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="invite-email" className="text-sm font-medium text-neutral-700">Email</label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="invite-role" className="text-sm font-medium text-neutral-700">Role</label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {link && (
        <p className="rounded-md bg-neutral-50 p-2 text-sm text-neutral-800 break-all">
          Invite link: {link}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create invite"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Close
        </button>
      </div>
    </form>
  );
}
