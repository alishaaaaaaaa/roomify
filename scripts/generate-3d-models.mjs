// One-off/occasional tool - NOT part of the running app - that fills in
// missing 3D models across your Shopify catalog:
//
// For every product that has a photo and real width/height/depth
// metafields but no 3D model attached yet, this asks an AI image-to-3D
// service (Meshy: https://www.meshy.ai) to build a .glb from THAT
// EXACT product's own photo, then attaches the result to that same
// product in Shopify - exactly where the app already looks for one
// (see the `modelUrl` field / `findModelUrl` in
// app/lib/shopify.server.ts). Nothing else in the app needs to change:
// once a product has a model attached, the 2D->3D pipeline picks it up
// automatically the next time it's loaded.
//
// Run it with:
//   node scripts/generate-3d-models.mjs
//
// --- Before running this, please read this ---
// Generating a 3D model from a product photo is creating a derivative
// work of that photo. Only run this against products from a supplier
// relationship whose terms actually permit that kind of use (a
// dropship/wholesale agreement that grants you rights to their product
// images for marketing/selling purposes is the normal case - a random
// image you don't have clear rights to is not). This script doesn't
// and can't check that for you.
//
// --- Setup: three things this needs in your .env (see .env.example) ---
//
// SHOPIFY_ADMIN_API_ACCESS_TOKEN (NEW - different from the storefront
// token the app already uses, which is read-only and can't attach media
// to a product):
//   Shopify admin -> Settings -> Apps and sales channels
//   -> Develop apps -> Create an app -> Configure Admin API scopes
//   -> check "write_products" -> Install app -> reveal the Admin API
//   access token (starts with shpat_) and put it in .env.
//
// MESHY_API_KEY (NEW):
//   Sign up at https://www.meshy.ai, choose a plan with API access, and
//   copy your API key from their dashboard into .env.
//
// A note on accuracy: I (Claude) wrote this against Meshy's published
// API docs (docs.meshy.ai/en/api/image-to-3d) but couldn't actually run
// a live request against it - this sandbox's network is locked down to
// package registries and GitHub, so it can't reach meshy.ai or your
// Shopify store to test this end to end. The task-creation/polling
// response shape below matches their documented API as of this
// writing, but if Meshy has since changed field names, the error
// messages this script prints should make that obvious - check
// https://docs.meshy.ai/en/api/image-to-3d against whatever it prints
// and adjust the two spots marked below if needed.

import { GraphQLClient, gql } from "graphql-request";

const domain = process.env.SHOPIFY_STORE_DOMAIN;
const storefrontToken = process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN;
const adminToken = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const meshyApiKey = process.env.MESHY_API_KEY;
const apiVersion = process.env.SHOPIFY_STOREFRONT_API_VERSION ?? "2026-01";

for (const [name, value] of Object.entries({
  SHOPIFY_STORE_DOMAIN: domain,
  SHOPIFY_STOREFRONT_PRIVATE_TOKEN: storefrontToken,
  SHOPIFY_ADMIN_API_ACCESS_TOKEN: adminToken,
  MESHY_API_KEY: meshyApiKey,
})) {
  if (!value) {
    console.error(
      `Missing ${name} in your .env - see the setup notes at the top of this script.`
    );
    process.exit(1);
  }
}

// Read-only: used just to find which products need a model.
const storefrontClient = new GraphQLClient(
  `https://${domain}/api/${apiVersion}/graphql.json`,
  { headers: { "Shopify-Storefront-Private-Token": storefrontToken } }
);

// Write access: used to attach the generated model to a product.
const adminClient = new GraphQLClient(
  `https://${domain}/admin/api/${apiVersion}/graphql.json`,
  { headers: { "X-Shopify-Access-Token": adminToken } }
);

const PRODUCTS_QUERY = gql`
  query GetProductsForModelGen($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          featuredImage {
            url
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
          media(first: 10) {
            edges {
              node {
                __typename
              }
            }
          }
        }
      }
    }
  }
`;

async function getProductsNeedingModels() {
  const data = await storefrontClient.request(PRODUCTS_QUERY, { first: 100 });

  return data.products.edges
    .map(({ node }) => ({
      id: node.id,
      title: node.title,
      imageUrl: node.featuredImage?.url ?? null,
      hasDimensions: Boolean(
        node.widthMeta && node.heightMeta && node.depthMeta
      ),
      hasModel: node.media.edges.some(
        (edge) => edge.node.__typename === "Model3d"
      ),
    }))
    .filter((product) => product.imageUrl && product.hasDimensions && !product.hasModel);
}

