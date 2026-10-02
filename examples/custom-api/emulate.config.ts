import { defineConfig } from "@inbox-zero/emulate";
import inventory from "./emulators/inventory.ts";
// @emulate:imports

export default defineConfig({
  services: {
    inventory: { emulator: inventory },
    // @emulate:services
  },
});
