export interface VerifiablePresentation {
  '@context': string[];
  id: string;
  type: string[];
  holder: HolderCnf;
  verifiableCredential: string[];
}

export interface HolderCnf {
  [key: string]: unknown;
}

export type DescriptorMap = {
  format: string;
  path: string;
  id: string;
  path_nested?: DescriptorMap | null;
};

export type PresentationSubmission = {
  id: string;
  definition_id: string;
  descriptor_map: DescriptorMap[];
};