const YT_BASE_URL = "https://www.googleapis.com/youtube/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Fetch a fresh access token using a refresh token.
 *
 * By default, this uses the primary YouTube OAuth credentials:
 *   - YOUTUBE_CLIENT_ID
 *   - YOUTUBE_CLIENT_SECRET
 *   - YOUTUBE_REFRESH_TOKEN
 *
 * You can override any of these via the `overrides` parameter, which allows
 * you to use a second account (for example, for playlist B).
 */
async function getAccessToken(env, overrides = {}) {
  const clientId = overrides.clientId ?? env.YOUTUBE_CLIENT_ID;
  const clientSecret = overrides.clientSecret ?? env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = overrides.refreshToken ?? env.YOUTUBE_REFRESH_TOKEN;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${res.statusText} – ${text}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error("No access_token in token response");
  }

  return json.access_token;
}

/**
 * Lightweight retry helper with exponential backoff for transient failures.
 */
async function withRetry(fn, { attempts = 3, baseDelayMs = 250 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const delay = baseDelayMs * 2 ** i;
      console.warn(`Attempt ${i + 1} failed:`, err?.message ?? err);
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Fetch all items for a playlist, returning an array of
 *   { videoId, playlistItemId }
 */
async function listPlaylistItems(env, accessToken, playlistId) {
  const items = [];
  let pageToken;

  // Loop until no nextPageToken – YouTube caps maxResults at 50.
  for (let i = 0; i < 100; i++) {
    const params = new URLSearchParams({
      playlistId,
      part: "contentDetails",
      maxResults: "50",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const url = `${YT_BASE_URL}/playlistItems?${params.toString()}`;

    const res = await withRetry(() =>
      fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      }),
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to list playlistItems: ${res.status} ${res.statusText} – ${text}`);
    }

    const json = await res.json();
    if (Array.isArray(json.items)) {
      for (const item of json.items) {
        const videoId = item?.contentDetails?.videoId;
        const playlistItemId = item?.id;
        if (videoId) {
          items.push({ videoId, playlistItemId });
        }
      }
    }

    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  return items;
}

async function insertPlaylistItem(env, accessToken, playlistId, videoId) {
  const url = `${YT_BASE_URL}/playlistItems?part=snippet`;
  const body = {
    snippet: {
      playlistId,
      resourceId: {
        kind: "youtube#video",
        videoId,
      },
    },
  };

  const res = await withRetry(() =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to insert playlist item for ${videoId}: ${res.status} ${res.statusText} – ${text}`);
  }
}

async function deletePlaylistItem(env, accessToken, playlistItemId) {
  const url = `${YT_BASE_URL}/playlistItems?id=${encodeURIComponent(playlistItemId)}`;

  const res = await withRetry(() =>
    fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }),
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete playlist item ${playlistItemId}: ${res.status} ${res.statusText} – ${text}`);
  }
}

/**
 * Compute the diff between source and destination playlists.
 * Returns:
 *   { toAdd: string[], toRemove: { videoId, playlistItemId }[] }
 */
function computeDiff(sourceItems, destItems) {
  const sourceSet = new Set(sourceItems.map((i) => i.videoId));
  const destSet = new Set(destItems.map((i) => i.videoId));

  const toAdd = [];
  for (const item of sourceItems) {
    if (!destSet.has(item.videoId)) {
      toAdd.push(item.videoId);
    }
  }

  const toRemove = [];
  for (const item of destItems) {
    if (!sourceSet.has(item.videoId)) {
      toRemove.push(item);
    }
  }

  return { toAdd, toRemove };
}

async function syncPlaylists(env) {
  const dryRun = String(env.DRY_RUN ?? "false").toLowerCase() === "true";

  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.YOUTUBE_REFRESH_TOKEN) {
    throw new Error("Missing YouTube OAuth secrets (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN)");
  }

  if (!env.PLAYLIST_A_ID || !env.PLAYLIST_B_ID) {
    throw new Error("PLAYLIST_A_ID and PLAYLIST_B_ID must be set in wrangler.toml or environment variables.");
  }

  if (env.PLAYLIST_A_ID === env.PLAYLIST_B_ID) {
    console.error(
      "Configuration error: PLAYLIST_A_ID and PLAYLIST_B_ID are identical. " +
        "Playlist A (source) and playlist B (destination) must be different playlists.",
    );
    return { added: 0, removed: 0, dryRun, skipped: true, reason: "PLAYLIST_IDS_IDENTICAL" };
  }

  console.log(
    "Starting playlist sync with configuration:",
    JSON.stringify(
      {
        playlistAId: env.PLAYLIST_A_ID,
        playlistBId: env.PLAYLIST_B_ID,
        dryRun,
      },
      null,
      2,
    ),
  );

  // Primary account (typically used for playlist A).
  const accessTokenA = await getAccessToken(env);

  // Optional second account for playlist B:
  // If YOUTUBE_B_REFRESH_TOKEN is set, we use it (and optionally
  // YOUTUBE_B_CLIENT_ID / YOUTUBE_B_CLIENT_SECRET); otherwise we fall
  // back to the primary account token.
  const useSeparateAccountForB = Boolean(env.YOUTUBE_B_REFRESH_TOKEN);

  const accessTokenB = useSeparateAccountForB
    ? await getAccessToken(env, {
        clientId: env.YOUTUBE_B_CLIENT_ID ?? env.YOUTUBE_CLIENT_ID,
        clientSecret: env.YOUTUBE_B_CLIENT_SECRET ?? env.YOUTUBE_CLIENT_SECRET,
        refreshToken: env.YOUTUBE_B_REFRESH_TOKEN,
      })
    : accessTokenA;

  if (useSeparateAccountForB) {
    console.log("Using a separate Google account for playlist B operations (YOUTUBE_B_* credentials).");
  }

  const [sourceItems, destItems] = await Promise.all([
    listPlaylistItems(env, accessTokenA, env.PLAYLIST_A_ID),
    listPlaylistItems(env, accessTokenB, env.PLAYLIST_B_ID),
  ]);

  console.log(`Fetched ${sourceItems.length} items from playlist A and ${destItems.length} from playlist B.`);

  const { toAdd, toRemove } = computeDiff(sourceItems, destItems);

  console.log(`Diff computed – to add: ${toAdd.length}, to remove: ${toRemove.length}. DRY_RUN=${dryRun}`);

  if (dryRun) {
    console.log("Dry run mode – not applying any changes.");
    if (toAdd.length) {
      console.log("Would add videoIds:", toAdd);
    }
    if (toRemove.length) {
      console.log(
        "Would remove playlist items:",
        toRemove.map((i) => ({ videoId: i.videoId, playlistItemId: i.playlistItemId })),
      );
    }
    return { added: 0, removed: 0, dryRun: true };
  }

  let added = 0;
  let removed = 0;

  for (const videoId of toAdd) {
    await insertPlaylistItem(env, accessTokenB, env.PLAYLIST_B_ID, videoId);
    added++;
  }

  for (const item of toRemove) {
    if (item.playlistItemId) {
      await deletePlaylistItem(env, accessTokenB, item.playlistItemId);
      removed++;
    }
  }

  console.log(`Sync complete – added ${added}, removed ${removed}`);
  return { added, removed, dryRun: false };
}

export default {
  /**
   * HTTP handler – useful for local testing with `wrangler dev`.
   *
   * - GET /          → health/status
   * - POST /run-once → trigger one sync run on demand
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/run-once") {
      try {
        const result = await syncPlaylists(env);
        return new Response(JSON.stringify({ ok: true, ...result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        console.error("Manual sync failed:", err);
        return new Response(JSON.stringify({ ok: false, error: err?.message ?? String(err) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        message: "YouTube playlist sync worker is deployed.",
        endpoints: {
          runOnce: "POST /run-once",
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  },

  /**
   * Scheduled handler – Cloudflare will invoke this using the cron schedule
   * defined in `wrangler.toml`.
   */
  async scheduled(event, env, ctx) {
    try {
      console.log("Scheduled playlist sync tick at", new Date().toISOString());
      const result = await syncPlaylists(env);
      console.log("Scheduled sync result:", result);
    } catch (err) {
      console.error("Scheduled sync failed:", err);
    }
  },
};

