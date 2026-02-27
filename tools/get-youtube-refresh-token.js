/**
 * One-time local helper to obtain a YouTube OAuth refresh token.
 *
 * Usage:
 *   1. Create an OAuth 2.0 client in Google Cloud Console (Web application).
 *   2. Set the redirect URI to: http://localhost:3000/oauth2callback
 *   3. Set the environment variables below (or edit the defaults):
 *      - GOOGLE_CLIENT_ID
 *      - GOOGLE_CLIENT_SECRET
 *   4. Run: node tools/get-youtube-refresh-token.js
 *   5. Open the printed URL, grant access, then copy the printed refresh token.
 */

import http from "node:http";
import { URL } from "node:url";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "YOUR_CLIENT_ID_HERE";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "YOUR_CLIENT_SECRET_HERE";
const REDIRECT_URI = "http://localhost:3000/oauth2callback";

const SCOPES = [
  // Read/write access to manage your YouTube account (public resources).
  "https://www.googleapis.com/auth/youtube",
];

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES.join(" "),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to exchange code: ${res.status} ${res.statusText} – ${text}`);
  }

  return res.json();
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing URL");
        return;
      }

      const url = new URL(req.url, REDIRECT_URI);

      if (url.pathname !== "/oauth2callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.statusCode = 400;
        res.end(`Error from Google OAuth: ${error}`);
        console.error("OAuth error:", error);
        return;
      }

      if (!code) {
        res.statusCode = 400;
        res.end("Missing ?code parameter");
        return;
      }

      console.log("Received authorization code, exchanging for tokens...");
      const tokens = await exchangeCodeForTokens(code);

      console.log("\n=== OAuth tokens ===");
      console.log(JSON.stringify(tokens, null, 2));

      if (tokens.refresh_token) {
        console.log("\n=== Save this refresh token as a Cloudflare secret ===");
        console.log("YOUTUBE_REFRESH_TOKEN =", tokens.refresh_token);
      } else {
        console.warn("\nNo refresh_token returned. Ensure you requested 'offline' access and used 'prompt=consent'.");
      }

      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("You can close this tab now. Check your terminal for the tokens.");

      server.close();
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end("Internal error, see terminal.");
    }
  });

  server.listen(3000, () => {
    console.log("OAuth callback server listening on http://localhost:3000");
    console.log("Open this URL in your browser to authorize:\n");
    console.log(getAuthUrl());
  });
}

if (!CLIENT_ID || CLIENT_ID === "YOUR_CLIENT_ID_HERE" || !CLIENT_SECRET || CLIENT_SECRET === "YOUR_CLIENT_SECRET_HERE") {
  console.error(
    "Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables or edit the script with your credentials.",
  );
  process.exit(1);
}

startServer();

