import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("test-products", "routes/test-products.tsx"),
] satisfies RouteConfig;