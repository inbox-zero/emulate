import { resolve } from "path";
import type { NextConfig } from "next";
import { withEmulate } from "@emulators/adapter-next";
import { MAX_UPLOAD_MB } from "./src/lib/limits";

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(import.meta.dirname, "../.."),
  },
  allowedDevOrigins: ["vercel-blob-sharing.emulate.localhost"],
  experimental: {
    serverActions: {
      // One extra megabyte of headroom so a file right at the limit still
      // fits once multipart form encoding overhead is added.
      bodySizeLimit: `${MAX_UPLOAD_MB + 1}mb`,
    },
  },
};

export default withEmulate(nextConfig);
