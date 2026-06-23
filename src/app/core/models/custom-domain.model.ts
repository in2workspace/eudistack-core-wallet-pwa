export interface CustomDomainEntry {
  tenantId: string;
  envId: string;
}

export interface CustomDomainEnv {
  issuer: string;
  verifier: string;
  wallet: string;
}

export interface CustomDomainConfig {
  domains: Record<string, CustomDomainEntry>;
  env: Record<string, CustomDomainEnv>;
}
