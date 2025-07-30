import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JsonToSqlDO } from "./do.js";
import { ToolRegistry } from "./tools/index.js";
import type { ToolContext } from "./tools/index.js";

// Define our MCP agent for UniProt and Proteins APIs
export class UniProtMCP extends McpAgent implements ToolContext {
	server = new McpServer({
		name: "UniProt & Proteins API MCP Server",
		version: "1.0.0",
		description: "A comprehensive MCP server for UniProt search/retrieval and the EBI Proteins API, with advanced data staging.",
	});

	// Base URLs for the different services
	uniprotSearchBaseUrl = "https://rest.uniprot.org/uniprotkb/search";
	uniprotFetchBaseUrl = "https://rest.uniprot.org/uniprotkb";
	proteinsApiBaseUrl = "https://www.ebi.ac.uk/proteins/api";

	private workerEnv: Env | undefined;

	constructor(ctx?: any, env?: Env) {
		super(ctx, env);
		if (env) {
			this.workerEnv = env;
		}
	}

	getEnvironment(): Env | undefined {
		return this.workerEnv || UniProtMCP.currentEnv;
	}

	// Static property to hold the current environment during request processing
	public static currentEnv: Env | undefined;

	async parseResponse(response: Response, toolName: string): Promise<any> {
		if (!response.ok) {
			const errorText = await response.text();
			let errorJson: any = {};
			try {
				errorJson = JSON.parse(errorText);
			} catch {
				// Not a JSON error, use the raw text
			}
			
			const errorMessage = errorJson.messages?.join('; ') || errorText;
			throw new Error(`${toolName} request failed: ${response.status} ${response.statusText}. Response: ${errorMessage}`);
		}

		// Check if response is compressed
		const contentEncoding = response.headers.get("content-encoding");
		if (contentEncoding && (contentEncoding.includes("gzip") || contentEncoding.includes("deflate"))) {
			// Browser automatically handles decompression, but if we get here with raw compressed data, 
			// it means decompression failed - return error instead of trying to parse
			throw new Error(`${toolName} received compressed response that could not be decompressed. Try disabling compression.`);
		}

		const contentType = response.headers.get("content-type");
		if (contentType && contentType.includes("application/json")) {
			try {
				return await response.json();
			} catch (error) {
				throw new Error(`${toolName} received invalid JSON response: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		
		return response.text();
	}

	formatResponseData(data: any): string {
		if (typeof data === 'string') {
			return data;
		}
		return JSON.stringify(data, null, 2);
	}

	async checkAndStageIfNeeded(data: any, operationName: string): Promise<{shouldStage: boolean, dataAccessId?: string, formattedData?: string}> {
		// Calculate payload size first
		const payloadSize = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data)).length;
		
		// CRITICAL: Always stage responses over 20KB to prevent token limit issues
		if (payloadSize > 20480) { // 20KB threshold - hard limit
			const processedData = this.convertToStagingFormat(data, operationName);
			
			// Try primary staging with enhanced error handling
			try {
				const dataAccessId = await this.stageData(processedData);
				return { 
					shouldStage: true, 
					dataAccessId,
					formattedData: `✅ **Large Dataset Automatically Staged**

📊 **Data Summary:**
- **Operation:** ${operationName}
- **Payload Size:** ${Math.round(payloadSize / 1024)}KB
- **Entities:** ${processedData.length}
- **Data Access ID:** ${dataAccessId}

🔍 **Next Steps:**
Use the \`data_manager\` tool with operation "query" and this data_access_id to run SQL queries on your staged data.

**Example:**
\`\`\`
operation: "query"
data_access_id: "${dataAccessId}"
sql: "SELECT * FROM protein LIMIT 10"
\`\`\`

**Reason for staging:** Response size (${Math.round(payloadSize / 1024)}KB) exceeds 20KB limit to prevent context overflow`
				};
			} catch (error) {
				console.error('Primary staging failed:', error);
				throw new Error(`Response too large (${Math.round(payloadSize / 1024)}KB) and staging failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		// For smaller responses, check if staging is still beneficial
		if (typeof data === 'string') {
			if (payloadSize < 4096) { // 4KB threshold for simple strings
				return { shouldStage: false, formattedData: data };
			}
		}

		// Convert to staging format for analysis
		const processedData = this.convertToStagingFormat(data, operationName);
		
		// Check if we should bypass staging for small, simple datasets
		const stagingDecision = this.shouldBypassStaging(processedData, payloadSize);
		
		if (stagingDecision.bypass) {
			return { shouldStage: false, formattedData: this.formatResponseData(data) };
		}

		// Stage the data
		try {
			const dataAccessId = await this.stageData(processedData);
			return { 
				shouldStage: true, 
				dataAccessId,
				formattedData: `✅ **Large Dataset Automatically Staged**

📊 **Data Summary:**
- **Operation:** ${operationName}
- **Payload Size:** ${Math.round(payloadSize / 1024)}KB
- **Entities:** ${processedData.length}
- **Data Access ID:** ${dataAccessId}

🔍 **Next Steps:**
Use the \`data_manager\` tool with operation "query" and this data_access_id to run SQL queries on your staged data.

**Example:**
\`\`\`
operation: "query"
data_access_id: "${dataAccessId}"
sql: "SELECT * FROM protein LIMIT 10"
\`\`\`

**Reason for staging:** ${stagingDecision.reason}`
			};
		} catch (error) {
			// Fallback to direct return if staging fails
			console.error('Failed to stage data:', error);
			return { shouldStage: false, formattedData: this.formatResponseData(data) };
		}
	}

	private convertToStagingFormat(data: any, operationName: string): any[] {
		// Convert different response formats to staging format
		if (Array.isArray(data)) {
			return data.map((item, index) => ({
				type: operationName.replace(/[^a-zA-Z0-9]/g, '_'),
				data: { ...item, _index: index }
			}));
		}

		if (data && typeof data === 'object') {
			// Handle UniProt search response format
			if (data.results && Array.isArray(data.results)) {
				return data.results.map((item: any, index: number) => ({
					type: 'protein',
					data: { ...item, _index: index, _total_results: data.results.length }
				}));
			}

			// Handle EBI Proteins API response
			if (data.features && Array.isArray(data.features)) {
				return data.features.map((feature: any, index: number) => ({
					type: 'feature',
					data: { ...feature, _index: index, _accession: data.accession }
				}));
			}

			if (data.variants && Array.isArray(data.variants)) {
				return data.variants.map((variant: any, index: number) => ({
					type: 'variant',
					data: { ...variant, _index: index, _accession: data.accession }
				}));
			}

			// Single protein object
			return [{
				type: 'protein',
				data: { ...data, _index: 0 }
			}];
		}

		// Fallback for other formats
		return [{
			type: operationName.replace(/[^a-zA-Z0-9]/g, '_'),
			data: data
		}];
	}

	private async stageData(processedData: any[]): Promise<string> {
		const env = this.getEnvironment();
		if (!env) {
			throw new Error('Environment not available for staging');
		}

		const dataAccessId = `uniprot_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
		const doId = env.JSON_TO_SQL_DO.idFromName(dataAccessId);
		const doInstance = env.JSON_TO_SQL_DO.get(doId);
		
		const stageRequest = new Request('http://localhost/stage', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				operation: 'fetch_and_stage',
				data: processedData,
				metadata: {
					source: 'uniprot_mcp',
					timestamp: new Date().toISOString(),
					entity_count: processedData.length
				}
			})
		});

		const response = await doInstance.fetch(stageRequest);
		if (!response.ok) {
			throw new Error(`Failed to stage data: ${response.statusText}`);
		}

		return dataAccessId;
	}


	shouldBypassStaging(entities: any[], payloadSize: number): { bypass: boolean; reason: string } {
		const entityCount = entities.length;
		const entityTypes = new Set(entities.map(e => e.type));
		const entityTypeCount = entityTypes.size;

		// Much more restrictive thresholds to prevent token overflow
		if (payloadSize < 1024 && entityCount < 5) {
			return { bypass: true, reason: "Very small dataset (<1KB, <5 entities) returned directly." };
		}
		if (entityTypeCount === 1 && entityCount < 10 && payloadSize < 2048) {
			return { bypass: true, reason: "Simple single-type dataset - direct return is more efficient." };
		}
		
		return { bypass: false, reason: "Dataset complexity justifies SQL staging for efficient querying." };
	}

	async init() {
		const toolRegistry = new ToolRegistry(this);
		toolRegistry.registerAll();
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		UniProtMCP.currentEnv = env;
		
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return UniProtMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return UniProtMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("UniProt & Proteins API MCP Server", { 
			status: 200,
			headers: { "Content-Type": "text/plain" }
		});
	},
};

export { JsonToSqlDO };
