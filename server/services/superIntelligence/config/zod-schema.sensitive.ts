import { z } from "zod/v4";

// Everything registered here will be redacted when the config is exposed,
// e.g. sent to the dashboard
export const sensitive = z.registry<undefined, z.ZodType>();
