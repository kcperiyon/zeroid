import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { CreateProductForm } from "@/components/create-product-form";

export default async function BusinessProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const products = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.product.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } })
  );

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Products</h2>
      <div className="mb-6 space-y-3">
        {products.length === 0 && (
          <p className="text-sm text-neutral-500">No products yet — add your first one below.</p>
        )}
        {products.map((product) => (
          <div key={product.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="font-medium text-neutral-900">{product.name}</p>
            {product.description && <p className="mt-1 text-sm text-neutral-500">{product.description}</p>}
            {product.price != null && (
              <p className="mt-1 text-sm text-neutral-700">
                {product.currency} {product.price.toString()}
              </p>
            )}
          </div>
        ))}
      </div>

      <CreateProductForm businessId={businessId} />
    </div>
  );
}
