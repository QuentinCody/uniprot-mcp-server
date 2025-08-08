import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EnhancedErrorFormatter } from "../lib/response-formatter.js";
import type { ErrorContext } from "../lib/types.js";

export interface ToolContext {
	server: McpServer;
	uniprotSearchBaseUrl: string;
	uniprotFetchBaseUrl: string;
	proteinsApiBaseUrl: string;
	getEnvironment(): Env | undefined;
	parseResponse(response: Response, toolName: string): Promise<any>;
	formatResponseData(data: any): string;
	shouldBypassStaging(processedData: any[], payloadSize: number): { bypass: boolean; reason: string };
	checkAndStageIfNeeded(data: any, operationName: string): Promise<{shouldStage: boolean, dataAccessId?: string, formattedData?: string}>;
	// Dataset registry helpers
	registerDataset(meta: { id: string; operation: string; entityCount: number; entityTypes: string[]; payloadSize: number; timestamp: string }): void;
	listDatasets(): Array<{ id: string; operation: string; entityCount: number; entityTypes: string[]; payloadSize: number; timestamp: string }>;
}

export abstract class BaseTool {
	protected context: ToolContext;

	constructor(context: ToolContext) {
		this.context = context;
	}

	abstract register(): void;

	protected async parseResponse(response: Response, toolName: string): Promise<any> {
		return this.context.parseResponse(response, toolName);
	}

	protected formatResponseData(data: any): string {
		return this.context.formatResponseData(data);
	}

	protected getEnvironment(): Env | undefined {
		return this.context.getEnvironment();
	}

	protected formatEnhancedError(error: Error | string, toolName: string, operation: string, userInput?: any, httpStatus?: number): string {
		const context: ErrorContext = {
			toolName,
			operation,
			userInput,
			httpStatus,
			originalError: error instanceof Error ? error.message : error
		};
		
		return EnhancedErrorFormatter.formatError(error, context);
	}

  protected async fetchWithRetry(
    url: string,
    init: RequestInit = {},
    options: { attempts?: number; baseDelayMs?: number } = {}
  ): Promise<Response> {
    const maxAttempts = options.attempts ?? 3;
    const baseDelay = options.baseDelayMs ?? 500;
    let lastError: any = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const resp = await fetch(url, init);
        if (resp.ok) return resp;
        // Handle 429/5xx with backoff
        if (resp.status === 429 || resp.status >= 500) {
          const retryAfter = resp.headers.get('retry-after');
          const retryMs = retryAfter ? Number(retryAfter) * 1000 : Math.min(baseDelay * 2 ** attempt, 5000);
          await new Promise((r) => setTimeout(r, retryMs + Math.floor(Math.random() * 200)));
          lastError = new Error(`${resp.status} ${resp.statusText}`);
          continue;
        }
        return resp; // non-retryable
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, Math.min(baseDelay * 2 ** attempt, 5000)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}