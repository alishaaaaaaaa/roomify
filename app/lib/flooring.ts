// Flooring: the list of floors a person can pick from, plus the code
// that PAINTS each one.
//
// Nothing here is a photo or an image file. Each floor is drawn from
// scratch onto an HTML canvas (tile grid with grout lines, hardwood
// planks with staggered end joints and wood grain, polished concrete
// with soft blotches) and the result is a square picture that repeats
// seamlessly. Painting it ourselves means:
//   - no image files to source, license, or ship
//   - the 2D floor plan and the 3D scene use the EXACT same picture, so
//     they always match
//   - the pattern is drawn at a real-world scale (tiles are 60cm, planks
//     are 12cm wide), so floors look the right size next to furniture
//
// The painting code needs a browser canvas, so it only runs in the
// browser. On the server everything falls back to a flat color for a
// moment, then the real pattern appears once the page loads.

export type FloorId =
  | "tile-white"
  | "tile-grey"
  | "tile-black"
  | "hardwood-light"
  | "hardwood-natural"
  | "hardwood-dark"
  | "concrete"
  | "custom"; // "custom" = a single flat color the person picks themselves

export type FloorGroup = "Tile" | "Hardwood" | "Concrete" | "Custom";

export type FloorOption = {
  id: FloorId;
  group: FloorGroup;
  label: string;
  // A flat color that roughly matches the finished pattern. Used for the
  // swatch background while the pattern is still being painted, and as
  // the whole floor for "custom".
  baseColor: string;
  // How shiny the floor looks in 3D: 0 is a mirror, 1 is completely
  // matte. Glossy tile reflects light; hardwood and concrete are duller.
  roughness: number;
};

export const FLOORING_OPTIONS: FloorOption[] = [
  { id: "tile-white", group: "Tile", label: "White", baseColor: "#e9e7e1", roughness: 0.28 },
  { id: "tile-grey", group: "Tile", label: "Grey", baseColor: "#9a9c9f", roughness: 0.3 },
  { id: "tile-black", group: "Tile", label: "Black", baseColor: "#2a2b2e", roughness: 0.25 },
  { id: "hardwood-light", group: "Hardwood", label: "Light oak", baseColor: "#cfae80", roughness: 0.55 },
  { id: "hardwood-natural", group: "Hardwood", label: "Natural", baseColor: "#b2834f", roughness: 0.55 },
  { id: "hardwood-dark", group: "Hardwood", label: "Dark walnut", baseColor: "#5a3d29", roughness: 0.5 },
  { id: "concrete", group: "Concrete", label: "Polished", baseColor: "#a19f9b", roughness: 0.75 },
  { id: "custom", group: "Custom", label: "Custom color", baseColor: "#c9a876", roughness: 0.8 },
];

export const DEFAULT_FLOOR_ID: FloorId = "hardwood-light";

export function isFloorId(value: unknown): value is FloorId {
  return FLOORING_OPTIONS.some((option) => option.id === value);
}

export function getFloorOption(id: FloorId): FloorOption {
  return FLOORING_OPTIONS.find((option) => option.id === id) ?? FLOORING_OPTIONS[0];
}

// One painted picture covers a 240cm x 240cm square of real floor and
// then repeats. Big enough that the repeat isn't obvious (a 4x4 block of
// tiles, 20 rows of planks), small enough to stay sharp.
export const FLOOR_PERIOD_CM = 240;

// --- How each floor is painted -------------------------------------

type TileRecipe = {
  kind: "tile";
  base: string;
  grout: string;
  tileCm: number;
  groutCm: number;
  variation: number; // how much each tile's shade differs from the next
  sheen: number; // strength of the soft highlight across each tile
  speckle: number; // fine grain noise
};

type WoodRecipe = {
  kind: "wood";
  base: string;
  plankCm: number; // plank width
  variation: number; // how much each plank's shade differs
  grain: number; // how much visible wood grain
  speckle: number;
};

type ConcreteRecipe = {
  kind: "concrete";
  base: string;
  speckle: number;
};

type Recipe = TileRecipe | WoodRecipe | ConcreteRecipe;

const RECIPES: Record<Exclude<FloorId, "custom">, Recipe> = {
  "tile-white": {
    kind: "tile", base: "#ebe9e4", grout: "#c4c1b9",
    tileCm: 60, groutCm: 0.6, variation: 0.018, sheen: 0.1, speckle: 5,
  },
  "tile-grey": {
    kind: "tile", base: "#9b9da0", grout: "#6a6c6f",
    tileCm: 60, groutCm: 0.6, variation: 0.04, sheen: 0.09, speckle: 7,
  },
  "tile-black": {
    kind: "tile", base: "#27282b", grout: "#111112",
    tileCm: 60, groutCm: 0.6, variation: 0.035, sheen: 0.13, speckle: 6,
  },
  "hardwood-light": {
    kind: "wood", base: "#d2b184", plankCm: 12, variation: 0.07, grain: 1, speckle: 5,
  },
  "hardwood-natural": {
    kind: "wood", base: "#b4854f", plankCm: 12, variation: 0.08, grain: 1, speckle: 5,
  },
  "hardwood-dark": {
    kind: "wood", base: "#5b3e2a", plankCm: 12, variation: 0.1, grain: 1.2, speckle: 5,
  },
  concrete: { kind: "concrete", base: "#a3a19d", speckle: 9 },
};