// --- Meshy: turn one product photo into a .glb ---

async function createMeshyTask(imageUrl) {
  const response = await fetch("https://api.meshy.ai/openapi/v1/image-to-3d", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${meshyApiKey}`,
      "Content-Type": "application/json",
    },
    // should_texture/enable_pbr keep this to a plain textured model -
    // no need for auto_size, since we scale the result ourselves to
    // the product's real widthCm/heightCm/depthCm at render time
    // (see RealModel in app/routes/walkthrough.tsx).
    body: JSON.stringify({
      image_url: imageUrl,
      should_texture: true,
      enable_pbr: false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Meshy task creation failed: ${response.status} ${await response.text()}`
    );
  }

  const body = await response.json();
  // NOTE: per Meshy's docs, task creation returns { "result": "<task-id>" }.
  // If this comes back undefined, check the printed `body` against
  // https://docs.meshy.ai/en/api/image-to-3d for the current field name.
  if (!body.result) {
    throw new Error(
      `Unexpected response from Meshy - no task id found: ${JSON.stringify(body)}`
    );
  }
  return body.result;
}

async function pollMeshyTask(taskId) {
  const url = `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`;

  // Generations typically take a couple of minutes - poll gently rather
  // than hammering the API.
  while (true) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${meshyApiKey}` },
    });
    const task = await response.json();

    if (task.status === "SUCCEEDED") {
      // NOTE: per Meshy's docs, the finished task's downloadable files
      // live at task.model_urls.glb. If this comes back undefined,
      // check the printed `task` against
      // https://docs.meshy.ai/en/api/image-to-3d for the current shape.
      const glbUrl = task.model_urls?.glb;
      if (!glbUrl) {
        throw new Error(
          `Task succeeded but no glb URL was found: ${JSON.stringify(task)}`
        );
      }
      return glbUrl;
    }

    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(
        `Meshy task ${taskId} ${task.status.toLowerCase()}: ${
          task.task_error?.message ?? "unknown error"
        }`
      );
    }

    console.log(`  ...still generating (${task.progress ?? 0}%)`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

// --- Shopify: attach the generated .glb to the product ---
//
// originalSource can just be Meshy's own (temporary, unauthenticated)
// download URL - Shopify fetches and re-hosts it the moment this
// mutation runs, so it doesn't matter that Meshy's link expires later.
// That also means this has to run right after the task succeeds, not
// on a stale/saved URL from an earlier run.

const ATTACH_MODEL_MUTATION = gql`
  mutation AttachModel($productId: ID!, $glbUrl: String!) {
    productCreateMedia(
      productId: $productId
      media: [{ originalSource: $glbUrl, mediaContentType: MODEL_3D }]
    ) {
      media {
        status
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

async function attachModelToProduct(productId, glbUrl) {
  const data = await adminClient.request(ATTACH_MODEL_MUTATION, {
    productId,
    glbUrl,
  });

  if (data.productCreateMedia.mediaUserErrors.length > 0) {
    throw new Error(
      data.productCreateMedia.mediaUserErrors
        .map((error) => error.message)
        .join(", ")
    );
  }
}

// --- Main ---

async function main() {
  const products = await getProductsNeedingModels();

  if (products.length === 0) {
    console.log(
      "No products need a model right now (either they already have one, or they're missing a photo/dimensions)."
    );
    return;
  }

  console.log(`Generating models for ${products.length} product(s)...\n`);

  for (const product of products) {
    console.log(product.title);
    try {
      const taskId = await createMeshyTask(product.imageUrl);
      console.log(`  Meshy task started (${taskId})`);
      const glbUrl = await pollMeshyTask(taskId);
      console.log("  Model generated, attaching to Shopify...");
      await attachModelToProduct(product.id, glbUrl);
      console.log("  Done.\n");
    } catch (error) {
      console.error(`  Failed: ${error.message}\n`);
    }
  }

  console.log(
    "All done. Refresh the app - products with a model attached will now show it in the 3D walkthrough."
  );
}

main();
