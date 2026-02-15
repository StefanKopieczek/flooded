/**
 * A417 Maisemore–Over Roundabout Traffic Monitor
 *
 * Cloudflare Worker using:
 *   - Cron Trigger (every minute) → polls Mapbox Map Matching API, writes to D1
 *   - HTTP GET / → reads last 30 mins from D1, returns aggregated status
 *
 * Secrets: MAPBOX_ACCESS_TOKEN
 * Bindings: DB (D1 database)
 */

interface Env {
  MAPBOX_ACCESS_TOKEN: string;
  DB: D1Database;
}

// ── Mapbox types ─────────────────────────────────────────────────────

interface MapboxMatchResponse {
  code: string;
  matchings: MapboxMatching[];
  tracepoints: Array<{ name: string; location: [number, number] } | null>;
}

interface MapboxMatching {
  distance: number;
  duration: number;
  confidence: number;
  geometry: {
    type: string;
    coordinates: Array<[number, number]>;
  };
  legs: MapboxLeg[];
}

interface MapboxLeg {
  distance: number;
  duration: number;
  annotation?: {
    speed?: number[];
    congestion?: string[];
    distance?: number[];
  };
}

// ── Reading status (per-poll) ────────────────────────────────────────

type ReadingStatus =
  | "NO_MATCH"
  | "NO_DATA"
  | "HAS_LIVE_DATA"
  | "NO_LIVE_DATA"
  | "ERROR";

// ── Aggregated status (returned by fetch) ────────────────────────────

type AggregatedStatus =
  | "LIKELY_OPEN"
  | "NO_LIVE_DATA"
  | "INSUFFICIENT_DATA";

// ── Config ───────────────────────────────────────────────────────────

const A417_TRACE: Array<[number, number]> = [
  [-2.2672733370840206, 51.888305076674015],
  [-2.2668528388330174, 51.88795285594853],
  [-2.2666425897068905, 51.88736890498075],
  [-2.2668528388330174, 51.886275135135094],
  [-2.2670030167795403, 51.88523695608393],
  [-2.2672132659056956, 51.8840967853921],
  [-2.2674986040050555, 51.88338300528022],
  [-2.2669491352942828, 51.87975523263444],
  [-2.2661210690561404, 51.87771425224227],
  [-2.2653322694025917, 51.876520401209234],
];

const MAPBOX_MATCHING_URL =
  "https://api.mapbox.com/matching/v5/mapbox/driving-traffic";

const AGGREGATION_WINDOW_MINUTES = 30;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Worker entry ─────────────────────────────────────────────────────

