// The room setup screen. This used to be three number inputs (width,
// length, height). Now it's a real drawing tool: click points on a grid
// to trace your room's actual outline - straight rectangle, L-shape,
// an alcove, whatever your real room looks like - then fine-tune each
// corner by dragging it, or typing exact measurements below.

import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { StepNav } from "~/components/StepNav";
import {
  FloorPatternDefs,
  useFloorPaint,
  useFloorTextureUrl,
} from "~/components/FloorPattern";
import { useRoomStore } from "~/store/roomStore";
import type { RoomPoint } from "~/lib/geometry";
import { ROOM_PRESETS, WALL_COLORS } from "~/lib/presets";
import {
  DOOR_COLOR,
  OPENING_DEFAULTS,
  WINDOW_COLOR,
  edgeLength,
  getOpeningLine,
  sanitizeOpenings,
  snapToWall,
  type Opening,
  type OpeningType,
} from "~/lib/openings";
import {
  FLOORING_OPTIONS,
  getFloorOption,
  type FloorGroup,
  type FloorId,
  type FloorOption,
} from "~/lib/flooring";

// The drawing canvas represents an 800cm x 800cm (8m x 8m) working
// area - generous for most rooms - mapped onto a fixed-size on-screen
// grid. GRID_PX / GRID_CM gives us "pixels per centimeter" for this
// screen only (separate from the floor plan's own scale later).
const GRID_CM = 800;
const GRID_PX = 560;
const SCALE = GRID_PX / GRID_CM;
const SNAP_CM = 10; // clicks/drags snap to the nearest 10cm, so corners
// come out as clean round numbers instead of stray decimals

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snap(cm: number) {
  return clamp(Math.round(cm / SNAP_CM) * SNAP_CM, 0, GRID_CM);
}

