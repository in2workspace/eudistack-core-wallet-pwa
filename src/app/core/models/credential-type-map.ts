import { CredentialType } from "./verifiable-credential";

export interface CredentialMapConfig {
  icon: string;
}

export const CredentialTypeMap: Record<CredentialType, CredentialMapConfig> = {
  'LEARCredentialEmployee':        { icon: 'assets/icons/LearCredentialEmployee.png' },
  'LEARCredentialMachine':         { icon: 'assets/icons/LearCredentialMachine.png' },
  'learcredential.employee.w3c.4': { icon: 'assets/icons/LearCredentialEmployee.png' },
  'learcredential.employee.sd.1':  { icon: 'assets/icons/LearCredentialEmployee.png' },
  'learcredential.machine.w3c.3':  { icon: 'assets/icons/LearCredentialMachine.png' },
  'learcredential.machine.sd.1':   { icon: 'assets/icons/LearCredentialMachine.png' },
  'gx.labelcredential.w3c.2':      { icon: 'assets/icons/LabelCredential.png' },
  'urn:es.cgcom:doctorid:1':       { icon: 'assets/icons/LearCredentialEmployee.png' },
};
