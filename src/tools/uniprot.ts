import { z } from "zod";
import { BaseTool } from "./base.js";

// Shared validation utility for UniProt tools
class UniProtValidator {
	static validateSearchParams(query: string, fields?: string): string | null {
		const issues: string[] = [];
		
		// Common field mistakes in search queries - check for exact matches with word boundaries
		const fieldMistakes = [
			{ pattern: /\bgene_names:/g, correct: 'gene:' },
			{ pattern: /\bgene_name:/g, correct: 'gene:' },
			{ pattern: /\bname:/g, correct: 'protein_name:' },
			{ pattern: /\bspecies:/g, correct: 'organism_name: or organism_id:' },
			{ pattern: /\bfunction:/g, correct: 'cc_function:' }
		];
		
		for (const mistake of fieldMistakes) {
			if (mistake.pattern.test(query)) {
				const wrongField = mistake.pattern.source.replace(/\\b/g, '').replace(/:/g, ':');
				issues.push(`• Replace "${wrongField}" with "${mistake.correct}"`);
			}
		}
		
		// Valid UniProt search fields
		const validSearchFields = [
			'accession', 'gene', 'protein_name', 'organism_name', 'organism_id',
			'cc_function', 'cc_subcellular_location', 'keyword', 'go', 'ec',
			'pathway', 'reviewed', 'protein_existence', 'length', 'mass',
			'taxonomy', 'ft_peptide', 'sequence'
		];
		
		// Validate fields parameter if provided
		if (fields) {
			const requestedFields = fields.split(',').map(f => f.trim());
			const validReturnFields = [
				'accession', 'gene_names', 'protein_name', 'length', 'mass',
				'organism_name', 'cc_function', 'cc_subcellular_location',
				'ft_peptide', 'sequence', 'reviewed', 'protein_existence',
				'organism_id', 'taxonomy', 'keyword', 'go', 'ec', 'pathway'
			];
			
			const invalidFields = requestedFields.filter(f => !validReturnFields.includes(f));
			if (invalidFields.length > 0) {
				issues.push(`• Invalid fields: ${invalidFields.join(', ')}`);
				issues.push(`• Valid fields: ${validReturnFields.join(', ')}`);
			}
		}
		
		if (issues.length > 0) {
			return `**UniProt Search Field Validation Issues:**

${issues.join('\n')}

**Common Query Patterns:**
\`\`\`
• Basic: organism_id:9606 AND reviewed:true
• Gene search: gene:BRCA1 AND organism_id:9606
• Function: cc_function:"DNA repair" AND reviewed:true
• Complex: gene:BRCA* AND organism_id:9606 AND length:[100 TO 500]
\`\`\`

**Field Reference:**
- **Search fields**: gene, organism_id, cc_function, keyword, reviewed, length
- **Return fields**: accession, gene_names, protein_name, cc_function, sequence`;
		}
		
		return null;
	}
}

