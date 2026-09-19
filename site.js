const axios = require('axios');
const express = require('express');
const path = require('path');
const app = express();

const KEY = "Bot k1oSnRxJULXoL5KZ2PAxXj0M2MU3QdFY4ZzMl5vHd3Pte4JXvimea3XmvhqpkNph";
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cache = { items: [], bodyPaints: [], bundles: [], fullBundles: [], tags: {}, loaded: false };

async function wapi(p) {
  try {
    const r = await axios.get(`https://api.wolvesville.com${p}`, { headers: { Authorization: KEY } });
    return r.data;
  } catch(e) { return null; }
}

async function loadCache() {
  console.log('⏳ Yükleniyor...');
  const [items, bodyPaints, bundles, fullBundles, tags] = await Promise.all([
    wapi('/items/avatarItems'),
    wapi('/items/bodyPaints'),
    wapi('/items/avatarItemSets'),
    wapi('/items/bundles'),
    wapi('/items/tags')
  ]);
  cache.items = items || [];
  cache.bodyPaints = bodyPaints || [];
  cache.bundles = bundles || [];
  cache.fullBundles = fullBundles || [];
  cache.tags = {};
  (tags || []).forEach(t => {
    const origin = t.tags.find(x => x.startsWith('origin:'));
    const colors = t.tags.filter(x => x.startsWith('color:')).map(x => x.replace('color:',''));
    cache.tags[t.avatarItemId] = { origin: origin || null, colors };
  });
  cache.loaded = true;
  console.log(`✅ ${cache.items.length} item, ${cache.bodyPaints.length} boya, ${cache.bundles.length} bundle`);
}

function parseOrigin(origin) {
  if (!origin) return null;
  const o = origin.replace('origin:', '');
  if (o.startsWith('calendar:')) return { type: 'TAKVİM', name: o.replace('calendar:', '').replace(/_/g, ' ').toUpperCase() };
  if (o.startsWith('collection_outfits:')) return { type: 'KOLEKSİYON', name: o.replace('collection_outfits:', '').replace(/_/g, ' ').toUpperCase() };
  if (o === 'offer_avatar_item_set') return { type: 'SKİN PAKETİ', name: 'MAĞAZA' };
  if (o.startsWith('clan_')) return { type: 'KLAN', name: o.replace(/_/g, ' ').toUpperCase() };
  if (o.startsWith('role_card')) return { type: 'ROL KARTI', name: o.replace(/_/g, ' ').toUpperCase() };
  if (o.startsWith('daily')) return { type: 'GÜNLÜK TEKLİF', name: o.replace(/_/g, ' ').toUpperCase() };
  return { type: 'DİĞER', name: o.replace(/_/g, ' ').toUpperCase() };
}

app.get('/cdn/:uuid', async (req, res) => {
  try {
    const r = await axios.get(`https://cdn-avatars.wolvesville.com/${req.params.uuid}.png`, { responseType: 'arraybuffer' });
    res.set('Content-Type', 'image/png');
    res.send(r.data);
  } catch(e) { res.status(404).send(); }
});

app.get('/api/player/:u', async (req, res) => {
  const s = await wapi(`/players/search?username=${encodeURIComponent(req.params.u)}`);
  if (!s) return res.status(404).json({ error: 1 });
  const p = await wapi(`/players/${s.id}`);
  if (!p) return res.status(404).json({ error: 1 });
  let cn = '-', ci = '-';
  if (p.clanId) {
    const c = await wapi(`/clans/${p.clanId}/info`);
    if (c) { cn = c.name; ci = p.clanId; }
  }
  const uuid = url => url ? url.split('/').pop().replace('.png','') : null;
  res.json({
    n: p.username, l: p.level, id: s.id, cn, ci,
    eq: uuid(p.equippedAvatar?.url),
    avs: (p.avatars || []).map((a, i) => ({ uuid: uuid(a.url), slot: i })).filter(a => a.uuid)
  });
});

