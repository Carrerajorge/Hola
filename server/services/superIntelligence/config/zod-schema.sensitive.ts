import { z } from "zod/v4";

type ZodRegistryCompat<TSchema extends z.ZodType = z.ZodType> = {
  add: (schema: TSchema) => TSchema;
  has: (schema: z.ZodType) => boolean;
};

type ZodTypeCompat = z.ZodType & {
  register?: (registry: ZodRegistryCompat) => z.ZodType;
};

function createRegistryCompat<TSchema extends z.ZodType>(): ZodRegistryCompat<TSchema> {
  const store = new WeakSet<z.ZodType>();
  return {
    add(schema) {
      store.add(schema);
      return schema;
    },
    has(schema) {
      return store.has(schema);
    },
  };
}

function ensureRegistryCompat(): void {
  const basePrototype = Object.getPrototypeOf(
    Object.getPrototypeOf(z.string()),
  ) as ZodTypeCompat | null;

  if (basePrototype && typeof basePrototype.register !== "function") {
    Object.defineProperty(basePrototype, "register", {
      value(this: z.ZodType, registry: ZodRegistryCompat) {
        registry.add(this);
        return this;
      },
      configurable: true,
      writable: true,
    });
  }
}

// Everything registered here will be redacted when the config is exposed,
// e.g. sent to the dashboard
ensureRegistryCompat();
export const sensitive = createRegistryCompat<z.ZodType>();
