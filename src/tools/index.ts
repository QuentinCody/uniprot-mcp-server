import type { BaseTool, ToolContext } from "./base.js";
import { 
	UniProtSearchTool, 
	UniProtStreamTool, 
	UniProtEntryTool, 
	UniProtIDMappingTool, 
	UniProtBLASTTool 
} from "./uniprot.js";
import { 
	ProteinsAPIDetailsTool, 
	ProteinsAPIFeaturesTool, 
	ProteinsAPIVariationTool, 
	ProteinsAPIProteomicsTool, 
	ProteinsAPIGenomeTool 
} from "./proteins-api.js";
import { DataManagerTool } from "./data-manager.js";

export type { ToolContext } from "./base.js";

export class ToolRegistry {
	private context: ToolContext;
	private tools: BaseTool[] = [];

	constructor(context: ToolContext) {
		this.context = context;
	}

	registerAll(): void {
		// Register UniProt tools
		const uniProtSearchTool = new UniProtSearchTool(this.context);
		uniProtSearchTool.register();
		this.tools.push(uniProtSearchTool);

		const uniProtStreamTool = new UniProtStreamTool(this.context);
		uniProtStreamTool.register();
		this.tools.push(uniProtStreamTool);

		const uniProtEntryTool = new UniProtEntryTool(this.context);
		uniProtEntryTool.register();
		this.tools.push(uniProtEntryTool);

		const uniProtIDMappingTool = new UniProtIDMappingTool(this.context);
		uniProtIDMappingTool.register();
		this.tools.push(uniProtIDMappingTool);

		const uniProtBLASTTool = new UniProtBLASTTool(this.context);
		uniProtBLASTTool.register();
		this.tools.push(uniProtBLASTTool);

		// Register EBI Proteins API tools
		const proteinsAPIDetailsTool = new ProteinsAPIDetailsTool(this.context);
		proteinsAPIDetailsTool.register();
		this.tools.push(proteinsAPIDetailsTool);

		const proteinsAPIFeaturesTool = new ProteinsAPIFeaturesTool(this.context);
		proteinsAPIFeaturesTool.register();
		this.tools.push(proteinsAPIFeaturesTool);

		const proteinsAPIVariationTool = new ProteinsAPIVariationTool(this.context);
		proteinsAPIVariationTool.register();
		this.tools.push(proteinsAPIVariationTool);

		const proteinsAPIProteomicsTool = new ProteinsAPIProteomicsTool(this.context);
		proteinsAPIProteomicsTool.register();
		this.tools.push(proteinsAPIProteomicsTool);

		const proteinsAPIGenomeTool = new ProteinsAPIGenomeTool(this.context);
		proteinsAPIGenomeTool.register();
		this.tools.push(proteinsAPIGenomeTool);

		// Register data management tools
		const dataManagerTool = new DataManagerTool(this.context);
		dataManagerTool.register();
		this.tools.push(dataManagerTool);
	}

	getTools(): BaseTool[] {
		return this.tools;
	}
}