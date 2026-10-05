# Roomify

Design a room, furnish it with **real products you can actually buy**, walk through it in 3D, and check out.

> 📹 _Demo video / GIF goes here_ &nbsp;·&nbsp; 🔗 _Live demo link goes here_

Roomify pulls live furniture (name, price, photo, real-world dimensions, and optionally a 3D model) from a Shopify store. You draw your room, drag furniture into a to-scale floor plan, then view it as a textured 3D scene or walk around inside it. When you're happy, "Buy this room" builds a real Shopify cart and sends you to Shopify's hosted checkout.

## Features

**Room**
- Draw any room shape (rectangles, L-shapes, angled walls) on a grid, or start from an example room
- Flooring with real-looking materials: tile (white / grey / black), hardwood (light / natural / dark), polished concrete, or a custom colour — drawn at true scale in both 2D and 3D
- Wall colour presets, adjustable ceiling height
- Doors and windows that you drag along the walls; they become real openings in 3D

**Furniture**
- Drag products from the catalog into a to-scale 2D plan; rotate to any angle
- No overlaps and no leaving the room — a piece slides to the nearest free spot, or is refused with a clear reason
- Snapping and alignment guides against walls, corners and other furniture
- Undo / redo (buttons and Ctrl/Cmd+Z), "Furnish for me" auto-layout

**3D**
- Textured floors, soft shadows, baseboards, trim, and walls that fade when they block the camera
- First-person **walk mode** (WASD / drag to look / on-screen arrows on touch devices) with collision against walls and furniture
- Real 3D models where a product has one, polished placeholder boxes otherwise (a broken model file never breaks the scene)

**Commerce & sharing**
- Live prices and stock-linked variants from the Shopify Storefront API
- One-click checkout via Shopify's hosted cart
- Rooms save automatically in the browser; **share links** encode the whole room in the URL (no account or database)

## How it works

```
 Shopify store ──(Storefront API, server-side only)──▶  /design loader
   products, prices, photos,                                │
   dimension metafields, 3D models                          ▼
                                                    Zustand store  ◀──▶ localStorage
   room shape · flooring · openings · placed items          │
                                  ┌─────────────────────────┼───────────────────────┐
                                  ▼                         ▼                       ▼
                          /room-setup (SVG)        /design (SVG + dnd-kit)   /walkthrough (react-three-fiber)
                                                            │
                                                            ▼
                                            action ─▶ Shopify cart ─▶ hosted checkout
```

One store feeds all three screens, so the 2D plan and the 3D scene can't drift apart. Pure geometry (overlap tests, snapping, auto-placement, wall construction) lives in `app/lib/geometry.ts` with no UI dependencies.

## Technical decisions worth a look

- **Overlap prevention uses the separating-axis theorem** on rotated rectangles (not bounding boxes), plus point-in-polygon for non-rectangular rooms. When a drop is invalid, a ring search finds the nearest free spot within 80 cm.
- **Rotation is free-form**, rendered with CSS transforms in 2D; three.js rotates the opposite way, so 3D negates the angle to match.
- **Walls are built per edge of the room outline**, mitred only at convex corners, with openings cut by splitting each wall into boxes. Walls between camera and room fade out; outward normals work for either winding direction.
- **Floors are painted procedurally** on a canvas (tile grout, staggered plank seams, grain, concrete mottling), seamlessly tiling at 240 cm so no image assets are needed.
- **SSR-safe persistence**: the store uses `skipHydration` and rehydrates after mount so server and client HTML always match.
- **Share links** carry only product id + position + angle for each item; details are re-fetched from the live catalog, so shared rooms never show stale prices.
- **The Shopify token never reaches the browser** — all Storefront API calls happen in route loaders/actions.

## Tech

React Router (framework mode, SSR) · React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · @dnd-kit · three.js with react-three-fiber and drei · Shopify Storefront API

## Running it locally

```bash
npm install
cp .env.example .env     # fill in your store's values
npm run dev
```

You need a Shopify store with:
1. A **Headless** sales channel storefront (gives you the private Storefront API token).
2. Products published to that channel.
3. Optional product metafields `custom.width_cm`, `custom.height_cm`, `custom.depth_cm` (numbers) — without them a default size is used and flagged "size estimated".
4. Optional: a `.glb` uploaded to a product's Media → that product renders as a real model in 3D.

`npm run generate-models` can create `.glb` files from product photos with the Meshy API (needs `MESHY_API_KEY` and Dev Dashboard app credentials — see `.env.example`).

## Deploying

The app is a Node server (`npm run build` then `npm start`) and ships with a `Dockerfile` and a `render.yaml` for [Render](https://render.com). Set these environment variables on the host:

| Variable | Value |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` | the private Storefront token |
| `SHOPIFY_STOREFRONT_API_VERSION` | e.g. `2026-01` |

## Known limitations

- Rooms are saved per browser (no accounts); share links are the way to move a room between devices.
- Doors can't be walked through, and furniture doesn't yet avoid doors/windows.
- Furniture without a 3D model shows as a box.
- Checkout goes to Shopify's hosted page; a development store shows a password/test checkout.
