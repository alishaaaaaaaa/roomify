// Small helpers for showing a painted floor (see app/lib/flooring.ts) in
// the 2D views: the floor plan, the room-setup preview, and the swatches.

import { useEffect, useState } from "react";
import {
  FLOOR_PERIOD_CM,
  getFloorOption,
  getFloorTextureUrl,
  peekFloorTextureUrl,
  type FloorId,
} from "~/lib/flooring";

// The painted picture for a floor, as an image address - or null until
// it's ready (and always null for "custom", which is just a flat color).
// Painting needs the browser, so it happens right after the page loads,
// not while the server builds it.
export function useFloorTextureUrl(floorType: FloorId): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (floorType === "custom") {
      setUrl(null);
      return;
    }
    const cached = peekFloorTextureUrl(floorType);
    if (cached) {
      setUrl(cached);
      return;
    }
    // Painting takes a few dozen milliseconds, so it waits one tick to
    // let the page draw first.
    let cancelled = false;
    const handle = window.setTimeout(() => {
      if (!cancelled) setUrl(getFloorTextureUrl(floorType));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [floorType]);

  return floorType === "custom" ? null : url;
}

// What to fill the floor shape with: the repeating pattern once it's
// ready, otherwise a flat color close to the finished look.
export function useFloorPaint(
  floorType: FloorId,
  floorColor: string,
  patternId: string
) {
  const url = useFloorTextureUrl(floorType);
  const solid =
    floorType === "custom" ? floorColor : getFloorOption(floorType).baseColor;
  return { url, fill: url ? `url(#${patternId})` : solid };
}

// Goes inside an <svg>. Defines the repeating pattern that `fill`
// above points at. `pxPerCm` is the SVG's scale, so a 60cm tile is drawn
// 60cm wide on screen.
export function FloorPatternDefs({
  patternId,
  url,
  pxPerCm,
}: {
  patternId: string;
  url: string | null;
  pxPerCm: number;
}) {
  if (!url) return null;
  const size = FLOOR_PERIOD_CM * pxPerCm;
  return (
    <defs>
      <pattern
        id={patternId}
        patternUnits="userSpaceOnUse"
        width={size}
        height={size}
      >
        <image href={url} width={size} height={size} preserveAspectRatio="none" />
      </pattern>
    </defs>
  );
}
