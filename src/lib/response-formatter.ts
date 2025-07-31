import type { EnhancedError, ErrorSuggestion, ErrorContext, FieldValidation, QuerySyntaxGuide } from './types.js';

export class EnhancedErrorFormatter {
  private static readonly UNIPROT_VALID_FIELDS = [
    'accession', 'gene_names', 'protein_name', 'length', 'mass', 
    'organism_name', 'cc_function', 'cc_subcellular_location', 
    'ft_peptide', 'sequence', 'reviewed', 'protein_existence',
    'organism_id', 'taxonomy', 'keyword', 'go', 'ec', 'pathway'
  ];

  private static readonly COMMON_FIELD_MISTAKES = {
    'gene_names': ['gene', 'gene_name'],
    'existence': ['protein_existence', 'reviewed'],
    'gene_name': ['gene', 'gene_names'],
    'species': ['organism_name', 'organism_id'],
    'function': ['cc_function'],
    'location': ['cc_subcellular_location'],
    'name': ['protein_name'],
    'id': ['accession', 'organism_id'],
    'annotation': ['cc_function', 'cc_subcellular_location'],
    'comment': ['cc_function'],
    'feature': ['ft_peptide'],
    'domain': ['ft_peptide'],
    'modification': ['ft_peptide'],
    'variant': ['ft_peptide'],
    'binding': ['ft_peptide']
  };

  private static readonly QUERY_SYNTAX_GUIDES: QuerySyntaxGuide[] = [
    {
      pattern: /\*[^*]+\*/g,
      errorType: 'wildcard_placement',
      correction: 'Use wildcards only at the end: term* not *term*',
      examples: ['aging* (correct)', 'metabolism* (correct)', '*aging* (incorrect)']
    },
    {
      pattern: /AND\s+AND|OR\s+OR/gi,
      errorType: 'duplicate_operators',
      correction: 'Remove duplicate boolean operators',
      examples: ['gene:BRCA1 AND reviewed:true (correct)', 'gene:BRCA1 AND AND reviewed:true (incorrect)']
    },
    {
      pattern: /[^:]\s*:\s*[^:]/g,
      errorType: 'field_syntax',
      correction: 'Use field:value format with no spaces around colon',
      examples: ['gene:BRCA1 (correct)', 'gene : BRCA1 (incorrect)']
    }
  ];

  static formatError(error: Error | string, context: ErrorContext): string {
    const errorMessage = error instanceof Error ? error.message : error;
    const enhancedError = this.analyzeError(errorMessage, context);
    
    return this.buildErrorResponse(enhancedError);
  }

  private static analyzeError(errorMessage: string, context: ErrorContext): EnhancedError {
    const suggestions: ErrorSuggestion[] = [];
    
    // Field validation errors
    if (errorMessage.includes('not a valid search field') || errorMessage.includes('Invalid fields parameter')) {
      suggestions.push(...this.getFieldValidationSuggestions(errorMessage, context));
    }
    
    // Query syntax errors
    if (errorMessage.includes('wildcard') || errorMessage.includes('query syntax')) {
      suggestions.push(...this.getQuerySyntaxSuggestions(errorMessage, context));
    }
    
    // SQL/Staging errors
    if (errorMessage.includes('no such column') || errorMessage.includes('no such table')) {
      suggestions.push(...this.getSQLStagingSuggestions(errorMessage, context));
    }
    
    // HTTP/Network errors
    if (context.httpStatus && context.httpStatus >= 400) {
      suggestions.push(...this.getNetworkErrorSuggestions(errorMessage, context));
    }
    
    // Service-specific errors
    if (context.toolName.includes('blast')) {
      suggestions.push(...this.getBLASTSuggestions(errorMessage, context));
    }
    
    return {
      message: errorMessage,
      suggestions,
      context
    };
  }

