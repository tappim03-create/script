// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(helmet());
app.use(bodyParser.json());

// Basic rate limiter for public endpoints
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30,             // limit each IP to 30 requests per windowMs
});
app.use(limiter);

const STORE_FILE = path.join(__dirname, 'keys.json');
fs.ensureFileSync(STORE_FILE);

// Load store
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    if (!raw) return {};
    return JSON.parse(raw || "{}");
  } catch (e) {
    return {};
  }
}
function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// env secret
const CLAIM_SECRET = process.env.CLAIM_SECRET || "changeme_in_prod"; // set as env var in deployment

// Utils
function genKey() {
  return uuidv4().slice(0, 8).toUpperCase(); // short human-friendly key
}

/*
Data model:
store = {
  links: {
    "<linkId>": { key: "<KEY>", createdAt: 123, claimed: false, claimedBy: null, claimedAt: null, reward: {...} }
  },
  keys: { "<KEY>": "<linkId>" } // reverse lookup
}
*/

// Create or return key for a given linkId (public)
app.get('/key/:linkId', (req, res) => {
  const linkId = req.params.linkId;
  if (!linkId) return res.status(400).json({ ok: false, err: 'missing_link' });

  const store = loadStore();
  store.links = store.links || {};
  store.keys = store.keys || {};

  // If a key exists for this link, return it
  if (store.links[linkId] && store.links[linkId].key) {
    const entry = store.links[linkId];
    return res.json({
      ok: true,
      key: entry.key,
      claimed: !!entry.claimed,
      reward: entry.reward || null
    });
  }

  // Otherwise generate a new key and store
  const newKey = genKey();
  store.links[linkId] = {
    key: newKey,
    createdAt: Date.now(),
    claimed: false,
    claimedBy: null,
    claimedAt: null,
    reward: { coins: 100 } // default reward (customize per link if desired)
  };
  store.keys = store.keys || {};
  store.keys[newKey] = linkId;

  saveStore(store);
  return res.json({
    ok: true,
    key: newKey,
    claimed: false,
    reward: store.links[linkId].reward
  });
});

// Protected claim endpoint: Roblox server calls this to atomically claim the key.
// Body: { key: "<KEY>", userId: <RobloxUserId> }
// Header must include: x-server-secret: <CLAIM_SECRET>
app.post('/claim', (req, res) => {
  const headerSecret = req.header('x-server-secret');
  if (!headerSecret || headerSecret !== CLAIM_SECRET) {
    return res.status(403).json({ ok: false, err: 'forbidden' });
  }

  const key = (req.body.key || "").toString().toUpperCase();
  const userId = req.body.userId;

  if (!key || !userId) return res.status(400).json({ ok: false, err: 'missing_params' });

  const store = loadStore();
  store.links = store.links || {};
  store.keys = store.keys || {};

  const linkId = store.keys[key];
  if (!linkId) {
    return res.status(404).json({ ok: false, err: 'key_not_found' });
  }

  const entry = store.links[linkId];
  if (!entry) {
    return res.status(404).json({ ok: false, err: 'key_entry_missing' });
  }

  if (entry.claimed) {
    return res.json({ ok: false, err: 'already_claimed', claimedBy: entry.claimedBy });
  }

  // Atomically mark claimed
  entry.claimed = true;
  entry.claimedBy = userId;
  entry.claimedAt = Date.now();

  store.links[linkId] = entry;
  saveStore(store);

  return res.json({ ok: true, msg: 'claimed', reward: entry.reward });
});

// Admin endpoint to pre-create a key for a link (protected by same secret).
// Body: { linkId: "abc", reward: { coins: 200 } }
app.post('/create', (req, res) => {
  const headerSecret = req.header('x-server-secret');
  if (!headerSecret || headerSecret !== CLAIM_SECRET) {
    return res.status(403).json({ ok: false, err: 'forbidden' });
  }
  const linkId = req.body.linkId || uuidv4().slice(0,6);
  const reward = req.body.reward || { coins: 100 };

  const store = loadStore();
  store.links = store.links || {};
  store.keys = store.keys || {};

  if (store.links[linkId] && store.links[linkId].key) {
    return res.json({ ok: false, err: 'link_exists', key: store.links[linkId].key });
  }

  const newKey = genKey();
  store.links[linkId] = {
    key: newKey,
    createdAt: Date.now(),
    claimed: false,
    claimedBy: null,
    claimedAt: null,
    reward = reward
  };
  store.keys = store.keys || {};
  store.keys[newKey] = linkId;

  saveStore(store);
  return res.json({ ok: true, linkId, key: newKey, reward });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Key server listening on port', PORT);
});
