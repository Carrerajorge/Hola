/**
 * HubSpot Connector Handler
 *
 * Executes HubSpot CRM API v3 operations using direct fetch.
 * Each operation maps to a ConnectorCapability declared in the manifest.
 */

import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";

const BASE_URL = "https://api.hubapi.com";

// ─── Helpers ───────────────────────────────────────────────────────

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

async function hubspotFetch(
  url: string,
  token: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const opts: RequestInit = {
    method,
    headers: headers(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  };

  const res = await fetch(url, opts);

  let data: unknown;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data };
}

function errorResult(
  code: string,
  message: string,
  statusCode: number,
  retryable: boolean,
  details?: unknown
): ConnectorOperationResult {
  return {
    success: false,
    error: { code, message, retryable, statusCode, details },
  };
}

// ─── Handler Factory ───────────────────────────────────────────────

export const hubspotHandler: ConnectorHandlerFactory = {
  async execute(
    operationId: string,
    input: Record<string, unknown>,
    credential: ResolvedCredential
  ): Promise<ConnectorOperationResult> {
    const token = credential.accessToken;
    const startTime = Date.now();

    try {
      switch (operationId) {
        // ── List Contacts ────────────────────────────────────────
        case "hubspot_list_contacts": {
          const query = qs({
            limit: input.limit,
            after: input.after,
          });
          const { status, data } = await hubspotFetch(
            `${BASE_URL}/crm/v3/objects/contacts${query}`,
            token
          );

          if (status !== 200) {
            return errorResult("HUBSPOT_API_ERROR", `HubSpot API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: { latencyMs: Date.now() - startTime },
          };
        }

        // ── Get Contact ──────────────────────────────────────────
        case "hubspot_get_contact": {
          const { contactId } = input as { contactId: string };
          const { status, data } = await hubspotFetch(
            `${BASE_URL}/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
            token
          );

          if (status !== 200) {
            return errorResult("HUBSPOT_API_ERROR", `HubSpot API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: { latencyMs: Date.now() - startTime },
          };
        }

        // ── Create Contact ───────────────────────────────────────
        case "hubspot_create_contact": {
          const { email, firstname, lastname, phone, company } = input as {
            email: string;
            firstname?: string;
            lastname?: string;
            phone?: string;
            company?: string;
          };

          const properties: Record<string, string> = { email };
          if (firstname !== undefined) properties.firstname = firstname;
          if (lastname !== undefined) properties.lastname = lastname;
          if (phone !== undefined) properties.phone = phone;
          if (company !== undefined) properties.company = company;

          const { status, data } = await hubspotFetch(
            `${BASE_URL}/crm/v3/objects/contacts`,
            token,
            "POST",
            { properties }
          );

          if (status !== 201) {
            return errorResult("HUBSPOT_API_ERROR", `HubSpot API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: { latencyMs: Date.now() - startTime },
          };
        }

        // ── List Deals ───────────────────────────────────────────
        case "hubspot_list_deals": {
          const query = qs({
            limit: input.limit,
            after: input.after,
          });
          const { status, data } = await hubspotFetch(
            `${BASE_URL}/crm/v3/objects/deals${query}`,
            token
          );

          if (status !== 200) {
            return errorResult("HUBSPOT_API_ERROR", `HubSpot API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: { latencyMs: Date.now() - startTime },
          };
        }

        // ── Create Deal ──────────────────────────────────────────
        case "hubspot_create_deal": {
          const { dealname, amount, pipeline, dealstage } = input as {
            dealname: string;
            amount?: string;
            pipeline?: string;
            dealstage?: string;
          };

          const properties: Record<string, string> = { dealname };
          if (amount !== undefined) properties.amount = amount;
          if (pipeline !== undefined) properties.pipeline = pipeline;
          if (dealstage !== undefined) properties.dealstage = dealstage;

          const { status, data } = await hubspotFetch(
            `${BASE_URL}/crm/v3/objects/deals`,
            token,
            "POST",
            { properties }
          );

          if (status !== 201) {
            return errorResult("HUBSPOT_API_ERROR", `HubSpot API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: { latencyMs: Date.now() - startTime },
          };
        }

        // ── List Companies ───────────────────────────────────────
        case "hubspot_list_companies": {
          const query = qs({
            limit: input.limit,
            after: input.after,
          });
          const { status, data } = await hubspotFetch(
            `${BASE_URL}/crm/v3/objects/companies${query}`,
            token
          );

          if (status !== 200) {
            return errorResult("HUBSPOT_API_ERROR", `HubSpot API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: { latencyMs: Date.now() - startTime },
          };
        }

        default:
          return errorResult(
            "UNKNOWN_OPERATION",
            `Unknown HubSpot operation: ${operationId}`,
            400,
            false
          );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult("HUBSPOT_FETCH_ERROR", message, 0, true);
    }
  },

  async healthCheck(credential?: ResolvedCredential) {
    const startTime = Date.now();
    try {
      if (!credential) {
        return { healthy: false, latencyMs: 0 };
      }
      // HubSpot doesn't have a dedicated health endpoint; listing contacts
      // with limit=1 is the lightest authenticated call.
      const { status } = await hubspotFetch(
        `${BASE_URL}/crm/v3/objects/contacts?limit=1`,
        credential.accessToken
      );
      return {
        healthy: status === 200,
        latencyMs: Date.now() - startTime,
      };
    } catch {
      return { healthy: false, latencyMs: Date.now() - startTime };
    }
  },
};
