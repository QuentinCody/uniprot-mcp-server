export class JsonToSqlStorageDO {
	private ctx: DurableObjectState;

	constructor(ctx: DurableObjectState, _env: Env) {
		this.ctx = ctx;
	}

	async fetch(request: Request): Promise<Response> {
		try {
			const body = await request.json() as { operation: string; [key: string]: any };
			const { operation } = body;

			switch (operation) {
				case 'fetch_and_stage':
					return await this.handleFetchAndStage(body);
				case 'query':
					return await this.handleQuery(body);
				case 'get_schema':
					return await this.handleGetSchema(body);
				case 'cleanup':
					return await this.handleCleanup(body);
				default:
					return new Response(JSON.stringify({ error: `Unknown operation: ${operation}` }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' }
					});
			}
		} catch (error) {
			return new Response(JSON.stringify({ 
				error: `JsonToSqlDO error: ${error instanceof Error ? error.message : String(error)}` 
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	private async handleFetchAndStage(body: any): Promise<Response> {
		const { data, metadata } = body;
		
		if (!data || !Array.isArray(data)) {
			return new Response(JSON.stringify({ error: 'Data must be an array' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Create tables with better error handling for large datasets
		try {
			console.log(`Starting to stage ${data.length} items`);
			
			const createTableSQL = `
				CREATE TABLE IF NOT EXISTS protein (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					data TEXT,
					type TEXT,
					created_at DATETIME DEFAULT CURRENT_TIMESTAMP
				)
			`;
			this.ctx.storage.sql.exec(createTableSQL);
			console.log('Table created successfully');

			// Insert data one by one with better error handling 
			const insertSQL = `INSERT INTO protein (data, type) VALUES (?, ?)`;
			let successCount = 0;
			
			for (let i = 0; i < data.length; i++) {
				try {
					const item = data[i];
					const dataStr = JSON.stringify(item.data || item);
					
					// Limit individual record size aggressively
					let truncatedData = dataStr;
					if (dataStr.length > 10000) { // Much smaller limit
						truncatedData = dataStr.substring(0, 10000) + '...[truncated]';
					}
					
					this.ctx.storage.sql.exec(insertSQL, truncatedData, item.type || 'protein');
					successCount++;
					
					if (i % 100 === 0) {
						console.log(`Processed ${i}/${data.length} items`);
					}
				} catch (itemError) {
					console.error(`Failed to insert item ${i}:`, itemError);
					// Continue with next item rather than failing entirely
				}
			}

			console.log(`Successfully inserted ${successCount}/${data.length} items`);

			// Store metadata without async call
			try {
				this.storeMetadataSync(metadata, successCount);
				console.log('Metadata stored successfully');
			} catch (metaError) {
				console.error('Failed to store metadata:', metaError);
				// Don't fail the entire operation for metadata issues
			}

			return new Response(JSON.stringify({ 
				success: true, 
				tables_created: ['protein'],
				entities_inserted: successCount,
				total_attempted: data.length
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
			
		} catch (error) {
			console.error('Failed to stage data:', error);
			return new Response(JSON.stringify({ 
				error: `Failed to stage data: ${error instanceof Error ? error.message : String(error)}`,
				stack: error instanceof Error ? error.stack : undefined
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}


	private storeMetadataSync(metadata: any, entityCount: number): void {
		const metadataSQL = `
			CREATE TABLE IF NOT EXISTS _metadata (
				key TEXT PRIMARY KEY,
				value TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`;
		this.ctx.storage.sql.exec(metadataSQL);
		
		const insertMetadataSQL = `
			INSERT OR REPLACE INTO _metadata (key, value) 
			VALUES (?, ?), (?, ?), (?, ?), (?, ?)
		`;
		this.ctx.storage.sql.exec(insertMetadataSQL, 
			'entity_count', entityCount.toString(),
			'source', metadata?.source || 'unknown',
			'timestamp', metadata?.timestamp || new Date().toISOString(),
			'status', 'staged'
		);
	}

	private async storeMetadata(metadata: any, entityCount: number): Promise<void> {
		this.storeMetadataSync(metadata, entityCount);
	}

	private async handleQuery(body: any): Promise<Response> {
		const { sql: querySQL } = body;
		
		if (!querySQL) {
			return new Response(JSON.stringify({ error: 'SQL query is required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		try {
			// Execute the query
			const result = this.ctx.storage.sql.exec(querySQL);
			
			// Convert result to array format
			const rows: any[] = [];
			for (const row of result) {
				rows.push(row);
			}
			
			return new Response(JSON.stringify({
				success: true,
				result: rows,
				row_count: rows.length
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			return new Response(JSON.stringify({
				success: false,
				error: `Query failed: ${error instanceof Error ? error.message : String(error)}`
			}), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	private async handleGetSchema(_body: any): Promise<Response> {
		try {
			const metadataResult = this.ctx.storage.sql.exec("SELECT key, value FROM _metadata");
			const metadata: Record<string, string> = {};
			
			for (const row of metadataResult) {
				metadata[row.key as string] = row.value as string;
			}

			const schema = {
				tables: {
					protein: {
						columns: ['id', 'data', 'type', 'created_at'],
						description: 'Staged protein data'
					}
				},
				metadata
			};

			return new Response(JSON.stringify({
				success: true,
				schema
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			return new Response(JSON.stringify({
				success: false,
				error: `Failed to get schema: ${error instanceof Error ? error.message : String(error)}`
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	private async handleCleanup(_body: any): Promise<Response> {
		try {
			// Drop main tables
			this.ctx.storage.sql.exec("DROP TABLE IF EXISTS protein");
			this.ctx.storage.sql.exec("DROP TABLE IF EXISTS _metadata");

			return new Response(JSON.stringify({
				success: true,
				message: 'All data cleaned up'
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			return new Response(JSON.stringify({
				success: false,
				error: `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
}