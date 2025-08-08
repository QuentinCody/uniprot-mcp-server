import { z } from "zod";
import { BaseTool } from "./base.js";

// New tools for UniRef and UniParc access
export class UniRefClusterTool extends BaseTool {
  register(): void {
    this.context.server.tool(
      "uniref_cluster",
      "Retrieve UniRef clusters (50/90/100) by UniProt accession or UniRef ID, with optional staging for large responses.",
      {
        id: z.string().describe("UniRef cluster ID (e.g., UniRef90_P04637) or UniProt accession (e.g., P04637)"),
        identity: z.enum(["50", "90", "100"]).optional().default("90").describe("UniRef identity level"),
        format: z.enum(["json", "fasta", "xml"]).optional().default("json")
      },
      async (params, _extra) => {
        const { id, identity, format } = params;

        // Accept direct UniRef IDs or derive from accession
        const clusterId = id.startsWith("UniRef") ? id : `UniRef${identity}_${id}`;
        const base = `https://rest.uniprot.org/uniref/${clusterId}`;
        const url = `${base}?format=${format}`;
        const headers: Record<string, string> = {
          Accept:
            format === "json"
              ? "application/json"
              : format === "xml"
              ? "application/xml"
              : "text/plain",
        };

        const response = await fetch(url, { headers });
        const data = await this.parseResponse(response, `UniRef ${clusterId}`);

        const staging = await this.context.checkAndStageIfNeeded(data, `uniref_${clusterId}_${format}`);
        return {
          content: [{ type: "text" as const, text: staging.formattedData ?? this.context.formatResponseData(data) }],
        };
      }
    );
  }
}

export class UniParcEntryTool extends BaseTool {
  register(): void {
    this.context.server.tool(
      "uniparc_entry",
      "Retrieve UniParc entry by UPI or by UniProt accession mapping.",
      {
        upi_or_accession: z.string().describe("UniParc UPI (e.g., UPI000000000A) or UniProt accession (e.g., P04637)"),
        format: z.enum(["json", "fasta", "xml"]).optional().default("json")
      },
      async (params, _extra) => {
        const { upi_or_accession, format } = params;
        const isUPI = upi_or_accession.toUpperCase().startsWith("UPI");
        const base = isUPI
          ? `https://rest.uniprot.org/uniparc/${upi_or_accession}`
          : `https://rest.uniprot.org/uniparc/search?query=accession:${encodeURIComponent(upi_or_accession)}`;
        const url = `${base}&format=${format}`;

        const headers: Record<string, string> = {
          Accept:
            format === "json"
              ? "application/json"
              : format === "xml"
              ? "application/xml"
              : "text/plain",
        };

        const response = await fetch(url, { headers });
        const data = await this.parseResponse(response, `UniParc ${upi_or_accession}`);
        const staging = await this.context.checkAndStageIfNeeded(data, `uniparc_${format}`);
        return {
          content: [{ type: "text" as const, text: staging.formattedData ?? this.context.formatResponseData(data) }],
        };
      }
    );
  }
}