export class UniProtSearchTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"uniprot_search",
			"Search UniProtKB database with comprehensive filtering and pagination. Supports small to large result sets with automatic staging.",
			{
				query: z.string().describe("UniProtKB search query. Examples: 'organism_id:9606 AND reviewed:true', 'gene:BRCA1', 'length:[100 TO 500]'"),
				format: z.enum(["json", "tsv", "fasta", "xml"]).optional().default("json").describe("Response format"),
				fields: z.string().optional().describe("Comma-separated fields to return (only for json/tsv formats)"),
				size: z.number().optional().default(25).describe("Results per page (max 500)"),
				sort: z.string().optional().describe("Sort field and direction (e.g., 'score desc', 'length asc')"),
				facets: z.string().optional().describe("Comma-separated facet fields for aggregation"),
				compressed: z.boolean().optional().default(false).describe("Enable response compression"),
				include_isoforms: z.boolean().optional().default(false).describe("Include protein isoforms")
			},
			async (params, _extra) => {
				try {
					return await this.handleSearch(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'UniProt Search',
						'search',
						params,
						error instanceof Error && 'status' in error ? (error as any).status : undefined
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleSearch(params: any) {
		const { query, format, fields, size, sort, facets, compressed, include_isoforms } = params;
		
		// Pre-validate query and fields to provide better error messages
		const validationError = UniProtValidator.validateSearchParams(query, fields);
		if (validationError) {
			return { content: [{ type: "text" as const, text: validationError }] };
		}
		
		const searchParams = new URLSearchParams({
			query: query,
			size: Math.min(size, 500).toString(),
			format: format
		});

		if (fields && (format === "json" || format === "tsv")) {
			searchParams.append("fields", fields);
		}
		if (sort) {
			searchParams.append("sort", sort);
		}
		if (facets) {
			searchParams.append("facets", facets);
		}
		if (compressed) {
			searchParams.append("compressed", "true");
		}
		if (include_isoforms) {
			searchParams.append("includeIsoform", "true");
		}

		const url = `${this.context.uniprotSearchBaseUrl}?${searchParams}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : 
					  format === "xml" ? "application/xml" :
					  format === "tsv" ? "text/tab-separated-values" :
					  "text/plain"
		};

		const response = await fetch(url, { headers });
		const data = await this.parseResponse(response, "UniProt Search");

		// Check if response needs staging due to size
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `search_${format}`);
		
		if (stagingResult.shouldStage && stagingResult.formattedData) {
			return {
				content: [{ type: "text" as const, text: stagingResult.formattedData }]
			};
		} else {
			const resultText = format === "json" && typeof data === 'object' && data.results 
				? `**UniProt Search Results** (${data.results.length} entries):\n\n${stagingResult.formattedData}`
				: `**UniProt Search Results**:\n\n${stagingResult.formattedData}`;
			
			return {
				content: [{ type: "text" as const, text: resultText }]
			};
		}
	}
}

export class UniProtStreamTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"uniprot_stream",
			"Stream large datasets from UniProtKB. Automatically stages large responses for efficient querying. Use for bulk downloads.",
			{
				query: z.string().describe("UniProtKB search query for bulk download"),
				format: z.enum(["json", "tsv", "fasta", "xml"]).optional().default("json").describe("Response format"),
				fields: z.string().optional().describe("Comma-separated fields to return (only for json/tsv formats)"),
				compressed: z.boolean().optional().default(true).describe("Enable response compression (recommended for large datasets)"),
				include_isoforms: z.boolean().optional().default(false).describe("Include protein isoforms")
			},
			async (params, _extra) => {
				try {
					return await this.handleStream(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'UniProt Stream',
						'stream',
						params,
						error instanceof Error && 'status' in error ? (error as any).status : undefined
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleStream(params: any) {
		const { query, format, fields, compressed, include_isoforms } = params;
		
		// Pre-validate query and fields to provide better error messages
		const validationError = UniProtValidator.validateSearchParams(query, fields);
		if (validationError) {
			return { content: [{ type: "text" as const, text: validationError }] };
		}
		
		const searchParams = new URLSearchParams({
			query: query,
			format: format
		});

		if (fields && (format === "json" || format === "tsv")) {
			searchParams.append("fields", fields);
		}
		if (compressed) {
			searchParams.append("compressed", "true");
		}
		if (include_isoforms) {
			searchParams.append("includeIsoform", "true");
		}

		const url = `https://rest.uniprot.org/uniprotkb/stream?${searchParams}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : 
					  format === "xml" ? "application/xml" :
					  format === "tsv" ? "text/tab-separated-values" :
					  "text/plain"
		};

		const response = await fetch(url, { headers });
		const data = await this.parseResponse(response, "UniProt Stream");

		// Stream responses are always large, so stage them
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `stream_${format}`);
		
		return {
			content: [{ type: "text" as const, text: stagingResult.formattedData || `**UniProt Stream Results**:\n\n${this.context.formatResponseData(data)}` }]
		};
	}
}