export default function RoomSetup() {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const shape = useRoomStore((state) => state.shape);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorType = useRoomStore((state) => state.floorType);
  const floorColor = useRoomStore((state) => state.floorColor);
  const setShape = useRoomStore((state) => state.setShape);
  const setWallColor = useRoomStore((state) => state.setWallColor);
  const setFloorType = useRoomStore((state) => state.setFloorType);
  const setFloorColor = useRoomStore((state) => state.setFloorColor);
  const applyPreset = useRoomStore((state) => state.applyPreset);
  const openings = useRoomStore((state) => state.openings);
  const addOpening = useRoomStore((state) => state.addOpening);
  const updateOpening = useRoomStore((state) => state.updateOpening);
  const removeOpening = useRoomStore((state) => state.removeOpening);

  // Only openings that still fit the current outline are shown/drawn
  const validOpenings = sanitizeOpenings(shape.points, openings, shape.heightCm);

  // The list shows what was typed as-is (so typing isn't fought by
  // clamping); only walls that still exist are listed.
  const listedOpenings = openings.filter(
    (o) => o.edgeIndex >= 0 && o.edgeIndex < shape.points.length
  );

  function handleAddOpening(type: OpeningType) {
    if (shape.points.length < 3) return;
    // Put it on the longest wall, in the middle
    let best = 0;
    for (let i = 1; i < shape.points.length; i++) {
      if (edgeLength(shape.points, i) > edgeLength(shape.points, best)) best = i;
    }
    addOpening({
      id: crypto.randomUUID(),
      type,
      edgeIndex: best,
      centerCm: edgeLength(shape.points, best) / 2,
      ...OPENING_DEFAULTS[type],
    });
  }

  // The room preview is filled with the chosen flooring, drawn to the
  // same scale as the grid (so a 60cm tile looks 60cm wide).
  const floorPaint = useFloorPaint(floorType, floorColor, "setup-floor");

  // Whether the shape is "finished" (a closed polygon you can drag
  // corners of) or still being drawn (an open line you're adding points
  // to). This is a purely visual/editing distinction, so it lives here
  // as local state rather than in the shared store.
  const [isClosed, setIsClosed] = useState(shape.points.length >= 3);

  function pointFromEvent(e: { clientX: number; clientY: number }): RoomPoint {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: snap((e.clientX - rect.left) / SCALE),
      z: snap((e.clientY - rect.top) / SCALE),
    };
  }

  function handleCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    if (isClosed) return; // once closed, clicking the canvas does nothing -
    // corners are adjusted by dragging them instead
    const point = pointFromEvent(e);
    setShape({ ...shape, points: [...shape.points, point] });
  }

  // Dragging a door/window: it follows the pointer but always stays on
  // a wall - it jumps to whichever wall is nearest, and slides along it.
  function moveOpeningTo(id: string, e: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect();
    const snapped = snapToWall(shape.points, {
      x: (e.clientX - rect.left) / SCALE,
      z: (e.clientY - rect.top) / SCALE,
    });
    if (snapped) updateOpening(id, snapped);
  }

  function handleCornerDrag(index: number, point: RoomPoint) {
    const nextPoints = shape.points.map((p, i) => (i === index ? point : p));
    setShape({ ...shape, points: nextPoints });
  }

  function handleUndo() {
    setShape({ ...shape, points: shape.points.slice(0, -1) });
  }

  function handleStartOver() {
    setShape({ ...shape, points: [] });
    setIsClosed(false);
  }

  function handleRemovePoint(index: number) {
    if (shape.points.length <= 3) return; // a room needs at least 3 corners
    setShape({
      ...shape,
      points: shape.points.filter((_, i) => i !== index),
    });
  }

  const canFinish = shape.points.length >= 3;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <StepNav />

      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Draw your room
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {isClosed
            ? "Drag a corner to adjust it, or fine-tune exact measurements below."
            : "Click to place each corner of your room, in order around the edge. You need at least 3 points."}
        </p>

        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          <div className="flex-shrink-0">
            <svg
              ref={svgRef}
              width={GRID_PX}
              height={GRID_PX}
              onClick={handleCanvasClick}
              className="rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
              style={{ cursor: isClosed ? "default" : "crosshair" }}
            >
              <FloorPatternDefs
                patternId="setup-floor"
                url={floorPaint.url}
                pxPerCm={SCALE}
              />

              {/* Reference grid, every 50cm, purely visual */}
              {Array.from({ length: GRID_CM / 50 + 1 }, (_, i) => i * 50).map(
                (cm) => (
                  <g key={cm}>
                    <line
                      x1={cm * SCALE}
                      y1={0}
                      x2={cm * SCALE}
                      y2={GRID_PX}
                      stroke="currentColor"
                      className="text-stone-100 dark:text-stone-800"
                    />
                    <line
                      x1={0}
                      y1={cm * SCALE}
                      x2={GRID_PX}
                      y2={cm * SCALE}
                      stroke="currentColor"
                      className="text-stone-100 dark:text-stone-800"
                    />
                  </g>
                )
              )}

              {/* The room shape itself: filled polygon once closed, an
                  open dashed line while still being drawn */}
              {shape.points.length > 0 &&
                (isClosed ? (
                  <polygon
                    points={shape.points
                      .map((p) => `${p.x * SCALE},${p.z * SCALE}`)
                      .join(" ")}
                    fill={floorPaint.fill}
                    stroke={wallColor}
                    strokeWidth={10}
                    strokeLinejoin="round"
                  />
                ) : (
                  <polyline
                    points={shape.points
                      .map((p) => `${p.x * SCALE},${p.z * SCALE}`)
                      .join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    className="text-stone-400"
                  />
                ))}

              {/* Doors (brown) and windows (blue) drawn on their walls */}
              {isClosed &&
                validOpenings.map((o) => {
                  const line = getOpeningLine(shape.points, o);
                  const coords = {
                    x1: line.x1 * SCALE,
                    y1: line.z1 * SCALE,
                    x2: line.x2 * SCALE,
                    y2: line.z2 * SCALE,
                  };
                  return (
                    <g key={o.id}>
                      <line
                        {...coords}
                        stroke={o.type === "door" ? DOOR_COLOR : WINDOW_COLOR}
                        strokeWidth={10}
                        strokeLinecap="butt"
                      />
                      {/* A wider invisible copy that's easy to grab */}
                      <line
                        {...coords}
                        stroke="transparent"
                        strokeWidth={26}
                        style={{ cursor: "grab", touchAction: "none" }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            moveOpeningTo(o.id, e);
                          }
                        }}
                      >
                        <title>Drag along the walls to move</title>
                      </line>
                    </g>
                  );
                })}

              {/* One draggable (once closed) or plain (while drawing)
                  handle per corner */}
              {shape.points.map((point, index) => (
                <CornerHandle
                  key={index}
                  point={point}
                  draggable={isClosed}
                  svgRef={svgRef}
                  onDrag={(next) => handleCornerDrag(index, next)}
                />
              ))}
            </svg>

            <div className="mt-3 flex flex-wrap gap-2">
              {!isClosed && (
                <>
                  <button
                    onClick={handleUndo}
                    disabled={shape.points.length === 0}
                    className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                  >
                    Undo last point
                  </button>
                  <button
                    onClick={() => setIsClosed(true)}
                    disabled={!canFinish}
                    className="rounded-full bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
                  >
                    Finish shape
                  </button>
                </>
              )}
              {isClosed && (
                <button
                  onClick={handleStartOver}
                  className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  Start over
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-6">
            {/* Precise numeric editing, for anyone who'd rather type
                exact measurements than eyeball them by dragging */}
            {shape.points.length > 0 && (
              <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <h2 className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                  Corners (cm)
                </h2>
                <div className="mt-2 space-y-2">
                  {shape.points.map((point, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-4 text-xs text-stone-400">
                        {index + 1}
                      </span>
                      <input
                        type="number"
                        value={point.x}
                        onChange={(e) =>
                          handleCornerDrag(index, {
                            ...point,
                            x: Number(e.target.value),
                          })
                        }
                        className="w-20 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-800"
                      />
                      <span className="text-xs text-stone-400">x</span>
                      <input
                        type="number"
                        value={point.z}
                        onChange={(e) =>
                          handleCornerDrag(index, {
                            ...point,
                            z: Number(e.target.value),
                          })
                        }
                        className="w-20 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-800"
                      />
                      <button
                        onClick={() => handleRemovePoint(index)}
                        disabled={shape.points.length <= 3}
                        className="ml-auto text-xs text-red-600 hover:text-red-800 disabled:opacity-30"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                Or start from an example
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {ROOM_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      applyPreset({
                        ...preset,
                        openings: preset.openings.map((o) => ({
                          ...o,
                          id: crypto.randomUUID(),
                        })),
                      });
                      setIsClosed(true);
                    }}
                    className="rounded-lg border border-stone-200 p-2 text-left hover:border-stone-400 dark:border-stone-700 dark:hover:border-stone-500"
                  >
                    <div className="text-xs font-medium text-stone-900 dark:text-stone-100">
                      {preset.label}
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">
                      {preset.blurb}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <label className="block">
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  Ceiling height (cm)
                </span>
                <input
                  type="number"
                  value={shape.heightCm}
                  onChange={(e) =>
                    setShape({ ...shape, heightCm: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-800"
                />
              </label>

              <div className="mt-4">
                <ColorField
                  label="Wall color"
                  value={wallColor}
                  onChange={setWallColor}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {WALL_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      aria-label={`Wall color: ${c.label}`}
                      aria-pressed={wallColor.toLowerCase() === c.value}
                      onClick={() => setWallColor(c.value)}
                      style={{ backgroundColor: c.value }}
                      className={`h-7 w-7 rounded-full border border-stone-300 dark:border-stone-600 ${
                        wallColor.toLowerCase() === c.value
                          ? "ring-2 ring-stone-900 ring-offset-2 dark:ring-stone-100 dark:ring-offset-stone-900"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                Doors &amp; windows
              </h2>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleAddOpening("door")}
                  disabled={!isClosed}
                  className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  + Door
                </button>
                <button
                  type="button"
                  onClick={() => handleAddOpening("window")}
                  disabled={!isClosed}
                  className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  + Window
                </button>
              </div>
              {listedOpenings.length === 0 && (
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                  None yet. Doors show brown and windows blue on the plan - drag them along the walls to move them.
                </p>
              )}
              <div className="mt-3 space-y-3">
                {listedOpenings.map((o) => (
                  <OpeningRow
                    key={o.id}
                    opening={o}
                    wallCount={shape.points.length}
                    wallLengths={shape.points.map((_, i) => edgeLength(shape.points, i))}
                    onChange={(patch) => updateOpening(o.id, patch)}
                    onRemove={() => removeOpening(o.id)}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <h2 className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                Flooring
              </h2>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                {floorType === "custom"
                  ? "Custom color"
                  : `${getFloorOption(floorType).group}: ${getFloorOption(floorType).label}`}
              </p>
              <FloorChooser value={floorType} onChange={setFloorType} />
              {floorType === "custom" && (
                <div className="mt-4">
                  <ColorField
                    label="Floor color"
                    value={floorColor}
                    onChange={setFloorColor}
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => navigate("/design")}
              disabled={!isClosed}
              className="w-full rounded-full bg-stone-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              Continue to floor plan →
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function OpeningRow({
  opening,
  wallCount,
  wallLengths,
  onChange,
  onRemove,
}: {
  opening: Opening;
  wallCount: number;
  wallLengths: number[];
  onChange: (patch: Partial<Omit<Opening, "id">>) => void;
  onRemove: () => void;
}) {
  const inputClass =
    "mt-0.5 w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-800";
  return (
    <div className="rounded-lg border border-stone-200 p-2 dark:border-stone-700">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-stone-900 dark:text-stone-100">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{
              backgroundColor: opening.type === "door" ? DOOR_COLOR : WINDOW_COLOR,
            }}
          />
          {opening.type === "door" ? "Door" : "Window"}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-600 hover:underline"
        >
          Remove
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[11px] text-stone-500 dark:text-stone-400">
          Wall
          <select
            value={opening.edgeIndex}
            onChange={(e) => onChange({ edgeIndex: Number(e.target.value) })}
            className={inputClass}
          >
            {Array.from({ length: wallCount }, (_, i) => (
              <option key={i} value={i}>
                Wall {i + 1} ({Math.round(wallLengths[i])} cm)
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-stone-500 dark:text-stone-400">
          Position (cm)
          <input
            type="number"
            value={Math.round(opening.centerCm)}
            onChange={(e) => onChange({ centerCm: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500 dark:text-stone-400">
          Width (cm)
          <input
            type="number"
            value={Math.round(opening.widthCm)}
            onChange={(e) => onChange({ widthCm: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
        <label className="text-[11px] text-stone-500 dark:text-stone-400">
          Height (cm)
          <input
            type="number"
            value={Math.round(opening.heightCm)}
            onChange={(e) => onChange({ heightCm: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
        {opening.type === "window" && (
          <label className="text-[11px] text-stone-500 dark:text-stone-400">
            Sill height (cm)
            <input
              type="number"
              value={Math.round(opening.sillCm)}
              onChange={(e) => onChange({ sillCm: Number(e.target.value) })}
              className={inputClass}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function CornerHandle({
  point,
  draggable,
  svgRef,
  onDrag,
}: {
  point: RoomPoint;
  draggable: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onDrag: (point: RoomPoint) => void;
}) {
  // Pointer capture is the trick that makes free dragging simple: once
  // captured on pointer-down, this exact element keeps receiving
  // pointermove/pointerup events even if the cursor moves outside its
  // boundaries - no need for manual window-level event listeners.
  function handlePointerDown(e: React.PointerEvent<SVGCircleElement>) {
    if (!draggable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<SVGCircleElement>) {
    if (!draggable) return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    onDrag({
      x: snap((e.clientX - rect.left) / SCALE),
      z: snap((e.clientY - rect.top) / SCALE),
    });
  }

  return (
    <circle
      cx={point.x * SCALE}
      cy={point.z * SCALE}
      r={7}
      fill="#57534e"
      stroke="white"
      strokeWidth={2}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      style={{ cursor: draggable ? "grab" : "default" }}
    />
  );
}

const FLOOR_GROUP_ORDER: FloorGroup[] = ["Tile", "Hardwood", "Concrete", "Custom"];

// The flooring picker: a swatch for every option, grouped by material.
// Each swatch shows a small piece of the real painted floor.
function FloorChooser({
  value,
  onChange,
}: {
  value: FloorId;
  onChange: (id: FloorId) => void;
}) {
  const floorColor = useRoomStore((state) => state.floorColor);

  return (
    <div className="mt-3 space-y-3">
      {FLOOR_GROUP_ORDER.map((group) => {
        const options = FLOORING_OPTIONS.filter((o) => o.group === group);
        if (options.length === 0) return null;
        return (
          <div key={group}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
              {group}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {options.map((option) => (
                <FloorSwatch
                  key={option.id}
                  option={option}
                  selected={option.id === value}
                  customColor={floorColor}
                  onSelect={() => onChange(option.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FloorSwatch({
  option,
  selected,
  customColor,
  onSelect,
}: {
  option: FloorOption;
  selected: boolean;
  customColor: string;
  onSelect: () => void;
}) {
  const url = useFloorTextureUrl(option.id);

  // A swatch shows the painted floor at about 0.8 pixels per cm, so a
  // 60cm tile or a 12cm plank is easy to make out.
  const style =
    option.id === "custom"
      ? { backgroundColor: customColor }
      : url
        ? {
            backgroundColor: option.baseColor,
            backgroundImage: `url(${url})`,
            backgroundSize: "192px 192px",
          }
        : { backgroundColor: option.baseColor };

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${option.group}: ${option.label}`}
      className="flex w-[76px] flex-col items-center gap-1 text-center"
    >
      <span
        style={style}
        className={
          "block h-[76px] w-[76px] rounded-lg border-2 transition-shadow " +
          (selected
            ? "border-stone-900 shadow-md dark:border-stone-100"
            : "border-white ring-1 ring-stone-300 hover:ring-stone-500 dark:border-stone-900 dark:ring-stone-700")
        }
      />
      <span
        className={
          "text-[11px] leading-tight " +
          (selected
            ? "font-semibold text-stone-900 dark:text-stone-100"
            : "text-stone-600 dark:text-stone-400")
        }
      >
        {option.label}
      </span>
    </button>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
        {label}
      </span>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-800">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0"
        />
        <span className="text-sm text-stone-500 dark:text-stone-400">
          {value}
        </span>
      </div>
    </label>
  );
}