export default {
  /**
   * HTTP handler – aggregates last 30 mins of D1 readings.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const url = new URL(request.url);
      const sinceParam = url.searchParams.get("since"); // ISO 8601 datetime
      const data = await aggregateReadings(env.DB, sinceParam);
      return jsonResponse(data, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return jsonResponse({ error: message }, 500);
    }
  },

  /**
   * Cron handler – polls Mapbox and writes a reading to D1.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(pollAndStore(env));
  },
} satisfies ExportedHandler<Env>;

// ── Scheduled: poll Mapbox and write to D1 ───────────────────────────

async function pollAndStore(env: Env): Promise<void> {
  const now = new Date().toISOString();

  try {
    const result = await fetchMapbox(env.MAPBOX_ACCESS_TOKEN);

    await env.DB.prepare(
      `INSERT INTO readings (timestamp, status, has_live_data, avg_speed_mph, confidence, geometry_json, segments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        now,
        result.status,
        result.hasLiveData ? 1 : 0,
        result.avgSpeedMph,
        result.confidence,
        result.geometryJson,
        result.segmentsJson
      )
      .run();

    console.log(
      `[Cron] Stored reading: status=${result.status}, speed=${result.avgSpeedMph?.toFixed(1) ?? "null"} mph, live=${result.hasLiveData}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Cron] Error: ${message}`);

    // Store error reading so we know the poll ran
    await env.DB.prepare(
      `INSERT INTO readings (timestamp, status, has_live_data, avg_speed_mph, confidence, geometry_json, segments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(now, "ERROR", 0, null, null, null, null)
      .run();
  }

  // Prune readings older than 7 days to keep D1 tidy
  await env.DB.prepare(
    `DELETE FROM readings WHERE timestamp < datetime('now', '-7 days')`
  ).run();
}

// ── Mapbox Map Matching ──────────────────────────────────────────────

interface MapboxResult {
  status: ReadingStatus;
  hasLiveData: boolean;
  avgSpeedMph: number | null;
  confidence: number | null;
  geometryJson: string | null;
  segmentsJson: string | null;
}

async function fetchMapbox(token: string): Promise<MapboxResult> {
  if (!token) throw new Error("MAPBOX_ACCESS_TOKEN is not configured");

  const coordinates = A417_TRACE.map((c) => c.join(",")).join(";");
  const params = new URLSearchParams({
    access_token: token,
    annotations: "speed,congestion,distance",
    overview: "full",
    geometries: "geojson",
    radiuses: A417_TRACE.map(() => "25").join(";"),
  });

  const res = await fetch(`${MAPBOX_MATCHING_URL}/${coordinates}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mapbox API returned ${res.status}: ${body}`);
  }

  const raw: MapboxMatchResponse = await res.json();

  if (raw.code !== "Ok" || !raw.matchings?.length) {
    return {
      status: "NO_MATCH",
      hasLiveData: false,
      avgSpeedMph: null,
      confidence: null,
      geometryJson: null,
      segmentsJson: null,
    };
  }

  const matching = raw.matchings[0];
  const allSpeeds: number[] = [];
  const allCongestion: string[] = [];
  const allDistances: number[] = [];

  for (const leg of matching.legs) {
    if (leg.annotation?.speed) allSpeeds.push(...leg.annotation.speed);
    if (leg.annotation?.congestion)
      allCongestion.push(...leg.annotation.congestion);
    if (leg.annotation?.distance) allDistances.push(...leg.annotation.distance);
  }

  if (allSpeeds.length === 0) {
    return {
      status: "NO_DATA",
      hasLiveData: false,
      avgSpeedMph: null,
      confidence: matching.confidence,
      geometryJson: JSON.stringify(matching.geometry),
      segmentsJson: null,
    };
  }

  const hasLiveData = allCongestion.some((c) => c !== "unknown");

  // Only average speeds from segments with live congestion data
  const liveSpeedsMph: number[] = [];
  const segments = allSpeeds.map((s, i) => {
    const congestion = allCongestion[i] ?? "unknown";
    if (congestion !== "unknown") {
      liveSpeedsMph.push(mpsToMph(s));
    }
    return {
      speedMph: mpsToMph(s),
      congestion,
      distanceM: Math.round((allDistances[i] ?? 0) * 10) / 10,
    };
  });

  const avgSpeedMph =
    liveSpeedsMph.length > 0
      ? liveSpeedsMph.reduce((a, b) => a + b, 0) / liveSpeedsMph.length
      : null;

  return {
    status: hasLiveData ? "HAS_LIVE_DATA" : "NO_LIVE_DATA",
    hasLiveData,
    avgSpeedMph,
    confidence: matching.confidence,
    geometryJson: JSON.stringify(matching.geometry),
    segmentsJson: JSON.stringify(segments),
  };
}

// ── Fetch handler: aggregate D1 readings ─────────────────────────────

interface ReadingRow {
  timestamp: string;
  status: string;
  has_live_data: number;
  avg_speed_mph: number | null;
  confidence: number | null;
  geometry_json: string | null;
}

async function aggregateReadings(db: D1Database, since: string | null) {
  // Default to last 30 minutes if no 'since' provided
  let stmt: D1PreparedStatement;
  let windowLabel: string;

  if (since) {
    stmt = db.prepare(
      `SELECT timestamp, status, has_live_data, avg_speed_mph, confidence, geometry_json
       FROM readings
       WHERE timestamp > ?
       ORDER BY timestamp DESC`
    ).bind(since);
    windowLabel = `since ${since}`;
  } else {
    stmt = db.prepare(
      `SELECT timestamp, status, has_live_data, avg_speed_mph, confidence, geometry_json
       FROM readings
       WHERE timestamp > datetime('now', ?)
       ORDER BY timestamp DESC`
    ).bind(`-${AGGREGATION_WINDOW_MINUTES} minutes`);
    windowLabel = `last ${AGGREGATION_WINDOW_MINUTES} minutes`;
  }

  const rows = await stmt.all<ReadingRow>();

  const readings = rows.results ?? [];

  if (readings.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      location: "A417 Maisemore – Over Roundabout",
      window: { description: windowLabel, since: since ?? null, readings: 0 },
      status: "INSUFFICIENT_DATA" as AggregatedStatus,
      averageSpeedMph: null,
      mostRecentLiveSpeedMph: null,
      mostRecentLiveTimestamp: null,
      geometry: null,
    };
  }

  // Any reading with live data in the window = road is open
  const liveReadings = readings.filter((r) => r.has_live_data === 1);
  const anyLiveData = liveReadings.length > 0;

  // Average speed across all readings that had live data
  const liveSpeeds = liveReadings
    .filter((r) => r.avg_speed_mph !== null)
    .map((r) => r.avg_speed_mph!);

  const avgSpeed =
    liveSpeeds.length > 0
      ? Math.round(
          (liveSpeeds.reduce((a, b) => a + b, 0) / liveSpeeds.length) * 10
        ) / 10
      : null;

  // Most recent reading with live data (rows are already DESC by timestamp)
  const mostRecentLive = liveReadings.find((r) => r.avg_speed_mph !== null);

  // GeoJSON LineString from the most recent reading that had geometry
  const latestWithGeometry = readings.find((r) => r.geometry_json !== null);
  const geometry = latestWithGeometry
    ? JSON.parse(latestWithGeometry.geometry_json!)
    : null;

  const status: AggregatedStatus = anyLiveData ? "LIKELY_OPEN" : "NO_LIVE_DATA";

  return {
    timestamp: new Date().toISOString(),
    location: "A417 Maisemore – Over Roundabout",
    window: {
      description: windowLabel,
      since: since ?? null,
      readings: readings.length,
      readingsWithLiveData: liveReadings.length,
    },
    status,
    averageSpeedMph: avgSpeed,
    mostRecentLiveSpeedMph: mostRecentLive?.avg_speed_mph ?? null,
    mostRecentLiveTimestamp: mostRecentLive?.timestamp ?? null,
    geometry,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function mpsToMph(mps: number): number {
  return Math.round(mps * 2.23694 * 10) / 10;
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
