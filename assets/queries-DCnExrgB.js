import{m as e,v as t,y as n}from"./src-DvT3srdk.js";import{S as r,V as i,b as a,ct as o,ht as s,lt as c,t as l,ut as u,y as d}from"./handleFs-CpJi3f0y.js";var f=[{version:1,name:`init`,sql:`
-- ── Library ────────────────────────────────────────────────────────────────

CREATE TABLE folders (
  id          TEXT PRIMARY KEY,            -- uuid, never a path
  parent_id   TEXT REFERENCES folders(id),
  name        TEXT NOT NULL,
  path        TEXT,                        -- materialized path of ids: /a/b/c — nearest-ancestor grant lookups
  owner_id    TEXT,                        -- dormant until identity ships (ADR-005)
  home        TEXT NOT NULL DEFAULT 'local',  -- local | server   (ADR-004)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_folders_parent ON folders(parent_id);

CREATE TABLE toppings (
  id           TEXT PRIMARY KEY,           -- uuid
  type         TEXT NOT NULL CHECK (type IN ('note','link','file','dash')),  -- ADR-003
  folder_id    TEXT NOT NULL REFERENCES folders(id),
  title        TEXT NOT NULL,
  content_ref  TEXT,                       -- vault rows: file path (links: the .url carrier; URL lives in properties)
  content_hash TEXT,                       -- re-association after offline moves
  thumb_ref    TEXT,                       -- key into .waffle/thumbs/
  blurhash     TEXT,
  owner_id     TEXT,
  source       TEXT,                       -- share-extension | paste | finder | import | seed | ...
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT                        -- tombstone (shared-folder sync)
);
CREATE INDEX idx_toppings_folder ON toppings(folder_id, type);
CREATE INDEX idx_toppings_folder_updated ON toppings(folder_id, updated_at);
CREATE INDEX idx_toppings_updated ON toppings(updated_at);  -- global recents
CREATE INDEX idx_toppings_hash ON toppings(content_hash);

-- Typed properties, EAV. For notes, YAML frontmatter is canonical and this
-- mirrors it; for link/file/dash this is canonical (mirrored to .waffle/meta.json, ADR-013).
CREATE TABLE properties (
  topping_id  TEXT NOT NULL REFERENCES toppings(id),
  key         TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- text|number|money|duration|date|coords|select|url|checkbox
  value_text  TEXT,
  value_num   REAL,                        -- canonical unit per kind (money: amount · duration: seconds)
  value_aux   TEXT,                        -- money: ISO 4217 · coords: lng · select: option id
  PRIMARY KEY (topping_id, key)
);
CREATE INDEX idx_properties_key_num  ON properties(key, value_num);
CREATE INDEX idx_properties_key_text ON properties(key, value_text);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,              -- user tags now; global crowd tags P3
  scope TEXT NOT NULL DEFAULT 'user'       -- user | global
);
CREATE TABLE topping_tags (
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  tag_id     TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (topping_id, tag_id)
);
CREATE INDEX idx_topping_tags_tag ON topping_tags(tag_id);

-- ── Views (ADR-006, ADR-014) ───────────────────────────────────────────────

CREATE TABLE views (
  id         TEXT PRIMARY KEY,
  folder_id  TEXT REFERENCES folders(id),  -- NULL ⇒ smart folder (query-scoped)
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL,                -- renderer registry key: masonry|list|table|board|gallery|map|...
  config     TEXT NOT NULL,                -- JSON: filters AST, sorts, group_by, visible props, subtree
  kind       TEXT NOT NULL DEFAULT 'shared', -- shared | personal
  owner_id   TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  position   REAL NOT NULL                 -- tab order
);
CREATE INDEX idx_views_folder ON views(folder_id);

-- Per-view manual ordering: fractional index keys — one write per drag-drop.
CREATE TABLE view_order (
  view_id    TEXT NOT NULL REFERENCES views(id),
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  order_key  TEXT NOT NULL,
  PRIMARY KEY (view_id, topping_id)
);

-- ── Sharing (ADR-005, dormant until P1) ────────────────────────────────────

CREATE TABLE grants (
  id         TEXT PRIMARY KEY,
  folder_id  TEXT NOT NULL REFERENCES folders(id),
  grantee    TEXT NOT NULL,                -- user id | invite-link token
  role       TEXT NOT NULL CHECK (role IN ('viewer','editor')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_grants_folder ON grants(folder_id);

-- ── Search ─────────────────────────────────────────────────────────────────

CREATE VIRTUAL TABLE toppings_fts USING fts5(
  topping_id UNINDEXED,
  title, body, tags
);

-- ── Datasets (ADR-007..011) ────────────────────────────────────────────────
-- Actual dataset tables (health_sleep, oura_readiness, ...) are created per
-- connector manifest by the host. This registry tracks them.

CREATE TABLE datasets (
  table_name   TEXT PRIMARY KEY,           -- e.g. 'health_sleep'
  kind         TEXT NOT NULL,              -- canonical | extension
  schema_ver   TEXT NOT NULL,
  connector_id TEXT,                       -- NULL for canonical multi-source tables
  created_at   TEXT NOT NULL
);

CREATE TABLE source_priority (              -- ADR-011: user-orderable provider precedence
  table_name TEXT NOT NULL,
  source     TEXT NOT NULL,
  priority   INTEGER NOT NULL,
  PRIMARY KEY (table_name, source)
);

CREATE TABLE fx_rates (                     -- ADR-010: currency converts at query time
  day      TEXT NOT NULL,                  -- ISO date
  currency TEXT NOT NULL,                  -- ISO 4217
  eur_rate REAL NOT NULL,
  PRIMARY KEY (day, currency)
);

CREATE TABLE connector_state (
  connector_id TEXT PRIMARY KEY,
  installed_at TEXT NOT NULL,
  last_pull    TEXT,
  status       TEXT NOT NULL DEFAULT 'ok'  -- ok | auth_required | error | disabled
);
`},{version:2,name:`status_and_ratings`,sql:`
CREATE TABLE status_sets (
  id     TEXT PRIMARY KEY,                 -- 'read' | 'watch' | 'visit' | 'buy' | 'do' | custom uuid
  name   TEXT NOT NULL,
  labels TEXT NOT NULL                     -- JSON: slot → label, e.g. {"queued":"Want to read",...}
);

CREATE TABLE status_set_bindings (
  set_id      TEXT NOT NULL REFERENCES status_sets(id),
  match_kind  TEXT NOT NULL,               -- 'schema_type' | 'tag'
  match_value TEXT NOT NULL,               -- 'Book' | 'Place' | tag id
  PRIMARY KEY (match_kind, match_value)
);

CREATE TABLE interactions (
  owner_id    TEXT NOT NULL DEFAULT 'local',
  entity_kind TEXT NOT NULL DEFAULT 'url', -- 'url' now; extensible (ADR: rate anything)
  entity_key  TEXT NOT NULL,               -- trimmed-URL hash; never the carrier file's content_hash
  set_id      TEXT REFERENCES status_sets(id),
  slot        TEXT CHECK (slot IN ('queued','active','done','dropped')),
  rating      REAL,                        -- canonical 0-10; display maps to user preference
  note        TEXT,
  status_at   TEXT,
  rated_at    TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, entity_kind, entity_key)
);
CREATE INDEX idx_interactions_slot ON interactions(owner_id, slot);

INSERT INTO status_sets (id, name, labels) VALUES
  ('read',  'Reading',  '{"queued":"Want to read","active":"Reading","done":"Read","dropped":"Abandoned"}'),
  ('watch', 'Watching', '{"queued":"Watchlist","active":"Watching","done":"Watched","dropped":"Dropped"}'),
  ('visit', 'Places',   '{"queued":"Want to go","done":"Been"}'),
  ('buy',   'Shopping', '{"queued":"Want it","done":"Bought","dropped":"Returned"}'),
  ('do',    'Tasks',    '{"queued":"To do","active":"Doing","done":"Done","dropped":"Dropped"}');

INSERT INTO status_set_bindings (set_id, match_kind, match_value) VALUES
  ('read',  'schema_type', 'Book'),
  ('read',  'schema_type', 'Article'),
  ('watch', 'schema_type', 'Movie'),
  ('watch', 'schema_type', 'TVSeries'),
  ('visit', 'schema_type', 'Place'),
  ('visit', 'schema_type', 'Restaurant'),
  ('buy',   'schema_type', 'Product');
`},{version:3,name:`thumbnails`,sql:`
ALTER TABLE toppings ADD COLUMN thumb_aspect REAL;   -- width / height
ALTER TABLE toppings ADD COLUMN thumb_color  TEXT;   -- dominant color, e.g. '#a2b3c4'
`},{version:4,name:`multi_axis_status`,sql:`
CREATE TABLE interactions_v4 (
  owner_id    TEXT NOT NULL DEFAULT 'local',
  entity_kind TEXT NOT NULL DEFAULT 'url',
  entity_key  TEXT NOT NULL,
  set_id      TEXT NOT NULL REFERENCES status_sets(id),
  slot        TEXT CHECK (slot IN ('queued','active','done','dropped')),
  rating      REAL,
  note        TEXT,
  status_at   TEXT,
  rated_at    TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, entity_kind, entity_key, set_id)
);
INSERT INTO interactions_v4
  SELECT owner_id, entity_kind, entity_key, COALESCE(set_id, 'do'), slot, rating, note, status_at, rated_at, updated_at
  FROM interactions;
DROP TABLE interactions;
ALTER TABLE interactions_v4 RENAME TO interactions;
CREATE INDEX idx_interactions_slot ON interactions(owner_id, slot);
`},{version:5,name:`topping_entity_refs`,sql:`
CREATE TABLE topping_entities (
  topping_id  TEXT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  entity_key  TEXT NOT NULL,
  PRIMARY KEY (topping_id, entity_kind)
);
CREATE INDEX idx_topping_entities_identity
  ON topping_entities(entity_kind, entity_key);
`},{version:6,name:`url_entity_aliases`,sql:`
ALTER TABLE topping_entities ADD COLUMN alias_key TEXT;

CREATE TABLE url_entity_aliases (
  alias_key          TEXT PRIMARY KEY,
  entity_key         TEXT NOT NULL,
  candidate_key      TEXT NOT NULL,
  normalizer_version INTEGER NOT NULL,
  provider           TEXT,
  provider_key       TEXT,
  evidence           TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('resolved','conflict')),
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_url_entity_aliases_entity
  ON url_entity_aliases(entity_key);
`},{version:7,name:`topping_stat_columns`,sql:`
ALTER TABLE toppings ADD COLUMN stat_size  INTEGER;
ALTER TABLE toppings ADD COLUMN stat_mtime INTEGER;
`},{version:8,name:`local_file_content_search`,sql:`
CREATE TABLE content_documents (
  topping_id       TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_hash      TEXT NOT NULL,
  media_type       TEXT NOT NULL,
  extractor_id     TEXT NOT NULL,
  extractor_version INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (
    status IN ('pending','indexed','needs_ocr','locked','unsupported','failed')
  ),
  page_count       INTEGER,
  detail           TEXT,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_content_documents_status
  ON content_documents(status, updated_at);

CREATE VIRTUAL TABLE content_chunks_fts USING fts5(
  topping_id UNINDEXED,
  anchor_page UNINDEXED,
  ordinal UNINDEXED,
  text
);
`},{version:9,name:`local_link_preview_evidence`,sql:`
CREATE TABLE link_preview_evidence (
  topping_id          TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_hash         TEXT NOT NULL,
  source_url          TEXT NOT NULL,
  transport           TEXT NOT NULL CHECK (
    transport IN ('share-target','rich-paste','manual','extension-dom','native-fetch')
  ),
  status              TEXT NOT NULL CHECK (status IN ('ready','denied','malformed')),
  observed_at         TEXT NOT NULL,
  collector_id        TEXT NOT NULL,
  collector_version   INTEGER NOT NULL,
  title_text          TEXT,
  title_provenance    TEXT,
  description_text    TEXT,
  description_provenance TEXT,
  site_name_text      TEXT,
  site_name_provenance TEXT,
  hero_ref            TEXT,
  hero_media_type     TEXT,
  hero_alt            TEXT,
  hero_provenance     TEXT,
  favicon_ref         TEXT,
  favicon_media_type  TEXT,
  favicon_provenance  TEXT
);
`},{version:10,name:`local_work_governor_state`,sql:`
CREATE TABLE local_work_state (
  kind       TEXT NOT NULL CHECK (kind IN ('meta','revision','job')),
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);
`},{version:11,name:`local_list_topping_type`,sql:`
CREATE TABLE toppings_v11 AS SELECT * FROM toppings;
CREATE TABLE properties_v11 AS SELECT * FROM properties;
CREATE TABLE topping_tags_v11 AS SELECT * FROM topping_tags;
CREATE TABLE view_order_v11 AS SELECT * FROM view_order;
CREATE TABLE topping_entities_v11 AS SELECT * FROM topping_entities;
CREATE TABLE content_documents_v11 AS SELECT * FROM content_documents;
CREATE TABLE link_preview_evidence_v11 AS SELECT * FROM link_preview_evidence;

DROP TABLE properties;
DROP TABLE topping_tags;
DROP TABLE view_order;
DROP TABLE topping_entities;
DROP TABLE content_documents;
DROP TABLE link_preview_evidence;
DROP TABLE toppings;

CREATE TABLE toppings (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('note','link','file','dash','list')),
  folder_id    TEXT NOT NULL REFERENCES folders(id),
  title        TEXT NOT NULL,
  content_ref  TEXT,
  content_hash TEXT,
  thumb_ref    TEXT,
  blurhash     TEXT,
  owner_id     TEXT,
  source       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  thumb_aspect REAL,
  thumb_color  TEXT,
  stat_size    INTEGER,
  stat_mtime   INTEGER
);
INSERT INTO toppings (
  id, type, folder_id, title, content_ref, content_hash, thumb_ref, blurhash,
  owner_id, source, created_at, updated_at, deleted_at, thumb_aspect,
  thumb_color, stat_size, stat_mtime
)
SELECT
  id, type, folder_id, title, content_ref, content_hash, thumb_ref, blurhash,
  owner_id, source, created_at, updated_at, deleted_at, thumb_aspect,
  thumb_color, stat_size, stat_mtime
FROM toppings_v11;
DROP TABLE toppings_v11;

CREATE INDEX idx_toppings_folder ON toppings(folder_id, type);
CREATE INDEX idx_toppings_folder_updated ON toppings(folder_id, updated_at);
CREATE INDEX idx_toppings_updated ON toppings(updated_at);
CREATE INDEX idx_toppings_hash ON toppings(content_hash);

CREATE TABLE properties (
  topping_id  TEXT NOT NULL REFERENCES toppings(id),
  key         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  value_text  TEXT,
  value_num   REAL,
  value_aux   TEXT,
  PRIMARY KEY (topping_id, key)
);
INSERT INTO properties SELECT * FROM properties_v11;
DROP TABLE properties_v11;
CREATE INDEX idx_properties_key_num ON properties(key, value_num);
CREATE INDEX idx_properties_key_text ON properties(key, value_text);

CREATE TABLE topping_tags (
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  tag_id     TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (topping_id, tag_id)
);
INSERT INTO topping_tags SELECT * FROM topping_tags_v11;
DROP TABLE topping_tags_v11;
CREATE INDEX idx_topping_tags_tag ON topping_tags(tag_id);

CREATE TABLE view_order (
  view_id    TEXT NOT NULL REFERENCES views(id),
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  order_key  TEXT NOT NULL,
  PRIMARY KEY (view_id, topping_id)
);
INSERT INTO view_order SELECT * FROM view_order_v11;
DROP TABLE view_order_v11;

CREATE TABLE topping_entities (
  topping_id  TEXT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  entity_key  TEXT NOT NULL,
  alias_key   TEXT,
  PRIMARY KEY (topping_id, entity_kind)
);
INSERT INTO topping_entities SELECT * FROM topping_entities_v11;
DROP TABLE topping_entities_v11;
CREATE INDEX idx_topping_entities_identity
  ON topping_entities(entity_kind, entity_key);

CREATE TABLE content_documents (
  topping_id         TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_hash        TEXT NOT NULL,
  media_type         TEXT NOT NULL,
  extractor_id       TEXT NOT NULL,
  extractor_version  INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (
    status IN ('pending','indexed','needs_ocr','locked','unsupported','failed')
  ),
  page_count         INTEGER,
  detail             TEXT,
  updated_at         TEXT NOT NULL
);
INSERT INTO content_documents SELECT * FROM content_documents_v11;
DROP TABLE content_documents_v11;
CREATE INDEX idx_content_documents_status
  ON content_documents(status, updated_at);

CREATE TABLE link_preview_evidence (
  topping_id          TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_hash         TEXT NOT NULL,
  source_url          TEXT NOT NULL,
  transport           TEXT NOT NULL CHECK (
    transport IN ('share-target','rich-paste','manual','extension-dom','native-fetch')
  ),
  status              TEXT NOT NULL CHECK (status IN ('ready','denied','malformed')),
  observed_at         TEXT NOT NULL,
  collector_id        TEXT NOT NULL,
  collector_version   INTEGER NOT NULL,
  title_text          TEXT,
  title_provenance    TEXT,
  description_text    TEXT,
  description_provenance TEXT,
  site_name_text      TEXT,
  site_name_provenance TEXT,
  hero_ref            TEXT,
  hero_media_type     TEXT,
  hero_alt             TEXT,
  hero_provenance     TEXT,
  favicon_ref         TEXT,
  favicon_media_type  TEXT,
  favicon_provenance  TEXT
);
INSERT INTO link_preview_evidence SELECT * FROM link_preview_evidence_v11;
DROP TABLE link_preview_evidence_v11;
`},{version:12,name:`drop_list_topping_type`,sql:`
CREATE TABLE toppings_v12 AS SELECT * FROM toppings;
CREATE TABLE properties_v12 AS SELECT * FROM properties;
CREATE TABLE topping_tags_v12 AS SELECT * FROM topping_tags;
CREATE TABLE view_order_v12 AS SELECT * FROM view_order;
CREATE TABLE topping_entities_v12 AS SELECT * FROM topping_entities;
CREATE TABLE content_documents_v12 AS SELECT * FROM content_documents;
CREATE TABLE link_preview_evidence_v12 AS SELECT * FROM link_preview_evidence;

DROP TABLE properties;
DROP TABLE topping_tags;
DROP TABLE view_order;
DROP TABLE topping_entities;
DROP TABLE content_documents;
DROP TABLE link_preview_evidence;
DROP TABLE toppings;

CREATE TABLE toppings (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('note','link','file','dash')),
  folder_id    TEXT NOT NULL REFERENCES folders(id),
  title        TEXT NOT NULL,
  content_ref  TEXT,
  content_hash TEXT,
  thumb_ref    TEXT,
  blurhash     TEXT,
  owner_id     TEXT,
  source       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  thumb_aspect REAL,
  thumb_color  TEXT,
  stat_size    INTEGER,
  stat_mtime   INTEGER
);
INSERT INTO toppings (
  id, type, folder_id, title, content_ref, content_hash, thumb_ref, blurhash,
  owner_id, source, created_at, updated_at, deleted_at, thumb_aspect,
  thumb_color, stat_size, stat_mtime
)
SELECT
  id,
  CASE WHEN type = 'list' THEN 'file' ELSE type END,
  folder_id, title, content_ref, content_hash, thumb_ref, blurhash,
  owner_id, source, created_at, updated_at, deleted_at, thumb_aspect,
  thumb_color, stat_size, stat_mtime
FROM toppings_v12;
DROP TABLE toppings_v12;

CREATE INDEX idx_toppings_folder ON toppings(folder_id, type);
CREATE INDEX idx_toppings_folder_updated ON toppings(folder_id, updated_at);
CREATE INDEX idx_toppings_updated ON toppings(updated_at);
CREATE INDEX idx_toppings_hash ON toppings(content_hash);

CREATE TABLE properties (
  topping_id  TEXT NOT NULL REFERENCES toppings(id),
  key         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  value_text  TEXT,
  value_num   REAL,
  value_aux   TEXT,
  PRIMARY KEY (topping_id, key)
);
INSERT INTO properties SELECT * FROM properties_v12;
DROP TABLE properties_v12;
CREATE INDEX idx_properties_key_num ON properties(key, value_num);
CREATE INDEX idx_properties_key_text ON properties(key, value_text);

CREATE TABLE topping_tags (
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  tag_id     TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (topping_id, tag_id)
);
INSERT INTO topping_tags SELECT * FROM topping_tags_v12;
DROP TABLE topping_tags_v12;
CREATE INDEX idx_topping_tags_tag ON topping_tags(tag_id);

CREATE TABLE view_order (
  view_id    TEXT NOT NULL REFERENCES views(id),
  topping_id TEXT NOT NULL REFERENCES toppings(id),
  order_key  TEXT NOT NULL,
  PRIMARY KEY (view_id, topping_id)
);
INSERT INTO view_order SELECT * FROM view_order_v12;
DROP TABLE view_order_v12;

CREATE TABLE topping_entities (
  topping_id  TEXT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
  entity_kind TEXT NOT NULL,
  entity_key  TEXT NOT NULL,
  alias_key   TEXT,
  PRIMARY KEY (topping_id, entity_kind)
);
INSERT INTO topping_entities SELECT * FROM topping_entities_v12;
DROP TABLE topping_entities_v12;
CREATE INDEX idx_topping_entities_identity
  ON topping_entities(entity_kind, entity_key);

CREATE TABLE content_documents (
  topping_id         TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_hash        TEXT NOT NULL,
  media_type         TEXT NOT NULL,
  extractor_id       TEXT NOT NULL,
  extractor_version  INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (
    status IN ('pending','indexed','needs_ocr','locked','unsupported','failed')
  ),
  page_count         INTEGER,
  detail             TEXT,
  updated_at         TEXT NOT NULL
);
INSERT INTO content_documents SELECT * FROM content_documents_v12;
DROP TABLE content_documents_v12;
CREATE INDEX idx_content_documents_status
  ON content_documents(status, updated_at);

CREATE TABLE link_preview_evidence (
  topping_id          TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_hash         TEXT NOT NULL,
  source_url          TEXT NOT NULL,
  transport           TEXT NOT NULL CHECK (
    transport IN ('share-target','rich-paste','manual','extension-dom','native-fetch')
  ),
  status              TEXT NOT NULL CHECK (status IN ('ready','denied','malformed')),
  observed_at         TEXT NOT NULL,
  collector_id        TEXT NOT NULL,
  collector_version   INTEGER NOT NULL,
  title_text          TEXT,
  title_provenance    TEXT,
  description_text    TEXT,
  description_provenance TEXT,
  site_name_text      TEXT,
  site_name_provenance TEXT,
  hero_ref            TEXT,
  hero_media_type     TEXT,
  hero_alt             TEXT,
  hero_provenance     TEXT,
  favicon_ref         TEXT,
  favicon_media_type  TEXT,
  favicon_provenance  TEXT
);
INSERT INTO link_preview_evidence SELECT * FROM link_preview_evidence_v12;
DROP TABLE link_preview_evidence_v12;
`},{version:13,name:`rowid_addressed_fts_deletion`,sql:`
CREATE TABLE toppings_fts_rows (
  fts_rowid  INTEGER PRIMARY KEY,
  topping_id TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tags       TEXT NOT NULL
);
INSERT INTO toppings_fts_rows (fts_rowid, topping_id, title, body, tags)
SELECT f.rowid, f.topping_id, f.title, f.body, f.tags
  FROM toppings_fts f
  JOIN (
    SELECT topping_id, MAX(rowid) AS rowid
      FROM toppings_fts
     GROUP BY topping_id
  ) latest ON latest.rowid = f.rowid;
DROP TABLE toppings_fts;

CREATE VIRTUAL TABLE toppings_fts USING fts5(
  topping_id UNINDEXED,
  title,
  body,
  tags,
  content = 'toppings_fts_rows',
  content_rowid = 'fts_rowid'
);
CREATE TRIGGER toppings_fts_rows_ai AFTER INSERT ON toppings_fts_rows BEGIN
  INSERT INTO toppings_fts (rowid, topping_id, title, body, tags)
  VALUES (new.fts_rowid, new.topping_id, new.title, new.body, new.tags);
END;
CREATE TRIGGER toppings_fts_rows_ad AFTER DELETE ON toppings_fts_rows BEGIN
  INSERT INTO toppings_fts (toppings_fts, rowid, topping_id, title, body, tags)
  VALUES ('delete', old.fts_rowid, old.topping_id, old.title, old.body, old.tags);
END;
CREATE TRIGGER toppings_fts_rows_au AFTER UPDATE ON toppings_fts_rows BEGIN
  INSERT INTO toppings_fts (toppings_fts, rowid, topping_id, title, body, tags)
  VALUES ('delete', old.fts_rowid, old.topping_id, old.title, old.body, old.tags);
  INSERT INTO toppings_fts (rowid, topping_id, title, body, tags)
  VALUES (new.fts_rowid, new.topping_id, new.title, new.body, new.tags);
END;
INSERT INTO toppings_fts(toppings_fts) VALUES('rebuild');

CREATE TABLE content_chunks_fts_rows (
  fts_rowid  INTEGER PRIMARY KEY,
  topping_id TEXT NOT NULL,
  anchor_page INTEGER NOT NULL,
  ordinal    INTEGER NOT NULL,
  text       TEXT NOT NULL
);
CREATE INDEX idx_content_chunks_fts_rows_topping
  ON content_chunks_fts_rows(topping_id);
INSERT INTO content_chunks_fts_rows (
  fts_rowid, topping_id, anchor_page, ordinal, text
)
SELECT rowid, topping_id, anchor_page, ordinal, text FROM content_chunks_fts;
DROP TABLE content_chunks_fts;

CREATE VIRTUAL TABLE content_chunks_fts USING fts5(
  topping_id UNINDEXED,
  anchor_page UNINDEXED,
  ordinal UNINDEXED,
  text,
  content = 'content_chunks_fts_rows',
  content_rowid = 'fts_rowid'
);
CREATE TRIGGER content_chunks_fts_rows_ai AFTER INSERT ON content_chunks_fts_rows BEGIN
  INSERT INTO content_chunks_fts (rowid, topping_id, anchor_page, ordinal, text)
  VALUES (new.fts_rowid, new.topping_id, new.anchor_page, new.ordinal, new.text);
END;
CREATE TRIGGER content_chunks_fts_rows_ad AFTER DELETE ON content_chunks_fts_rows BEGIN
  INSERT INTO content_chunks_fts (
    content_chunks_fts, rowid, topping_id, anchor_page, ordinal, text
  )
  VALUES (
    'delete', old.fts_rowid, old.topping_id, old.anchor_page, old.ordinal, old.text
  );
END;
CREATE TRIGGER content_chunks_fts_rows_au AFTER UPDATE ON content_chunks_fts_rows BEGIN
  INSERT INTO content_chunks_fts (
    content_chunks_fts, rowid, topping_id, anchor_page, ordinal, text
  )
  VALUES (
    'delete', old.fts_rowid, old.topping_id, old.anchor_page, old.ordinal, old.text
  );
  INSERT INTO content_chunks_fts (rowid, topping_id, anchor_page, ordinal, text)
  VALUES (new.fts_rowid, new.topping_id, new.anchor_page, new.ordinal, new.text);
END;
INSERT INTO content_chunks_fts(content_chunks_fts) VALUES('rebuild');
`},{version:14,name:`attachment_reference_projection`,sql:`
CREATE TABLE attachment_reference_documents (
  source_topping_id TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_path       TEXT NOT NULL,
  source_hash       TEXT NOT NULL
);
CREATE TABLE attachment_reference_candidates (
  source_topping_id TEXT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
  reference_ordinal INTEGER NOT NULL,
  candidate_path    TEXT NOT NULL,
  priority          INTEGER NOT NULL,
  PRIMARY KEY (source_topping_id, reference_ordinal, priority)
);
CREATE INDEX idx_attachment_reference_candidates_path
  ON attachment_reference_candidates(
    candidate_path,
    source_topping_id,
    reference_ordinal,
    priority
  );
CREATE INDEX idx_toppings_source_content_ref_live
  ON toppings(source, content_ref, deleted_at);
`},{version:15,name:`private_entity_projection`,sql:`
CREATE TABLE private_entity_active_vault (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  vault_id   TEXT NOT NULL
);

CREATE TABLE private_entity_mirror_migrations (
  vault_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  completed_at  TEXT NOT NULL,
  orphan_count  INTEGER NOT NULL CHECK (orphan_count >= 0),
  PRIMARY KEY (vault_id, name)
);

CREATE TABLE private_entity_url_refs (
  topping_id         TEXT PRIMARY KEY,
  scheme             TEXT NOT NULL,
  value              TEXT NOT NULL,
  issuer             TEXT,
  derivation_id      TEXT NOT NULL,
  derivation_version INTEGER NOT NULL
);
CREATE INDEX idx_private_entity_url_refs_identifier
  ON private_entity_url_refs(scheme, value, issuer);

CREATE TABLE private_entity_bindings (
  topping_id        TEXT PRIMARY KEY,
  entity_id         TEXT NOT NULL,
  binding_record_id TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_private_entity_bindings_entity
  ON private_entity_bindings(entity_id);

CREATE TABLE private_entity_identifier_claims (
  claim_record_id   TEXT PRIMARY KEY,
  entity_id         TEXT NOT NULL,
  scheme            TEXT NOT NULL,
  value             TEXT NOT NULL,
  issuer            TEXT,
  derivation_id     TEXT,
  derivation_version INTEGER
);
CREATE INDEX idx_private_entity_identifier_claims_identifier
  ON private_entity_identifier_claims(scheme, value, issuer, entity_id);

CREATE TABLE private_entity_marks (
  mark_record_id TEXT NOT NULL UNIQUE,
  entity_id      TEXT NOT NULL,
  set_id         TEXT NOT NULL REFERENCES status_sets(id),
  slot           TEXT CHECK (slot IN ('queued','active','done','dropped')),
  rating         REAL,
  note           TEXT,
  status_at      TEXT,
  rated_at       TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (entity_id, set_id)
);
CREATE INDEX idx_private_entity_marks_slot
  ON private_entity_marks(slot, entity_id);
CREATE INDEX idx_private_entity_marks_rating
  ON private_entity_marks(rating, entity_id);

CREATE TABLE private_entity_toppings (
  topping_id  TEXT PRIMARY KEY,
  entity_id   TEXT,
  resolution  TEXT NOT NULL CHECK (
    resolution IN ('binding','identifier','ambiguous')
  )
);
CREATE INDEX idx_private_entity_toppings_entity
  ON private_entity_toppings(entity_id, topping_id);

CREATE TABLE private_entity_projection_issues (
  issue_key  TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  detail     TEXT NOT NULL,
  record_ids TEXT NOT NULL
);

CREATE VIEW private_entity_effective_marks AS
SELECT
  t.topping_id,
  m.entity_id,
  m.set_id,
  m.slot,
  m.rating,
  m.note,
  m.status_at,
  m.rated_at,
  m.updated_at
FROM private_entity_toppings t
JOIN private_entity_marks m ON m.entity_id = t.entity_id
WHERE t.resolution != 'ambiguous'
UNION ALL
SELECT
  te.topping_id,
  NULL AS entity_id,
  i.set_id,
  i.slot,
  i.rating,
  i.note,
  i.status_at,
  i.rated_at,
  i.updated_at
FROM topping_entities te
JOIN interactions i
  ON i.entity_kind = te.entity_kind AND i.entity_key = te.entity_key
WHERE i.owner_id = 'local'
  AND NOT EXISTS (
    SELECT 1
      FROM private_entity_active_vault active
      JOIN private_entity_mirror_migrations migration
        ON migration.vault_id = active.vault_id
       AND migration.name = 'url-bridge-v1'
     WHERE active.singleton = 1
  )
  AND NOT EXISTS (
    SELECT 1
      FROM private_entity_toppings private_topping
      JOIN private_entity_marks private_mark
        ON private_mark.entity_id = private_topping.entity_id
     WHERE private_topping.topping_id = te.topping_id
       AND private_mark.set_id = i.set_id
  );
`},{version:16,name:`video_object_status_binding`,sql:`
INSERT INTO status_set_bindings (set_id, match_kind, match_value)
VALUES ('watch', 'schema_type', 'VideoObject');
`},{version:17,name:`typed_link_preview_records`,sql:`
ALTER TABLE link_preview_evidence ADD COLUMN schema_type TEXT;
ALTER TABLE link_preview_evidence ADD COLUMN schema_type_provenance TEXT;
`},{version:18,name:`rich_typed_link_preview_records`,sql:`
ALTER TABLE link_preview_evidence ADD COLUMN typed_properties_json TEXT;
ALTER TABLE link_preview_evidence ADD COLUMN media_json TEXT;
`},{version:19,name:`local_semantic_embedding_projection`,sql:`
CREATE TABLE semantic_model_state (
  model_id          TEXT PRIMARY KEY,
  model_revision    TEXT NOT NULL,
  processor_version INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('requested','ready','failed','removing')),
  expected_bytes    INTEGER NOT NULL CHECK (expected_bytes > 0),
  received_bytes    INTEGER NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
  error_class       TEXT,
  requested_at      TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE semantic_embedding_documents (
  topping_id        TEXT PRIMARY KEY REFERENCES toppings(id) ON DELETE CASCADE,
  source_revision   TEXT NOT NULL,
  model_id          TEXT NOT NULL,
  model_revision    TEXT NOT NULL,
  processor_version INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending','indexed','failed')),
  segment_count     INTEGER NOT NULL DEFAULT 0 CHECK (segment_count >= 0),
  error_class       TEXT,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_semantic_embedding_documents_status
  ON semantic_embedding_documents(status, updated_at);

CREATE TABLE semantic_embeddings (
  topping_id        TEXT NOT NULL REFERENCES toppings(id) ON DELETE CASCADE,
  source_revision   TEXT NOT NULL,
  model_id          TEXT NOT NULL,
  model_revision    TEXT NOT NULL,
  processor_version INTEGER NOT NULL,
  segment_kind      TEXT NOT NULL CHECK (segment_kind IN ('topping','content')),
  anchor_page       INTEGER NOT NULL DEFAULT 0 CHECK (anchor_page >= 0),
  ordinal           INTEGER NOT NULL CHECK (ordinal >= 0),
  snippet           TEXT NOT NULL,
  dimensions        INTEGER NOT NULL CHECK (dimensions > 0),
  vector            BLOB NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (topping_id, segment_kind, anchor_page, ordinal)
);
CREATE INDEX idx_semantic_embeddings_model
  ON semantic_embeddings(model_id, model_revision, processor_version);

CREATE TABLE semantic_query_requests (
  request_id        TEXT PRIMARY KEY,
  source_revision   TEXT NOT NULL,
  query_text        TEXT NOT NULL,
  model_id          TEXT NOT NULL,
  model_revision    TEXT NOT NULL,
  processor_version INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('queued','completed','failed','cancelled')),
  dimensions        INTEGER,
  vector            BLOB,
  error_class       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_semantic_query_requests_status
  ON semantic_query_requests(status, created_at);
`},{version:20,name:`asserted_schema_type`,sql:`
ALTER TABLE toppings ADD COLUMN asserted_schema_type TEXT;
`}];async function p(e){await e.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);let t=(await e.exec(`SELECT MAX(version) AS v FROM schema_migrations`))[0]?.v??0,n=f.at(-1).version;if(t>n)throw Error(`This library index uses schema v${t}, newer than this build understands (v${n}). Update Waffle to continue — your files are untouched.`);for(let n of f)n.version<=t||await e.transaction(async e=>{(await e.exec(`SELECT 1 AS ok FROM schema_migrations WHERE version = ?`,[n.version])).length>0||(await e.exec(n.sql),await e.exec(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,[n.version,n.name,new Date().toISOString()]))});return(await e.exec(`SELECT MAX(version) AS v FROM schema_migrations`))[0]?.v??0}var m=`Xenova/multilingual-e5-small`,h=`761b726dd34fb83930e26aab4e9ac3899aa1fa78`,ee=140461908,te=512*1024*1024,ne=`local-e5-model`,re=`local-e5-embedding`,ie=`query: `,g=`passage: `,ae=2048,oe=1176;function se(e){return e.replace(/\s+/gu,` `).trim()}function _(e){let t=se(e);return t.length<=2048?t:t.slice(0,ae).trimEnd()}function ce(e,t){return(e===`query`?ie:g)+_(t)}function le(e){let t=se(e);return t.length<=280?t:`${t.slice(0,279).trimEnd()}…`}function ue(e){return JSON.stringify({model:m,revision:h,version:1,segments:e.map(e=>({kind:e.kind,anchorPage:e.anchorPage,ordinal:e.ordinal,text:_(e.text)}))})}async function v(e){let t=new TextEncoder().encode(ue(e));return[...new Uint8Array(await crypto.subtle.digest(`SHA-256`,t))].map(e=>e.toString(16).padStart(2,`0`)).join(``)}function de(e){return v([{kind:`topping`,anchorPage:null,ordinal:0,text:_(e)}])}function fe(e){if(e.length!==384)throw Error(`Expected 384 embedding dimensions, got ${e.length}`);let t=new Uint8Array(e.length*Float32Array.BYTES_PER_ELEMENT),n=new DataView(t.buffer);for(let t=0;t<e.length;t++){let r=e[t];if(!Number.isFinite(r))throw Error(`Embedding vectors must contain only finite values`);n.setFloat32(t*Float32Array.BYTES_PER_ELEMENT,r,!0)}return t}function y(e){let t=e instanceof Uint8Array?e:e instanceof ArrayBuffer?new Uint8Array(e):null,n=384*Float32Array.BYTES_PER_ELEMENT;if(!t||t.byteLength!==n)throw Error(`Embedding BLOB must contain exactly ${n} bytes`);let r=new DataView(t.buffer,t.byteOffset,t.byteLength),i=new Float32Array(384);for(let e=0;e<i.length;e++){let t=r.getFloat32(e*Float32Array.BYTES_PER_ELEMENT,!0);if(!Number.isFinite(t))throw Error(`Embedding BLOB contains a non-finite value`);i[e]=t}return i}function b(e,t){if(e.length!==384||t.length!==384)throw Error(`Semantic similarity requires the shared E5 vector space`);let n=0;for(let r=0;r<384;r++)n+=e[r]*t[r];return n}var x=`\0`;function S(e,t){let n=e.byFolder.get(t)??0;return n>=3&&e.total>0&&n/e.total>=.7}function pe(e){let t=null;for(let n of e.byFolder.keys())if(S(e,n)){if(t!==null)return null;t=n}return t}function me(e){let t=new Map;for(let[n,r]of e.tallies){let e=pe(r);e!==null&&t.set(n,e)}let n=new Map;for(let r of e.items){let i=null,a=null,o=!1;for(let n of r.signals){let s=e.tallies.get(n),c=t.get(n);if(!(!s||c===void 0||c===r.folderId)&&!S(s,r.folderId)){if(i!==null&&i!==c){o=!0;break}i=c,a??=n}}if(o||i===null||a===null)continue;let s=[i,a].join(x);n.set(s,[...n.get(s)??[],r.toppingId])}let r=[];for(let[t,i]of n){let[n,a]=t.split(x),o=e.tallies.get(a),s=o.byFolder.get(n)??0;i.sort(),r.push({targetFolderId:n,signal:a,toppingIds:i,reason:`${s} of your ${o.total} ${o.label} are here`,fingerprint:[a,...i].join(x)})}return r.sort((e,t)=>t.toppingIds.length-e.toppingIds.length||e.targetFolderId.localeCompare(t.targetFolderId)||e.signal.localeCompare(t.signal)),r}var he=`waffle:sqlite-index`,C=3e3,w=class extends Error{diagnostic;constructor(e,t){super(e),this.diagnostic=t,this.name=`WebDbStartupError`}},ge=class{send;tail=Promise.resolve();transactionFault=null;constructor(e){this.send=e}exec(e,t){return this.runExclusive(()=>this.send(e,t))}transaction(e){return this.runExclusive(()=>this.runTransaction(e))}runExclusive(e){let t=this.tail.then(()=>{if(this.transactionFault)throw this.transactionFault;return e()});return this.tail=t.catch(()=>void 0),t}async runTransaction(e){let t=!1,n=!1,r=[],i,a=!1,o={scope:`transaction`,exec:(e,t)=>{if(!n)return Promise.reject(Error(`SQLite transaction executor is no longer active`));let o=this.send(e,t);return r.push(o.then(()=>void 0,e=>{a||(i=e),a=!0})),o}};try{await this.send(`BEGIN IMMEDIATE`),t=!0,n=!0;let s,c,l=!1;try{s=await e(o)}catch(e){l=!0,c=e}finally{n=!1}if(await Promise.all(r),l)throw c;if(a)throw i;return await this.send(`COMMIT`),t=!1,s}catch(e){if(n=!1,t)try{await this.send(`ROLLBACK`)}catch(e){let t=e instanceof Error?e.message:String(e);this.transactionFault=Error(`SQLite rollback failed; reload before using the index again (${t})`)}throw e}}},_e=class{ready;worker=null;releaseOwnership=null;nextId=1;pending=new Map;commands=new ge((e,t)=>this.send(e,t));constructor(){this.ready=this.initialize()}initialize(){if(!(`locks`in navigator))return Promise.reject(new w(`This browser cannot safely coordinate Waffle’s persistent index because Web Locks are unavailable. Your files are untouched.`,{kind:`ownership-unavailable`}));let e=new AbortController,t=!1;return new Promise((n,r)=>{let i=setTimeout(()=>{t||e.abort()},C);navigator.locks.request(he,{mode:`exclusive`,signal:e.signal},async()=>{t=!0,clearTimeout(i);let e,a=new Promise(t=>{e=t});this.releaseOwnership=e;try{let e=await this.startWorker();n(e),e.storage===`opfs-sahpool`&&await a}catch(e){r(e)}finally{this.releaseOwnership===e&&(this.releaseOwnership=null),e()}}).catch(n=>{if(clearTimeout(i),t)return;if(e.signal.aborted){r(new w(`Another Waffle tab is using this browser library. Close it, then try again. Waffle did not open a temporary in-memory index.`,{kind:`ownership-timeout`,waitedMs:C}));return}let a=n instanceof Error?`${n.name}: ${n.message}`:String(n);r(new w(`Waffle could not acquire its browser-index lock (${a}). Your files are untouched.`,{kind:`ownership-failed`,cause:a}))})})}startWorker(){let e=new Worker(new URL(`/waffle-shell/assets/sqlite.worker-4JRLpv6H.js`,``+import.meta.url),{type:`module`});return this.worker=e,new Promise((t,n)=>{let r=!1,i=t=>{r||(r=!0,n(t));for(let e of this.pending.values())e.reject(t);this.pending.clear(),e.terminate(),this.worker===e&&(this.worker=null),this.releaseOwnership?.(),this.releaseOwnership=null},a=n=>{let o=n.data;if(o.kind===`ready`)if(e.removeEventListener(`message`,a),o.ok)r=!0,t({storage:o.storage,sqliteVersion:o.sqliteVersion,warning:o.error,recovery:o.recovery});else{let e=new w(o.error??`SQLite worker failed to start`,o.diagnostic);i(e)}};e.addEventListener(`message`,a),e.addEventListener(`message`,e=>{let t=e.data;if(t.kind!==`result`)return;let n=this.pending.get(t.id);n&&(this.pending.delete(t.id),t.ok?n.resolve(t.rows??[]):n.reject(Error(t.error)))}),e.addEventListener(`error`,()=>{i(Error(`Waffle’s SQLite worker stopped unexpectedly. Reload to reopen the local index; your files are untouched.`))}),e.addEventListener(`messageerror`,()=>{i(Error(`Waffle could not read a SQLite worker response. Reload to reopen the local index; your files are untouched.`))})})}exec(e,t){return this.commands.exec(e,t)}transaction(e){return this.commands.transaction(e)}corruptIndexForDev(){return Promise.reject(Error(`Index corruption probe is unavailable outside development.`))}send(e,t){return this.sendMessage({kind:`exec`,sql:e,params:t})}sendMessage(e){let t=this.worker;if(t===null)return Promise.reject(Error(`SQLite worker is unavailable. Reload Waffle to reopen the local index.`));let n=this.nextId++;return new Promise((r,i)=>{this.pending.set(n,{resolve:r,reject:i}),t.postMessage({...e,id:n})})}},T=()=>{throw Error(`Use getVaultFs() (platform/instance.ts) — platform.fs is not the web vault seam`)},ve={pickRoot:T,read:T,statFile:T,write:T,createDirectory:T,removeEmptyDirectory:T,move:T,remove:T,list:T,watch:T};function ye(){let e=new _e;return{db:e,dbReady:e.ready,fs:ve,net:{fetch:(e,t)=>fetch(e,t)}}}var be=`/vault`;async function xe(){return l(await(await navigator.storage.getDirectory()).getDirectoryHandle(`vault`,{create:!0}),be)}var E=ye(),D=(()=>{let e=`waffle-identity-writer`;try{let t=localStorage.getItem(e);if(t)return t;let n=crypto.randomUUID();return localStorage.setItem(e,n),n}catch{return crypto.randomUUID()}})(),O=xe().then(e=>(o(e,D),e)),k=0,Se=()=>O,Ce=async()=>u(await O,async e=>e.vaultId),we=()=>k,Te=e=>{O.then(e=>c(e)).catch(()=>void 0),o(e,D),O=Promise.resolve(e),k+=1},Ee=(async()=>{let e=await E.dbReady,t=await p(E.db);return{storage:e.storage,sqliteVersion:e.sqliteVersion,schemaVersion:t,warning:e.warning,recovery:e.recovery}})();function A(e=`t`){return`(
    COALESCE(${e}.source, '') != 'vault'
    OR ${e}.type != 'file'
    OR NOT EXISTS (
      SELECT 1
        FROM attachment_reference_candidates attachment_ref
        JOIN toppings attachment_source
          ON attachment_source.id = attachment_ref.source_topping_id
         AND attachment_source.source = 'vault'
         AND attachment_source.type = 'note'
         AND attachment_source.deleted_at IS NULL
       WHERE attachment_ref.candidate_path = ${e}.content_ref
         AND NOT EXISTS (
           SELECT 1
             FROM attachment_reference_candidates prior_ref
             JOIN toppings prior_asset
               ON prior_asset.source = 'vault'
              AND prior_asset.deleted_at IS NULL
              AND prior_asset.content_ref = prior_ref.candidate_path
            WHERE prior_ref.source_topping_id = attachment_ref.source_topping_id
              AND prior_ref.reference_ordinal = attachment_ref.reference_ordinal
              AND prior_ref.priority < attachment_ref.priority
         )
    )
  )`}function j(e=`t`){return`(${e}.type = 'link' OR ${e}.asserted_schema_type IS NOT NULL)`}var De=new Intl.Collator;function Oe(e){return e.home!==`local`||e.path===null?null:e.path===`/`?``:e.path.replace(/^\//,``)}function ke(e,t){return t!==``&&e.startsWith(`${t}/`)}async function M(){let e=await E.db.exec(`
    SELECT f.id, f.parent_id, f.name, f.path, f.home,
      (SELECT COUNT(*) FROM toppings t
        WHERE t.folder_id = f.id
          AND t.deleted_at IS NULL
          AND ${A(`t`)}) AS count
    FROM folders f`),t=new Map(e.map(e=>[e.id,{id:e.id,parentId:e.parent_id,name:e.name,count:e.count,vaultPath:Oe(e),children:[]}])),n=[];for(let e of t.values()){let r=e.parentId?t.get(e.parentId):void 0;r?r.children.push(e):n.push(e)}let r=e=>{e.sort((e,t)=>De.compare(e.name,t.name)),e.forEach(e=>r(e.children))};return r(n),n}function Ae(e){let t=new Map;for(let n of e)!n.thumb_ref||t.has(n.folder_id)||t.set(n.folder_id,{thumbRef:n.thumb_ref,thumbColor:n.thumb_color,...n.updated_at?{updatedAt:n.updated_at}:{}});return t}async function je(e){let t=[...new Set(e)];if(t.length===0)return new Map;let n=t.map(()=>`?`).join(`,`);return Ae(await E.db.exec(`WITH ranked AS (
       SELECT folder_id, thumb_ref, thumb_color, updated_at,
              ROW_NUMBER() OVER (
                PARTITION BY folder_id
                ORDER BY updated_at DESC, id ASC
              ) AS recency_rank
         FROM toppings t
        WHERE t.folder_id IN (${n})
          AND t.deleted_at IS NULL
          AND ${A(`t`)}
          AND NULLIF(thumb_ref, '') IS NOT NULL
     )
     SELECT folder_id, thumb_ref, thumb_color, updated_at
       FROM ranked
      WHERE recency_rank = 1`,t))}async function Me(e){let t=await E.db.exec(`SELECT t.type, COUNT(*) AS count
       FROM toppings t
      WHERE t.folder_id = ? AND t.deleted_at IS NULL
        AND ${A(`t`)}
      GROUP BY t.type
      ORDER BY type`,[e]);return Object.fromEntries(t.map(e=>[e.type,e.count]))}function N(e,t){for(let n of e){if(n.id===t)return n;let e=N(n.children,t);if(e)return e}return null}function Ne(e,t){let n=N(e,t);if(!n)return[t];let r=[],i=e=>{r.push(e.id),e.children.forEach(i)};return i(n),r}async function Pe(e){if(e===null)return``;let t=await E.db.exec(`SELECT path, home FROM folders WHERE id = ?`,[e]);return t[0]?Oe(t[0]):null}var P=`0123456789abcdefghijklmnopqrstuvwxyz`;P[0];var Fe=P[35],F=(e,t)=>t<e.length?P.indexOf(e[t]):0;function I(e,t){let n=e??``,r=t??``;if(r!==``&&n>=r)throw Error(`orderKeyBetween requires a < b (got "${n}" >= "${r}").`);let i=``;for(let e=0;;e+=1){let t=F(n,e),a=r===``?36:e<r.length?P.indexOf(r[e]):36;if(a-t>1)return i+=P[Math.floor((t+a)/2)],i;if(a-t===1){i+=P[t];let r=n.slice(e+1),a=0;for(;;){let e=F(r,a);if(e<35)return i+=P[Math.floor((e+36)/2)],i;i+=Fe,a+=1}}i+=P[t]}}function Ie(e){let t=[],n=null;for(let r=0;r<e;r+=1)n=I(n,null),t.push(n);return t}function Le(e,t,n){let r=new Map(e.map(e=>[e.id,e.orderKey??null])),i=e.filter(e=>e.id!==t),a=n===null?i.length:i.findIndex(e=>e.id===n);if(a===-1)return null;let o=a>0?r.get(i[a-1].id)??null:null,s=a<i.length?r.get(i[a].id)??null:null;return o!==null&&s!==null&&o>=s?null:{previous:o,next:s}}var L={key:`$updated`,dir:`desc`},Re={sorts:[L],filters:null,groupBy:null};function ze({total:e,thumbs:t,docs:n}){return e<4||t/e>=.5?`masonry`:n/e>=.6?`list`:`masonry`}function R(e){if(!Array.isArray(e))return;let t=new Set,r=[];for(let i of e){let e=typeof i==`string`?i:i&&typeof i==`object`&&typeof i.key==`string`?i.key:``;if(!e||e.startsWith(`$`)||t.has(e))continue;t.add(e);let a=i&&typeof i==`object`?n(i.width):160;r.push({key:e,width:a})}return r}function Be(e){if(!e||typeof e!=`object`||Array.isArray(e))return;let t={};for(let[n,r]of Object.entries(e))n&&typeof r==`string`&&r.trim()&&(t[n]=r.trim());return Object.keys(t).length>0?t:void 0}function z(e){if(e===`title`)return[{key:`$title`,dir:`asc`}];if(e===`updated`)return[L];let t=(Array.isArray(e)?e:[e]).flatMap(e=>{if(!e||typeof e!=`object`||Array.isArray(e))return[];let t=e;return typeof t.key!=`string`||!t.key?[]:[{key:t.key,dir:t.dir===`asc`?`asc`:`desc`}]});if(t.find(e=>e.key===`$manual`))return[{key:`$manual`,dir:`asc`}];let n=new Set,r=t.filter(e=>n.has(e.key)?!1:(n.add(e.key),!0));return r.length>0?r:[L]}function B(e){if(typeof e==`string`)return e?{key:e,dir:`asc`}:null;if(!e||typeof e!=`object`)return null;let t=e;return typeof t.key!=`string`||!t.key?null:{key:t.key,dir:t.dir===`desc`?`desc`:`asc`}}function Ve(e,t){try{let n=JSON.parse(e);return JSON.stringify({layout:n.layout,sorts:z(`sorts`in n?n.sorts:n.sort),filters:n.filters,groupBy:`groupBy`in n?B(n.groupBy):t,columns:Array.isArray(n.columns)?R(n.columns)??null:n.columns??null})}catch{return e}}function He(e){let t=JSON.parse(e),n=z(t.sorts??t.sort);t.colSort&&(n=z(t.colSort));let r=B(t.groupBy),i={sorts:n,filters:t.filters??null,groupBy:r},a=R(t.columns);a&&(i.columns=a);let o=Be(t.propertyLabels);if(o&&(i.propertyLabels=o),t.roles&&typeof t.roles==`object`&&!Array.isArray(t.roles)){let e={};for(let[n,r]of Object.entries(t.roles))typeof r==`string`&&r&&(e[n]=r);Object.keys(e).length>0&&(i.roles=e)}if(Array.isArray(t.hidden)){let e=t.hidden.filter(e=>typeof e==`string`&&e!==``);e.length>0&&(i.hidden=e)}return t.origin&&(i.origin={...t.origin,spec:Ve(t.origin.spec,r)}),i}async function V(e,t){let n=await e.exec(`SELECT id, name, layout, config, is_default, position FROM views WHERE folder_id IS ? ORDER BY position, name`,[t]);if(n.length===0){let n=`masonry`;if(t!==null){let r=(await e.exec(`SELECT COUNT(*) AS total,
                COUNT(NULLIF(thumb_ref, '')) AS thumbs,
                SUM(CASE WHEN type IN ('note','link') THEN 1 ELSE 0 END) AS docs
           FROM toppings t
          WHERE t.folder_id = ? AND t.deleted_at IS NULL
            AND ${A(`t`)}`,[t]))[0];n=ze({total:r?.total??0,thumbs:r?.thumbs??0,docs:r?.docs??0})}let r={id:`v_${t??`root`}`,name:`Default`,layout:n,isDefault:!0,position:1,cfg:Re};return await e.exec(`INSERT OR IGNORE INTO views (id, folder_id, name, layout, config, kind, is_default, position) VALUES (?,?,?,?,?,'shared',1,1)`,[r.id,t,r.name,r.layout,JSON.stringify(r.cfg)]),[r]}let r=n.map(e=>({id:e.id,name:e.name,layout:e.layout,isDefault:e.is_default===1,position:e.position,cfg:He(e.config)}));return r.some(e=>e.isDefault)||(r[0].isDefault=!0),r}function Ue(e){return V(E.db,e)}async function H(e,t,n){let r=await e.exec(`SELECT MAX(position) AS maxpos FROM views WHERE folder_id IS ?`,[t]),i={id:`v_${crypto.randomUUID()}`,name:n.name,layout:n.layout,isDefault:!1,position:(r[0]?.maxpos??0)+1,cfg:n.cfg};return await e.exec(`INSERT INTO views (id, folder_id, name, layout, config, kind, is_default, position) VALUES (?,?,?,?,?,'shared',0,?)`,[i.id,t,i.name,i.layout,JSON.stringify(i.cfg),i.position]),i}function We(e,t){return H(E.db,e,t)}async function Ge(e,t){return E.db.transaction(async n=>{let r=await n.exec(`SELECT MAX(position) AS maxpos FROM views WHERE folder_id IS ?`,[e]),i=await n.exec(`SELECT name FROM views WHERE folder_id IS ?`,[e]),a=new Set(i.map(e=>e.name.trim().toLowerCase())),o=[],s=r[0]?.maxpos??0;for(let r of t){let t=r.name.trim().toLowerCase();if(!t||a.has(t))continue;a.add(t);let i={id:`v_${crypto.randomUUID()}`,name:r.name,layout:r.layout,isDefault:!1,position:++s,cfg:r.cfg};await n.exec(`INSERT INTO views (id, folder_id, name, layout, config, kind, is_default, position) VALUES (?,?,?,?,?,'shared',0,?)`,[i.id,e,i.name,i.layout,JSON.stringify(i.cfg),i.position]),o.push(i)}return o})}async function Ke(e,t){await E.db.exec(`UPDATE views SET name = ? WHERE id = ?`,[t,e])}async function U(e,t){await e.exec(`DELETE FROM view_order WHERE view_id = ?`,[t]),await e.exec(`DELETE FROM views WHERE id = ?`,[t])}function qe(e){return U(E.db,e)}async function Je(e,t){await E.db.exec(`UPDATE views SET is_default = 0 WHERE folder_id IS ?`,[e]),await E.db.exec(`UPDATE views SET is_default = 1 WHERE id = ?`,[t])}async function W(e,t,n,r){await e.exec(`UPDATE views SET layout = ?, config = ? WHERE id = ?`,[n,JSON.stringify(r),t])}function Ye(e,t,n){return W(E.db,e,t,n)}async function Xe(e,t,n){await E.db.exec(`INSERT INTO view_order (view_id, topping_id, order_key) VALUES (?,?,?)
       ON CONFLICT(view_id, topping_id) DO UPDATE SET order_key = excluded.order_key`,[e,t,n])}async function Ze(e,t){let n=Ie(t.length),r=new Map;return await E.db.transaction(async i=>{for(let a=0;a<t.length;a+=1){let o=t[a],s=n[a];r.set(o,s),await i.exec(`INSERT INTO view_order (view_id, topping_id, order_key) VALUES (?,?,?)
           ON CONFLICT(view_id, topping_id) DO UPDATE SET order_key = excluded.order_key`,[e,o,s])}}),r}async function Qe(e,t,n){let r=await e.exec(`SELECT MAX(position) AS maxpos FROM views WHERE folder_id IS ?`,[n]);await e.exec(`UPDATE views SET folder_id = ?, is_default = 0, position = ? WHERE id = ?`,[n,(r[0]?.maxpos??0)+1,t])}function $e(e){return{list:t=>V(e,t),create:(t,n)=>H(e,t,n),delete:t=>U(e,t),moveToFolder:(t,n)=>Qe(e,t,n),saveState:(t,n,r)=>W(e,t,n,r)}}function G(e){return e.asserted??e.evidence??e.derived}function et(e,t){return!e||!t||e===t?null:{message:`You set ${e}; this URL derives ${t}`,actionLabel:`Use ${t}`,acceptType:t}}async function tt(e){if(e.length===0)return new Map;let t=e.length<=900,n=await E.db.exec(`SELECT p.topping_id, p.value_text
     FROM properties p JOIN toppings t ON t.id = p.topping_id
     WHERE p.key = 'url' AND ${j(`t`)}
       ${t?`AND p.topping_id IN (${e.map(()=>`?`).join(`,`)})`:``}`,t?e:[]),r=new Set(e),i=new Map;for(let e of n)!e.value_text||!r.has(e.topping_id)||i.set(e.topping_id,e.value_text);return i}async function nt(e){let t=(await E.db.exec(`SELECT t.id, t.asserted_schema_type, p.value_text AS url
       FROM toppings t
       LEFT JOIN properties p ON p.topping_id = t.id AND p.key = 'url'
      WHERE t.source = 'vault' AND t.deleted_at IS NULL AND t.content_ref = ?
      LIMIT 1`,[e]))[0];return t?.asserted_schema_type?{toppingId:t.id,assertedSchemaType:t.asserted_schema_type,url:t.url}:null}async function rt(e){return(await E.db.exec(`SELECT value_text FROM properties WHERE topping_id = ? AND key = 'url'`,[e]))[0]?.value_text??null}var K={eq:`=`,ne:`!=`,lt:`<`,lte:`<=`,gt:`>`,gte:`>=`},q=e=>e.replace(/[\\%_]/g,`\\$&`);function J(e,t){if(e.op!==`cmp`){if(e.children.length===0)return`1`;let n=e.op===`not`?` OR `:` ${e.op.toUpperCase()} `,r=`(`+e.children.map(e=>J(e,t)).join(n)+`)`;return e.op===`not`?`NOT ${r}`:r}if(e.key===`$title`||e.key===`$basename`)return t.push(String(e.value)),e.cmp===`contains`?`INSTR(t.title, ?) > 0`:`t.title ${K[e.cmp]??`=`} ?`;if(e.key===`$name`){let n=String(e.value);t.push(n,`%/${q(n)}`);let r=`(t.content_ref = ? OR t.content_ref LIKE ? ESCAPE '\\')`;return e.cmp===`ne`?`NOT ${r}`:r}if(e.key===`$path`)return t.push(String(e.value)),e.cmp===`contains`?`INSTR(t.content_ref, ?) > 0`:`t.content_ref ${K[e.cmp]??`=`} ?`;if(e.key===`$folder`){let n=`CASE WHEN f.path = '/' THEN '' ELSE SUBSTR(f.path, 2) END`;if(e.cmp===`inFolder`){let r=String(e.value).replace(/^\/+|\/+$/g,``);return t.push(r,`${q(r)}/%`),`(${n} = ? OR ${n} LIKE ? ESCAPE '\\')`}return e.cmp===`startsWith`?(t.push(String(e.value)),`INSTR(${n}, ?) = 1`):(t.push(String(e.value)),e.cmp===`contains`?`INSTR(${n}, ?) > 0`:`${n} ${K[e.cmp]??`=`} ?`)}if(e.key===`$ext`){let n=`%.${q(String(e.value).replace(/^[.]/,``).toLowerCase())}`;return t.push(n),e.cmp===`ne`?`LOWER(t.content_ref) NOT LIKE ? ESCAPE '\\'`:`LOWER(t.content_ref) LIKE ? ESCAPE '\\'`}if(e.key===`$updated`)return t.push(Number(e.value)),`(unixepoch(t.updated_at) * 1000) ${K[e.cmp]??`=`} ?`;if(e.key===`$type`)return t.push(String(e.value)),`t.type = ?`;if(e.key===`$interaction.status`)return t.push(String(e.value)),e.cmp===`ne`?`EXISTS (
        SELECT 1
        FROM private_entity_effective_marks i
        WHERE i.topping_id = t.id AND i.slot IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1
        FROM private_entity_effective_marks i
        WHERE i.topping_id = t.id AND i.slot = ?
      )`:`EXISTS (
      SELECT 1
      FROM private_entity_effective_marks i
      WHERE i.topping_id = t.id AND i.slot = ?
    )`;if(e.key===`$interaction.rating`)return t.push(Number(e.value)),e.cmp===`ne`?`EXISTS (
        SELECT 1
        FROM private_entity_effective_marks i
        WHERE i.topping_id = t.id AND i.rating IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1
        FROM private_entity_effective_marks i
        WHERE i.topping_id = t.id AND i.rating = ?
      )`:`EXISTS (
      SELECT 1
      FROM private_entity_effective_marks i
      WHERE i.topping_id = t.id AND i.rating IS NOT NULL
        AND i.rating ${K[e.cmp]??`=`} ?
    )`;if(e.cmp===`tagged`){let n=String(e.value).replace(/^#/,``).toLowerCase();return t.push(n,`${q(n)}/%`),`EXISTS (
      SELECT 1 FROM topping_tags tt JOIN tags g ON g.id = tt.tag_id
      WHERE tt.topping_id = t.id AND (g.name = ? OR g.name LIKE ? ESCAPE '\\')
    )`}return typeof e.value==`number`||typeof e.value==`boolean`?(t.push(e.key,typeof e.value==`boolean`?+!!e.value:e.value),`EXISTS (SELECT 1 FROM properties p WHERE p.topping_id = t.id AND p.key = ? AND p.value_num ${K[e.cmp]??`=`} ?)`):e.cmp===`contains`?(t.push(e.key,String(e.value),String(e.value)),`EXISTS (
      SELECT 1 FROM properties p
      WHERE p.topping_id = t.id AND p.key = ?
        AND (
          (p.kind = 'list' AND EXISTS (SELECT 1 FROM json_each(p.value_text) j WHERE CAST(j.value AS TEXT) = ?))
          OR (p.kind != 'list' AND INSTR(p.value_text, ?) > 0)
        )
    )`):(t.push(e.key,String(e.value)),`EXISTS (SELECT 1 FROM properties p WHERE p.topping_id = t.id AND p.key = ? AND p.value_text ${K[e.cmp]??`=`} ?)`)}function it(e){if(!e||e.op===`not`||e.op===`or`)return null;if(e.op===`cmp`)return e.key===`$folder`&&(e.cmp===`inFolder`||e.cmp===`eq`)?String(e.value):null;for(let t of e.children){let e=it(t);if(e!==null)return e}return null}function Y(e){return!e||e.op===`not`||e.op===`or`?!1:e.op===`cmp`?e.key===`$folder`&&(e.cmp===`inFolder`||e.cmp===`startsWith`):e.children.some(Y)}function at(e,t){return e===null||Y(t)}async function ot(e,t,n){let r=[],i=``,a,o=t.sorts.length>0?t.sorts:[L],s=o[0]?.key===`$manual`;if(s)i=`LEFT JOIN view_order vo ON vo.topping_id = t.id AND vo.view_id = ?`,r.push(n??``),a=`(vo.order_key IS NULL) ASC, vo.order_key ASC, t.updated_at DESC`;else{let e=[],t=[];for(let[n,i]of o.entries()){let a=i.dir===`asc`?`ASC`:`DESC`;if(i.key===`$updated`)t.push(`t.updated_at ${a}`);else if(i.key===`$created`)t.push(`t.created_at ${a}`);else if(i.key===`$title`||i.key===`$basename`||i.key===`$name`)t.push(`t.title COLLATE NOCASE ${a}`);else if(i.key===`$path`)t.push(`t.content_ref COLLATE NOCASE ${a}`);else if(i.key===`$folder`)t.push(`f.path COLLATE NOCASE ${a}`);else{let o=`s${n}`;e.push(`LEFT JOIN properties ${o} ON ${o}.topping_id = t.id AND ${o}.key = ?`),r.push(i.key),t.push(`(${o}.topping_id IS NULL) ASC`,`${o}.value_num ${a}`,`${o}.value_text COLLATE NOCASE ${a}`)}}i=e.join(` `),a=[...t,`t.id ASC`].join(`, `)}let c=``;e&&!Y(t.filters)&&(c+=` AND t.folder_id = ?`,r.push(e)),t.filters&&(c+=` AND ${J(t.filters,r)}`);let l=(await E.db.exec(`SELECT t.id, t.type, t.title, t.content_ref, t.source, f.name AS folder, t.updated_at, t.thumb_ref, t.thumb_color, t.thumb_aspect, t.asserted_schema_type${s?`, vo.order_key`:``}
     FROM toppings t JOIN folders f ON f.id = t.folder_id ${i}
     WHERE t.deleted_at IS NULL AND ${A(`t`)} ${c}
     ORDER BY ${a}`,r)).map(e=>({id:e.id,type:e.type,title:e.title,subtitle:e.folder,contentRef:e.source===`vault`?e.content_ref:null,assertedSchemaType:e.asserted_schema_type,updatedAt:e.updated_at,thumbRef:e.thumb_ref,thumbColor:e.thumb_color,aspect:e.thumb_aspect,...s?{orderKey:e.order_key??null}:{}})),u=await lt(l.map(e=>e.id));for(let e of l){let t=u.get(e.id);t&&(e.interactionMarks=t)}return await st(l),l}async function X(){let[e,t]=await Promise.all([E.db.exec(`SELECT id, name, labels FROM status_sets`),E.db.exec(`SELECT match_value, set_id FROM status_set_bindings
        WHERE match_kind = 'schema_type'
        ORDER BY match_value, set_id`)]);return{sets:new Map(e.map(e=>[e.id,{id:e.id,name:e.name,labels:ut(e.labels)}])),bindings:t.map(e=>({schemaType:e.match_value,setId:e.set_id}))}}async function st(e){let n=e.filter(t);if(n.length===0)return;let[r,i]=await Promise.all([tt(n.map(e=>e.id)),X()]);for(let e of n){let t=e.interactionMarks?.[0]?.setId??null,n=e.assertedSchemaType??null,o=t||n?null:r.get(e.id),s=i.sets.get(a({pinnedSetId:t,schemaType:G({asserted:n,evidence:null,derived:o?d(o)?.type??null:null}),bindings:i.bindings}));s&&(e.statusSet=s)}}var ct=new Set([`queued`,`active`,`done`,`dropped`]);async function lt(e){if(e.length===0)return new Map;let t=e.length<=900,n=await E.db.exec(`SELECT i.topping_id, i.set_id, s.name AS set_name, s.labels, i.slot, i.rating
     FROM private_entity_effective_marks i
     JOIN status_sets s ON s.id = i.set_id
     WHERE (i.slot IS NOT NULL OR i.rating IS NOT NULL)
       ${t?`AND i.topping_id IN (${e.map(()=>`?`).join(`,`)})`:``}
     ORDER BY i.updated_at DESC, i.set_id`,t?e:[]),r=new Set(e),i=new Map;for(let e of n){if(!r.has(e.topping_id))continue;let t=e.slot&&ct.has(e.slot)?e.slot:null,n=ut(e.labels),a={setId:e.set_id,setName:e.set_name,slot:t,statusLabel:t?n[t]??t:null,rating:e.rating},o=i.get(e.topping_id)??[];o.push(a),i.set(e.topping_id,o)}return i}function ut(e){try{let t=JSON.parse(e),n={};for(let e of ct)typeof t[e]==`string`&&(n[e]=t[e]);return n}catch{return{}}}function dt(e,t){switch(e.kind){case`number`:return e.value;case`money`:return e.amount;case`duration`:return e.seconds;case`checkbox`:return+!!e.value;case`date`:return Date.parse(e.iso)||0;default:return t.toLowerCase()}}async function ft(t,n,r){let i=n.key,a=new Map;if(!i.startsWith(`$`)&&r.length>0){let t=JSON.stringify([...new Set(r.map(e=>e.id))]),n=await E.db.exec(`SELECT p.topping_id, p.kind, p.value_text, p.value_num, p.value_aux
       FROM json_each(?) scope
       CROSS JOIN properties p ON p.topping_id = scope.value
       WHERE p.key = ?`,[t,i]),o=new Map;for(let t of n){let n=JSON.stringify([t.kind,t.value_text,t.value_num,t.value_aux]),r=o.get(n);if(r===void 0){let i=s(t.kind,t.value_text,t.value_num,t.value_aux);if(i===null)r=null;else{let t=e(i);r={label:t,order:dt(i,t)}}o.set(n,r)}r&&a.set(t.topping_id,r)}}let o=new Map;for(let e of r){let t=a.get(e.id),n=i===`$title`||i===`$basename`?e.title:i===`$name`?e.contentRef?.split(`/`).pop()??null:i===`$path`?e.contentRef??null:i===`$folder`?e.contentRef?.split(`/`).slice(0,-1).join(`/`)??null:i===`$ext`?e.contentRef?.split(`.`).pop()?.toLowerCase()??null:i===`$updated`?e.updatedAt??null:i===`$type`?e.type:null,r=t?t.label:n||`No ${i}`,s=t?t.order:n?i===`$updated`?Date.parse(n):n.toLowerCase():null,c=o.get(r)??{order:s,items:[]};c.items.push(e),o.set(r,c)}let c=n.dir===`desc`?-1:1,l=[...o.entries()].sort(([,e],[,t])=>e.order===null?1:t.order===null?-1:typeof e.order==`number`&&typeof t.order==`number`?(e.order-t.order)*c:De.compare(String(e.order),String(t.order))*c);return{items:l.flatMap(([,e])=>e.items),groups:l.map(([e,t])=>({label:e,count:t.items.length}))}}async function pt(e){return e.length===0?[]:(await E.db.exec(`SELECT DISTINCT t.content_ref
       FROM properties p JOIN toppings t ON t.id = p.topping_id
      WHERE t.source = 'vault' AND t.deleted_at IS NULL AND t.content_ref IS NOT NULL
        AND p.key IN (${e.map(()=>`?`).join(`,`)})`,e)).map(e=>e.content_ref)}async function mt(e){let t=e?`AND t.folder_id = ?`:``;return ht(await E.db.exec(`SELECT p.key, p.kind, COUNT(*) AS item_count
       FROM properties p JOIN toppings t ON t.id = p.topping_id
      WHERE t.deleted_at IS NULL AND ${A(`t`)} ${t}
      GROUP BY p.key, p.kind
      ORDER BY p.key, item_count DESC, p.kind`,e?[e]:[])).map(({key:e,kind:t})=>({key:e,kind:t}))}function ht(e){let t=new Map;for(let n of e){let e=t.get(n.key);(!e||n.item_count>e.item_count||n.item_count===e.item_count&&n.kind.localeCompare(e.kind)<0)&&t.set(n.key,n)}return[...t.values()].sort((e,t)=>e.key.localeCompare(t.key)).map(({key:e,kind:t,item_count:n})=>({key:e,kind:t,itemCount:n}))}async function gt(e){let t=e===null?``:`AND t.folder_id = ?`,n=e===null?[]:[e],[r,i]=await Promise.all([E.db.exec(`SELECT COUNT(*) AS live_item_count
         FROM toppings t
        WHERE t.deleted_at IS NULL
          AND ${A(`t`)} ${t}`,n),E.db.exec(`SELECT p.key, p.kind, COUNT(DISTINCT t.id) AS item_count
         FROM properties p
         JOIN toppings t ON t.id = p.topping_id
        WHERE t.deleted_at IS NULL
          AND ${A(`t`)} ${t}
        GROUP BY p.key, p.kind
        ORDER BY p.key, item_count DESC, p.kind`,n)]);return{liveItemCount:r[0]?.live_item_count??0,fields:ht(i)}}async function _t(e){let t=e?`AND t.folder_id = ?`:``,n=await E.db.exec(`SELECT p.key,
       SUM(CASE
         WHEN p.value_text IS NULL
           OR LENGTH(TRIM(p.value_text)) != 3
           OR UPPER(TRIM(p.value_text)) GLOB '*[^A-Z]*'
         THEN 1 ELSE 0 END) AS invalid,
       GROUP_CONCAT(DISTINCT CASE
         WHEN p.value_text IS NOT NULL
           AND LENGTH(TRIM(p.value_text)) = 3
           AND UPPER(TRIM(p.value_text)) NOT GLOB '*[^A-Z]*'
         THEN UPPER(TRIM(p.value_text)) END) AS codes
     FROM properties p JOIN toppings t ON t.id = p.topping_id
     WHERE t.deleted_at IS NULL
       AND ${A(`t`)}
       AND p.kind IN ('text', 'select') ${t}
     GROUP BY p.key ORDER BY p.key`,e?[e]:[]),r=typeof Intl.supportedValuesOf==`function`?new Set(Intl.supportedValuesOf(`currency`)):null;return n.filter(e=>e.invalid>0||!e.codes?!1:e.codes.split(`,`).every(e=>{if(r)return r.has(e);try{return new Intl.NumberFormat(`en`,{style:`currency`,currency:e}),!0}catch{return!1}})).map(e=>e.key)}async function vt(e,t={}){if(t.itemIds?.length===0)return new Map;let n=[],r=[`t.deleted_at IS NULL`,A(`t`)];e&&(r.push(`t.folder_id = ?`),n.push(e)),t.kinds?.length&&(r.push(`p.kind IN (${t.kinds.map(()=>`?`).join(`,`)})`),n.push(...t.kinds)),t.itemIds!==void 0&&t.itemIds.length<=900&&(r.push(`p.topping_id IN (${t.itemIds.map(()=>`?`).join(`,`)})`),n.push(...t.itemIds));let i=await E.db.exec(`SELECT p.topping_id, p.key, p.kind, p.value_text, p.value_num, p.value_aux
     FROM properties p JOIN toppings t ON t.id = p.topping_id
     WHERE ${r.join(` AND `)}`,n),a=t.itemIds?new Set(t.itemIds):null,o=new Map;for(let e of i){if(a&&!a.has(e.topping_id))continue;let t=s(e.kind,e.value_text,e.value_num,e.value_aux);if(!t)continue;let n=o.get(e.topping_id);n||o.set(e.topping_id,n={}),n[e.key]=t}return o}async function yt(e,t){let n=await E.db.exec(`SELECT t.id, t.title, t.content_ref, p.key, p.kind, p.value_text, p.value_num, p.value_aux
       FROM toppings t JOIN properties p ON p.topping_id = t.id AND p.key IN (?, ?)
      WHERE t.source = 'vault' AND t.deleted_at IS NULL AND t.type = 'note'`,[e,t]),r=new Map;for(let e of n){let t=s(e.kind,e.value_text,e.value_num,e.value_aux);if(!t)continue;let n=r.get(e.id);n||r.set(e.id,n={id:e.id,title:e.title,contentRef:e.content_ref,props:{}}),n.props[e.key]=t}return[...r.values()]}function bt(e){let t={total:0,byType:{},bytes:0,unsized:0};for(let n of e)t.total+=n.item_count,t.byType[n.type]=(t.byType[n.type]??0)+n.item_count,t.bytes+=n.size_bytes??0,t.unsized+=n.unsized_count;return t}async function xt(){return bt(await E.db.exec(`SELECT t.type,
            SUM(CASE WHEN ${A(`t`)} THEN 1 ELSE 0 END) AS item_count,
            SUM(t.stat_size) AS size_bytes,
            SUM(CASE WHEN t.stat_size IS NULL THEN 1 ELSE 0 END) AS unsized_count
       FROM toppings t
      WHERE t.source = 'vault'
        AND t.deleted_at IS NULL
      GROUP BY t.type
      ORDER BY t.type`))}async function St(){return(await E.db.exec(`SELECT COUNT(*) AS count
       FROM content_documents
      WHERE status = 'pending'`))[0]?.count??0}async function Ct(e){let t=(await E.db.exec(`SELECT status, media_type, page_count, detail
       FROM content_documents
      WHERE topping_id = ?`,[e]))[0];return t?{status:t.status,mediaType:t.media_type,pageCount:t.page_count,detail:t.detail}:null}function wt(e){let t=e.replace(/[\u0000-\u001f\u007f]/g,` `).split(/\s+/).filter(Boolean);return t.length===0?null:t.map(e=>`"${e.replaceAll(`"`,`""`)}"*`).join(` `)}async function Tt(e,t){let n=wt(e);if(n===null||t!==null&&t.length===0)return{results:[],truncated:!1};let r=[],i=``;t!==null&&(i=`AND t.folder_id IN (${t.map(()=>`?`).join(`,`)})`,r.push(...t));let a=[n,...r,n,...r],o=await E.db.exec(`WITH topping_matches AS (
       SELECT 'topping:' || t.id AS result_key,
              t.id, t.type, t.title, t.content_ref, t.source, t.folder_id,
              f.name AS folder_name,
              highlight(toppings_fts, 1, char(1), char(2)) AS title_marked,
              snippet(toppings_fts, 2, char(1), char(2), '…', 12) AS body_snippet,
              NULL AS anchor_page,
              bm25(toppings_fts, 0.0, 10.0, 1.0, 5.0) AS rank
         FROM toppings_fts
         JOIN toppings t ON t.id = toppings_fts.topping_id
         JOIN folders f ON f.id = t.folder_id
        WHERE toppings_fts MATCH ? AND t.deleted_at IS NULL ${i}
     ),
     content_hits AS (
       SELECT 'pdf:' || t.id || ':' || content_chunks_fts.anchor_page AS result_key,
              t.id, t.type, t.title, t.content_ref, t.source, t.folder_id,
              f.name AS folder_name,
              t.title AS title_marked,
              snippet(content_chunks_fts, 3, char(1), char(2), '…', 18) AS body_snippet,
              CAST(content_chunks_fts.anchor_page AS INTEGER) AS anchor_page,
              CAST(content_chunks_fts.ordinal AS INTEGER) AS ordinal,
              bm25(content_chunks_fts, 0.0, 0.0, 0.0, 1.0) AS rank
         FROM content_chunks_fts
         JOIN toppings t ON t.id = content_chunks_fts.topping_id
         JOIN folders f ON f.id = t.folder_id
        WHERE content_chunks_fts MATCH ? AND t.deleted_at IS NULL ${i}
     ),
     content_ranked AS (
       SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY id, anchor_page
                ORDER BY rank ASC, ordinal ASC
              ) AS page_match
         FROM content_hits
     ),
     matches AS (
       SELECT * FROM topping_matches
       UNION ALL
       SELECT result_key, id, type, title, content_ref, source, folder_id,
              folder_name, title_marked, body_snippet, anchor_page, rank
         FROM content_ranked
        WHERE page_match = 1
     )
     SELECT *
       FROM matches
      ORDER BY rank ASC, result_key ASC
      LIMIT 101`,a),s=o.length>100;return{results:o.slice(0,100).map(e=>({resultKey:e.result_key,id:e.id,type:e.type,title:e.title,titleMarked:e.title_marked,snippet:e.body_snippet,contentRef:e.source===`vault`?e.content_ref:null,folderId:e.folder_id,folderName:e.folder_name,anchor:e.anchor_page===null?null:{kind:`page`,page:e.anchor_page}})),truncated:s}}function Et(e,n,a,o){let s=new Map;for(let e of n)s.set(e.topping_id,[...s.get(e.topping_id)??[],e]);let c=new Map;for(let e of a)c.set(e.topping_id,[...c.get(e.topping_id)??[],e.name]);let l=new Map,u=e.map(e=>{let n=new Set;if(t({type:e.type,assertedSchemaType:e.asserted_schema_type})){let t=s.get(e.id)?.find(e=>e.key===`url`)?.value_text??null,a=i(t);if(a){let e=`host:${a}`;n.add(e),l.set(e,`${a} links`)}let o=e.asserted_schema_type??(t?d(t)?.type??null:null);if(o){let e=`schema:${o}`;n.add(e),l.set(e,`${r(o)} links`)}}else{for(let t of s.get(e.id)??[]){let e=`property:${t.key}`;n.add(e),l.set(e,`notes with “${t.key}”`)}for(let t of c.get(e.id)??[]){let e=`tag:${t}`;n.add(e),l.set(e,`#${t} notes`)}}return{toppingId:e.id,folderId:e.folder_id,signals:[...n].sort()}}),f=new Map;for(let e of u)for(let t of e.signals){let n=f.get(t)??{label:l.get(t)??t,byFolder:new Map,total:0};n.byFolder.set(e.folderId,(n.byFolder.get(e.folderId)??0)+1),n.total+=1,f.set(t,n)}let p=new Map(f),m=new Map(e.map(e=>[e.id,e])),h=new Map;for(let e of me({items:u,tallies:p})){let t=o.get(e.targetFolderId);if(!t)continue;let n=h.get(e.targetFolderId)??{target:t,reasons:new Set,fingerprints:[],items:new Map};n.reasons.add(e.reason),n.fingerprints.push(e.fingerprint);for(let t of e.toppingIds){let e=m.get(t);e&&n.items.set(t,{id:t,title:e.title,path:e.content_ref,sourceFolderName:e.folder_name})}h.set(e.targetFolderId,n)}return[...h].flatMap(([e,t])=>{let n=[...t.items.values()].sort((e,t)=>e.id.localeCompare(t.id));return n.length===0?[]:[{basis:`signals`,targetFolderId:e,targetFolderName:t.target.name,targetFolderPath:t.target.path,reason:[...t.reasons].join(` · `),fingerprint:JSON.stringify(t.fingerprints.sort()),items:n}]}).sort((e,t)=>t.items.length-e.items.length||e.targetFolderId.localeCompare(t.targetFolderId))}function Z(e){let t=0;for(let n of e)t+=n*n;if(!Number.isFinite(t)||t<=2**-52)return null;let n=Math.sqrt(t),r=new Float32Array(384);for(let t=0;t<r.length;t++)r[t]=e[t]/n;return r}function Dt(e){if(e.length===0)return null;let t=new Float64Array(384);for(let n of e){if(n.length!==384)return null;for(let e=0;e<n.length;e++){let r=n[e];if(!Number.isFinite(r))return null;t[e]+=r}}return Z(t)}function Q(e,t){if(e.count<=1)return null;let n=new Float64Array(384);for(let r=0;r<n.length;r++)n[r]=e.sum[r]-t.vector[r];return Z(n)}function Ot(e){let t=new Map;for(let n of e)t.set(n.folderId,[...t.get(n.folderId)??[],n]);let n=new Map;for(let[e,r]of t){if(r.length<3)continue;let t=new Float64Array(384);for(let e of r)for(let n=0;n<e.vector.length;n++)t[n]+=e.vector[n];let i=Z(t);if(!i)continue;let a={folderId:e,count:r.length,sum:t,centroid:i,coherence:0},o=0,s=0;for(let e of r){let t=Q(a,e);t&&(o+=b(e.vector,t),s+=1)}a.coherence=s===r.length?o/s:-1/0,n.set(e,a)}return n}function $(e){return e.toFixed(2)}function kt(e,t,n=new Set){let r=e.flatMap(e=>{let t=Dt(e.vectors);return t?[{...e,vector:t}]:[]}),i=Ot(r),a=[...i.values()].filter(e=>e.coherence>=.93&&t.has(e.folderId));if(a.length===0||r.length*a.length>5e5)return[];let o=[];for(let e of r){if(n.has(e.id))continue;let t=i.get(e.folderId);if(t&&t.coherence>=.93){let n=Q(t,e);if(n&&t.count-1>=3&&b(e.vector,n)>=.86)continue}let r=null,s=-1/0,c=-1/0;for(let t of a){if(t.folderId===e.folderId)continue;let n=b(e.vector,t.centroid);n>s?(c=s,r=t,s=n):n>c&&(c=n)}if(!r||s<.86)continue;let l=t?Q(t,e):null;l&&(c=Math.max(c,b(e.vector,l)));let u=c===-1/0?1+s:s-c;u<.05||o.push({item:e,target:r,score:s,margin:u})}let s=new Map;for(let e of o)s.set(e.target.folderId,[...s.get(e.target.folderId)??[],e]);return[...s].flatMap(([e,n])=>{let r=t.get(e);if(!r||n.length===0)return[];n.sort((e,t)=>e.item.id.localeCompare(t.item.id));let i=n[0].target.count,a=Math.min(...n.map(e=>e.score)),o=Math.min(...n.map(e=>e.margin)),s=n.map(({item:e})=>({id:e.id,title:e.title,path:e.path,sourceFolderName:e.folderName}));return[{basis:`semantic`,targetFolderId:e,targetFolderName:r.name,targetFolderPath:r.path,reason:`Each local content vector matches this folder's ${i}-item profile (coherence ${$(n[0].target.coherence)}) at ${$(a)} or better, at least ${$(o)} beyond every alternative`,fingerprint:[`semantic`,m,h,1,...s.map(e=>e.id)].join(`\0`),items:s}]}).sort((e,t)=>t.items.length-e.items.length||e.targetFolderId.localeCompare(t.targetFolderId))}async function At(e,t){let n=i(e),[a,o]=await Promise.all([n===null?Promise.resolve([]):E.db.exec(`SELECT t.folder_id, p.value_text
       FROM properties p JOIN toppings t ON t.id = p.topping_id
       WHERE p.key = 'url' AND ${j(`t`)} AND t.deleted_at IS NULL`),E.db.exec(`SELECT folder_id FROM toppings
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 50`)]),s=e===null?null:d(e),c=new Map,l=new Map;for(let e of a)e.value_text&&(i(e.value_text)===n&&c.set(e.folder_id,(c.get(e.folder_id)??0)+1),s&&d(e.value_text)?.type===s.type&&l.set(e.folder_id,(l.get(e.folder_id)??0)+1));let u=[];for(let e of o)u.includes(e.folder_id)||u.push(e.folder_id);return{...s?{type:{value:s.type,label:r(s.type),tallies:jt(l)}}:{},...n?{domain:{value:n,label:n,tallies:jt(c)}}:{},recent:u,currentFolderId:t}}function jt(e){return[...e].map(([e,t])=>({folderId:e,count:t}))}async function Mt(){let[e,t,n,r]=await Promise.all([E.db.exec(`SELECT t.id, t.type, t.title, t.folder_id, f.name AS folder_name,
              t.content_ref, t.asserted_schema_type
         FROM toppings t
         JOIN folders f ON f.id = t.folder_id
        WHERE t.source = 'vault'
          AND t.deleted_at IS NULL
          AND t.content_ref IS NOT NULL
          AND t.type IN ('note', 'link')
        ORDER BY t.id`),E.db.exec(`SELECT p.topping_id, p.key, p.value_text
         FROM properties p
         JOIN toppings t ON t.id = p.topping_id
        WHERE t.source = 'vault'
          AND t.deleted_at IS NULL
          AND (
            (NOT ${j(`t`)} AND t.type = 'note')
            OR (${j(`t`)} AND p.key = 'url')
          )
        ORDER BY p.topping_id, p.key`),E.db.exec(`SELECT tt.topping_id, tags.name
         FROM topping_tags tt
         JOIN tags ON tags.id = tt.tag_id
         JOIN toppings t ON t.id = tt.topping_id
        WHERE t.source = 'vault'
          AND t.type = 'note'
          AND NOT ${j(`t`)}
          AND t.deleted_at IS NULL
        ORDER BY tt.topping_id, tags.name`),M()]),i=new Map,a=e=>{e.vaultPath!==null&&i.set(e.id,{name:e.vaultPath===``?`Vault`:e.vaultPath,path:e.vaultPath}),e.children.forEach(a)};return r.forEach(a),Et(e,t,n,i)}async function Nt(e=new Set){let t=(await E.db.exec(`SELECT COUNT(*) AS total,
            SUM(CASE WHEN document.status = 'indexed'
                      AND document.model_id = ?
                      AND document.model_revision = ?
                      AND document.processor_version = ?
                     THEN 1 ELSE 0 END) AS indexed
       FROM toppings t
       JOIN toppings_fts_rows fts ON fts.topping_id = t.id
       LEFT JOIN semantic_embedding_documents document
         ON document.topping_id = t.id
      WHERE t.source = 'vault'
        AND t.deleted_at IS NULL
        AND t.content_ref IS NOT NULL
        AND t.content_ref NOT LIKE '.trash/%'
        AND ${A(`t`)}`,[m,h,1]))[0];if(!t||t.total===0||t.indexed!==t.total)return[];let n=await M(),r=new Map,i=0,a=e=>{e.vaultPath!==null&&(r.set(e.id,{name:e.vaultPath===``?`Vault`:e.vaultPath,path:e.vaultPath}),e.count>=3&&(i+=1)),e.children.forEach(a)};if(n.forEach(a),i===0||t.total*i>5e5)return[];let o=await E.db.exec(`SELECT t.id, t.title, t.folder_id, folder.name AS folder_name,
              t.content_ref, embedding.vector
         FROM semantic_embeddings embedding
         JOIN semantic_embedding_documents document
           ON document.topping_id = embedding.topping_id
          AND document.source_revision = embedding.source_revision
          AND document.model_id = embedding.model_id
          AND document.model_revision = embedding.model_revision
          AND document.processor_version = embedding.processor_version
          AND document.status = 'indexed'
         JOIN toppings t ON t.id = embedding.topping_id
         JOIN toppings_fts_rows fts ON fts.topping_id = t.id
         JOIN folders folder ON folder.id = t.folder_id
        WHERE embedding.model_id = ?
          AND embedding.model_revision = ?
          AND embedding.processor_version = ?
          AND embedding.dimensions = ?
          AND t.source = 'vault'
          AND t.deleted_at IS NULL
          AND t.content_ref IS NOT NULL
          AND t.content_ref NOT LIKE '.trash/%'
          AND ${A(`t`)}
        ORDER BY t.id, embedding.segment_kind,
                 embedding.anchor_page, embedding.ordinal`,[m,h,1,384]),s=new Map;for(let e of o){let t=s.get(e.id);t||(t={id:e.id,title:e.title,folderId:e.folder_id,folderName:e.folder_name,path:e.content_ref,vectors:[]},s.set(e.id,t)),t.vectors.push(y(e.vector))}return s.size===t.total?kt([...s.values()],r,e):[]}export{re as $,Ye as A,Pe as B,We as C,Ue as D,Ze as E,Ne as F,we as G,j as H,N as I,Te as J,E as K,Me as L,$e as M,I as N,Ke as O,Le as P,ie as Q,M as R,G as S,qe as T,Ce as U,ke as V,Se as W,xe as X,be as Y,g as Z,X as _,St as a,oe as at,nt as b,_t as c,y as ct,mt as d,le as dt,ee as et,vt as f,b as ft,ot as g,ft as h,Ct as i,h as it,Je as j,Xe as k,pt as l,ce as lt,it as m,Nt as n,te as nt,Tt as o,_ as ot,yt as p,v as pt,Ee as q,Mt as r,ne as rt,xt as s,fe as st,At as t,m as tt,gt as u,de as ut,at as v,Ge as w,et as x,rt as y,je as z};