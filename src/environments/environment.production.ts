// this file is the used when deploying (see Dockerfile);
// its values will be overwriten by env variables (see env.js & env.template.js)
export const environment = {
  production: true,
  server_url: window["env"]["server_url"] || "", // REQUIRED
  websocket_url: window["env"]["websocket_url"], // REQUIRED
  logs_enabled: window["env"]["logs_enabled"] === "true" || false, //OPTIONAL WITH fallback
  wallet_mode: window["env"]["wallet_mode"] || 'browser', // OPTIONAL with fallback
  preferred_grant: window["env"]["preferred_grant"] || 'auto', // 'auto' | 'pre-authorized_code' | 'authorization_code'
  oid4vci_redirect_uri: window["env"]["oid4vci_redirect_uri"] || 'http://localhost/callback',
  wia: window["env"]["wia"] || '',
  wia_instance_key_jwk: window["env"]["wia_instance_key_jwk"] || '',
  appVersion: '3.0.0',
};
