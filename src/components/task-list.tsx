"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface TaskItem {
  id: string;
  title: string;
  note: string | null;
  status: string;
  createdAt: string;
  lead: { id: string; name: string | null; email: string | null; phone: string | null } | null;
}

export function TaskList({ businessId, tasks }: { businessId: string; tasks: TaskItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function markDone(taskId: string) {
    setPendingId(taskId);
    await fetch(`/api/businesses/${businessId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    setPendingId(null);
    router.refresh();
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-neutral-500">No open handoffs — leads marked HOT will show up here.</p>;
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4">
          <div>
            <p className="font-medium text-neutral-900">{task.title}</p>
            {task.note && <p className="text-sm text-neutral-500">{task.note}</p>}
            {task.lead && (
              <Link
                href={`/businesses/${businessId}/leads/${task.lead.id}`}
                className="text-sm text-neutral-500 underline hover:text-neutral-900"
              >
                {task.lead.name || task.lead.email || task.lead.phone}
              </Link>
            )}
          </div>
          <button
            onClick={() => markDone(task.id)}
            disabled={pendingId === task.id}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            Mark done
          </button>
        </div>
      ))}
    </div>
  );
}
