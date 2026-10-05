// The 3D walkthrough. Everything here reads the exact same room state
// (shape, colors, placed items) that the 2D floor planner writes to -
// nothing is duplicated. We're just rendering the same data a different
// way: as an explorable 3D scene instead of a flat top-down diagram.
//
// The room can now be any polygon shape, not just a rectangle, so this
// file builds:
//  - the floor as a real polygon mesh (via Three.js's Shape, which
//    correctly fills in even a concave shape like an L, unlike a naive
//    "fan of triangles from the center" approach which breaks on
//    concave shapes)
//  - a textured floor (tile / hardwood / concrete), soft shadows, a light
//    studio environment, baseboards and walls that fade when they block
//    the camera
//  - one wall PER EDGE of the polygon, each individually positioned and
//    rotated to sit exactly along that edge - this is what makes
//    arbitrary bends and angles in a room actually show up in 3D
//
// Three.js scenes need actual browser graphics (WebGL) to render, which
// doesn't exist on the server. So we wait until the component has
// "mounted" in the browser before rendering the <Canvas> at all - on
// the server, and for a brief instant in the browser before JavaScript
// finishes loading, we just show a simple loading message instead.

import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { RefObject } from "react";
import {
  Environment,
  Lightformer,
  OrbitControls,
  RoundedBox,
  useGLTF,
} from "@react-three/drei";
import {
  Box3,
  CanvasTexture,
  DoubleSide,
  MathUtils,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  Vector3,
} from "three";
import { StepNav } from "~/components/StepNav";
import { useRoomStore, type PlacedItem } from "~/store/roomStore";
import {
  checkPlacement,
  getEffectiveFootprint,
  getPolygonBounds,
  getWallSegments,
} from "~/lib/geometry";
import { sanitizeOpenings, type Opening } from "~/lib/openings";
import {
  FLOOR_PERIOD_CM,
  getFloorOption,
  paintFloorCanvas,
  type FloorId,
} from "~/lib/flooring";

const WALL_THICKNESS_M = 0.1;
const BASEBOARD_HEIGHT_M = 0.09;

