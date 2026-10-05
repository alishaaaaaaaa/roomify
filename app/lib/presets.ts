// Ready-made starting points: example rooms (shape + flooring + wall
// colour) for the room-setup screen, and a palette of wall colours.

import type { RoomShape } from "~/store/roomStore";
import type { FloorId } from "~/lib/flooring";
import type { Opening } from "~/lib/openings";

export type RoomPreset = {
  id: string;
  label: string;
  blurb: string;
  shape: RoomShape;
  wallColor: string;
  floorType: FloorId;
  openings: Array<Omit<Opening, "id">>;
};

const DOOR = { type: "door" as const, widthCm: 90, heightCm: 205, sillCm: 0 };
const WINDOW = { type: "window" as const, widthCm: 130, heightCm: 120, sillCm: 90 };

export const ROOM_PRESETS: RoomPreset[] = [
  {
    id: "studio",
    label: "Studio",
    blurb: "4.5 × 3.5 m",
    shape: {
      points: [
        { x: 100, z: 100 },
        { x: 550, z: 100 },
        { x: 550, z: 450 },
        { x: 100, z: 450 },
      ],
      heightCm: 250,
    },
    wallColor: "#f1ece4",
    floorType: "hardwood-light",
    openings: [
      { ...WINDOW, edgeIndex: 0, centerCm: 225 },
      { ...WINDOW, edgeIndex: 1, centerCm: 175 },
      { ...DOOR, edgeIndex: 2, centerCm: 80 },
    ],
  },
  {
    id: "living-l",
    label: "L-shaped living room",
    blurb: "5 × 4 m with a notch",
    shape: {
      points: [
        { x: 100, z: 100 },
        { x: 600, z: 100 },
        { x: 600, z: 350 },
        { x: 400, z: 350 },
        { x: 400, z: 500 },
        { x: 100, z: 500 },
      ],
      heightCm: 260,
    },
    wallColor: "#e3e6e1",
    floorType: "hardwood-natural",
    openings: [
      { ...WINDOW, edgeIndex: 0, centerCm: 130, widthCm: 150 },
      { ...WINDOW, edgeIndex: 0, centerCm: 370, widthCm: 150 },
      { ...DOOR, edgeIndex: 4, centerCm: 150 },
    ],
  },
  {
    id: "bedroom",
    label: "Bedroom",
    blurb: "3.6 × 3.6 m",
    shape: {
      points: [
        { x: 150, z: 100 },
        { x: 510, z: 100 },
        { x: 510, z: 460 },
        { x: 150, z: 460 },
      ],
      heightCm: 250,
    },
    wallColor: "#d9e0e6",
    floorType: "hardwood-dark",
    openings: [
      { ...WINDOW, edgeIndex: 0, centerCm: 180 },
      { ...DOOR, edgeIndex: 3, centerCm: 80 },
    ],
  },
  {
    id: "loft",
    label: "Modern loft",
    blurb: "6 × 4 m, concrete",
    shape: {
      points: [
        { x: 50, z: 100 },
        { x: 650, z: 100 },
        { x: 650, z: 500 },
        { x: 50, z: 500 },
      ],
      heightCm: 320,
    },
    wallColor: "#f7f7f5",
    floorType: "concrete",
    openings: [
      { ...WINDOW, edgeIndex: 0, centerCm: 150, widthCm: 180, heightCm: 200, sillCm: 40 },
      { ...WINDOW, edgeIndex: 0, centerCm: 450, widthCm: 180, heightCm: 200, sillCm: 40 },
      { ...DOOR, edgeIndex: 2, centerCm: 100 },
    ],
  },
];

export const WALL_COLORS: Array<{ label: string; value: string }> = [
  { label: "Warm white", value: "#f5f0e8" },
  { label: "Cool white", value: "#f4f6f8" },
  { label: "Greige", value: "#d8d0c4" },
  { label: "Sage", value: "#cfd8c8" },
  { label: "Sky", value: "#d5e1ea" },
  { label: "Blush", value: "#ecd8d2" },
  { label: "Sand", value: "#e6d5b8" },
  { label: "Charcoal", value: "#4a4d52" },
];