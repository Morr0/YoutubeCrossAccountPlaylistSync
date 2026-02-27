## YouTube Playlist Sync Worker

JavaScript Cloudflare Worker that mirrors videos from YouTube playlist **A** into playlist **B** every 5 minutes using the YouTube Data API v3.

### Channels and playlists

- `PLAYLIST_A_ID` should be a playlist on **channel A**.
- `PLAYLIST_B_ID` should be a playlist on **channel B**.
- The simplest setup is when both channels are managed by the **same Google account** you use when running `tools/get-youtube-refresh-token.js` (you can switch between channels in YouTube Studio under that account), but you can also use **two different Google accounts** (see below).

To get a playlist ID:

- Open the playlist in your browser.
- Copy the value of the `list` query parameter from the URL (it usually starts with `PL...`).
- Paste that value into `PLAYLIST_A_ID` or `PLAYLIST_B_ID` in `wrangler.toml`.

> Note: A and B can be on **different channels** as long as both channels are owned/managed by the same Google account. The worker will then mirror videos from playlist A (channel A) into playlist B (channel B).

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

If you want to use **two different Google accounts** (one primarily associated with playlist A and another with playlist B), you can run the helper twice:

- First time (primary account, used for playlist A and as default for everything):
  - Log into the browser with the Google account that should own/manage playlist A.
  - Run the helper and save the `refresh_token` as `YOUTUBE_REFRESH_TOKEN`.
- Second time (account that owns playlist B):
  - Log out, then log into the browser with the Google account that owns playlist B.
  - Optionally create a second OAuth client in Google Cloud for this account.
  - Run the helper again and save the new `refresh_token` as `YOUTUBE_B_REFRESH_TOKEN`.

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
   # Optional: second account specifically for playlist B
   wrangler secret put YOUTUBE_B_CLIENT_ID
   wrangler secret put YOUTUBE_B_CLIENT_SECRET
   wrangler secret put YOUTUBE_B_REFRESH_TOKEN
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

### Recommended two-channel setup

1. Make sure both **channel A** and **channel B** appear under the **same Google account** (you can switch channels in YouTube Studio without signing out).
2. On channel A, create or choose the playlist you want to mirror from and set its ID as `PLAYLIST_A_ID`.
3. On channel B, create or choose the playlist you want to mirror into and set its ID as `PLAYLIST_B_ID`.
4. Run with `DRY_RUN = "true"` and trigger a sync (`wrangler dev` + `POST /run-once`) to confirm logs show the correct playlist IDs and expected adds/removes only on playlist B.
5. When satisfied, set `DRY_RUN = "false"` and redeploy.



