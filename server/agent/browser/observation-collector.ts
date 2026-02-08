import { browserSessionManager } from "./session-manager";
import { Observation, PageState, NetworkRequest } from "./types";
import { selectorSanitizer, SelectorSanitizer } from "./security/selector-sanitizer";
import { browserAuditLogger } from "./security/audit-logger";

export interface StructuredData {
  metaTags: Record<string, string>;
  jsonLd: any[];
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  microdata: any[];
  tables: any[][];
  lists: string[][];
}

export interface ExtractedContent {
  title: string;
  description: string;
  mainContent: string;
  structuredData: StructuredData;
  links: { text: string; href: string }[];
  images: { src: string; alt: string }[];
  forms: { action: string; inputs: string[] }[];
}

class ObservationCollector {
  async collectFullObservation(sessionId: string): Promise<{
    state: PageState | null;
    screenshot: string | null;
    structured: StructuredData | null;
  }> {
    const state = await browserSessionManager.getPageState(sessionId);
    const screenshot = await browserSessionManager.getScreenshot(sessionId);
    const structured = state ? this.extractStructuredData(state) : null;

    return { state, screenshot, structured };
  }

  extractStructuredData(state: PageState): StructuredData {
    const openGraph: Record<string, string> = {};
    const twitterCard: Record<string, string> = {};

    Object.entries(state.metaTags).forEach(([key, value]) => {
      if (key.startsWith("og:")) {
        openGraph[key.replace("og:", "")] = value;
      } else if (key.startsWith("twitter:")) {
        twitterCard[key.replace("twitter:", "")] = value;
      }
    });

    return {
      metaTags: state.metaTags,
      jsonLd: state.jsonLd,
      openGraph,
      twitterCard,
      microdata: [],
      tables: [],
      lists: []
    };
  }

  async extractContent(sessionId: string): Promise<ExtractedContent | null> {
    const state = await browserSessionManager.getPageState(sessionId);
    if (!state) return null;

    const structured = this.extractStructuredData(state);

    return {
      title: state.title,
      description: state.metaTags["description"] ||
                   structured.openGraph["description"] ||
                   structured.twitterCard["description"] || "",
      mainContent: state.visibleText,
      structuredData: structured,
      links: state.links,
      images: state.images,
      forms: state.forms
    };
  }

  /**
   * Extract data from the page using CSS selectors.
   * All selectors are validated and sanitized before use to prevent injection.
   */
  async extractDataBySelector(
    sessionId: string,
    selectors: Record<string, string>
  ): Promise<Record<string, string | null>> {
    const session = browserSessionManager.getSession(sessionId);
    if (!session) return {};

    // Validate all selectors first
    const sanitizedSelectors: Record<string, string> = {};
    for (const [key, selector] of Object.entries(selectors)) {
      const validation = selectorSanitizer.validate(selector);
      if (!validation.valid) {
        browserAuditLogger.logSelectorBlocked(
          sessionId,
          selector,
          validation.reason || "validation_failed"
        );
        // Skip invalid selectors instead of failing entirely
        continue;
      }
      sanitizedSelectors[key] = validation.sanitizedSelector || selector;
    }

    if (Object.keys(sanitizedSelectors).length === 0) {
      return {};
    }

    // Pass sanitized selectors as JSON data rather than interpolating into script
    const result = await browserSessionManager.evaluate(sessionId, `
      (function() {
        var selectors = ${JSON.stringify(sanitizedSelectors)};
        var result = {};
        for (var key in selectors) {
          if (selectors.hasOwnProperty(key)) {
            try {
              var el = document.querySelector(selectors[key]);
              result[key] = el ? (el.textContent || "").trim() || el.getAttribute('value') || null : null;
            } catch(e) {
              result[key] = null;
            }
          }
        }
        return result;
      })()
    `);

    return result.success ? result.data : {};
  }

  /**
   * Extract table data from the page.
   * The table selector is validated to prevent CSS injection.
   */
  async extractTable(sessionId: string, tableSelector: string): Promise<string[][]> {
    // Validate the selector
    const validation = selectorSanitizer.validate(tableSelector);
    if (!validation.valid) {
      browserAuditLogger.logSelectorBlocked(
        sessionId,
        tableSelector,
        validation.reason || "validation_failed"
      );
      return [];
    }

    const safeSelector = validation.sanitizedSelector || tableSelector;

    // Use JSON.stringify to safely embed the selector, preventing injection
    const result = await browserSessionManager.evaluate(sessionId, `
      (function() {
        var selector = ${JSON.stringify(safeSelector)};
        try {
          var table = document.querySelector(selector);
          if (!table) return [];

          var rows = [];
          var maxRows = 500;
          var trs = table.querySelectorAll('tr');
          for (var i = 0; i < Math.min(trs.length, maxRows); i++) {
            var cells = [];
            var tds = trs[i].querySelectorAll('th, td');
            for (var j = 0; j < tds.length; j++) {
              cells.push((tds[j].textContent || '').trim().slice(0, 1000));
            }
            if (cells.length > 0) rows.push(cells);
          }
          return rows;
        } catch(e) {
          return [];
        }
      })()
    `);

    return result.success ? result.data : [];
  }

  /**
   * Extract list data from the page.
   * The list selector is validated to prevent CSS injection.
   */
  async extractList(sessionId: string, listSelector: string): Promise<string[]> {
    // Validate the selector
    const validation = selectorSanitizer.validate(listSelector);
    if (!validation.valid) {
      browserAuditLogger.logSelectorBlocked(
        sessionId,
        listSelector,
        validation.reason || "validation_failed"
      );
      return [];
    }

    const safeSelector = validation.sanitizedSelector || listSelector;

    // Use JSON.stringify to safely embed the selector
    const result = await browserSessionManager.evaluate(sessionId, `
      (function() {
        var selector = ${JSON.stringify(safeSelector)};
        try {
          var list = document.querySelector(selector);
          if (!list) return [];

          var items = list.querySelectorAll('li');
          var result = [];
          var maxItems = 200;
          for (var i = 0; i < Math.min(items.length, maxItems); i++) {
            result.push((items[i].textContent || '').trim().slice(0, 1000));
          }
          return result;
        } catch(e) {
          return [];
        }
      })()
    `);

    return result.success ? result.data : [];
  }

  formatObservationForLLM(state: PageState | null, screenshot: string | null): string {
    if (!state) return "No page state available.";

    const sections: string[] = [
      `# Current Page State`,
      `**URL:** ${state.url}`,
      `**Title:** ${state.title}`,
      ``,
      `## Visible Text (truncated):`,
      state.visibleText.slice(0, 2000),
      ``,
      `## Available Links (${state.links.length} total):`,
      ...state.links.slice(0, 15).map(l => `- [${l.text.slice(0, 50)}](${l.href})`),
      ``,
      `## Forms on Page (${state.forms.length}):`,
      ...state.forms.slice(0, 5).map(f => `- Action: ${f.action}, Fields: ${f.inputs.join(", ")}`),
    ];

    if (Object.keys(state.metaTags).length > 0) {
      sections.push(``, `## Meta Tags:`);
      Object.entries(state.metaTags).slice(0, 10).forEach(([k, v]) => {
        sections.push(`- ${k}: ${v.slice(0, 100)}`);
      });
    }

    if (state.jsonLd.length > 0) {
      sections.push(``, `## Structured Data (JSON-LD):`, JSON.stringify(state.jsonLd[0], null, 2).slice(0, 500));
    }

    return sections.join("\n");
  }
}

export const observationCollector = new ObservationCollector();
