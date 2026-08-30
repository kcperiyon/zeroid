"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";

interface InviteInfo {
  email: string;
  role: string;
  organizationName: string;
}

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${params.token}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Invite not found.");
        setInvite(body);
      })
      .catch((err) => setLoadError(err.message));
  }, [params.token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setSubmitError(null);

    const res = await fetch(`/api/invites/${params.token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || undefined, password: password || undefined }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setSubmitError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    router.push("/businesses");
    router.refresh();
  }

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-sm text-red-600">{loadError}</p>
      </main>
    );
  }
  if (!invite) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-sm text-neutral-500">Loading invite…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5 rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Join {invite.organizationName}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Invited as <span className="font-medium">{invite.email}</span> · {invite.role}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium text-neutral-700">Your name</label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-neutral-700">Set a password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>

        {submitError && (
          <p className="text-sm text-red-600">
            {submitError}{" "}
            {submitError.includes("already exists") && (
              <a href={`/login?from=/invite/${params.token}`} className="underline">Log in</a>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Joining…" : "Join team"}
        </button>
      </form>
    </main>
  );
}
