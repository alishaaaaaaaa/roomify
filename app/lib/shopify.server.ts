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
  // A "variant" is the specific purchasable version of a product (e.g.
  // "Blue, Large"). Even a product with no real options still has one
  // default variant, and Shopify's cart always adds a VARIANT, never a
  // product directly - so we need this id, not just the product's id,
  // to ever let someone actually buy something.
  variantId: string;
  title: string;
  description: string;
  price: string;
  currencyCode: string;
  imageUrl: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  // A real 3D model (.glb) for this exact product, if the merchant has
  // uploaded one to Shopify's AR/3D media field - see the long comment
  // on the `media` part of PRODUCTS_QUERY below for how this is found.
  // null means no model is attached yet, and callers should fall back
  // to a plain placeholder box.
  modelUrl: string | null;
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
          variants(first: 1) {
            edges {
              node {
                id
              }
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
          # A product's "media" can include photos AND a 3D model,
          # uploaded in the Shopify admin under that product's Media
          # section (the same feature that powers "View in AR" on a
          # storefront). Model3d is Shopify's own media type for that -
          # this is the actual model file for THIS product, not a
          # lookalike, which is why this is worth pulling in even though
          # most stores won't have one uploaded yet.
          media(first: 10) {
            edges {
              node {
                __typename
                ... on Model3d {
                  sources {
                    url
                    format
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type ProductMediaNode =
  | { __typename: "Model3d"; sources: Array<{ url: string; format: string }> }
  | { __typename: string; sources?: undefined };

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
        variants: { edges: Array<{ node: { id: string } }> };
        widthMeta: { value: string } | null;
        heightMeta: { value: string } | null;
        depthMeta: { value: string } | null;
        media: { edges: Array<{ node: ProductMediaNode }> };
      };
    }>;
  };
};

// Three.js (what the 3D walkthrough is built on) loads glTF/.glb files
// directly, so that's the format we look for among a Model3d's sources.
// Shopify also auto-generates a .usdz version of the same model for
// Apple's AR Quick Look - that one's for iOS's native AR viewer, not
// for us, so it's deliberately skipped here.
function findModelUrl(media: { edges: Array<{ node: ProductMediaNode }> }) {
  for (const { node } of media.edges) {
    if (node.__typename !== "Model3d" || !node.sources) continue;
    const glb = node.sources.find(
      (source) => source.format.toLowerCase() === "glb"
    );
    if (glb) return glb.url;
  }
  return null;
}

export async function getProducts(first = 20): Promise<ShopifyProduct[]> {
  const data = await client.request<ProductsQueryResponse>(PRODUCTS_QUERY, {
    first,
  });

  return data.products.edges.map(({ node }) => ({
    id: node.id,
    variantId: node.variants.edges[0]?.node.id ?? "",
    title: node.title,
    description: node.description,
    price: node.priceRange.minVariantPrice.amount,
    currencyCode: node.priceRange.minVariantPrice.currencyCode,
    imageUrl: node.featuredImage?.url ?? null,
    widthCm: node.widthMeta ? Number(node.widthMeta.value) : null,
    heightCm: node.heightMeta ? Number(node.heightMeta.value) : null,
    depthCm: node.depthMeta ? Number(node.depthMeta.value) : null,
    modelUrl: findModelUrl(node.media),
  }));
}

// --- Cart / checkout ---
//
// A Shopify "cart" is created server-side via GraphQL, and Shopify hands
// back a real checkout URL for it - we don't build our own checkout UI
// at all, we just redirect the browser to the real one Shopify hosts.
// This is the entire point of using the Storefront API's Cart mutations
// instead of some fake "add to cart" button that goes nowhere.

export type CartLineInput = {
  variantId: string;
  quantity: number;
};

const CART_CREATE_MUTATION = gql`
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type CartCreateResponse = {
  cartCreate: {
    cart: { id: string; checkoutUrl: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

export async function createCartCheckoutUrl(
  lines: CartLineInput[]
): Promise<string> {
  const data = await client.request<CartCreateResponse>(
    CART_CREATE_MUTATION,
    {
      // Shopify's cart input calls this field "merchandiseId" (a variant
      // is a kind of "merchandise") - we keep our own naming as
      // "variantId" everywhere else in the app since it's clearer, and
      // only translate to Shopify's exact wording right here at the
      // boundary where we talk to their API.
      lines: lines.map((line) => ({
        merchandiseId: line.variantId,
        quantity: line.quantity,
      })),
    }
  );

  if (data.cartCreate.userErrors.length > 0) {
    throw new Error(
      data.cartCreate.userErrors.map((error) => error.message).join(", ")
    );
  }

  if (!data.cartCreate.cart) {
    throw new Error("Shopify did not return a cart.");
  }

  return data.cartCreate.cart.checkoutUrl;
}
