import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,

  // React Router rejects form POSTs whose Origin header doesn't match the
  // URL the server sees. Behind Render's proxy the server sees an internal
  // address, so the live site's own hostname has to be allow-listed or the
  // "Buy this room" form gets a 400.
  allowedActionOrigins: ["roomify-zz16.onrender.com"],
} satisfies Config;
