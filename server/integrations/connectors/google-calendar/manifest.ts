import type { ConnectorManifest } from "../../kernel/types";

export const manifest: ConnectorManifest = {
  connectorId: "google-calendar",
  version: "1.0.0",
  displayName: "Google Calendar",
  description: "Schedule, read, and manage calendar events.",
  iconUrl: "/icons/connectors/google-calendar.svg",
  category: "productivity",

  authType: "oauth2",
  providerId: "google",
  authConfig: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events"
    ],
    pkce: false,
    offlineAccess: true,
    providerId: "google",
  },

  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },

  requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],

  capabilities: [
    {
      operationId: "calendar_list_events",
      name: "List Events",
      description: "List upcoming events from Google Calendar.",
      requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["calendar", "list", "events"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing calendar events.",
        properties: {
          timeMin: {
            type: "string",
            description: "Lower bound (inclusive) for an event's end time to filter by. RFC3339 format.",
          },
          timeMax: {
            type: "string",
            description: "Upper bound (exclusive) for an event's start time to filter by. RFC3339 format.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of events returned. Defaults to 10.",
            default: 10,
          },
          q: {
            type: "string",
            description: "Free text search terms to find events.",
          }
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        description: "A page of calendar events.",
        properties: {
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                summary: { type: "string" },
                description: { type: "string" },
                start: { type: "string" },
                end: { type: "string" },
                htmlLink: { type: "string" }
              }
            }
          }
        }
      }
    },
    {
      operationId: "calendar_create_event",
      name: "Create Event",
      description: "Create a new event in Google Calendar.",
      requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      tags: ["calendar", "create", "events"],
      inputSchema: {
        type: "object",
        description: "Parameters for creating a calendar event.",
        properties: {
          summary: {
            type: "string",
            description: "Title of the event.",
          },
          description: {
            type: "string",
            description: "Description of the event.",
          },
          startDateTime: {
            type: "string",
            description: "Start time of the event in RFC3339 format (e.g. 2026-02-21T10:00:00Z).",
          },
          endDateTime: {
            type: "string",
            description: "End time of the event in RFC3339 format.",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "List of attendee email addresses.",
          }
        },
        required: ["summary", "startDateTime", "endDateTime"],
      },
      outputSchema: {
        type: "object",
        description: "The created calendar event.",
        properties: {
          id: { type: "string" },
          htmlLink: { type: "string" },
          status: { type: "string" }
        }
      }
    }
  ],
};