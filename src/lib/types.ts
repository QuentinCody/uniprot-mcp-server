export interface ErrorContext {
  toolName: string;
  operation: string;
  userInput?: any;
  httpStatus?: number;
  originalError: string;
}

export interface ErrorSuggestion {
  type: 'field_correction' | 'syntax_help' | 'query_template' | 'alternative_approach';
  title: string;
  suggestion: string;
  example?: string;
}

export interface EnhancedError {
  message: string;
  suggestions: ErrorSuggestion[];
  context: ErrorContext;
}

export interface FieldValidation {
  validFields: string[];
  invalidFields: string[];
  suggestions: Record<string, string[]>;
}

export interface QuerySyntaxGuide {
  pattern: RegExp;
  errorType: string;
  correction: string;
  examples: string[];
}