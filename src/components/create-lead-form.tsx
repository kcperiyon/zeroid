"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function CreateLeadForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/businesses/${businessId}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || undefined,
        email: email || undefined,
        phone: phone || undefined,
        company: company || undefined,
      }),
    });

    if (!res.ok) {
      const resBody = await res.json().catch(() => ({ error: "Something went wrong." }));
      setError(resBody.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setName("");
    setEmail("");
    setPhone("");
    setCompany("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        + New lead
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">Qualification scoring is set from the lead's detail page once it exists.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="lead-name" className="text-sm font-medium text-neutral-700">Name</label>
          <input
            id="lead-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="lead-company" className="text-sm font-medium text-neutral-700">Company</label>
          <input
            id="lead-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="lead-email" className="text-sm font-medium text-neutral-700">Email</label>
          <input
            id="lead-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="lead-phone" className="text-sm font-medium text-neutral-700">Phone</label>
          <input
            id="lead-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
      </div>
      <p className="text-xs text-neutral-400">At least one of name, email, or phone is required.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
