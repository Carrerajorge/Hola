import { z } from "zod";

class SensitiveRegistry {
  private set = new Set<z.ZodType>();
  has(schema: z.ZodType) { return this.set.has(schema); }
  register(schema: z.ZodType) { this.set.add(schema); return schema; }
}

export const sensitive = new SensitiveRegistry() as any;

if (typeof (z.ZodType.prototype as any).register !== 'function') {
  (z.ZodType.prototype as any).register = function(registry: any) {
    if (registry?.register) registry.register(this);
    return this;
  };
}
