import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(express.json());

const config = {
  channelId: process.env.THINGSPEAK_CHANNEL_ID || "3281642",
  readApiKey: process.env.THINGSPEAK_READ_API_KEY || "",
};

const isValidReadApiKey = (key) => /^[A-Za-z0-9]{16}$/.test(key);

const buildThingSpeakUrl = (channelId, readApiKey, results = 30) => {
  const base = `https://api.thingspeak.com/channels/${channelId}/feeds.json?results=${results}`;
  return readApiKey ? `${base}&api_key=${encodeURIComponent(readApiKey)}` : base;
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, channelId: config.channelId, hasReadApiKey: Boolean(config.readApiKey) });
});

app.post("/api/config", async (req, res) => {
  const { channelId, readApiKey } = req.body || {};

  if (!channelId || typeof channelId !== "string" || !/^\d+$/.test(channelId.trim())) {
    return res.status(400).json({ ok: false, error: "Channel ID must be numeric." });
  }

  if (!readApiKey || typeof readApiKey !== "string" || !isValidReadApiKey(readApiKey.trim())) {
    return res.status(400).json({
      ok: false,
      error: "Invalid Read API Key. Expected exactly 16 alphanumeric characters.",
    });
  }

  const cleanChannelId = channelId.trim();
  const cleanKey = readApiKey.trim();

  // --- Server-side secret comparison (primary gate) ---
  // If the server has a pre-configured authorized API key in .env,
  // the submitted key must match EXACTLY. This is the real authentication
  // for public ThingSpeak channels (which accept any key from ThingSpeak's side).
  const authorizedKey = process.env.THINGSPEAK_READ_API_KEY;
  const authorizedChannelId = process.env.THINGSPEAK_CHANNEL_ID;

  if (authorizedKey && cleanKey !== authorizedKey) {
    return res.status(401).json({ ok: false, error: "Authentication failed. The Read API Key is incorrect." });
  }
  if (authorizedChannelId && cleanChannelId !== authorizedChannelId) {
    return res.status(401).json({ ok: false, error: "Authentication failed. The Channel ID is incorrect." });
  }

  // --- ThingSpeak connectivity check (secondary gate) ---
  // Confirms the channel exists and the key works against ThingSpeak.
  // For PRIVATE channels, ThingSpeak also enforces the key here.
  try {
    const testUrl = `https://api.thingspeak.com/channels/${encodeURIComponent(cleanChannelId)}/feeds.json?results=1&api_key=${encodeURIComponent(cleanKey)}`;
    const tsResponse = await fetch(testUrl);

    if (tsResponse.status === 404) {
      return res.status(400).json({ ok: false, error: "Channel not found. Check your Channel ID." });
    }
    if (!tsResponse.ok) {
      return res.status(400).json({ ok: false, error: `ThingSpeak rejected the request (HTTP ${tsResponse.status}).` });
    }

    let tsData;
    try {
      tsData = await tsResponse.json();
    } catch {
      return res.status(400).json({ ok: false, error: "ThingSpeak returned unreadable data." });
    }

    // ThingSpeak signals auth failure with {"status":"0"} or {"error":"..."}
    if (tsData.status === "0" || tsData.error) {
      return res.status(401).json({ ok: false, error: "Authentication failed. Channel ID or Read API Key is incorrect." });
    }

    if (!tsData.channel) {
      return res.status(400).json({ ok: false, error: "Could not verify channel. Check your Channel ID and API Key." });
    }
  } catch (fetchError) {
    return res.status(503).json({ ok: false, error: "Could not reach ThingSpeak to verify credentials. Check your internet connection." });
  }

  config.channelId = cleanChannelId;
  config.readApiKey = cleanKey;

  return res.json({ ok: true, channelId: config.channelId, hasReadApiKey: true });
});

app.get("/api/feeds", async (req, res) => {
  try {
    const results = Number(req.query.results || 30);
    const safeResults = Number.isFinite(results) ? Math.min(Math.max(results, 1), 200) : 30;
    const url = buildThingSpeakUrl(config.channelId, config.readApiKey, safeResults);

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: "ThingSpeak request failed" });
    }

    const payload = await response.json();
    return res.json({ ok: true, channelId: config.channelId, feeds: payload.feeds || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Server failed to fetch ThingSpeak data" });
  }
});

app.listen(PORT, () => {
  console.log(`ThingSpeak proxy API running on http://localhost:${PORT}`);
});
