export class JsonToSqlDO {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		this.sql = ctx.storage.sql;
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

		// Create a simple protein table for staging
		const createTableSQL = `
			CREATE TABLE IF NOT EXISTS protein (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				data TEXT,
				type TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`;
		this.sql.exec(createTableSQL);

		// Insert data in chunks
		for (let i = 0; i < data.length; i += 100) {
			const chunk = data.slice(i, i + 100);
			for (const item of chunk) {
				const insertSQL = `
					INSERT INTO protein (data, type) 
					VALUES (?, ?)
				`;
				this.sql.exec(insertSQL, JSON.stringify(item.data || item), item.type || 'protein');
			}
		}

		// Store metadata
		const metadataSQL = `
			CREATE TABLE IF NOT EXISTS _metadata (
				key TEXT PRIMARY KEY,
				value TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`;
		this.sql.exec(metadataSQL);
		
		const insertMetadataSQL = `
			INSERT OR REPLACE INTO _metadata (key, value) 
			VALUES (?, ?), (?, ?), (?, ?), (?, ?)
		`;
		this.sql.exec(insertMetadataSQL, 
			'entity_count', data.length.toString(),
			'source', metadata?.source || 'unknown',
			'timestamp', metadata?.timestamp || new Date().toISOString(),
			'status', 'staged'
		);

		return new Response(JSON.stringify({ 
			success: true, 
			tables_created: ['protein'],
			entities_inserted: data.length
		}), {
			headers: { 'Content-Type': 'application/json' }
		});
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
			const result = this.sql.exec(querySQL);
			
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

	private async handleGetSchema(body: any): Promise<Response> {
		try {
			const metadataResult = this.sql.exec("SELECT key, value FROM _metadata");
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

	private async handleCleanup(body: any): Promise<Response> {
		try {
			// Drop main tables
			this.sql.exec("DROP TABLE IF EXISTS protein");
			this.sql.exec("DROP TABLE IF EXISTS _metadata");

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