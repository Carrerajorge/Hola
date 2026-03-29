import { z } from "zod";

type ZodRegistryLike = {
  add: (schema: z.ZodType) => void;
  has: (schema: z.ZodType) => boolean;
};

function createSensitiveRegistry(): ZodRegistryLike {
  const zAny = z as typeof z & {
    registry?: <Meta = unknown, Schema extends z.ZodType = z.ZodType>() => ZodRegistryLike;
  };

  if (typeof zAny.registry === "function") {
    return zAny.registry<undefined, z.ZodType>();
  }

  const store = new WeakSet<z.ZodType>();
  return {
    add(schema: z.ZodType) {
      store.add(schema);
    },
    has(schema: z.ZodType) {
      return store.has(schema);
    },
  };
}

// Everything registered here will be redacted when the config is exposed,
// e.g. sent to the dashboard.
//
// OpenClaw upstream uses z.registry() from Zod v4, but Hola currently ships
// Zod v3. This compatibility shim preserves the tiny subset we need:
//   - schema.register(sensitive) -> sensitive.add(schema)
//   - sensitive.has(schema)
export const sensitive: any = createSensitiveRegistry();
