(function (window) {
  window.env = window.env || {};

  // Wallet API: same-origin proxy mode (Atlassian-style). Empty strings force the
  // runtime fallback in environment.production.ts to derive the URL from
  // window.location, so the same bundle works across tenants.
  window["env"]["server_url"] = "";
  window["env"]["websocket_url"] = "";
  window["env"]["logs_enabled"] = "${LOGS_ENABLED}";
  window["env"]["wallet_mode"] = "${WALLET_MODE}";
  window["env"]["preferred_grant"] = "${PREFERRED_GRANT}";
  window["env"]["oid4vci_redirect_uri"] = "";
  window["env"]["wia"] = "${WIA}";
  window["env"]["wia_instance_key_jwk"] = '${WIA_INSTANCE_KEY_JWK}';
})(this);
