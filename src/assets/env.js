(function (window) {
  window.env = window.env || {};

  // Environment variables
  window["env"]["server_url"] = "http://localhost:8083";
  window["env"]["websocket_url"] = "ws://localhost:8083";

  window["env"]["logs_enabled"] = "false";
  window["env"]["primary"] = "#001E8C";
  window["env"]["primary_contrast"] = "#ffffff";
  window["env"]["secondary"] = "#132153";
  window["env"]["secondary_contrast"] = "#ffffff";
  window["env"]["assets_base_url"]= "assets";
  window["env"]["logo_path"]= "logos/altia-logo.svg";
  window["env"]["favicon_path"]= "icons/altia-favicon.png";
  window["env"]["default_lang"] =  "es";
  window["env"]["wallet_mode"] = "";
  window["env"]["preferred_grant"] = "auto";
  window["env"]["oid4vci_redirect_uri"] = "http://localhost/callback";
  window["env"]["wia"] = "eyJhbGciOiJFUzI1NiIsInR5cCI6IndhbGxldC1hdHRlc3RhdGlvbitqd3QifQ.eyJpc3MiOiJkZXYtd2FsbGV0LXByb3ZpZGVyIiwic3ViIjoiZXVkaXN0YWNrLXdhbGxldCIsImlhdCI6MTc3MjUyODY1MCwiZXhwIjoxODA0MDY0NjUwLCJjbmYiOnsiandrIjp7Imt0eSI6IkVDIiwiY3J2IjoiUC0yNTYiLCJ4IjoiRXdEd1NSYmpaNWRtNlJPYVVyZXVTaGszX3VNc3RQR2NrN1RaQW9kaHNBVSIsInkiOiI5VFBuN1lCdVFxOXd5SVhjVHdnbFljTmZlbHQ4UEJjbUYwQTR0N1h0MTdFIn19fQ.N94-hIxp7n55y6L_uZQ_dCod5xsTMQ5JID_BwZjJyDhDJIcCCTBUollyb7cfjO29wVhlgsliurCyEGAFuWOqTA";
  window["env"]["wia_instance_key_jwk"] = '{"kty":"EC","crv":"P-256","x":"EwDwSRbjZ5dm6ROaUreuShk3_uMstPGck7TZAodhsAU","y":"9TPn7YBuQq9wyIXcTwglYcNfelt8PBcmF0A4t7Xt17E","d":"ccj3b6F3ZJm8Zo6CSvsqHTUSQjq2JTpRVY1ugEVKtOw"}';
})(this);