export class UniProtEntryTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"uniprot_entry",
			"Retrieve individual UniProtKB entries by accession number with detailed formatting options.",
			{
				accession: z.string().describe("UniProt accession number (e.g., P04637, Q9Y261)"),
				format: z.enum(["json", "tsv", "fasta", "xml"]).optional().default("json").describe("Response format"),
				fields: z.string().optional().describe("Comma-separated fields to return (only for json/tsv formats)"),
				include_isoforms: z.boolean().optional().default(false).describe("Include protein isoforms")
			},
			async (params, _extra) => {
				try {
					return await this.handleEntry(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'UniProt Entry',
						'entry',
						params,
						error instanceof Error && 'status' in error ? (error as any).status : undefined
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleEntry(params: any) {
		const { accession, format, fields, include_isoforms } = params;
		
		const searchParams = new URLSearchParams({
			format: format
		});

		if (fields && (format === "json" || format === "tsv")) {
			searchParams.append("fields", fields);
		}
		if (include_isoforms) {
			searchParams.append("includeIsoform", "true");
		}

		const url = `${this.context.uniprotFetchBaseUrl}/${accession}?${searchParams}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : 
					  format === "xml" ? "application/xml" :
					  format === "tsv" ? "text/tab-separated-values" :
					  "text/plain"
		};

		const response = await fetch(url, { headers });
		const data = await this.parseResponse(response, `UniProt Entry ${accession}`);

		// Check if response needs staging due to size
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `entry_${accession}_${format}`);
		
		if (stagingResult.shouldStage && stagingResult.formattedData) {
			return {
				content: [{ type: "text" as const, text: stagingResult.formattedData }]
			};
		} else {
			return {
				content: [{ type: "text" as const, text: `**UniProt Entry ${accession}**:\n\n${stagingResult.formattedData}` }]
			};
		}
	}
}

export class UniProtIDMappingTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"uniprot_id_mapping",
			"Map IDs between different database systems. Supports batch mapping up to 100,000 IDs with job-based processing.",
			{
				from_db: z.string().describe("Source database (e.g., 'UniProtKB_AC-ID', 'Gene_Name', 'ENSEMBL')"),
				to_db: z.string().describe("Target database (e.g., 'UniProtKB', 'Gene_Name', 'PDB')"),
				ids: z.array(z.string()).describe("List of IDs to map (max 100,000)"),
				format: z.enum(["json", "tsv"]).optional().default("json").describe("Response format"),
				taxon_id: z.string().optional().describe("Filter by taxonomy ID (e.g., '9606' for human)")
			},
			async (params, _extra) => {
				try {
					return await this.handleIDMapping(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'UniProt ID Mapping',
						'id_mapping',
						params,
						error instanceof Error && 'status' in error ? (error as any).status : undefined
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleIDMapping(params: any) {
		const { from_db, to_db, ids, format, taxon_id } = params;
		
		if (ids.length > 100000) {
			throw new Error("Maximum 100,000 IDs allowed per mapping job");
		}

		// Submit mapping job - corrected approach
		const submitData = new FormData();
		submitData.append('from', from_db);
		submitData.append('to', to_db);
		submitData.append('ids', ids.join(','));
		if (taxon_id) {
			submitData.append('taxonId', taxon_id);
		}

		const submitResponse = await fetch('https://rest.uniprot.org/idmapping/run', {
			method: 'POST',
			body: submitData
		});

		if (!submitResponse.ok) {
			const errorText = await submitResponse.text();
			throw new Error(`Failed to submit ID mapping job: ${submitResponse.status} ${submitResponse.statusText}. Response: ${errorText}`);
		}

		const submitResult = await submitResponse.json() as { jobId: string };
		const { jobId } = submitResult;

		// Poll for job completion - use 3 second intervals as recommended
		let attempts = 0;
		const maxAttempts = 100; // 5 minutes with 3-second intervals
		
		while (attempts < maxAttempts) {
			try {
				const statusResponse = await fetch(`https://rest.uniprot.org/idmapping/status/${jobId}`, {
					method: 'GET',
					headers: {
						'Accept': 'application/json'
					}
				});
				
				if (!statusResponse.ok) {
					throw new Error(`Status check failed: ${statusResponse.status} ${statusResponse.statusText}`);
				}
				
				const statusData = await statusResponse.json() as any;
				
				// Check for different response formats
				if (statusData.jobStatus) {
					if (statusData.jobStatus === 'FINISHED') {
						// Get results
						const resultsUrl = `https://rest.uniprot.org/idmapping/results/${jobId}`;
						const resultsResponse = await fetch(resultsUrl, {
							headers: {
								'Accept': format === 'json' ? 'application/json' : 'text/tab-separated-values'
							}
						});
						
						if (!resultsResponse.ok) {
							throw new Error(`Failed to get results: ${resultsResponse.status} ${resultsResponse.statusText}`);
						}
						
						const data = await this.parseResponse(resultsResponse, "UniProt ID Mapping");
						
						// Check if response needs staging due to size
						const stagingResult = await this.context.checkAndStageIfNeeded(data, `id_mapping_${from_db}_to_${to_db}_${format}`);
						
						if (stagingResult.shouldStage && stagingResult.formattedData) {
							return {
								content: [{ type: "text" as const, text: stagingResult.formattedData }]
							};
						} else {
							return {
								content: [{ type: "text" as const, text: `**ID Mapping Results** (${from_db} → ${to_db}):\n\n${stagingResult.formattedData}` }]
							};
						}
					} else if (statusData.jobStatus === 'ERROR') {
						throw new Error(`ID mapping job failed: ${statusData.messages?.join('; ') || 'Job error'}`);
					} else if (statusData.jobStatus === 'RUNNING') {
						// Continue polling
					} else {
						throw new Error(`Unknown job status: ${statusData.jobStatus}`);
					}
				} else if (statusData.results || statusData.failedIds !== undefined) {
					// Job completed - results directly in status response
					const stagingResult = await this.context.checkAndStageIfNeeded(statusData, `id_mapping_${from_db}_to_${to_db}_${format}`);
					
					if (stagingResult.shouldStage && stagingResult.formattedData) {
						return {
							content: [{ type: "text" as const, text: stagingResult.formattedData }]
						};
					} else {
						return {
							content: [{ type: "text" as const, text: `**ID Mapping Results** (${from_db} → ${to_db}):\n\n${stagingResult.formattedData}` }]
						};
					}
				}
				
				// Wait 3 seconds before next check (recommended by UniProt)
				await new Promise(resolve => setTimeout(resolve, 3000));
				attempts++;
			} catch (error) {
				console.warn(`ID mapping status check attempt ${attempts + 1} failed:`, error);
				attempts++;
				if (attempts >= maxAttempts) {
					throw new Error(`ID mapping job monitoring failed after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`);
				}
				// Wait before retry
				await new Promise(resolve => setTimeout(resolve, 3000));
			}
		}
		
		throw new Error('ID mapping job timed out after 5 minutes');
	}
}

