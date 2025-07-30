import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
}