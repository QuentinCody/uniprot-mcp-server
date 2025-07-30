import { z } from "zod";
import { BaseTool } from "./base.js";

export class DataManagerTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"data_manager",
			"Query, analyze, and manage staged data from UniProt and Proteins API responses. Provides SQL interface to staged datasets.",
			{
				operation: z.enum([
					"query", "schema", "cleanup", "list_datasets", "export"
				]).describe("Operation to perform on staged data"),
				
				data_access_id: z.string().optional().describe("Data access ID from staging operation (required for query, schema, cleanup, export)"),
				
				// Query operation parameters
				sql: z.string().optional().describe("SQL query to execute on staged data (required for query operation)"),
				limit: z.number().optional().default(100).describe("Maximum number of rows to return from query"),
				
				// Export operation parameters
				export_format: z.enum(["json", "csv", "tsv"]).optional().default("json").describe("Format for data export"),
				table_name: z.string().optional().describe("Specific table to export (optional)")
			},
			async (params, _extra) => {
				try {
					return await this.handleDataManagement(params);
				} catch (error) {
					return { content: [{ type: "text" as const, text: `Data Manager Error: ${error instanceof Error ? error.message : String(error)}` }] };
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

		const env = this.context.getEnvironment();
		if (!env) {
			throw new Error('Environment not available for data operations');
		}

		// Add LIMIT clause if not present and limit is specified
		let finalQuery = sqlQuery.trim();
		if (limit && !finalQuery.toLowerCase().includes('limit')) {
			finalQuery += ` LIMIT ${limit}`;
		}

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

		const schemaText = `**Dataset Schema** for \`${dataAccessId}\`:\n\n${JSON.stringify(result.schema, null, 2)}`;
		
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
		// This would require implementing a registry of active datasets
		// For now, return a helpful message about how to track datasets
		return {
			content: [{ type: "text" as const, text: `**Dataset Management**

Currently active datasets are tracked through their data access IDs returned during staging operations.

**Common SQL Queries for Staged Data:**

1. **Count total records:**
   \`\`\`sql
   SELECT COUNT(*) as total_records FROM protein;
   \`\`\`

2. **View sample data:**
   \`\`\`sql
   SELECT * FROM protein LIMIT 10;
   \`\`\`

3. **Search by protein name:**
   \`\`\`sql
   SELECT * FROM protein WHERE JSON_EXTRACT(data, '$.proteinDescription.recommendedName.fullName.value') LIKE '%p53%';
   \`\`\`

4. **Filter by organism:**
   \`\`\`sql
   SELECT * FROM protein WHERE JSON_EXTRACT(data, '$.organism.scientificName') = 'Homo sapiens';
   \`\`\`

5. **Get metadata:**
   \`\`\`sql
   SELECT * FROM _metadata;
   \`\`\`

Use the \`data_manager\` tool with operation "schema" to see the exact structure of your staged data.` }]
		};
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
}