// Temporary route to prove the Storefront API connection works end to end.
// Visit /test-products in the browser once the dev server is running.
// We'll delete this once real UI replaces it.

import { getProducts } from "~/lib/shopify.server";
import type { Route } from "./+types/test-products";

export async function loader() {
  const products = await getProducts();
  return { products };
}

export default function TestProducts({ loaderData }: Route.ComponentProps) {
  const { products } = loaderData;

  if (products.length === 0) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h1>Connected to Shopify — but no products found</h1>
        <p>
          The API call worked, but your store has no products yet. Add a few
          sample products in your Shopify admin, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>✅ Connected to Shopify Storefront API</h1>
      <p>Found {products.length} product(s) in roomify-zytvvthe:</p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {products.map((product) => (
          <li
            key={product.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 16,
              marginBottom: 12,
              display: "flex",
              gap: 16,
              alignItems: "center",
            }}
          >
            {product.imageUrl && (
              <img
                src={product.imageUrl}
                alt={product.title}
                width={80}
                height={80}
                style={{ objectFit: "cover", borderRadius: 4 }}
              />
            )}
            <div>
              <strong>{product.title}</strong>
              <div>
                {product.price} {product.currencyCode}
              </div>
              {(product.widthCm || product.heightCm || product.depthCm) && (
                <div style={{ fontSize: 12, color: "#666" }}>
                  Dimensions: {product.widthCm ?? "?"}cm ×{" "}
                  {product.heightCm ?? "?"}cm × {product.depthCm ?? "?"}cm
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
