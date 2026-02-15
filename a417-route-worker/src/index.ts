/**
 * A417 Maisemore–Over Roundabout Route Check
 *
 * Cloudflare Worker that probes the TomTom Routing API to see whether
 * it routes traffic through the A417 between Maisemore and Over Roundabout,
 * or diverts around it (implying the road is considered closed).
 *
 * TomTom has strong closure detection: government authority feeds,
 * probe-based closure inference, and active validation against GPS data.
 *
 * Secret required: TOMTOM_API_KEY
 *
 * Endpoint:
 *   GET /  → { status: "ROUTING_THROUGH" | "ROUTING_AROUND" | "NO_ROUTE", ... }
 *
 * Free tier: 2,500 non-tile requests/day (no credit card required)
 */

interface Env {
  TOMTOM_API_KEY: string;
}

// ── TomTom Routing types ─────────────────────────────────────────────

interface TomTomRoutingResponse {
  formatVersion: string;
  routes: TomTomRoute[];
}

interface TomTomRoute {
  summary: {
    lengthInMeters: number;
    travelTimeInSeconds: number;
    trafficDelayInSeconds: number;
    departureTime: string;
    arrivalTime: string;
  };
  legs: Array<{
    summary: {
      lengthInMeters: number;
      travelTimeInSeconds: number;
    };
    points: Array<{ latitude: number; longitude: number }>;
  }>;
  sections?: Array<{
    startPointIndex: number;
    endPointIndex: number;
    sectionType: string;
    simpleCategory?: string;
    effectiveSpeedInKmh?: number;
    travelMode?: string;
  }>;
}

type RouteStatus = "ROUTING_THROUGH" | "ROUTING_AROUND" | "NO_ROUTE" | "ERROR";

// ── Config ───────────────────────────────────────────────────────────

// Origin: on the A417 north of Over Roundabout, outside flood area
const ORIGIN = { lat: 51.889861372093094, lng: -2.275701917721733 };

// Destination: on the A417 south of Maisemore, outside flood area
const DESTINATION = { lat: 51.87532802057413, lng: -2.2633948798302583 };

// Midpoint of the A417 stretch — index 5 of the user's 10-point trace
const A417_MIDPOINT = { lat: 51.8840967853921, lng: -2.2672132659056956 };

// The direct A417 route between these points is ~1.8km. If the route is
// significantly longer, the router is sending traffic on a detour.
const DIRECT_DISTANCE_M = 1800;
const DETOUR_THRESHOLD_MULTIPLIER = 2.5; // >4.5km = definitely a detour

// How close (in metres) the route must pass to the midpoint to count
// as "going through" the A417
const MIDPOINT_PROXIMITY_M = 150;

const TOMTOM_ROUTING_URL =
  "https://api.tomtom.com/routing/1/calculateRoute";

// Cache for 5 minutes
const CACHE_TTL_SECONDS = 300;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Worker entry ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Serve from cache if available
    const cacheKey = new Request(new URL("/", request.url).href);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const data = await checkRoute(env.TOMTOM_API_KEY);
      const response = jsonResponse(data, 200);
      response.headers.set(
        "Cache-Control",
        `public, max-age=${CACHE_TTL_SECONDS}`
      );
      await cache.put(cacheKey, response.clone());
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return jsonResponse({ error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ── Route check ──────────────────────────────────────────────────────

async function checkRoute(apiKey: string) {
  if (!apiKey) throw new Error("TOMTOM_API_KEY is not configured");

  // TomTom format: lat,lng:lat,lng
  const locations = `${ORIGIN.lat},${ORIGIN.lng}:${DESTINATION.lat},${DESTINATION.lng}`;

  const params = new URLSearchParams({
    key: apiKey,
    traffic: "true",
    travelMode: "car",
    routeRepresentation: "polyline",
  });

  const url = `${TOMTOM_ROUTING_URL}/${locations}/json?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TomTom Routing API returned ${res.status}: ${body}`);
  }

  const raw: TomTomRoutingResponse = await res.json();

  if (!raw.routes?.length) {
    return {
      timestamp: new Date().toISOString(),
      location: "A417 Maisemore – Over Roundabout",
      status: "NO_ROUTE" as RouteStatus,
      route: null,
    };
  }

  const route = raw.routes[0];
  const routePoints = route.legs.flatMap((leg) => leg.points);

  // Check 1: Is the route distance close to the direct distance?
  const distanceRatio = route.summary.lengthInMeters / DIRECT_DISTANCE_M;
  const isShortRoute = distanceRatio < DETOUR_THRESHOLD_MULTIPLIER;

  // Check 2: Does the route pass near the A417 midpoint?
  const closestToMidpoint = findClosestDistance(routePoints, A417_MIDPOINT);
  const passesNearMidpoint = closestToMidpoint < MIDPOINT_PROXIMITY_M;

  // Route is "through" if it's short AND passes near the midpoint
  const routingThrough = isShortRoute && passesNearMidpoint;

  const status: RouteStatus = routingThrough
    ? "ROUTING_THROUGH"
    : "ROUTING_AROUND";

  // Convert route points to GeoJSON for consistency with the traffic worker
  const geometry = {
    type: "LineString" as const,
    coordinates: routePoints.map((p) => [p.longitude, p.latitude]),
  };

  return {
    timestamp: new Date().toISOString(),
    location: "A417 Maisemore – Over Roundabout",
    status,
    route: {
      distanceM: route.summary.lengthInMeters,
      durationSec: route.summary.travelTimeInSeconds,
      trafficDelaySec: route.summary.trafficDelayInSeconds,
      distanceRatio: Math.round(distanceRatio * 100) / 100,
      closestToMidpointM: Math.round(closestToMidpoint),
      geometry,
    },
  };
}

// ── Geo helpers ──────────────────────────────────────────────────────

interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Find the closest distance (in metres) between any point on a route
 * and a target point.
 */
function findClosestDistance(
  routePoints: Array<{ latitude: number; longitude: number }>,
  target: LatLng
): number {
  let minDist = Infinity;
  for (const point of routePoints) {
    const dist = haversineM(point.latitude, point.longitude, target.lat, target.lng);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

/**
 * Haversine distance in metres between two lat/lng points.
 */
function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Response helper ──────────────────────────────────────────────────

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
