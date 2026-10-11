export const CREDENTIAL_TYPES = ['claude-oauth-token', 'anthropic-api-key'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

/** Prefix check only — the real validation is a test call (POST /ai/credentials/test). */
export const CREDENTIAL_FORMATS: Record<CredentialType, RegExp> = {
  'claude-oauth-token': /^sk-ant-oat[0-9]{2}-[A-Za-z0-9_-]{20,}$/,
  'anthropic-api-key': /^sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}$/,
};

export interface CredentialStatus {
  type: CredentialType;
  /** e.g. "…a1B2" */
  hint: string;
  updatedAt: Date;
}

export const AI_ERROR_CODES = {
  credentialsRequired: 'AI_CREDENTIALS_REQUIRED',
  credentialsInvalid: 'AI_CREDENTIALS_INVALID',
  busy: 'AI_BUSY',
} as const;
