import { createEmulateHandler } from "@emulators/adapter-next";
import * as vercel from "@emulators/vercel";

export const { GET, POST, PUT, PATCH, DELETE } = createEmulateHandler({
  services: {
    vercel: {
      emulator: vercel,
    },
  },
});