export class UniProtBLASTTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"uniprot_blast",
			"Perform BLAST searches against UniProtKB database. Supports protein and nucleotide sequences with various BLAST programs.",
			{
				program: z.enum(["blastp", "blastx", "tblastn"]).describe("BLAST program to use"),
				sequence: z.string().describe("Query sequence (protein or nucleotide)"),
				database: z.enum(["uniprotkb", "uniref90", "uniref50"]).optional().default("uniprotkb").describe("Target database"),
				matrix: z.string().optional().describe("Scoring matrix (e.g., 'BLOSUM62')"),
				threshold: z.number().optional().describe("E-value threshold"),
				hits: z.number().optional().default(50).describe("Maximum number of hits to return"),
				hsps: z.number().optional().describe("Maximum number of HSPs per hit"),
				format: z.enum(["json", "xml"]).optional().default("json").describe("Response format")
			},
			async (params, _extra) => {
				try {
					return await this.handleBLAST(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'UniProt BLAST',
						'blast',
						params,
						error instanceof Error && 'status' in error ? (error as any).status : undefined
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleBLAST(params: any) {
		const { program, sequence, database, matrix, threshold, hits, hsps, format } = params;
		
		// Submit BLAST job
		const submitData = new FormData();
		submitData.append('program', program);
		submitData.append('sequence', sequence);
		submitData.append('database', database);
		if (matrix) submitData.append('matrix', matrix);
		if (threshold) submitData.append('threshold', threshold.toString());
		if (hits) submitData.append('hits', hits.toString());
		if (hsps) submitData.append('hsps', hsps.toString());

		const submitResponse = await fetch('https://www.uniprot.org/blast/', {
			method: 'POST',
			body: submitData
		});

		if (!submitResponse.ok) {
			const error = new Error(`Failed to submit BLAST job: ${submitResponse.status} ${submitResponse.statusText}`);
			(error as any).status = submitResponse.status;
			throw error;
		}

		const submitResult = await submitResponse.json() as { jobId: string };
		const { jobId } = submitResult;

		// Poll for job completion
		let attempts = 0;
		const maxAttempts = 60; // 10 minutes max wait for BLAST
		
		while (attempts < maxAttempts) {
			const statusResponse = await fetch(`https://www.uniprot.org/blast/status/${jobId}`);
			const status = await statusResponse.json() as { jobStatus: string; messages?: string[] };
			
			if (status.jobStatus === 'FINISHED') {
				// Get results
				const resultsUrl = `https://www.uniprot.org/blast/results/${jobId}?format=${format}`;
				const resultsResponse = await fetch(resultsUrl);
				const data = await this.parseResponse(resultsResponse, "UniProt BLAST");
				
				// Check if response needs staging due to size
				const stagingResult = await this.context.checkAndStageIfNeeded(data, `blast_${program}_${database}_${format}`);
				
				if (stagingResult.shouldStage && stagingResult.formattedData) {
					return {
						content: [{ type: "text" as const, text: stagingResult.formattedData }]
					};
				} else {
					return {
						content: [{ type: "text" as const, text: `**BLAST Results** (${program} vs ${database}):\n\n${stagingResult.formattedData}` }]
					};
				}
			} else if (status.jobStatus === 'ERROR') {
				throw new Error(`BLAST job failed: ${status.messages?.join('; ') || 'Unknown error'}`);
			}
			
			// Wait 10 seconds before next check
			await new Promise(resolve => setTimeout(resolve, 10000));
			attempts++;
		}
		
		throw new Error('BLAST job timed out after 10 minutes');
	}
}