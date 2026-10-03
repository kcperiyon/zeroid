import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ChangePasswordForm } from "@/components/change-password-form";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <div className="mb-6">
        <Link href="/businesses" className="text-sm text-neutral-500 hover:text-neutral-900">← Businesses</Link>
        <h1 className="mt-3 text-xl font-semibold text-neutral-900">Account</h1>
        <p className="mt-1 text-sm text-neutral-500">{user.email}</p>
      </div>
      <h2 className="mb-3 text-sm font-medium text-neutral-700">Change password</h2>
      <ChangePasswordForm />
    </main>
  );
}
