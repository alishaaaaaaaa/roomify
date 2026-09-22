import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("test-products", "routes/test-products.tsx"),
  route("room-setup", "routes/room-setup.tsx"),
  route("design", "routes/design.tsx"),
  route("walkthrough", "routes/walkthrough.tsx"),
] satisfies RouteConfig;