export default function Walkthrough() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const shape = useRoomStore((state) => state.shape);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);
  const floorType = useRoomStore((state) => state.floorType);
  const placedItems = useRoomStore((state) => state.placedItems);
  const openings = useRoomStore((state) => state.openings);

  // Walk mode: first-person view inside the room (vs. the orbit overview)
  const [walk, setWalk] = useState(false);

  // Same idea as the 2D floor plan: work in coordinates relative to the
  // room's bounding-box corner, in meters (three.js convention).
  const bounds = getPolygonBounds(shape.points);
  const roomWidthM = (bounds.maxX - bounds.minX) / 100;
  const roomDepthM = (bounds.maxZ - bounds.minZ) / 100;
  const heightM = shape.heightCm / 100;

  // Memoized so these only rebuild when the room's shape changes.
  const localPointsM = useMemo(
    () =>
      shape.points.map((p) => ({
        x: (p.x - bounds.minX) / 100,
        z: (p.z - bounds.minZ) / 100,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape.points]
  );

  const floorShape = useMemo(() => {
    const s = new Shape();
    // A Shape lives in its own 2D (x, y) plane; z is negated so that
    // after the mesh is laid flat (-90deg around X) it isn't mirrored.
    s.moveTo(localPointsM[0].x, -localPointsM[0].z);
    for (const p of localPointsM.slice(1)) s.lineTo(p.x, -p.z);
    s.closePath();
    return s;
  }, [localPointsM]);

  const walls = useMemo(
    () => getWallSegments(localPointsM, WALL_THICKNESS_M),
    [localPointsM]
  );

  const maxDim = Math.max(roomWidthM, roomDepthM);

  const roomOpenings = useMemo(
    () => sanitizeOpenings(shape.points, openings, shape.heightCm),
    [shape.points, openings, shape.heightCm]
  );

  // Same room, in centimeters, for the "can I stand here?" check used
  // while walking.
  const roomCm = useMemo(
    () => ({
      polygon: localPointsM.map((p) => ({ x: p.x * 100, z: p.z * 100 })),
      widthCm: roomWidthM * 100,
      depthCm: roomDepthM * 100,
    }),
    [localPointsM, roomWidthM, roomDepthM]
  );

  // Standing room for a person (a 40cm square): inside the walls and
  // not inside furniture.
  const canStand = (xM: number, zM: number) =>
    checkPlacement({
      center: { x: xM * 100, z: zM * 100 },
      widthCm: 40,
      depthCm: 40,
      rotationY: 0,
      others: placedItems,
      room: roomCm,
    }).ok;

  // Where the walker starts: the free spot closest to the room's middle
  const walkStart = useMemo(() => {
    let best: [number, number] = [roomWidthM / 2, roomDepthM / 2];
    let bestDist = Infinity;
    for (let x = 20; x < roomCm.widthCm; x += 20) {
      for (let z = 20; z < roomCm.depthCm; z += 20) {
        const ok = checkPlacement({
          center: { x, z },
          widthCm: 40,
          depthCm: 40,
          rotationY: 0,
          others: placedItems,
          room: roomCm,
        }).ok;
        if (!ok) continue;
        const d = Math.hypot(x - roomCm.widthCm / 2, z - roomCm.depthCm / 2);
        if (d < bestDist) {
          bestDist = d;
          best = [x / 100, z / 100];
        }
      }
    }
    return best;
    // Only needs to be right when walking starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk]);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <StepNav />

      <div className="mx-auto max-w-6xl px-6 py-4">
        <Link
          to="/design"
          className="text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
        >
          ← Back to floor plan
        </Link>
      </div>

      <div className="relative mx-auto h-[70vh] max-w-6xl overflow-hidden rounded-2xl bg-stone-800 px-0 shadow-inner sm:mx-6">
        {mounted && (
          <div className="pointer-events-none absolute top-3 right-3 left-3 z-10 flex items-start justify-between gap-3">
            <p className="rounded-lg bg-black/45 px-3 py-1.5 text-xs text-white">
              {walk
                ? "Drag to look · W A S D or arrow keys to move · Shift to run"
                : "Drag to orbit · scroll to zoom · right-drag to pan"}
            </p>
            <button
              type="button"
              onClick={() => setWalk((w) => !w)}
              className="pointer-events-auto rounded-full bg-white px-4 py-2 text-xs font-medium text-stone-900 shadow hover:bg-stone-100"
            >
              {walk ? "⤴ Back to overview" : "🚶 Walk inside"}
            </button>
          </div>
        )}
        {mounted ? (
          <Canvas
            // Re-created if the room's size changes so the camera starts
            // in a sensible spot for the new room.
            key={`${roomWidthM.toFixed(2)}x${roomDepthM.toFixed(2)}-${walk ? "walk" : "orbit"}`}
            shadows
            dpr={[1, 2]}
            camera={{
              position: walk
                ? [walkStart[0], 1.6, walkStart[1]]
                : [
                    roomWidthM / 2 + maxDim * 0.9,
                    heightM + maxDim * 0.8,
                    roomDepthM / 2 + maxDim * 1.1,
                  ],
              fov: walk ? 70 : 45,
              near: 0.05,
            }}
          >
            <color attach="background" args={["#d9d4cc"]} />

            {/* Soft studio-style reflections, built from a few light
                panels (no image download needed) */}
            <Environment resolution={256} environmentIntensity={0.55}>
              <Lightformer
                form="rect"
                intensity={2}
                position={[0, 5, 0]}
                rotation-x={Math.PI / 2}
                scale={[10, 10, 1]}
              />
              <Lightformer
                form="rect"
                intensity={1.2}
                position={[-6, 2, 2]}
                rotation-y={Math.PI / 2}
                scale={[8, 4, 1]}
              />
              <Lightformer
                form="rect"
                intensity={0.8}
                position={[6, 2, -2]}
                rotation-y={-Math.PI / 2}
                scale={[8, 4, 1]}
              />
            </Environment>

            <hemisphereLight args={["#ffffff", "#b8aa98", 0.5]} />
            <directionalLight
              castShadow
              position={[
                roomWidthM / 2 + maxDim * 0.6,
                heightM * 2.2,
                roomDepthM / 2 + maxDim * 0.4,
              ]}
              target-position={[roomWidthM / 2, 0, roomDepthM / 2]}
              intensity={1.6}
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0004}
              shadow-normalBias={0.02}
              shadow-camera-left={-maxDim}
              shadow-camera-right={maxDim}
              shadow-camera-top={maxDim}
              shadow-camera-bottom={-maxDim}
              shadow-camera-near={0.5}
              shadow-camera-far={maxDim * 6 + heightM * 4}
            />

            <Floor
              shape={floorShape}
              floorType={floorType}
              floorColor={floorColor}
            />

            {walls.map((w, i) => (
              <Wall
                key={i}
                wall={w}
                heightM={heightM}
                color={wallColor}
                openings={roomOpenings.filter((o) => o.edgeIndex === w.edgeIndex)}
              />
            ))}

            {/* Baseboards: a thin trim strip along the foot of each wall,
                just inside the room (broken at doorways) */}
            {walls.map((w) => (
              <Baseboards
                key={`bb-${w.edgeIndex}`}
                wall={w}
                doors={roomOpenings.filter(
                  (o) => o.edgeIndex === w.edgeIndex && o.type === "door"
                )}
              />
            ))}

            {/* Furniture, from the same data the 2D planner uses. Real
                .glb models where a product has one, nice placeholder
                boxes otherwise. Suspense because loading a model file is
                asynchronous. */}
            <Suspense fallback={null}>
              {placedItems.map((item) => (
                <PlacedFurnitureMesh key={item.id} item={item} />
              ))}
            </Suspense>

            {walk ? (
              <WalkControls
                start={walkStart}
                lookAt={[roomWidthM / 2, roomDepthM / 2]}
                canStand={canStand}
              />
            ) : (
              <OrbitControls
                target={[roomWidthM / 2, heightM * 0.3, roomDepthM / 2]}
                maxPolarAngle={Math.PI / 2 - 0.05}
                minDistance={maxDim * 0.4}
                maxDistance={maxDim * 3}
                enableDamping
              />
            )}
          </Canvas>
        ) : (
          <div className="p-6 text-sm text-stone-300">Loading 3D view…</div>
        )}
      </div>
    </div>
  );
}

// The floor: a polygon filled with the chosen material. For tile/hardwood/
// concrete the painted picture (see lib/flooring.ts) is repeated across
// the floor at real-world scale; "custom" is just a flat color.
function Floor({
  shape,
  floorType,
  floorColor,
}: {
  shape: Shape;
  floorType: FloorId;
  floorColor: string;
}) {
  const gl = useThree((state) => state.gl);

  const texture = useMemo(() => {
    if (floorType === "custom") return null;
    const canvas = paintFloorCanvas(floorType, 1024);
    if (!canvas) return null;
    const t = new CanvasTexture(canvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    // ShapeGeometry UVs are in meters, and one picture covers
    // FLOOR_PERIOD_CM, so this keeps tiles/planks at true size.
    const repeat = 100 / FLOOR_PERIOD_CM;
    t.repeat.set(repeat, repeat);
    return t;
  }, [floorType, gl]);

  useEffect(() => () => texture?.dispose(), [texture]);

  const option = floorType === "custom" ? null : getFloorOption(floorType);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        key={texture ? texture.uuid : "flat"}
        map={texture ?? undefined}
        color={texture ? "#ffffff" : floorColor}
        roughness={option?.roughness ?? 0.8}
        side={DoubleSide}
      />
    </mesh>
  );
}

// Baseboard strips for one wall, skipping the width of any doors.
function Baseboards({
  wall,
  doors,
}: {
  wall: ReturnType<typeof getWallSegments>[number];
  doors: Opening[];
}) {
  // Spans along the EDGE (0 = its start corner), in meters
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const d of [...doors].sort((p, q) => p.centerCm - q.centerCm)) {
    const start = (d.centerCm - d.widthCm / 2) / 100 - 0.05;
    const end = (d.centerCm + d.widthCm / 2) / 100 + 0.05;
    if (start > cursor) spans.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < wall.edgeLength) spans.push([cursor, wall.edgeLength]);

  // Where the edge's start corner sits in the slab's own frame
  const edgeStartX = -wall.alongOffset;
  // Which way the slab's own "z" axis points relative to "outward"
  // (it depends on which way the room outline winds): +1 if the same.
  const sideSign =
    wall.outwardX * Math.sin(wall.angleY) + wall.outwardZ * Math.cos(wall.angleY) > 0
      ? 1
      : -1;
  return (
    <group
      position={[wall.centerX, 0, wall.centerZ]}
      rotation={[0, wall.angleY, 0]}
    >
      {spans
        .filter(([a, b]) => b - a > 0.02)
        .map(([a, b], i) => (
          <mesh
            key={i}
            position={[
              edgeStartX + (a + b) / 2,
              BASEBOARD_HEIGHT_M / 2,
              // slab is centered half a thickness OUTSIDE the edge, so
              // step back in (toward the room) to sit on the floor side
              -sideSign * (WALL_THICKNESS_M / 2 + 0.01),
            ]}
            receiveShadow
          >
            <boxGeometry args={[b - a, BASEBOARD_HEIGHT_M, 0.02]} />
            <meshStandardMaterial color="#fbfaf7" roughness={0.5} />
          </mesh>
        ))}
    </group>
  );
}

