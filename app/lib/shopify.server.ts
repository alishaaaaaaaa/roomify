// This file only ever runs on the server (React Router keeps *.server.ts
// out of the browser bundle), which is important: it holds the private
// Storefront API token and that token must never reach client-side code.

import { GraphQLClient, gql } from "graphql-request";

const domain = process.env.SHOPIFY_STORE_DOMAIN;
const token = process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN;
const apiVersion = process.env.SHOPIFY_STOREFRONT_API_VERSION ?? "2026-01";

if (!domain || !token) {
  throw new Error(
    "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_PRIVATE_TOKEN. " +
      "Copy .env.example to .env and fill in your dev store's values."
  );
}

const endpoint = `https://${domain}/api/${apiVersion}/graphql.json`;

// The private token is sent server-to-server only, using the header
// Shopify expects for private (not public) Storefront API access.
const client = new GraphQLClient(endpoint, {
  headers: {
    "Shopify-Storefront-Private-Token": token,
  },
});

// A small, typed shape we control, rather than passing Shopify's raw
// GraphQL response shape around the app.
export type ShopifyProduct = {
  id: string;
  title: string;
  description: string;
  price: string;
  currencyCode: string;
  imageUrl: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
};

const PRODUCTS_QUERY = gql`
  query GetProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          description
          featuredImage {
            url
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          widthMeta: metafield(namespace: "custom", key: "width_cm") {
            value
          }
          heightMeta: metafield(namespace: "custom", key: "height_cm") {
            value
          }
          depthMeta: metafield(namespace: "custom", key: "depth_cm") {
            value
          }
        }
      }
    }
  }
`;

type ProductsQueryResponse = {
  products: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        description: string;
        featuredImage: { url: string } | null;
        priceRange: {
          minVariantPrice: { amount: string; currencyCode: string };
        };
        widthMeta: { value: string } | null;
        heightMeta: { value: string } | null;
        depthMeta: { value: string } | null;
      };
    }>;
  };
};

export async function getProducts(first = 20): Promise<ShopifyProduct[]> {
  const data = await client.request<ProductsQueryResponse>(PRODUCTS_QUERY, {
    first,
  });

  return data.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    description: node.description,
    price: node.priceRange.minVariantPrice.amount,
    currencyCode: node.priceRange.minVariantPrice.currencyCode,
    imageUrl: node.featuredImage?.url ?? null,
    widthCm: node.widthMeta ? Number(node.widthMeta.value) : null,
    heightCm: node.heightMeta ? Number(node.heightMeta.value) : null,
    depthCm: node.depthMeta ? Number(node.depthMeta.value) : null,
  }));
}