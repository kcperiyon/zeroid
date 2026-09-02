"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type KnowledgeSource = {
  id: string;
  type: "text" | "pdf" | "url" | "doc";
  title: string;
  status: "pending" | "processing" | "ready" | "failed";
  createdAt: string;
};

export function TrainAiPanel({ businessId, sources }: { businessId: string; sources: KnowledgeSource[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"text" | "url">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ content: string; source: string; score: number }> | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/businesses/${businessId}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "text" ? { type: "text", title, text } : { type: "url", title, url }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setTitle(""); setText(""); setUrl("");
    setLoading(false);
    router.refresh();
  }

  async function handleDelete(sourceId: string) {
    await fetch(`/api/businesses/${businessId}/knowledge/${sourceId}`, { method: "DELETE" });
    router.refresh();
  }

  async function handleQuery(event: FormEvent) {
    event.preventDefault();
    setQueryLoading(true);
    setQueryError(null);
    setResults(null);

    const res = await fetch(`/api/businesses/${businessId}/knowledge/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));
    if (!res.ok) {
      setQueryError(body.error ?? "Something went wrong.");
    } else {
      setResults(body.results);
    }
    setQueryLoading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Trained knowledge</h2>
        {sources.length === 0 && (
          <p className="text-sm text-neutral-500">Nothing trained yet — add text or a URL below.</p>
        )}
        <div className="space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">{source.title}</p>
                <p className="text-xs text-neutral-500">
                  {source.type} ·{" "}
                  <span className={source.status === "ready" ? "text-green-600" : source.status === "failed" ? "text-red-600" : "text-neutral-500"}>
                    {source.status}
                  </span>
                </p>
              </div>
              <button onClick={() => handleDelete(source.id)} className="text-sm text-neutral-400 hover:text-red-600">
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "text"} onChange={() => setMode("text")} /> Paste text
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "url"} onChange={() => setMode("url")} /> From a URL
          </label>
        </div>
        <div className="space-y-1">
          <label htmlFor="knowledge-title" className="text-sm font-medium text-neutral-700">Title</label>
          <input
            id="knowledge-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Pricing FAQ"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        {mode === "text" ? (
          <div className="space-y-1">
            <label htmlFor="knowledge-text" className="text-sm font-medium text-neutral-700">Text</label>
            <textarea
              id="knowledge-text"
              required
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste product info, FAQs, policies…"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor="knowledge-url" className="text-sm font-medium text-neutral-700">URL</label>
            <input
              id="knowledge-url"
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/pricing"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Training…" : "Train"}
        </button>
        <p className="text-xs text-neutral-400">PDF/document upload isn&apos;t wired up yet — text and URLs only for now.</p>
      </form>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Test what it learned</h2>
        <form onSubmit={handleQuery} className="flex gap-2">
          <input
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question your trained knowledge should answer…"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={queryLoading}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {queryLoading ? "Asking…" : "Ask"}
          </button>
        </form>
        {queryError && <p className="mt-2 text-sm text-red-600">{queryError}</p>}
        {results && (
          <div className="mt-3 space-y-2">
            {results.length === 0 && <p className="text-sm text-neutral-500">No matching trained knowledge found.</p>}
            {results.map((r, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 bg-white p-3">
                <p className="text-sm text-neutral-800">{r.content}</p>
                <p className="mt-1 text-xs text-neutral-400">{r.source} · match #{i + 1}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
