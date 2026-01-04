import { ToolResult, ToolCategory, IAgentTool, SearchResult, WebPageContent } from "./agentTypes";
import { CommandExecutor } from "./commandExecutor";
import { FileManager } from "./fileManager";
import { DocumentCreator, documentCreator } from "./documentCreator";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export abstract class BaseTool implements IAgentTool {
  abstract name: string;
  abstract description: string;
  abstract category: ToolCategory;
  enabled: boolean = true;

  abstract execute(params: Record<string, any>): Promise<ToolResult>;

  protected createResult(
    success: boolean,
    data?: any,
    message?: string,
    error?: string,
    startTime?: number,
    filesCreated?: string[]
  ): ToolResult {
    return {
      success,
      toolName: this.name,
      data,
      message: message || "",
      error,
      executionTimeMs: startTime ? Date.now() - startTime : 0,
      filesCreated: filesCreated || [],
    };
  }

  protected async withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; executionTimeMs: number }> {
    const startTime = Date.now();
    const result = await fn();
    return { result, executionTimeMs: Date.now() - startTime };
  }
}

export class ShellTool extends BaseTool {
  name = "shell";
  description = "Executes shell commands in a sandboxed environment";
  category: ToolCategory = "system";

  private executor: CommandExecutor;

  constructor(executor?: CommandExecutor) {
    super();
    this.executor = executor || new CommandExecutor();
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { command, timeout, workingDir, env } = params;

    if (!command || typeof command !== "string") {
      return this.createResult(false, null, "", "Command is required and must be a string", startTime);
    }

    try {
      const result = await this.executor.execute(command, {
        timeout: timeout || 30000,
        workingDir,
        env,
      });

      const success = result.status === "completed" && result.returnCode === 0;

      return this.createResult(
        success,
        {
          stdout: result.stdout,
          stderr: result.stderr,
          returnCode: result.returnCode,
          status: result.status,
        },
        success ? `Command executed successfully` : `Command failed with code ${result.returnCode}`,
        success ? undefined : result.errorMessage || result.stderr,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class FileTool extends BaseTool {
  name = "file";
  description = "Performs file operations: read, write, delete, list, mkdir";
  category: ToolCategory = "file";

  private fileManager: FileManager;

  constructor(fileManager?: FileManager) {
    super();
    this.fileManager = fileManager || new FileManager();
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { operation, path, content, encoding, recursive, pattern, createDirs } = params;

    if (!operation) {
      return this.createResult(false, null, "", "Operation is required", startTime);
    }

    try {
      let result;
      const filesCreated: string[] = [];

      switch (operation) {
        case "read":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for read operation", startTime);
          }
          result = await this.fileManager.read(path, encoding || "utf-8");
          break;

        case "write":
          if (!path || content === undefined) {
            return this.createResult(false, null, "", "Path and content are required for write operation", startTime);
          }
          result = await this.fileManager.write(path, content, { encoding, createDirs: createDirs !== false });
          if (result.success) {
            filesCreated.push(result.path);
          }
          break;

        case "delete":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for delete operation", startTime);
          }
          result = await this.fileManager.delete(path, recursive || false);
          break;

        case "list":
          result = await this.fileManager.listDir(path || ".", pattern, recursive || false);
          break;

        case "mkdir":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for mkdir operation", startTime);
          }
          result = await this.fileManager.mkdir(path);
          break;

        case "exists":
          if (!path) {
            return this.createResult(false, null, "", "Path is required for exists operation", startTime);
          }
          result = await this.fileManager.exists(path);
          break;

        case "copy":
          if (!params.src || !params.dst) {
            return this.createResult(false, null, "", "Source and destination are required for copy operation", startTime);
          }
          result = await this.fileManager.copy(params.src, params.dst);
          if (result.success) {
            filesCreated.push(params.dst);
          }
          break;

        case "move":
          if (!params.src || !params.dst) {
            return this.createResult(false, null, "", "Source and destination are required for move operation", startTime);
          }
          result = await this.fileManager.move(params.src, params.dst);
          break;

        default:
          return this.createResult(false, null, "", `Unknown operation: ${operation}`, startTime);
      }

      return this.createResult(
        result.success,
        result.data,
        result.message,
        result.error,
        startTime,
        filesCreated
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class PythonTool extends BaseTool {
  name = "python";
  description = "Executes Python code in a sandboxed environment";
  category: ToolCategory = "development";

  private executor: CommandExecutor;

  constructor(executor?: CommandExecutor) {
    super();
    this.executor = executor || new CommandExecutor();
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { code, timeout } = params;

    if (!code || typeof code !== "string") {
      return this.createResult(false, null, "", "Python code is required", startTime);
    }

    try {
      const result = await this.executor.executeScript(code, "python3", timeout || 60000);
      const success = result.status === "completed" && result.returnCode === 0;

      return this.createResult(
        success,
        {
          stdout: result.stdout,
          stderr: result.stderr,
          returnCode: result.returnCode,
        },
        success ? "Python code executed successfully" : "Python execution failed",
        success ? undefined : result.errorMessage || result.stderr,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class SearchTool extends BaseTool {
  name = "search";
  description = "Performs web search using DuckDuckGo API";
  category: ToolCategory = "search";

  private baseUrl = "https://api.duckduckgo.com/";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { query, maxResults = 10 } = params;

    if (!query || typeof query !== "string") {
      return this.createResult(false, null, "", "Search query is required", startTime);
    }

    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_html", "1");
      url.searchParams.set("skip_disambig", "1");

      const response = await fetch(url.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AgentV2/1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`Search request failed with status ${response.status}`);
      }

      const data = await response.json();
      const results: SearchResult[] = [];

      if (data.Abstract) {
        results.push({
          title: data.Heading || "Abstract",
          snippet: data.Abstract,
          url: data.AbstractURL || "",
        });
      }

      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(" - ")[0] || topic.Text.substring(0, 50),
              snippet: topic.Text,
              url: topic.FirstURL,
            });
          } else if (topic.Topics) {
            for (const subTopic of topic.Topics.slice(0, 3)) {
              if (subTopic.Text && subTopic.FirstURL) {
                results.push({
                  title: subTopic.Text.split(" - ")[0] || subTopic.Text.substring(0, 50),
                  snippet: subTopic.Text,
                  url: subTopic.FirstURL,
                });
              }
            }
          }
        }
      }

      return this.createResult(
        true,
        { results: results.slice(0, maxResults), query, totalResults: results.length },
        `Found ${results.length} results for "${query}"`,
        undefined,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class BrowserTool extends BaseTool {
  name = "browser";
  description = "Fetches and extracts readable text content from URLs";
  category: ToolCategory = "browser";

  private maxContentLength = 50000;
  private timeout = 30000;

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { url, extractText = true, maxLength } = params;

    if (!url || typeof url !== "string") {
      return this.createResult(false, null, "", "URL is required", startTime);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return this.createResult(
          false,
          { url, status: response.status },
          "",
          `Failed to fetch URL: HTTP ${response.status}`,
          startTime
        );
      }

      const html = await response.text();
      let title = "";
      let content = html;

      if (extractText) {
        try {
          const dom = new JSDOM(html, { url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();

          if (article) {
            title = article.title || "";
            content = article.textContent || "";
          } else {
            const doc = dom.window.document;
            title = doc.title || "";
            content = doc.body?.textContent?.replace(/\s+/g, " ").trim() || "";
          }
        } catch {
          content = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
      }

      const limit = maxLength || this.maxContentLength;
      const truncatedContent = content.length > limit ? content.substring(0, limit) + "..." : content;

      const pageContent: WebPageContent = {
        url,
        title,
        content: truncatedContent,
        status: response.status,
      };

      return this.createResult(
        true,
        pageContent,
        `Successfully fetched content from ${url}`,
        undefined,
        startTime
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createResult(
        false,
        { url, error: errorMessage },
        "",
        `Failed to fetch URL: ${errorMessage}`,
        startTime
      );
    }
  }
}

export class DocumentTool extends BaseTool {
  name = "document";
  description = "Creates professional documents: PPTX, DOCX, XLSX";
  category: ToolCategory = "document";

  private creator: DocumentCreator;

  constructor(creator?: DocumentCreator) {
    super();
    this.creator = creator || documentCreator;
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { type, title, filename } = params;

    if (!type) {
      return this.createResult(false, null, "", "Document type is required (pptx, docx, xlsx)", startTime);
    }

    if (!title) {
      return this.createResult(false, null, "", "Document title is required", startTime);
    }

    try {
      let result: ToolResult;

      switch (type.toLowerCase()) {
        case "pptx":
        case "powerpoint":
          const { slides = [], theme } = params;
          result = await this.creator.createPptx(title, slides, theme, filename);
          break;

        case "docx":
        case "word":
          const { sections = [], author } = params;
          result = await this.creator.createDocx(title, sections, author, filename);
          break;

        case "xlsx":
        case "excel":
          const { sheets = [] } = params;
          result = await this.creator.createXlsx(title, sheets, filename);
          break;

        default:
          return this.createResult(false, null, "", `Unknown document type: ${type}`, startTime);
      }

      return {
        ...result,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class MessageTool extends BaseTool {
  name = "message";
  description = "Returns formatted messages to the user";
  category: ToolCategory = "communication";

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { content, format = "text", title, type = "info" } = params;

    if (!content) {
      return this.createResult(false, null, "", "Message content is required", startTime);
    }

    try {
      let formattedContent = content;

      if (format === "markdown") {
        formattedContent = content;
      } else if (format === "json") {
        formattedContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      } else if (format === "list" && Array.isArray(content)) {
        formattedContent = content.map((item, i) => `${i + 1}. ${item}`).join("\n");
      } else if (format === "bullet" && Array.isArray(content)) {
        formattedContent = content.map((item) => `• ${item}`).join("\n");
      }

      return this.createResult(
        true,
        {
          content: formattedContent,
          format,
          title,
          type,
          timestamp: new Date().toISOString(),
        },
        formattedContent,
        undefined,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class ResearchTool extends BaseTool {
  name = "research";
  description = "Performs deep research by combining search and browser tools";
  category: ToolCategory = "search";

  private searchTool: SearchTool;
  private browserTool: BrowserTool;
  private maxPages = 5;

  constructor(searchTool?: SearchTool, browserTool?: BrowserTool) {
    super();
    this.searchTool = searchTool || new SearchTool();
    this.browserTool = browserTool || new BrowserTool();
  }

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();
    const { query, maxPages = this.maxPages, extractContent = true } = params;

    if (!query || typeof query !== "string") {
      return this.createResult(false, null, "", "Research query is required", startTime);
    }

    try {
      const searchResult = await this.searchTool.execute({ query, maxResults: maxPages + 5 });

      if (!searchResult.success || !searchResult.data?.results) {
        return this.createResult(
          false,
          null,
          "",
          searchResult.error || "Search failed",
          startTime
        );
      }

      const searchResults: SearchResult[] = searchResult.data.results;
      const researchData: Array<{
        source: SearchResult;
        content?: WebPageContent;
        fetchError?: string;
      }> = [];

      const urlsToFetch = searchResults
        .filter((r) => r.url && r.url.startsWith("http"))
        .slice(0, maxPages);

      if (extractContent && urlsToFetch.length > 0) {
        const fetchPromises = urlsToFetch.map(async (source) => {
          try {
            const browserResult = await this.browserTool.execute({
              url: source.url,
              extractText: true,
              maxLength: 10000,
            });

            return {
              source,
              content: browserResult.success ? browserResult.data : undefined,
              fetchError: browserResult.success ? undefined : browserResult.error,
            };
          } catch (error) {
            return {
              source,
              fetchError: error instanceof Error ? error.message : String(error),
            };
          }
        });

        const results = await Promise.allSettled(fetchPromises);
        for (const result of results) {
          if (result.status === "fulfilled") {
            researchData.push(result.value);
          }
        }
      } else {
        for (const source of searchResults) {
          researchData.push({ source });
        }
      }

      const summary = {
        query,
        totalSources: researchData.length,
        successfulFetches: researchData.filter((r) => r.content).length,
        sources: researchData,
      };

      return this.createResult(
        true,
        summary,
        `Research completed: ${researchData.length} sources found, ${summary.successfulFetches} successfully fetched`,
        undefined,
        startTime
      );
    } catch (error) {
      return this.createResult(
        false,
        null,
        "",
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }
}

export class ToolRegistry {
  private tools: Map<string, IAgentTool> = new Map();

  register(tool: IAgentTool): void {
    if (!tool.name) {
      throw new Error("Tool must have a name");
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): IAgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, params: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        toolName: name,
        message: "",
        error: `Tool "${name}" not found`,
        executionTimeMs: 0,
        filesCreated: [],
      };
    }

    if (!tool.enabled) {
      return {
        success: false,
        toolName: name,
        message: "",
        error: `Tool "${name}" is disabled`,
        executionTimeMs: 0,
        filesCreated: [],
      };
    }

    try {
      return await tool.execute(params);
    } catch (error) {
      return {
        success: false,
        toolName: name,
        message: "",
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: 0,
        filesCreated: [],
      };
    }
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  listToolsWithInfo(): Array<{ name: string; description: string; category: ToolCategory; enabled: boolean }> {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      enabled: tool.enabled,
    }));
  }

  getToolsByCategory(category: ToolCategory): IAgentTool[] {
    return Array.from(this.tools.values()).filter((tool) => tool.category === category);
  }

  enableTool(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = true;
      return true;
    }
    return false;
  }

  disableTool(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = false;
      return true;
    }
    return false;
  }

  clear(): void {
    this.tools.clear();
  }

  get size(): number {
    return this.tools.size;
  }
}

export function createDefaultToolRegistry(
  executor?: CommandExecutor,
  fileManager?: FileManager,
  docCreator?: DocumentCreator
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(new ShellTool(executor));
  registry.register(new FileTool(fileManager));
  registry.register(new PythonTool(executor));
  registry.register(new SearchTool());
  registry.register(new BrowserTool());
  registry.register(new DocumentTool(docCreator));
  registry.register(new MessageTool());
  registry.register(new ResearchTool());

  return registry;
}

export const defaultToolRegistry = createDefaultToolRegistry();
