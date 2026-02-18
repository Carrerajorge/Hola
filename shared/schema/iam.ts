import { pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";


export const userIdentities = pgTable(

  "user_identities",

  {

    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id").notNull(),


    provider: text("provider").notNull(),

    providerSubject: text("provider_subject").notNull(),


    providerEmail: text("provider_email"),

    emailVerified: text("email_verified").default("false"),


    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),

  },

  (t) => ({

    providerSubjectIdx: uniqueIndex("user_identities_provider_subject_idx").on(t.provider, t.providerSubject),

    userIdx: index("user_identities_user_idx").on(t.userId),

    providerIdx: index("user_identities_provider_idx").on(t.provider),

  })

);
