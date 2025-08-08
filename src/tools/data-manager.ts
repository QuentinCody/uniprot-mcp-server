import { z } from "zod";
import { BaseTool } from "./base.js";
import { StagingGuideFormatter } from "../lib/response-formatter.js";

export class DataManagerTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"data_manager",
			"Query, analyze, and manage staged data from UniProt and Proteins API responses. Provides SQL interface to staged datasets.",
			{
				operation: z.enum([
					"query", "schema", "cleanup", "list_datasets", "export", "fetch_and_stage",
					"count", "sample", "distinct", "select"
				]).describe("Operation to perform on staged data"),
				
				data_access_id: z.string().optional().describe("Data access ID from staging operation (required for query, schema, cleanup, export)"),
				
				// Query operation parameters
				sql: z.string().optional().describe("SQL query to execute on staged data (required for query operation)"),
				limit: z.number().optional().default(100).describe("Maximum number of rows to return from query"),
				paths: z.array(z.string()).optional().describe("For 'select': list of JSON paths to project (e.g., ['$.primaryAccession','$.sequence.length'])"),
				where: z.string().optional().describe("For 'select': simple WHERE clause expression using json_extract aliases (e.g., len > 300)"),
				path: z.string().optional().describe("For 'distinct': single JSON path to get distinct values"),
				
                // Fetch & stage parameters
                accessions: z.union([z.string(), z.array(z.string())]).optional().describe("Comma-separated string or array of UniProt accessions"),
                fields: z.string().optional().describe("Comma-separated UniProt fields to include when fetching entries"),

				// Export operation parameters
				export_format: z.enum(["json", "csv", "tsv"]).optional().default("json").describe("Format for data export"),
				table_name: z.string().optional().describe("Specific table to export (optional)")
			},
			async (params, _extra) => {
				try {
					return await this.handleDataManagement(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'Data Manager',
						params.operation || 'unknown',
						params
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleDataManagement(params: any) {
		const { operation, data_access_id, sql, limit, export_format, table_name } = params;

			switch (operation) {
			case "query":
				return await this.handleQuery(data_access_id, sql, limit);
			case "schema":
				return await this.handleSchema(data_access_id);
			case "cleanup":
				return await this.handleCleanup(data_access_id);
			case "list_datasets":
				return await this.handleListDatasets();
			case "export":
				return await this.handleExport(data_access_id, export_format, table_name);
				case "fetch_and_stage":
					return await this.handleFetchAndStage(params);
			case "count":
				return await this.handleCount(data_access_id);
			case "sample":
				return await this.handleSample(data_access_id, limit);
			case "distinct":
				return await this.handleDistinct(data_access_id, params.path!, limit);
			case "select":
				return await this.handleSelect(data_access_id, params.paths!, params.where, limit);
			default:
				throw new Error(`Unknown operation: ${operation}`);
		}
	}

	private async handleQuery(dataAccessId: string, sqlQuery: string, limit: number) {
		if (!dataAccessId) {
			throw new Error("data_access_id is required for query operation");
		}
		if (!sqlQuery) {
			throw new Error("sql parameter is required for query operation");
		}

		// Basic SQL safety: single statement only
		const sanitized = sqlQuery.replace(/--.*$/gm, '').trim();
		if (sanitized.split(';').filter(Boolean).length > 1) {
			throw new Error("Only single SQL statements are allowed");
		}

		const env = this.context.getEnvironment();
		if (!env) {
			throw new Error('Environment not available for data operations');
		}

		// Do not auto-append LIMIT to avoid parser issues; trust user input and display row_count
		const finalQuery = sqlQuery.trim();

		const doId = env.JSON_TO_SQL_DO.idFromName(dataAccessId);
		const doInstance = env.JSON_TO_SQL_DO.get(doId);
		
		const queryRequest = new Request('http://localhost/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				operation: 'query',
				sql: finalQuery
			})
		});

		const response = await doInstance.fetch(queryRequest);
		const result = await response.json() as { success: boolean; result?: any[]; row_count?: number; error?: string };

		if (!result.success) {
			throw new Error(`Query failed: ${result.error}`);
		}

		const resultText = `**Query Results** (${result.row_count} rows):\n\n\`\`\`sql\n${finalQuery}\n\`\`\`\n\n${JSON.stringify(result.result, null, 2)}`;
		
		return {
			content: [{ type: "text" as const, text: resultText }]
		};
	}

	private async handleCount(dataAccessId?: string) {
		if (!dataAccessId) throw new Error("data_access_id is required for count");
		return this.handleQuery(dataAccessId, "SELECT COUNT(*) as total FROM protein", 0);
	}

	private async handleSample(dataAccessId?: string, limit: number = 10) {
		if (!dataAccessId) throw new Error("data_access_id is required for sample");
		return this.handleQuery(dataAccessId, `SELECT json_extract(data, '$') as obj FROM protein LIMIT ${Math.max(1, limit)}`, limit);
	}

	private async handleDistinct(dataAccessId?: string, path?: string, limit: number = 50) {
		if (!dataAccessId) throw new Error("data_access_id is required for distinct");
		if (!path) throw new Error("'path' is required for distinct");
		const sql = `SELECT DISTINCT json_extract(data, '${path}') as value FROM protein LIMIT ${Math.max(1, limit)}`;
		return this.handleQuery(dataAccessId, sql, limit);
	}

	private async handleSelect(dataAccessId?: string, paths?: string[], where?: string, limit: number = 100) {
		if (!dataAccessId) throw new Error("data_access_id is required for select");
		if (!paths || paths.length === 0) throw new Error("'paths' is required for select");
		const selects = paths.map((p, i) => `json_extract(data, '${p}') as c${i + 1}`).join(', ');
		const whereClause = where ? ` WHERE ${where}` : '';
		const sql = `SELECT ${selects} FROM protein${whereClause} LIMIT ${Math.max(1, limit)}`;
		return this.handleQuery(dataAccessId, sql, limit);
	}

	private async handleSchema(dataAccessId: string) {
		if (!dataAccessId) {
			throw new Error("data_access_id is required for schema operation");
		}

		const env = this.context.getEnvironment();
		if (!env) {
			throw new Error('Environment not available for data operations');
		}

		const doId = env.JSON_TO_SQL_DO.idFromName(dataAccessId);
		const doInstance = env.JSON_TO_SQL_DO.get(doId);
		
		const schemaRequest = new Request('http://localhost/schema', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				operation: 'get_schema'
			})
		});

		const response = await doInstance.fetch(schemaRequest);
		const result = await response.json() as { success: boolean; schema?: any; error?: string };

		if (!result.success) {
			throw new Error(`Schema retrieval failed: ${result.error}`);
		}

		const schemaText = StagingGuideFormatter.formatSchemaWithGuide(result.schema, dataAccessId);
		
		return {
			content: [{ type: "text" as const, text: schemaText }]
		};
	}

	private async handleCleanup(dataAccessId: string) {
		if (!dataAccessId) {
			throw new Error("data_access_id is required for cleanup operation");
		}

		const env = this.context.getEnvironment();
		if (!env) {
			throw new Error('Environment not available for data operations');
		}

		const doId = env.JSON_TO_SQL_DO.idFromName(dataAccessId);
		const doInstance = env.JSON_TO_SQL_DO.get(doId);
		
		const cleanupRequest = new Request('http://localhost/cleanup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				operation: 'cleanup'
			})
		});

		const response = await doInstance.fetch(cleanupRequest);
		const result = await response.json() as { success: boolean; message?: string; error?: string };

		if (!result.success) {
			throw new Error(`Cleanup failed: ${result.error}`);
		}

		return {
			content: [{ type: "text" as const, text: `✅ **Dataset Cleaned**: ${result.message}\n\nData access ID \`${dataAccessId}\` has been permanently removed.` }]
		};
	}

	private async handleListDatasets() {
		const datasets: Array<{ id: string; operation: string; entityCount: number; entityTypes: string[]; payloadSize: number; timestamp: string }> = (this.context as any).listDatasets?.() ?? [];
		if (!datasets.length) {
			return {
				content: [{ type: "text" as const, text: `No datasets are currently registered. Stage data via any UniProt/Proteins tool; large responses auto-stage. Then use data_manager with operation: "schema" or "query".` }]
			};
		}

		const lines = datasets.map((d: { id: string; operation: string; entityCount: number; entityTypes: string[]; payloadSize: number; timestamp: string }) => `- ${d.id} | op=${d.operation} | entities=${d.entityCount} | types=${d.entityTypes.join(',')} | size=${Math.round(d.payloadSize/1024)}KB | ${d.timestamp}`);
		const text = `**Staged Dataset Registry** (${datasets.length})\n\n${lines.join('\n')}\n\nTips:\n- Inspect: { operation: "schema", data_access_id: "<id>" }\n- Sample: { operation: "sample", data_access_id: "<id>", limit: 3 }\n- Count: { operation: "count", data_access_id: "<id>" }`;
		return { content: [{ type: "text" as const, text }] };
	}

	private async handleExport(dataAccessId: string, format: string, tableName?: string) {
		if (!dataAccessId) {
			throw new Error("data_access_id is required for export operation");
		}

		const env = this.context.getEnvironment();
		if (!env) {
			throw new Error('Environment not available for data operations');
		}

		const doId = env.JSON_TO_SQL_DO.idFromName(dataAccessId);
		const doInstance = env.JSON_TO_SQL_DO.get(doId);
		
		// Query all data from specified table or main protein table
		const table = tableName || 'protein';
		const exportQuery = `SELECT * FROM ${table}`;
		
		const queryRequest = new Request('http://localhost/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				operation: 'query',
				sql: exportQuery
			})
		});

		const response = await doInstance.fetch(queryRequest);
		const result = await response.json() as { success: boolean; result?: any[]; row_count?: number; error?: string };

		if (!result.success) {
			throw new Error(`Export query failed: ${result.error}`);
		}

		if (!result.result || result.result.length === 0) {
			return {
				content: [{ type: "text" as const, text: `**Export Complete**: No data found in table '${table}'` }]
			};
		}

		let exportData: string;
		let contentType: string;

		switch (format) {
			case "json":
				exportData = JSON.stringify(result.result, null, 2);
				contentType = "application/json";
				break;
			case "csv":
			case "tsv": {
				const delimiter = format === "csv" ? "," : "\t";
				const headers = Object.keys(result.result[0]);
				const rows = result.result.map(row => 
					headers.map(header => {
						const value = row[header];
						// Escape quotes and wrap in quotes if contains delimiter
						const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
						return stringValue.includes(delimiter) || stringValue.includes('"') 
							? `"${stringValue.replace(/"/g, '""')}"` 
							: stringValue;
					}).join(delimiter)
				);
				exportData = [headers.join(delimiter), ...rows].join('\n');
				contentType = format === "csv" ? "text/csv" : "text/tab-separated-values";
				break;
			}
			default:
				throw new Error(`Unsupported export format: ${format}`);
		}

		// For large exports, we should stage the result
		if (exportData.length > 8192) { // 8KB threshold
			const stagingResult = await this.context.checkAndStageIfNeeded(
				{ export_data: exportData, format, table, row_count: result.row_count },
				`export_${dataAccessId}_${table}_${format}`
			);
			
			if (stagingResult.shouldStage && stagingResult.formattedData) {
				return {
					content: [{ type: "text" as const, text: stagingResult.formattedData }]
				};
			}
		}

		return {
			content: [{ type: "text" as const, text: `**Export Complete** (${result.row_count} rows, ${format.toUpperCase()}):\n\n\`\`\`${format}\n${exportData.slice(0, 2000)}${exportData.length > 2000 ? '\n... (truncated)' : ''}\n\`\`\`` }]
		};
	}

	private async handleFetchAndStage(params: any) {
		const accessionsParam: string | string[] | undefined = params.accessions;
		const fields: string | undefined = params.fields;
		if (!accessionsParam) {
			throw new Error("'accessions' is required for fetch_and_stage (CSV or array of strings)");
		}

		const accessionList = Array.isArray(accessionsParam)
			? accessionsParam
			: String(accessionsParam).split(',').map(s => s.trim()).filter(Boolean);
		if (accessionList.length === 0) {
			throw new Error("No accessions provided");
		}

		const results: any[] = [];
		for (const acc of accessionList) {
			const searchParams = new URLSearchParams({ format: 'json' });
			if (fields) searchParams.append('fields', fields);
			const url = `${this.context.uniprotFetchBaseUrl}/${acc}?${searchParams}`;
			const headers: Record<string, string> = { Accept: 'application/json' };
			const resp = await fetch(url, { headers });
			const data = await this.parseResponse(resp, `UniProt Entry ${acc}`);
			results.push({ type: 'protein', data: { ...data, _accession: acc } });
		}

		const dataAccessId = await (this.context as any).stageDataInChunks(results, 'fetch_and_stage_entries');

		const summary = `✅ **Protein Entries Staged**\n\n**Accessions:** ${accessionList.join(', ')}\n**Data Access ID:** ${dataAccessId}\n\nUse the data_manager tool with operation: \"schema\" and \"query\" to explore the dataset.`;

		return { content: [{ type: "text" as const, text: summary }] };
	}
}