  private static getFieldValidationSuggestions(errorMessage: string, context: ErrorContext): ErrorSuggestion[] {
    const suggestions: ErrorSuggestion[] = [];
    
    // Extract invalid field names from error message
    const fieldMatches = errorMessage.match(/'([^']+)'/g);
    const invalidFields = fieldMatches ? fieldMatches.map(match => match.replace(/'/g, '')) : [];
    
    for (const invalidField of invalidFields) {
      const possibleCorrections = this.COMMON_FIELD_MISTAKES[invalidField] || 
        this.findSimilarFields(invalidField);
      
      if (possibleCorrections.length > 0) {
        suggestions.push({
          type: 'field_correction',
          title: `Field '${invalidField}' correction`,
          suggestion: `Did you mean: ${possibleCorrections.join(', ')}?`,
          example: `L fields: "${invalidField}"\n fields: "${possibleCorrections[0]}"`
        });
      }
    }
    
    // Add context-specific suggestions based on what user was trying to do
    if (context.userInput && context.userInput.query) {
      const query = context.userInput.query.toLowerCase();
      
      if (query.includes('created') || query.includes('modified') || query.includes('recent')) {
        suggestions.push({
          type: 'alternative_approach',
          title: 'Time-based Filtering Alternative',
          suggestion: 'UniProt does not support direct time-based searching. Use annotation_score sorting for most recent/complete entries.',
          example: 'query: "organism_id:9606 AND reviewed:true"\nsort: "annotation_score desc"'
        });
      }
      
      if (query.includes('therapeutic') || query.includes('drug')) {
        suggestions.push({
          type: 'query_template',
          title: 'Drug/Therapeutic Search Suggestions',
          suggestion: 'Search for drug-related proteins using these approaches:',
          example: `query: "cc_function:therapeutic OR cc_function:drug OR keyword:pharmaceutical"
query: "protein_name:inhibitor OR protein_name:receptor"
query: "go:0008144" # drug binding GO term`
        });
      }
    }
    
    // Add general field guidance
    suggestions.push({
      type: 'query_template',
      title: 'Valid UniProt Fields',
      suggestion: `Available fields for ${context.operation}:\n${this.UNIPROT_VALID_FIELDS.join(', ')}`,
      example: 'fields: "accession,gene_names,protein_name,length"'
    });
    
    return suggestions;
  }

  private static getQuerySyntaxSuggestions(errorMessage: string, context: ErrorContext): ErrorSuggestion[] {
    const suggestions: ErrorSuggestion[] = [];
    
    if (errorMessage.includes('wildcard')) {
      suggestions.push({
        type: 'syntax_help',
        title: 'Wildcard Usage',
        suggestion: 'Use wildcards at the end only, not at the beginning',
        example: 'L cc_function:*aging*\n cc_function:aging OR cc_function:"cellular aging"'
      });
    }
    
    suggestions.push({
      type: 'query_template',
      title: 'UniProt Query Syntax Guide',
      suggestion: `Common patterns:
- Field search: field:value (e.g., gene:BRCA1)
- Ranges: field:[min TO max] (e.g., length:[100 TO 500])
- Boolean: AND, OR, NOT (e.g., gene:BRCA1 AND organism_id:9606)
- Phrases: "exact phrase" (e.g., cc_function:"DNA repair")
- Wildcards: term* (e.g., kinase*)`,
      example: 'query: "organism_id:9606 AND reviewed:true AND gene:BRCA1"'
    });
    
    return suggestions;
  }

  private static getSQLStagingSuggestions(errorMessage: string, context: ErrorContext): ErrorSuggestion[] {
    const suggestions: ErrorSuggestion[] = [];
    
    if (errorMessage.includes('no such column')) {
      suggestions.push({
        type: 'query_template',
        title: 'Staged Data Query Help',
        suggestion: 'All UniProt data is stored as JSON in the "data" column. Use json_extract() to access fields.',
        example: `L SELECT accession FROM protein
 SELECT json_extract(data, '$.primaryAccession') as accession FROM protein

Common JSON paths:
- Accession: '$.primaryAccession'
- Gene: '$.genes[0].geneName.value'
- Length: '$.sequence.length'
- Function: '$.comments[0].texts[0].value'`
      });
      
      suggestions.push({
        type: 'alternative_approach',
        title: 'Check Schema First',
        suggestion: 'Use the schema operation to understand the data structure',
        example: 'operation: "schema", data_access_id: "your_id"'
      });
    }
    
    if (errorMessage.includes('bad JSON path') || errorMessage.includes('SQLITE_ERROR')) {
      suggestions.push({
        type: 'syntax_help',
        title: 'SQLite JSON Path Syntax',
        suggestion: 'SQLite uses simpler JSON path syntax than JSONPath. Avoid complex filters.',
        example: `L json_extract(data, '$.comments[?(@.commentType=="FUNCTION")]')
 Filter with WHERE clause instead:
 WHERE json_extract(data, '$.commentType') = 'FUNCTION'

Valid SQLite JSON paths:
- Simple: '$.fieldName'
- Array: '$.array[0]'
- Nested: '$.parent.child'
- NOT supported: JSONPath filters [?(...)]`
      });
    }
    
    if (errorMessage.includes('no such table')) {
      suggestions.push({
        type: 'alternative_approach',
        title: 'Data Staging Issue',
        suggestion: 'The data may not have been staged properly. Try re-running the original search or check if the data_access_id is correct.',
        example: 'Verify your data_access_id matches the one returned from the staging operation'
      });
    }
    
    return suggestions;
  }

  private static getNetworkErrorSuggestions(errorMessage: string, context: ErrorContext): ErrorSuggestion[] {
    const suggestions: ErrorSuggestion[] = [];
    
    if (context.httpStatus === 400) {
      suggestions.push({
        type: 'syntax_help',
        title: 'Bad Request (400)',
        suggestion: 'Check your query syntax and field names',
        example: 'Ensure all field names are valid and query syntax follows UniProt standards'
      });
    }
    
    if (context.httpStatus === 405) {
      if (context.toolName.includes('BLAST')) {
        suggestions.push({
          type: 'alternative_approach',
          title: 'BLAST Service Unavailable (405)',
          suggestion: 'BLAST service may be temporarily unavailable. Try alternative sequence search methods.',
          example: `Alternative approaches:
- Use sequence similarity search: query: "sequence:YOURSEQUENCE"
- Try exact sequence matching in regular search
- Use local alignment tools`
        });
      } else {
        suggestions.push({
          type: 'alternative_approach',
          title: 'Method Not Allowed (405)',
          suggestion: 'This endpoint may be temporarily unavailable or the service has changed',
          example: 'Try using alternative search methods or check service status'
        });
      }
    }
    
    if (context.httpStatus === 500) {
      suggestions.push({
        type: 'alternative_approach',
        title: 'Server Error (500)',
        suggestion: 'The UniProt service may be experiencing issues. Try again later or use smaller queries.',
        example: 'Reduce query complexity or size parameter'
      });
    }
    
    return suggestions;
  }

  private static getBLASTSuggestions(errorMessage: string, context: ErrorContext): ErrorSuggestion[] {
    const suggestions: ErrorSuggestion[] = [];
    
    if (errorMessage.includes('405') || errorMessage.includes('Not Allowed')) {
      suggestions.push({
        type: 'alternative_approach',
        title: 'BLAST Service Unavailable',
        suggestion: 'BLAST service may be temporarily unavailable. Try alternative sequence search methods.',
        example: `Alternative approaches:
- Use sequence similarity search: query: "sequence:MRWQEMGYIFYPRKLR"
- Try exact sequence matching in regular search
- Use local alignment tools`
      });
    }
    
    return suggestions;
  }

  private static findSimilarFields(field: string): string[] {
    const similar: string[] = [];
    const fieldLower = field.toLowerCase();
    
    for (const validField of this.UNIPROT_VALID_FIELDS) {
      if (validField.includes(fieldLower) || fieldLower.includes(validField)) {
        similar.push(validField);
      }
    }
    
    return similar.slice(0, 3); // Return top 3 matches
  }

  private static suggestJsonPath(columnName: string): string | null {
    const column = columnName.toLowerCase();
    
    // Common column name to JSON path mappings
    const pathMappings: { [key: string]: string } = {
      'accession': '$.primaryAccession',
      'gene': '$.genes[0].geneName.value',
      'gene_name': '$.genes[0].geneName.value',
      'protein_name': '$.proteinDescription.recommendedName.fullName.value',
      'length': '$.sequence.length',
      'sequence': '$.sequence.value',
      'organism': '$.organism.scientificName',
      'species': '$.organism.scientificName',
      'function': '$.comments[0].texts[0].value',
      'description': '$.proteinDescription.recommendedName.fullName.value'
    };
    
    return pathMappings[column] || null;
  }

  private static buildErrorResponse(enhancedError: EnhancedError): string {
    let response = `${enhancedError.context.toolName} Error: ${enhancedError.message}`;
    
    if (enhancedError.suggestions.length > 0) {
      response += '\n\n=� Helpful Hints:';
      
      for (const suggestion of enhancedError.suggestions) {
        response += `\n\n**${suggestion.title}:**\n${suggestion.suggestion}`;
        
        if (suggestion.example) {
          response += `\n\n\`\`\`\n${suggestion.example}\n\`\`\``;
        }
      }
    }
    
    return response;
  }
}

export class StagingGuideFormatter {
  static formatSchemaWithGuide(schema: any, dataAccessId: string): string {
    let response = `**Dataset Schema** for \`${dataAccessId}\`:\n\n`;
    
    // Add JSON path guide first
    response += `=� **Common JSON Extraction Patterns:**\n`;
    response += `- Accession: \`json_extract(data, '$.primaryAccession')\`\n`;
    response += `- Gene Name: \`json_extract(data, '$.genes[0].geneName.value')\`\n`;
    response += `- Protein Name: \`json_extract(data, '$.proteinDescription.recommendedName.fullName.value')\`\n`;
    response += `- Sequence: \`json_extract(data, '$.sequence.value')\`\n`;
    response += `- Length: \`json_extract(data, '$.sequence.length')\`\n`;
    response += `- Organism: \`json_extract(data, '$.organism.scientificName')\`\n\n`;
    
    // Add query template
    response += `= **Query Template:**\n`;
    response += `\`\`\`sql\n`;
    response += `SELECT \n`;
    response += `  json_extract(data, '$.primaryAccession') as accession,\n`;
    response += `  json_extract(data, '$.genes[0].geneName.value') as gene_name\n`;
    response += `FROM protein \n`;
    response += `WHERE json_extract(data, '$.organism.scientificName') = 'Homo sapiens'\n`;
    response += `LIMIT 10;\n`;
    response += `\`\`\`\n\n`;
    
    // Add the actual schema
    response += `=� **Schema Details:**\n`;
    response += JSON.stringify(schema, null, 2);
    
    return response;
  }
}