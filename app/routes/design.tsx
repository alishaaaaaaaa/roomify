// Placeholder for the 2D floor planner (built in the next step). For now
// it just proves that what you set on the /room-setup screen actually
// persisted in the shared store when you navigated to a different page.

import { Link } from "react-router";
import { useRoomStore } from "~/store/roomStore";

export default function Design() {
  const dimensions = useRoomStore((state) => state.dimensions);
  const wallColor = useRoomStore((state) => state.wallColor);
  const floorColor = useRoomStore((state) => state.floorColor);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Room saved ✅</h1>
      <p>
        {dimensions.widthCm}cm × {dimensions.lengthCm}cm ×{" "}
        {dimensions.heightCm}cm
      </p>

      <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
        <div>
          <div
            style={{
              width: 60,
              height: 60,
              background: wallColor,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
          <small>Wall color</small>
        </div>
        <div>
          <div
            style={{
              width: 60,
              height: 60,
              background: floorColor,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
          <small>Floor color</small>
        </div>
      </div>

      <p style={{ color: "#666" }}>
        Next up: the drag-and-drop 2D floor planner goes here.
      </p>

      <Link to="/room-setup">← Back to room setup</Link>
    </div>
  );
}