// One wall. It's built from separate boxes so doors and windows can be
// real openings: full-height pieces between openings, a strip under each
// window, and a strip over each window or door. Walls between the camera
// and the room's inside fade to nearly see-through so you can always look
// in, while the walls behind stay solid - which makes the room read as a
// room.
function Wall({
  wall,
  heightM,
  color,
  openings,
}: {
  wall: ReturnType<typeof getWallSegments>[number];
  heightM: number;
  color: string;
  openings: Opening[];
}) {
  const groupRef = useRef<Group>(null);
  const fade = useRef(1);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({ color, roughness: 0.95, transparent: true }),
    // color is applied separately below so a color change doesn't
    // rebuild the material
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(() => {
    material.color.set(color);
  }, [color, material]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera }, delta) => {
    const towardCamera =
      (camera.position.x - wall.edgeMidX) * wall.outwardX +
      (camera.position.z - wall.edgeMidZ) * wall.outwardZ;
    const target = towardCamera > 0 ? 0.08 : 1;
    fade.current = MathUtils.damp(fade.current, target, 8, delta);
    material.opacity = fade.current;
    material.depthWrite = fade.current > 0.5;
    const casts = fade.current > 0.5;
    groupRef.current?.children.forEach((child) => {
      if ((child as Mesh).isMesh && child.userData.wallPiece) {
        child.castShadow = casts;
      }
    });
  });

  // Where each solid piece goes, measured along the wall from its middle
  const pieces = useMemo(() => {
    const out: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    const half = wall.length / 2;
    const sorted = [...openings].sort((p, q) => p.centerCm - q.centerCm);
    let cursor = -half;
    for (const o of sorted) {
      const start = (o.centerCm - o.widthCm / 2) / 100 - wall.alongOffset;
      const end = (o.centerCm + o.widthCm / 2) / 100 - wall.alongOffset;
      const sill = o.sillCm / 100;
      const top = (o.sillCm + o.heightCm) / 100;
      out.push({ x0: cursor, x1: start, y0: 0, y1: heightM });
      if (sill > 0.001) out.push({ x0: start, x1: end, y0: 0, y1: sill });
      if (top < heightM - 0.001) out.push({ x0: start, x1: end, y0: top, y1: heightM });
      cursor = end;
    }
    out.push({ x0: cursor, x1: half, y0: 0, y1: heightM });
    return out.filter((p) => p.x1 - p.x0 > 0.005 && p.y1 - p.y0 > 0.005);
  }, [openings, wall.length, wall.alongOffset, heightM]);

  return (
    <group
      ref={groupRef}
      position={[wall.centerX, 0, wall.centerZ]}
      rotation={[0, wall.angleY, 0]}
    >
      {pieces.map((p, i) => (
        <mesh
          key={i}
          userData={{ wallPiece: true }}
          position={[(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, 0]}
          material={material}
          receiveShadow
        >
          <boxGeometry args={[p.x1 - p.x0, p.y1 - p.y0, WALL_THICKNESS_M]} />
        </mesh>
      ))}
      {openings.map((o) => (
        <OpeningFixture
          key={o.id}
          opening={o}
          x={o.centerCm / 100 - wall.alongOffset}
          fade={fade}
        />
      ))}
    </group>
  );
}