app.get('/api/playeravatars/:playerId/slot/:slot', async (req, res) => {
  const { playerId, slot } = req.params;
  const r = await wapi(`/avatars/sharedAvatarId/${playerId}/${slot}`);
  if (!r || r.code === 404) return res.status(404).json({ error: 1 });
  const detail = await wapi(`/avatars/${r.sharedAvatarId}`);
  if (!detail) return res.status(404).json({ error: 1 });
  const parts = {};
  Object.entries(detail.items || {}).forEach(([k, id]) => {
    if (!id) return;
    const itemData = cache.items.find(x => x.id === id) || cache.bodyPaints.find(x => x.id === id);
    const tagData = cache.tags[id];
    parts[k] = { id, imageUrl: itemData?.imageUrl || null, origin: tagData ? parseOrigin(tagData.origin) : null };
  });
  res.json({ code: r.sharedAvatarId, avatarUrl: detail.avatar.url, parts });
});

app.get('/api/skin/:code', async (req, res) => {
  const r = await wapi(`/avatars/${req.params.code}`);
  if (!r) return res.status(404).json({ error: 1 });
  const parts = {};
  Object.entries(r.items || {}).forEach(([k, id]) => {
    if (!id) return;
    const itemData = cache.items.find(x => x.id === id) || cache.bodyPaints.find(x => x.id === id);
    const tagData = cache.tags[id];
    parts[k] = { id, imageUrl: itemData?.imageUrl || null, origin: tagData ? parseOrigin(tagData.origin) : null };
  });
  res.json({ id: r.id, avatarUrl: r.avatar.url, parts });
});

app.get('/api/itemsource/:id', (req, res) => {
  if (!cache.loaded) return res.json({ bundles: [], item: null, fullBundle: null, origin: null });
  const id = req.params.id;
  const item = cache.items.find(x => x.id === id) || cache.bodyPaints.find(x => x.id === id) || null;
  const found = cache.bundles.filter(b => b.avatarItemIds.includes(id));
  const fullBundle = cache.fullBundles.find(fb => fb.avatarItemSets?.some(s => s.avatarItemIds.includes(id)));
  const tagData = cache.tags[id];
  const origin = tagData ? parseOrigin(tagData.origin) : null;
  res.json({
    bundles: found, item,
    fullBundle: fullBundle ? { id: fullBundle.id, promoImageUrl: fullBundle.promoImageUrl, costInGems: fullBundle.costInGems } : null,
    origin
  });
});

app.get('/api/items', (req, res) => {
  if (!cache.loaded) return res.json({ items: [], total: 0, loading: true });
  const { type, q, page = 1 } = req.query;
  const limit = 48;
  let list = [...cache.items, ...cache.bodyPaints.map(x => ({ ...x, type: 'BODY_PAINT' }))];
  if (type && type !== 'ALL') list = list.filter(x => x.type === type);
  if (q) list = list.filter(x => x.id.toLowerCase().includes(q.toLowerCase()));
  const total = list.length;
  const items = list.slice((page-1)*limit, page*limit);
  res.json({ items, total, page: Number(page), pages: Math.ceil(total/limit) });
});

app.get('/api/bundles', (req, res) => {
  if (!cache.loaded) return res.json({ bundles: [], loading: true });
  res.json({ bundles: cache.bundles });
});

app.get('/api/bundle/:id', (req, res) => {
  const bundle = cache.bundles.find(b => b.id === req.params.id);
  if (!bundle) return res.status(404).json({ error: 1 });
  const items = bundle.avatarItemIds.map(id =>
    cache.items.find(x => x.id === id) ||
    cache.bodyPaints.find(x => x.id === id) ||
    { id, imageUrl: null, type: 'UNKNOWN' }
  );
  res.json({ ...bundle, items });
});

loadCache().then(() => {
  app.listen(3000, () => console.log('🚀 http://localhost:3000'));
});