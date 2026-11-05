// AIPowerSalon — runtime API origin. Edit this one line on your server at deploy time; NO rebuild needed.
//   ""                         → call the API on the SAME origin this app is served from (default: dist/ hosted behind the API)
//   "https://api.yoursalon.com" → point this app at a separately-hosted backend
// This file is copied verbatim into dist/ (never bundled/hashed), so you can change it post-build per environment.
window.APS_API_BASE = "https://app.aipowersalon.com:3000";
