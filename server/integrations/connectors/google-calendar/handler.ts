import { google } from "googleapis";
import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";

/** Build an authenticated Calendar client from a resolved credential. */
function buildCalendarClient(credential: ResolvedCredential) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: credential.accessToken });
  return google.calendar({ version: "v3", auth });
}

export const handler: ConnectorHandlerFactory = {
  async execute(
    operationId: string,
    input: Record<string, unknown>,
    credential: ResolvedCredential
  ): Promise<ConnectorOperationResult> {
    const calendar = buildCalendarClient(credential);

    try {
      switch (operationId) {
        case "calendar_list_events": {
          const maxResults = (input.maxResults as number) || 10;
          const timeMin = (input.timeMin as string) || undefined;
          const timeMax = (input.timeMax as string) || undefined;
          const q = (input.q as string) || undefined;
          const pageToken = (input.pageToken as string) || undefined;

          const res = await calendar.events.list({
            calendarId: "primary",
            timeMin,
            timeMax,
            maxResults,
            q,
            pageToken,
            singleEvents: true,
            orderBy: "startTime",
          });

          return {
            success: true,
            data: {
              events: (res.data.items || []).map((item) => ({
                id: item.id,
                summary: item.summary,
                description: item.description,
                start: item.start?.dateTime || item.start?.date,
                end: item.end?.dateTime || item.end?.date,
                htmlLink: item.htmlLink,
              })),
              nextPageToken: res.data.nextPageToken || undefined,
            },
          };
        }

        case "calendar_create_event": {
          const summary = input.summary as string;
          const description = input.description as string;
          const startDateTime = input.startDateTime as string;
          const endDateTime = input.endDateTime as string;
          const attendees = (input.attendees as string[]) || [];

          const eventBody: any = {
            summary,
            description,
            start: { dateTime: startDateTime },
            end: { dateTime: endDateTime },
          };

          if (attendees.length > 0) {
            eventBody.attendees = attendees.map((email) => ({ email }));
          }

          const res = await calendar.events.insert({
            calendarId: "primary",
            requestBody: eventBody,
          });

          return {
            success: true,
            data: {
              id: res.data.id,
              htmlLink: res.data.htmlLink,
              status: res.data.status,
            },
          };
        }

        default:
          return {
            success: false,
            error: {
              code: "UNKNOWN_OPERATION",
              message: `Unknown operation: ${operationId}`,
              retryable: false,
            },
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: "CALENDAR_API_ERROR",
          message: error.message || "Unknown error occurred while calling Google Calendar API",
          retryable: true,
        },
      };
    }
  },
};
