import { z } from "zod";
import { BaseTool } from "./base.js";

export class ProteinsAPIDetailsTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"proteins_api_details",
			"Retrieve detailed protein information from EBI Proteins API. Includes sequence, isoforms, and functional data.",
			{
				accession: z.string().describe("UniProt accession number (e.g., P04637)"),
				format: z.enum(["json", "xml"]).optional().default("json").describe("Response format"),
				include_isoforms: z.boolean().optional().default(false).describe("Include protein isoforms")
			},
			async (params, _extra) => {
				try {
					return await this.handleProteinDetails(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'Proteins API Details',
						'details',
						params,
						error instanceof Error && 'status' in error ? (error as any).status : undefined
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleProteinDetails(params: any) {
		const { accession, format, include_isoforms } = params;
		
		const searchParams = new URLSearchParams();
		if (include_isoforms) {
			searchParams.append("isoforms", "true");
		}

		const url = `${this.context.proteinsApiBaseUrl}/proteins/${accession}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : "application/xml"
		};

		// Add timeout to prevent hanging
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
		
		let data;
		try {
			const response = await fetch(url, { 
				headers,
				signal: controller.signal 
			});
			clearTimeout(timeoutId);
			data = await this.parseResponse(response, `Proteins API Details for ${accession}`);
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Details API request timed out after 30 seconds for ${accession}`);
			}
			throw error;
		}

		// Check if response needs staging due to size
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `protein_details_${accession}_${format}`);
		
		if (stagingResult.shouldStage && stagingResult.formattedData) {
			return {
				content: [{ type: "text" as const, text: stagingResult.formattedData }]
			};
		} else {
			return {
				content: [{ type: "text" as const, text: `**Protein Details for ${accession}**:\n\n${stagingResult.formattedData}` }]
			};
		}
	}
}

export class ProteinsAPIFeaturesTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"proteins_api_features",
			"Retrieve protein sequence features from EBI Proteins API. Includes domains, sites, regions, and structural annotations.",
			{
				accession: z.string().describe("UniProt accession number (e.g., P04637)"),
				categories: z.array(z.string()).optional().describe("Feature categories to include (e.g., ['DOMAINS_AND_SITES', 'PTM'])"),
				format: z.enum(["json", "xml", "gff"]).optional().default("json").describe("Response format")
			},
			async (params, _extra) => {
				try {
					return await this.handleProteinFeatures(params);
				} catch (error) {
					const enhancedError = this.formatEnhancedError(
						error instanceof Error ? error : String(error),
						'Proteins API Features',
						'features',
						params,
						error instanceof Error && 'status' in error ? (error as any).status : undefined
					);
					return { content: [{ type: "text" as const, text: enhancedError }] };
				}
			}
		);
	}

	private async handleProteinFeatures(params: any) {
		const { accession, categories, format } = params;
		
		const searchParams = new URLSearchParams();
		if (categories && categories.length > 0) {
			searchParams.append("categories", categories.join(","));
		}

		const url = `${this.context.proteinsApiBaseUrl}/features/${accession}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : 
					  format === "xml" ? "application/xml" :
					  "text/plain" // for GFF
		};

		// Add timeout to prevent hanging
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
		
		let data;
		try {
			const response = await fetch(url, { 
				headers,
				signal: controller.signal 
			});
			clearTimeout(timeoutId);
			data = await this.parseResponse(response, `Proteins API Features for ${accession}`);
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Features API request timed out after 30 seconds for ${accession}`);
			}
			throw error;
		}

		// Check if response needs staging due to size
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `protein_features_${accession}_${format}`);
		
		if (stagingResult.shouldStage && stagingResult.formattedData) {
			return {
				content: [{ type: "text" as const, text: stagingResult.formattedData }]
			};
		} else {
			return {
				content: [{ type: "text" as const, text: `**Protein Features for ${accession}**:\n\n${stagingResult.formattedData}` }]
			};
		}
	}
}

export class ProteinsAPIVariationTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"proteins_api_variation",
			"Retrieve protein sequence variations from EBI Proteins API. Includes SNPs, insertions, deletions, and disease variants.",
			{
				accession: z.string().describe("UniProt accession number (e.g., P04637)"),
				sources: z.array(z.string()).optional().describe("Variation sources (e.g., ['uniprot', 'large_scale_studies'])"),
				consequences: z.array(z.string()).optional().describe("Variation consequences to filter (e.g., ['missense', 'nonsense'])"),
				disease_filter: z.boolean().optional().default(false).describe("Only include disease-associated variants"),
				format: z.enum(["json", "xml"]).optional().default("json").describe("Response format")
			},
			async (params, _extra) => {
				try {
					return await this.handleProteinVariation(params);
				} catch (error) {
					return { content: [{ type: "text" as const, text: `Proteins API Variation Error: ${error instanceof Error ? error.message : String(error)}` }] };
				}
			}
		);
	}

	private async handleProteinVariation(params: any) {
		const { accession, sources, consequences, disease_filter, format } = params;
		
		const searchParams = new URLSearchParams();
		if (sources && sources.length > 0) {
			searchParams.append("sources", sources.join(","));
		}
		if (consequences && consequences.length > 0) {
			searchParams.append("consequences", consequences.join(","));
		}
		if (disease_filter) {
			searchParams.append("disease", "true");
		}

		const url = `${this.context.proteinsApiBaseUrl}/variation/${accession}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : "application/xml"
		};

		// Add timeout to prevent hanging
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
		
		let data;
		try {
			const response = await fetch(url, { 
				headers,
				signal: controller.signal 
			});
			clearTimeout(timeoutId);
			data = await this.parseResponse(response, `Proteins API Variation for ${accession}`);
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Variation API request timed out after 30 seconds for ${accession}`);
			}
			throw error;
		}

		// Check if response needs staging due to size
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `protein_variation_${accession}_${format}`);
		
		if (stagingResult.shouldStage && stagingResult.formattedData) {
			return {
				content: [{ type: "text" as const, text: stagingResult.formattedData }]
			};
		} else {
			return {
				content: [{ type: "text" as const, text: `**Protein Variations for ${accession}**:\n\n${stagingResult.formattedData}` }]
			};
		}
	}
}

export class ProteinsAPIProteomicsTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"proteins_api_proteomics",
			"Retrieve proteomics data from EBI Proteins API. Includes peptide identifications and quantitative data from various studies.",
			{
				accession: z.string().describe("UniProt accession number (e.g., P04637)"),
				studies: z.array(z.string()).optional().describe("Specific study IDs to include"),
				tissues: z.array(z.string()).optional().describe("Tissue types to filter (e.g., ['brain', 'liver'])"),
				format: z.enum(["json", "xml"]).optional().default("json").describe("Response format")
			},
			async (params, _extra) => {
				try {
					return await this.handleProteomics(params);
				} catch (error) {
					return { content: [{ type: "text" as const, text: `Proteins API Proteomics Error: ${error instanceof Error ? error.message : String(error)}` }] };
				}
			}
		);
	}

	private async handleProteomics(params: any) {
		const { accession, studies, tissues, format } = params;
		
		const searchParams = new URLSearchParams();
		if (studies && studies.length > 0) {
			searchParams.append("studies", studies.join(","));
		}
		if (tissues && tissues.length > 0) {
			searchParams.append("tissues", tissues.join(","));
		}

		const url = `${this.context.proteinsApiBaseUrl}/proteomics/${accession}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : "application/xml"
		};

		// Add timeout to prevent hanging
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
		
		let data;
		try {
			const response = await fetch(url, { 
				headers,
				signal: controller.signal 
			});
			clearTimeout(timeoutId);
			data = await this.parseResponse(response, `Proteins API Proteomics for ${accession}`);
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Proteomics API request timed out after 30 seconds for ${accession}`);
			}
			throw error;
		}

		// Check if response needs staging due to size
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `protein_proteomics_${accession}_${format}`);
		
		if (stagingResult.shouldStage && stagingResult.formattedData) {
			return {
				content: [{ type: "text" as const, text: stagingResult.formattedData }]
			};
		} else {
			return {
				content: [{ type: "text" as const, text: `**Proteomics Data for ${accession}**:\n\n${stagingResult.formattedData}` }]
			};
		}
	}
}

export class ProteinsAPIGenomeTool extends BaseTool {
	register(): void {
		this.context.server.tool(
			"proteins_api_genome",
			"Retrieve genome coordinate mappings from EBI Proteins API. Maps protein positions to genomic coordinates.",
			{
				accession: z.string().describe("UniProt accession number (e.g., P04637)"),
				assembly: z.string().optional().describe("Genome assembly version (e.g., 'GRCh38', 'GRCh37')"),
				format: z.enum(["json", "xml"]).optional().default("json").describe("Response format")
			},
			async (params, _extra) => {
				try {
					return await this.handleGenomeMapping(params);
				} catch (error) {
					return { content: [{ type: "text" as const, text: `Proteins API Genome Error: ${error instanceof Error ? error.message : String(error)}` }] };
				}
			}
		);
	}

	private async handleGenomeMapping(params: any) {
		const { accession, assembly, format } = params;
		
		const searchParams = new URLSearchParams();
		if (assembly) {
			searchParams.append("assembly", assembly);
		}

		const url = `${this.context.proteinsApiBaseUrl}/coordinates/${accession}${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
		const headers: Record<string, string> = {
			"Accept": format === "json" ? "application/json" : "application/xml"
		};

		// Add timeout to prevent hanging
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
		
		let data;
		try {
			const response = await fetch(url, { 
				headers,
				signal: controller.signal 
			});
			clearTimeout(timeoutId);
			data = await this.parseResponse(response, `Proteins API Genome Mapping for ${accession}`);
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Genome API request timed out after 30 seconds for ${accession}`);
			}
			throw error;
		}

		// Check if response needs staging due to size
		const stagingResult = await this.context.checkAndStageIfNeeded(data, `protein_genome_${accession}_${format}`);
		
		if (stagingResult.shouldStage && stagingResult.formattedData) {
			return {
				content: [{ type: "text" as const, text: stagingResult.formattedData }]
			};
		} else {
			return {
				content: [{ type: "text" as const, text: `**Genome Coordinates for ${accession}**:\n\n${stagingResult.formattedData}` }]
			};
		}
	}
}