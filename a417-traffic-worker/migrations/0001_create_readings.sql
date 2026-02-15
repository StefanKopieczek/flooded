-- readings: one row per Mapbox poll (every minute)
CREATE TABLE IF NOT EXISTS readings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT    NOT NULL,
  status        TEXT    NOT NULL,  -- HAS_LIVE_DATA | NO_LIVE_DATA | NO_MATCH | NO_DATA | ERROR
  has_live_data INTEGER NOT NULL DEFAULT 0,
  avg_speed_mph REAL,
  confidence    REAL,
  geometry_json TEXT,              -- GeoJSON geometry from Mapbox match
  segments_json TEXT               -- per-segment speed/congestion detail
);

-- Index for the aggregation query (last N minutes)
CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings (timestamp DESC);