// The door leaf or window glass + frame that fills an opening, plus
// white trim around it. Fades along with its wall.
function OpeningFixture({
  opening,
  x,
  fade,
}: {
  opening: Opening;
  x: number;
  fade: RefObject<number>;
}) {
  const w = opening.widthCm / 100;
  const h = opening.heightCm / 100;
  const y0 = opening.sillCm / 100;
  const trim = 0.05;
  const T = WALL_THICKNESS_M;

  const materials = useMemo(
    () => ({
      trim: new MeshStandardMaterial({ color: "#fbfaf7", roughness: 0.5, transparent: true }),
      leaf: new MeshStandardMaterial({ color: "#a9825a", roughness: 0.6, transparent: true }),
      glass: new MeshStandardMaterial({
        color: "#cfe9f7",
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
      }),
      handle: new MeshStandardMaterial({ color: "#c8c5bd", metalness: 0.8, roughness: 0.3, transparent: true }),
    }),
    []
  );
  useEffect(
    () => () => Object.values(materials).forEach((m) => m.dispose()),
    [materials]
  );
  useFrame(() => {
    const f = fade.current ?? 1;
    materials.trim.opacity = f;
    materials.leaf.opacity = f;
    materials.handle.opacity = f;
    materials.glass.opacity = 0.28 * f;
  });

  // Trim: left, right, top (and a sill for windows)
  const trimPieces: Array<[number, number, number, number]> = [
    [-w / 2 - trim / 2, y0 + h / 2, trim, h + trim],
    [w / 2 + trim / 2, y0 + h / 2, trim, h + trim],
    [0, y0 + h + trim / 2, w + trim * 2, trim],
  ];
  if (opening.type === "window") {
    trimPieces.push([0, y0 - trim / 2, w + trim * 2, trim]);
  }

  return (
    <group position={[x, 0, 0]}>
      {trimPieces.map(([px, py, sw, sh], i) => (
        <mesh key={i} position={[px, py, 0]} material={materials.trim} castShadow>
          <boxGeometry args={[sw, sh, T + 0.02]} />
        </mesh>
      ))}
      {opening.type === "window" ? (
        <>
          <mesh position={[0, y0 + h / 2, 0]} material={materials.glass}>
            <boxGeometry args={[w, h, 0.012]} />
          </mesh>
          {/* Cross bars */}
          <mesh position={[0, y0 + h / 2, 0]} material={materials.trim}>
            <boxGeometry args={[0.03, h, 0.03]} />
          </mesh>
          <mesh position={[0, y0 + h / 2, 0]} material={materials.trim}>
            <boxGeometry args={[w, 0.03, 0.03]} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, y0 + h / 2, 0]} material={materials.leaf} castShadow receiveShadow>
            <boxGeometry args={[w, h, 0.04]} />
          </mesh>
          <mesh position={[w / 2 - 0.07, y0 + h * 0.48, 0.04]} material={materials.handle}>
            <sphereGeometry args={[0.025, 12, 12]} />
          </mesh>
          <mesh position={[w / 2 - 0.07, y0 + h * 0.48, -0.04]} material={materials.handle}>
            <sphereGeometry args={[0.025, 12, 12]} />
          </mesh>
        </>
      )}
    </group>
  );
}