// A small seeded random number generator, so the painting is identical
// every time (the 2D plan, the 3D scene and the swatches all agree).
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Lightens (positive) or darkens (negative) a color, optionally nudging
// it warmer (toward red) or cooler (toward blue).
function shade(hex: string, factor: number, warm = 0) {
  const [r, g, b] = hexToRgb(hex);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r * (1 + factor) + warm)}, ${clamp(g * (1 + factor))}, ${clamp(b * (1 + factor) - warm)})`;
}

// When a soft shape is near an edge, it has to be drawn again on the
// opposite edge too, so the picture repeats without a visible seam.
function wrapOffsets(center: number, radius: number, size: number) {
  const offsets = [0];
  if (center - radius < 0) offsets.push(size);
  if (center + radius > size) offsets.push(-size);
  return offsets;
}

function paintTile(
  ctx: CanvasRenderingContext2D,
  size: number,
  recipe: TileRecipe,
  rand: () => number
) {
  const px = size / 1024;
  const tilePx = (recipe.tileCm / FLOOR_PERIOD_CM) * size;
  const count = Math.round(size / tilePx);
  const groutPx = Math.max(1.5, (recipe.groutCm / FLOOR_PERIOD_CM) * size);

  // Grout first, then each tile on top, leaving a gap between them.
  ctx.fillStyle = recipe.grout;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      const x = i * tilePx + groutPx / 2;
      const y = j * tilePx + groutPx / 2;
      const w = tilePx - groutPx;

      ctx.fillStyle = shade(
        recipe.base,
        (rand() - 0.5) * 2 * recipe.variation,
        (rand() - 0.5) * 3
      );
      ctx.fillRect(x, y, w, w);

      // A soft diagonal highlight, like light catching a glazed tile.
      const sheen = ctx.createLinearGradient(x, y, x + w, y + w);
      sheen.addColorStop(0, `rgba(255,255,255,${recipe.sheen * (0.5 + rand())})`);
      sheen.addColorStop(0.55, "rgba(255,255,255,0)");
      sheen.addColorStop(1, `rgba(0,0,0,${recipe.sheen * 0.8 * (0.5 + rand())})`);
      ctx.fillStyle = sheen;
      ctx.fillRect(x, y, w, w);

      // A hairline bevel: light on the top/left edges, dark on the
      // bottom/right, so each tile looks slightly raised.
      ctx.lineWidth = Math.max(1, 1.2 * px);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(x, y + w);
      ctx.lineTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.beginPath();
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w, y + w);
      ctx.lineTo(x, y + w);
      ctx.stroke();
    }
  }
}

type Plank = {
  fill: string;
  grain: Array<{
    y: number;
    amp: number;
    width: number;
    alpha: number;
    dark: boolean;
    segs: number;
    seed: number;
  }>;
};

function makePlank(recipe: WoodRecipe, rand: () => number, len: number, size: number, rowH: number): Plank {
  const grainCount = Math.round(recipe.grain * (len / size) * 14 + 3);
  return {
    fill: shade(recipe.base, (rand() - 0.5) * 2 * recipe.variation, (rand() - 0.5) * 8),
    grain: Array.from({ length: grainCount }, () => ({
      y: rand() * rowH,
      amp: 0.3 + rand() * 1.6,
      width: 0.5 + rand() * 1.1,
      alpha: 0.05 + rand() * 0.12,
      dark: rand() > 0.25,
      segs: 3 + Math.floor(rand() * 4),
      seed: rand(),
    })),
  };
}

function paintPlank(
  ctx: CanvasRenderingContext2D,
  plank: Plank,
  x: number,
  y: number,
  len: number,
  h: number,
  px: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, len, h);
  ctx.clip();

  ctx.fillStyle = plank.fill;
  ctx.fillRect(x, y, len, h);

  // Slightly lighter along the top edge, slightly darker along the
  // bottom, so each plank reads as a separate board.
  const edge = ctx.createLinearGradient(0, y, 0, y + h);
  edge.addColorStop(0, "rgba(255,255,255,0.06)");
  edge.addColorStop(1, "rgba(0,0,0,0.07)");
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, len, h);

  // Wood grain: thin, gently wavy lines running along the plank.
  for (const line of plank.grain) {
    ctx.strokeStyle = line.dark
      ? `rgba(0,0,0,${line.alpha})`
      : `rgba(255,255,255,${line.alpha * 0.6})`;
    ctx.lineWidth = line.width * px;
    ctx.beginPath();
    const gy = y + line.y;
    ctx.moveTo(x, gy);
    for (let s = 1; s <= line.segs; s++) {
      const sx = x + (len * s) / line.segs;
      const wobble = Math.sin(line.seed * 50 + s * 1.7) * line.amp * px;
      ctx.quadraticCurveTo(sx - len / line.segs / 2, gy + wobble * 2, sx, gy + wobble);
    }
    ctx.stroke();
  }
  ctx.restore();

  // The dark gaps between boards: along the top edge and at the left end.
  const gap = Math.max(1, 1.4 * px);
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(x, y, len, gap);
  ctx.fillRect(x, y, gap, h);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(x, y + gap, len, Math.max(1, px));
}

function paintWood(
  ctx: CanvasRenderingContext2D,
  size: number,
  recipe: WoodRecipe,
  rand: () => number
) {
  const px = size / 1024;
  const rows = Math.round(FLOOR_PERIOD_CM / recipe.plankCm);
  const rowH = size / rows;
  const minLen = size * 0.25;
  const maxLen = size * 0.7;

  for (let row = 0; row < rows; row++) {
    const y = row * rowH;

    // Break the row into planks of random lengths that add up to
    // exactly one picture width...
    const lengths: number[] = [];
    let total = 0;
    while (total < size - 0.5) {
      let len = minLen + rand() * (maxLen - minLen);
      if (size - (total + len) < minLen * 0.5) len = size - total;
      lengths.push(len);
      total += len;
    }

    // ...then slide the whole row sideways by a random amount, so the
    // end joints of neighbouring rows don't line up. Planks that slide
    // off the right edge reappear on the left, which keeps it seamless.
    const offset = rand() * size;
    let cursor = 0;
    for (const len of lengths) {
      const plank = makePlank(recipe, rand, len, size, rowH);
      const start = (offset + cursor) % size;
      paintPlank(ctx, plank, start, y, len, rowH, px);
      paintPlank(ctx, plank, start - size, y, len, rowH, px);
      cursor += len;
    }
  }
}

function paintConcrete(
  ctx: CanvasRenderingContext2D,
  size: number,
  recipe: ConcreteRecipe,
  rand: () => number
) {
  const px = size / 1024;
  ctx.fillStyle = recipe.base;
  ctx.fillRect(0, 0, size, size);

  // Hundreds of big, faint, soft blotches, light and dark, give the
  // cloudy look of poured concrete.
  for (let n = 0; n < 380; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const radius = size * (0.03 + rand() * 0.14);
    const light = rand() > 0.5;
    const alpha = 0.025 + rand() * 0.04;
    for (const dx of wrapOffsets(cx, radius, size)) {
      for (const dy of wrapOffsets(cy, radius, size)) {
        const g = ctx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, radius);
        const color = light ? "255,255,255" : "0,0,0";
        g.addColorStop(0, `rgba(${color},${alpha})`);
        g.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx + dx - radius, cy + dy - radius, radius * 2, radius * 2);
      }
    }
  }

  // Faint saw-cut joints every 120cm.
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  const joint = Math.max(1.5, 1.6 * px);
  for (const pos of [0, size / 2]) {
    ctx.fillRect(pos - joint / 2, 0, joint, size);
    ctx.fillRect(0, pos - joint / 2, size, joint);
  }
  // The joint at 0 sits on the edge, so draw its other half on the far side.
  ctx.fillRect(size - joint / 2, 0, joint / 2, size);
  ctx.fillRect(0, size - joint / 2, size, joint / 2);
}

// Fine random grain over everything, so flat colors look like a real
// surface instead of plastic.
function addSpeckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
  amount: number
) {
  if (amount <= 0) return;
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rand() - 0.5) * amount;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
  ctx.putImageData(image, 0, 0);
}

// Paints one floor onto a fresh square canvas. Browser only.
export function paintFloorCanvas(
  id: Exclude<FloorId, "custom">,
  size = 1024
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const recipe = RECIPES[id];
  const rand = mulberry32(seedFromString(id));

  if (recipe.kind === "tile") paintTile(ctx, size, recipe, rand);
  else if (recipe.kind === "wood") paintWood(ctx, size, recipe, rand);
  else paintConcrete(ctx, size, recipe, rand);

  addSpeckle(ctx, size, rand, recipe.speckle);
  return canvas;
}

// --- Pictures for the 2D views ---------------------------------------
//
// The 2D floor plan and the swatches show the painted floor as an
// ordinary image (a "data URL" - the picture encoded as text). It's
// painted once per floor and remembered.

const urlCache = new Map<FloorId, string>();

// The picture if it has already been painted, without painting it now.
export function peekFloorTextureUrl(id: FloorId): string | null {
  return urlCache.get(id) ?? null;
}

export function getFloorTextureUrl(id: FloorId): string | null {
  if (id === "custom" || typeof document === "undefined") return null;
  const cached = urlCache.get(id);
  if (cached) return cached;
  // 512px is plenty for the 2D views (they show the floor much smaller
  // than the 3D scene does) and keeps the encoded picture small.
  const url = paintFloorCanvas(id, 512).toDataURL("image/jpeg", 0.9);
  urlCache.set(id, url);
  return url;
}
