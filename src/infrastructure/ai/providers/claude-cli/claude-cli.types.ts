// Subset of `claude -p --output-format json` output we rely on.
export interface ClaudeCliJsonResult {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result?: string;
  duration_ms?: number;
}
