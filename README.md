# UniProt & Proteins API MCP Server

A comprehensive [Model Context Protocol](https://modelcontextprotocol.io/) server for UniProt and EBI Proteins APIs, built on Cloudflare Workers with advanced data staging capabilities using Durable Objects and SQLite.

## Overview

This MCP server provides unified access to:
- **UniProtKB**: Search and retrieve protein sequence and functional information
- **EBI Proteins API**: Detailed protein features, variations, and structural data

### Key Features

🚀 **Unified Interface**: Single tool for searching UniProt and fetching detailed protein data
📊 **Advanced Data Staging**: Large datasets automatically staged in SQLite for complex queries  
🔍 **Smart Query Generation**: Automatic suggestions for exploring staged data
📈 **Intelligent Bypassing**: Small datasets returned directly for efficiency
🏗️ **Scalable Architecture**: Built on Cloudflare Workers with Durable Objects
⚡ **Rate Limit Aware**: Intelligent handling of API rate limits

## Tools Available

### UniProt Database Tools

#### `uniprot_search`
Advanced UniProtKB search with comprehensive filtering and pagination:
- **Query**: Complex search queries with UniProt syntax
- **Formats**: JSON, TSV, FASTA, XML
- **Features**: Sorting, facets, compression, isoforms
- **Pagination**: Up to 500 results per page with automatic staging for large datasets

```json
{
  "query": "organism_id:9606 AND reviewed:true",
  "format": "json",
  "fields": "accession,protein_name,gene_names,organism_name",
  "size": 100,
  "sort": "score desc",
  "compressed": true
}
```

#### `uniprot_stream`
Bulk download tool for large datasets with automatic staging:
- **Purpose**: Stream large datasets efficiently
- **Auto-staging**: Always stages responses for SQL querying
- **Compression**: Built-in compression support
- **Formats**: JSON, TSV, FASTA, XML

```json
{
  "query": "organism_id:9606 AND reviewed:true",
  "format": "fasta",
  "compressed": true
}
```

#### `uniprot_entry`
Retrieve individual UniProtKB entries by accession:
- **Direct Access**: Get specific protein entries
- **Multiple Formats**: JSON, TSV, FASTA, XML
- **Isoforms**: Include protein isoforms
- **Field Selection**: Choose specific data fields

```json
{
  "accession": "P04637",
  "format": "json",
  "fields": "accession,protein_name,sequence,organism_name",
  "include_isoforms": true
}
```

#### `uniprot_id_mapping`
Map IDs between different database systems:
- **Batch Processing**: Up to 100,000 IDs per job
- **Cross-Database**: Map between UniProt, Ensembl, PDB, etc.
- **Job-Based**: Asynchronous processing with status tracking
- **Filtering**: Taxonomy-based filtering

```json
{
  "from_db": "Gene_Name",
  "to_db": "UniProtKB",
  "ids": ["TP53", "BRCA1", "BRCA2"],
  "taxon_id": "9606"
}
```

#### `uniprot_blast`
Perform BLAST searches against UniProtKB:
- **Programs**: BLASTP, BLASTX, TBLASTN
- **Databases**: UniProtKB, UniRef90, UniRef50
- **Parameters**: E-value, matrix, hit limits
- **Async Processing**: Job-based with polling

```json
{
  "program": "blastp",
  "sequence": "MTMDKSELVQKAKLAEQAERYDDMAAAMKAVTEQGHELSNEERNLLSVAYKNVVGARRSSWRVISSIEQKTERNEKKQQMGKEYREKIEAELQDICNDVLELLDKYLIPNATQPESKVFYLKMKGDYFRYLSEVASGDNKQTTVSNSQQAYQEAFEISKKEMQPTHPIRLGLALNFSVFYYEILNSPEKACSLAKTAFDEAIAELDTLNEESYKDSTLIMQLLRDNLTLWTSENQGDEGDAGEGEN",
  "database": "uniprotkb",
  "threshold": 0.001,
  "hits": 50
}
```

### EBI Proteins API Tools

#### `proteins_api_details`
Detailed protein information from EBI Proteins API:
- **Rich Data**: Sequence, functional annotations, isoforms
- **Formats**: JSON, XML
- **Isoforms**: Include protein variants

```json
{
  "accession": "P04637",
  "format": "json",
  "include_isoforms": true
}
```

#### `proteins_api_features`
Protein sequence features and annotations:
- **Categories**: Domains, sites, regions, PTMs
- **Formats**: JSON, XML, GFF
- **Filtering**: Specific feature categories

```json
{
  "accession": "P04637",
  "categories": ["DOMAINS_AND_SITES", "PTM"],
  "format": "json"
}
```

#### `proteins_api_variation`
Protein sequence variations and disease variants:
- **Sources**: UniProt, large-scale studies
- **Consequences**: Missense, nonsense, synonymous
- **Disease Filter**: Disease-associated variants only
- **Clinical Data**: ClinVar, COSMIC integration

```json
{
  "accession": "P04637",
  "sources": ["uniprot", "large_scale_studies"],
  "consequences": ["missense", "nonsense"],
  "disease_filter": true
}
```

#### `proteins_api_proteomics`
Proteomics data from various studies:
- **Studies**: PeptideAtlas, MaxQB, ProteomicsDB
- **Tissues**: Brain, liver, heart, etc.
- **Quantitative**: Expression levels and modifications

```json
{
  "accession": "P04637",
  "tissues": ["brain", "liver"],
  "format": "json"
}
```

#### `proteins_api_genome`
Genome coordinate mappings:
- **Assemblies**: GRCh38, GRCh37
- **Coordinates**: Protein to genomic position mapping
- **Exon Structure**: Gene structure information

```json
{
  "accession": "P04637",
  "assembly": "GRCh38",
  "format": "json"
}
```

### Data Management Tools

#### `data_manager`
Query, analyze, and manage staged datasets:
- **Operations**: Query, schema, cleanup, export
- **SQL Interface**: Full SQLite support
- **Export**: JSON, CSV, TSV formats
- **Analytics**: Built-in query suggestions

```json
{
  "operation": "query",
  "data_access_id": "uniprot_1234567890_abc123",
  "sql": "SELECT * FROM protein WHERE JSON_EXTRACT(data, '$.organism.scientificName') = 'Homo sapiens' LIMIT 10"
}
```

## Quick Start

### 1. Setup

```bash
npm install
```

### 2. Development

```bash
npm run dev
```

The server will be available at:
- **MCP Endpoint**: `http://localhost:8787/mcp`
- **SSE Endpoint**: `http://localhost:8787/sse`

### 3. Testing Examples

#### Search for Human Proteins
```json
{
  "method": "tools/call",
  "params": {
    "name": "uniprot_query",
    "arguments": {
      "operation": "search",
      "query": "organism_id:9606 AND reviewed:true",
      "limit": 10
    }
  }
}
```

#### Get Protein Details
```json
{
  "method": "tools/call", 
  "params": {
    "name": "uniprot_query",
    "arguments": {
      "operation": "protein_details",
      "accession": "P04637"
    }
  }
}
```

#### Stage and Query Multiple Proteins
```json
{
  "method": "tools/call",
  "params": {
    "name": "data_manager", 
    "arguments": {
      "operation": "fetch_and_stage",
      "accessions": "P04637,P53_HUMAN,Q92793"
    }
  }
}
```

## Data Staging & SQL Querying

For large datasets, the server automatically stages data in SQLite tables within Durable Objects, enabling complex analytical queries:

### Automatic Table Creation
Data is normalized into tables like:
- `proteins`: Core protein information
- `gene_names`: Gene names and synonyms  
- `features`: Protein sequence features
- `keywords`: Functional keywords
- `references`: Literature references

### Example SQL Queries
```sql
-- Find proteins by gene name
SELECT * FROM proteins p 
JOIN gene_names g ON p.accession = g.accession 
WHERE g.gene_name LIKE 'TP53%';

-- Analyze protein lengths by organism
SELECT organism_name, AVG(sequence_length), COUNT(*) 
FROM proteins 
GROUP BY organism_name;

-- Find proteins with specific features
SELECT p.accession, p.protein_name, f.description
FROM proteins p
JOIN features f ON p.accession = f.accession
WHERE f.type = 'DOMAIN';
```

## API Endpoints and Rate Limits

### UniProtKB REST API
- **Base URL**: `https://rest.uniprot.org/uniprotkb/`
- **Rate Limits**: IP-based, ~3 requests/second recommended
- **Formats**: JSON, TSV, FASTA, GFF, XML

### EBI Proteins API  
- **Base URL**: `https://www.ebi.ac.uk/proteins/api/`
- **Rate Limits**: ~10 requests/second per IP
- **Authentication**: None required for public data

## Architecture

### Components
- **UniProtMCP**: Main MCP agent implementing ToolContext interface
- **ToolRegistry**: Manages and registers all available tools
- **JsonToSqlDO**: Durable Object for data staging and SQL operations
- **ChunkingEngine**: Handles large dataset chunking for efficient processing
- **DataInsertionEngine**: Optimized bulk data insertion with conflict resolution
- **SchemaInferenceEngine**: Automatic schema discovery and documentation

### Data Flow
1. **Request**: Tool receives search/fetch request
2. **API Call**: Fetches data from UniProt/Proteins APIs  
3. **Parsing**: Normalizes JSON responses into structured entities
4. **Staging Decision**: Determines if staging is beneficial
5. **Storage**: Creates optimized SQLite tables in Durable Objects
6. **Querying**: Enables complex SQL analysis of staged data

## Deployment

### Cloudflare Workers

```bash
npm run deploy
```

### Configuration

Ensure `wrangler.jsonc` includes:
- Durable Object bindings for `UniProtMCP` and `JsonToSqlDO`
- Node.js compatibility flags
- Proper migration configuration

### Environment Variables
No API keys required - both UniProt and EBI Proteins APIs are open access.

## Connect to Claude Desktop

You can connect to your remote MCP server from Claude Desktop using the [mcp-remote proxy](https://www.npmjs.com/package/mcp-remote).

Update your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "uniprot": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/sse"  // or your-uniprot-server.workers.dev/sse
      ]
    }
  }
}
```

## Rate Limiting Strategy

See [RATE_LIMITING.md](./RATE_LIMITING.md) for detailed information about:
- API-specific rate limits and best practices
- Intelligent request throttling and retry logic
- Monitoring and optimization strategies
- Bulk operation handling

## Examples

### Research Workflow: Cancer-related Proteins

1. **Search for cancer-related proteins**:
```json
{
  "operation": "search",
  "query": "keyword:Cancer AND organism_id:9606",
  "limit": 100
}
```

2. **Stage for analysis**:
```json
{
  "operation": "fetch_and_stage",
  "accessions": "P04637,P53_HUMAN,BRCA1_HUMAN,BRCA2_HUMAN"
}
```

3. **Analyze with SQL**:
```sql
SELECT 
  p.accession,
  p.protein_name,
  COUNT(f.feature_id) as feature_count,
  GROUP_CONCAT(DISTINCT k.keyword) as keywords
FROM proteins p
LEFT JOIN features f ON p.accession = f.accession  
LEFT JOIN keywords k ON p.accession = k.accession
WHERE k.keyword LIKE '%cancer%'
GROUP BY p.accession
ORDER BY feature_count DESC;
```

### Protein Family Analysis

1. **Search protein family**:
```json
{
  "operation": "search", 
  "query": "family:\"protein kinase\" AND reviewed:true",
  "fields": "accession,protein_name,gene_names,ec"
}
```

2. **Get detailed features**:
```json
{
  "operation": "protein_features",
  "accession": "P06493",
  "features": "DOMAIN,BINDING,ACT_SITE"
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes  
4. Test thoroughly with both APIs
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [UniProt REST API Documentation](https://www.uniprot.org/api-documentation)
- [EBI Proteins API Documentation](https://www.ebi.ac.uk/proteins/api/doc/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)