// First-person controls: drag to look around, W A S D / arrow keys to
// walk (Shift to run). `canStand` stops you walking through walls and
// furniture, and each axis is tried separately so you slide along
// obstacles instead of sticking to them.
function WalkControls({
  start,
  lookAt,
  canStand,
}: {
  start: [number, number];
  lookAt: [number, number];
  canStand: (x: number, z: number) => boolean;
}) {
  const { camera, gl } = useThree();
  const state = useRef({
    yaw: 0,
    pitch: 0,
    keys: new Set<string>(),
    dragging: false,
    lastX: 0,
    lastY: 0,
  });
  const canStandRef = useRef(canStand);
  canStandRef.current = canStand;

  useEffect(() => {
    const st = state.current;
    camera.position.set(start[0], 1.6, start[1]);
    camera.rotation.order = "YXZ";
    // Start by looking toward the middle of the room (or straight "up"
    // the plan if already standing there)
    const dx = lookAt[0] - start[0];
    const dz = lookAt[1] - start[1];
    st.yaw = Math.hypot(dx, dz) > 0.5 ? Math.atan2(-dx, -dz) : 0;
    st.pitch = 0;

    const canvas = gl.domElement;
    canvas.style.touchAction = "none";

    const onDown = (e: PointerEvent) => {
      st.dragging = true;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!st.dragging) return;
      st.yaw -= (e.clientX - st.lastX) * 0.004;
      st.pitch = MathUtils.clamp(st.pitch - (e.clientY - st.lastY) * 0.004, -1.2, 1.2);
      st.lastX = e.clientX;
      st.lastY = e.clientY;
    };
    const onUp = () => {
      st.dragging = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      st.keys.add(e.key.toLowerCase());
      if (e.key.startsWith("Arrow")) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => st.keys.delete(e.key.toLowerCase());

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [camera, gl, start, lookAt]);

  useFrame((_, delta) => {
    const st = state.current;
    camera.rotation.set(st.pitch, st.yaw, 0);

    const k = st.keys;
    const forward = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const strafe = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    if (forward === 0 && strafe === 0) return;

    const speed = (k.has("shift") ? 3.2 : 1.6) * Math.min(delta, 0.1);
    const fx = -Math.sin(st.yaw);
    const fz = -Math.cos(st.yaw);
    const rx = Math.cos(st.yaw);
    const rz = -Math.sin(st.yaw);
    const len = Math.hypot(forward, strafe) || 1;
    const moveX = ((fx * forward + rx * strafe) / len) * speed;
    const moveZ = ((fz * forward + rz * strafe) / len) * speed;

    const { x, z } = camera.position;
    if (canStandRef.current(x + moveX, z)) camera.position.x = x + moveX;
    if (canStandRef.current(camera.position.x, z + moveZ)) camera.position.z = z + moveZ;
  });

  return null;
}

// A stable, pleasant wood-ish tone per product, so different placeholder
// boxes are told apart in the room.
function placeholderColor(productId: string) {
  let h = 0;
  for (let i = 0; i < productId.length; i++) {
    h = (h * 31 + productId.charCodeAt(i)) >>> 0;
  }
  const hue = 22 + (h % 18);
  const light = 38 + ((h >> 5) % 14);
  return `hsl(${hue}, 38%, ${light}%)`;
}

// If a 3D model file fails to load (bad link, deleted file, network
// hiccup), show the plain placeholder box for that one item instead of
// letting the error take down the whole 3D view.
class ModelBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("A 3D model failed to load; showing a box instead.", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Works out this item's position and rotation (shared by both the real
// model and the placeholder box below), then renders whichever one
// applies. item.position.x/z is stored as the top-left corner of the
// item's EFFECTIVE (rotated) bounding-box footprint, not its raw
// dimensions - items can be rotated to any angle now, so that footprint
// needs the same trigonometry the 2D floor plan uses (see
// getEffectiveFootprint), not just a width/depth swap at 90/270 degrees.
function PlacedFurnitureMesh({ item }: { item: PlacedItem }) {
  const footprint = getEffectiveFootprint(
    item.widthCm,
    item.depthCm,
    item.rotationY
  );
  const x = item.position.x / 100 + footprint.width / 100 / 2;
  const z = item.position.z / 100 + footprint.depth / 100 / 2;
  // three.js turns the opposite way round to the 2D plan's CSS
  // rotation (clockwise on screen), so the angle is negated here so
  // that an item faces the same way in 3D as it did in the plan.
  const rotationYRadians = -(item.rotationY * Math.PI) / 180;

  const itemWidthM = item.widthCm / 100;
  const itemHeightM = item.heightCm / 100;
  const itemDepthM = item.depthCm / 100;

  const box = (
    <RoundedBox
      args={[itemWidthM, itemHeightM, itemDepthM]}
      radius={Math.min(0.03, itemWidthM / 4, itemHeightM / 4, itemDepthM / 4)}
      smoothness={4}
      position={[x, itemHeightM / 2, z]}
      rotation={[0, rotationYRadians, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={placeholderColor(item.productId)}
        roughness={0.6}
      />
    </RoundedBox>
  );

  if (!item.modelUrl) return box;

  return (
    <ModelBoundary fallback={box}>
      <RealModel
        item={item}
        x={x}
        z={z}
        rotationYRadians={rotationYRadians}
      />
    </ModelBoundary>
  );
}

// Loads the product's ACTUAL 3D model (a .glb uploaded to that product
// in Shopify) and drops it into the room. Two things a raw model file
// can't be trusted to match on its own:
//  - its real-world SIZE, since it was modeled/exported independently
//    of our widthCm/heightCm/depthCm data - so we measure its bounding
//    box after loading and scale it to fit those dimensions exactly.
//  - its PIVOT POINT, since an arbitrary .glb might be centered on its
//    origin, sitting on the floor, or anything else - so we also
//    re-center it horizontally and drop it so its bottom sits on the
//    floor (y = 0), matching where the placeholder box and the 2D plan
//    both assume the item sits.
function RealModel({
  item,
  x,
  z,
  rotationYRadians,
}: {
  item: PlacedItem;
  x: number;
  z: number;
  rotationYRadians: number;
}) {
  // useGLTF suspends (throws a promise) while the model is loading -
  // that's what the <Suspense> wrapper around all the furniture is for.
  // If the .glb fails to load (bad URL, network error), this throws for
  // real, which without an error boundary would crash the whole scene -
  // acceptable for now since a broken model URL is worth noticing and
  // fixing in Shopify, but worth revisiting if that turns out to happen
  // often in practice.
  const { scene } = useGLTF(item.modelUrl!);

  // Cloned so that placing the same product twice doesn't have both
  // copies fighting over one shared Object3D instance.
  const clonedScene = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  const { scale, centerOffset, bottomY } = useMemo(() => {
    const box = new Box3().setFromObject(clonedScene);
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);

    return {
      // Guard against a degenerate (zero-size) axis so a broken/empty
      // model doesn't scale to Infinity.
      scale: new Vector3(
        item.widthCm / 100 / (size.x || 1),
        item.heightCm / 100 / (size.y || 1),
        item.depthCm / 100 / (size.z || 1)
      ),
      centerOffset: center,
      bottomY: box.min.y,
    };
  }, [clonedScene, item.widthCm, item.heightCm, item.depthCm]);

  return (
    <group position={[x, 0, z]} rotation={[0, rotationYRadians, 0]}>
      <primitive
        object={clonedScene}
        scale={[scale.x, scale.y, scale.z]}
        position={[
          -centerOffset.x * scale.x,
          -bottomY * scale.y,
          -centerOffset.z * scale.z,
        ]}
      />
    </group>
  );
}
