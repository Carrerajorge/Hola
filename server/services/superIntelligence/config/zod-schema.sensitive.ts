import { z } from "zod";

// Everything registered here will be redacted when the config is exposed,
// e.g. sent to the dashboard
export const sensitive = new Map<string, z.ZodTypeAny[]>();

export function registerSensitive<T extends z.ZodTypeAny>(key: string, schema: T): T {
  const list = sensitive.get(key);
  if (list) {
    list.push(schema);
  } else {
    sensitive.set(key, [schema]);
  }
  return schema;
}

export function *iterSensitiveSchemas(): IterableIterator<z.ZodTypeAny> {
  for (const list of sensitive.values()) {
    for (const schema of list) yield schema;
  }
}
