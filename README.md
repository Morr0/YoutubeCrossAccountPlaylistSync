## YouTube Playlist Sync Worker

JavaScript Cloudflare Worker that mirrors videos from YouTube playlist **A** into playlist **B** every 5 minutes using the YouTube Data API v3.

### Files

- `wrangler.toml` – Worker configuration, cron schedule, and basic environment variables.
- `src/worker.js` – Worker entry point (HTTP + scheduled handlers, sync logic).
- `tools/get-youtube-refresh-token.js` – One-time local helper to obtain a YouTube OAuth refresh token.

### One-time OAuth setup

1. In **Google Cloud Console**, create a project and enable **YouTube Data API v3**.
2. Create an **OAuth 2.0 Client ID** for a **Web application**.
3. Set an authorized redirect URI to `http://localhost:3000/oauth2callback`.
4. Export your credentials when running the helper:

   ```bash
   export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   export GOOGLE_CLIENT_SECRET="your-client-secret"
   node tools/get-youtube-refresh-token.js
   ```

5. Open the URL printed in the terminal, grant access, and when redirected back the script will print a JSON blob containing a **refresh_token**.
6. Save the refresh token and configure it as a Cloudflare secret (see below).

### Cloudflare configuration & deployment

1. Install the Cloudflare CLI:

   ```bash
   npm install -g wrangler
   ```

2. Login (once):

   ```bash
   wrangler login
   ```

3. Set secrets:

   ```bash
   wrangler secret put YOUTUBE_CLIENT_ID
   wrangler secret put YOUTUBE_CLIENT_SECRET
   wrangler secret put YOUTUBE_REFRESH_TOKEN
   ```

4. Edit `wrangler.toml` and set `PLAYLIST_A_ID` and `PLAYLIST_B_ID`.
5. Deploy:

   ```bash
   wrangler deploy
   ```

6. Local test with a small playlist pair:
   - Temporarily set `DRY_RUN = "true"` in `wrangler.toml` so no real changes are applied.
   - Run:

     ```bash
     wrangler dev
     ```

   - In another terminal, trigger a one-off sync:

     ```bash
     curl -X POST http://127.0.0.1:8787/run-once
     ```

   - Confirm the JSON response shows the expected `toAdd` / `toRemove` counts and that logs match your playlists.

7. Production verification:
   - Set `DRY_RUN = "false"` once you are confident in the diff.
   - Hit the worker URL in a browser or via `curl` to confirm it responds.
   - Check the **Cron Triggers** and logs in the Cloudflare dashboard to ensure scheduled runs are happening every 5 minutes and that adds/removes look correct.


