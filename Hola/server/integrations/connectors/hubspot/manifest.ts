/**
 * HubSpot Connector Manifest
 *
 * Provides CRM contact, deal, and company management via the HubSpot API v3.
 */

import type { ConnectorManifest } from "../../kernel/types";

export const hubspotManifest: ConnectorManifest = {
  connectorId: "hubspot",
  version: "1.0.0",
  displayName: "HubSpot",
  description: "Manage HubSpot CRM contacts, deals, and companies.",
  iconUrl: "/icons/connectors/hubspot.svg",
  category: "crm",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.deals.read",
      "crm.objects.deals.write",
      "crm.objects.companies.read",
    ],
    pkce: false,
    offlineAccess: true,
  },
  baseUrl: "https://api.hubapi.com",
  rateLimit: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
  },
  requiredEnvVars: ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"],
  capabilities: [
    // ── hubspot_list_contacts ──────────────────────────────────────
    {
      operationId: "hubspot_list_contacts",
      name: "List Contacts",
      description: "List CRM contacts from HubSpot with optional pagination via limit and cursor.",
      requiredScopes: ["crm.objects.contacts.read"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing HubSpot contacts.",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of contacts to return (max 100).",
          },
          after: {
            type: "string",
            description: "Pagination cursor returned from a previous request.",
          },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        description: "Paginated list of contacts.",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                properties: { type: "object" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
          paging: {
            type: "object",
            properties: {
              next: {
                type: "object",
                properties: {
                  after: { type: "string" },
                },
              },
            },
          },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["contacts", "list", "crm"],
    },

    // ── hubspot_get_contact ────────────────────────────────────────
    {
      operationId: "hubspot_get_contact",
      name: "Get Contact",
      description: "Retrieve a single HubSpot CRM contact by its unique ID.",
      requiredScopes: ["crm.objects.contacts.read"],
      inputSchema: {
        type: "object",
        description: "Parameters for retrieving a contact.",
        properties: {
          contactId: {
            type: "string",
            description: "The unique HubSpot contact ID.",
          },
        },
        required: ["contactId"],
      },
      outputSchema: {
        type: "object",
        description: "Contact object with properties.",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["contacts", "get", "crm"],
    },

    // ── hubspot_create_contact ─────────────────────────────────────
    {
      operationId: "hubspot_create_contact",
      name: "Create Contact",
      description: "Create a new contact in HubSpot CRM. Requires user confirmation before execution.",
      requiredScopes: ["crm.objects.contacts.write"],
      inputSchema: {
        type: "object",
        description: "Parameters for creating a new HubSpot contact.",
        properties: {
          email: {
            type: "string",
            description: "Contact email address (primary identifier).",
          },
          firstname: {
            type: "string",
            description: "Contact first name.",
          },
          lastname: {
            type: "string",
            description: "Contact last name.",
          },
          phone: {
            type: "string",
            description: "Contact phone number.",
          },
          company: {
            type: "string",
            description: "Company name associated with the contact.",
          },
        },
        required: ["email"],
      },
      outputSchema: {
        type: "object",
        description: "Created contact object.",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
          createdAt: { type: "string" },
        },
      },
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      tags: ["contacts", "create", "crm"],
    },

    // ── hubspot_list_deals ─────────────────────────────────────────
    {
      operationId: "hubspot_list_deals",
      name: "List Deals",
      description: "List deals from the HubSpot CRM pipeline with optional pagination.",
      requiredScopes: ["crm.objects.deals.read"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing HubSpot deals.",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of deals to return (max 100).",
          },
          after: {
            type: "string",
            description: "Pagination cursor returned from a previous request.",
          },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        description: "Paginated list of deals.",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                properties: { type: "object" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
          paging: {
            type: "object",
            properties: {
              next: {
                type: "object",
                properties: {
                  after: { type: "string" },
                },
              },
            },
          },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["deals", "list", "crm"],
    },

    // ── hubspot_create_deal ────────────────────────────────────────
    {
      operationId: "hubspot_create_deal",
      name: "Create Deal",
      description: "Create a new deal in the HubSpot CRM pipeline. Requires user confirmation before execution.",
      requiredScopes: ["crm.objects.deals.write"],
      inputSchema: {
        type: "object",
        description: "Parameters for creating a new HubSpot deal.",
        properties: {
          dealname: {
            type: "string",
            description: "Name of the deal.",
          },
          amount: {
            type: "string",
            description: "Deal monetary amount as a string (e.g. \"5000\").",
          },
          pipeline: {
            type: "string",
            description: "Pipeline ID or name. Defaults to the default pipeline.",
          },
          dealstage: {
            type: "string",
            description: "Deal stage ID within the pipeline.",
          },
        },
        required: ["dealname"],
      },
      outputSchema: {
        type: "object",
        description: "Created deal object.",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
          createdAt: { type: "string" },
        },
      },
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      tags: ["deals", "create", "crm"],
    },

    // ── hubspot_list_companies ──────────────────────────────────────
    {
      operationId: "hubspot_list_companies",
      name: "List Companies",
      description: "List companies from HubSpot CRM with optional pagination via limit and cursor.",
      requiredScopes: ["crm.objects.companies.read"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing HubSpot companies.",
        properties: {
          limit: {
            type: "integer",
            description: "Maximum number of companies to return (max 100).",
          },
          after: {
            type: "string",
            description: "Pagination cursor returned from a previous request.",
          },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        description: "Paginated list of companies.",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                properties: { type: "object" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
          paging: {
            type: "object",
            properties: {
              next: {
                type: "object",
                properties: {
                  after: { type: "string" },
                },
              },
            },
          },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["companies", "list", "crm"],
    },
  ],
};
