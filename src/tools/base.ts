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
}