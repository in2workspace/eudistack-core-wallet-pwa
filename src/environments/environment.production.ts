// this file is the used when deploying (see Dockerfile);
// its values will be overwriten by env variables (see env.js & env.template.js)
export const environment = {
  production: true,
  server_url: window["env"]["server_url"] || "", // REQUIRED
  websocket_url: window["env"]["websocket_url"], // REQUIRED
  logs_enabled: window["env"]["logs_enabled"] === "true", //OPTIONAL WITH fallback
  wallet_mode: window["env"]["wallet_mode"] || 'browser', // OPTIONAL with fallback
  preferred_grant: window["env"]["preferred_grant"] || 'auto', // 'auto' | 'pre-authorized_code' | 'authorization_code'
  // Derived from the current browser origin so the same build works across tenants
  // (sandbox/kpmg/dome/…). Explicit override via env.js still wins if non-empty.
  oid4vci_redirect_uri: window["env"]["oid4vci_redirect_uri"] || `${window.location.origin}/wallet/callback`,
  wia: window["env"]["wia"] || '',
  wia_instance_key_jwk: window["env"]["wia_instance_key_jwk"] || '',
  appVersion: '3.0.0',
};
