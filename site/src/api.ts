import type {
  RouteCheckResponse,
  TrafficResponse,
  EAReading,
  FloodWarning,
} from "./types";
import { THRESHOLDS } from "./types";

const EA_BASE = "https://environment.data.gov.uk/flood-monitoring";
const ROUTE_CHECK_URL = "https://routecheck.ismaisemoreflooded.com";
const TRAFFIC_URL = "https://traffic.ismaisemoreflooded.com";

export async function fetchRiverReadings(days: number): Promise<EAReading[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  const url = `${EA_BASE}/id/stations/${THRESHOLDS.STATION_ID}/readings?since=${sinceStr}&_sorted&_limit=10000`;
  console.log("[API] Fetching river readings:", url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error("[API] EA readings error:", res.status, res.statusText);
    throw new Error(`EA readings API error: ${res.status}`);
  }

  const data = await res.json();
  const items = data.items || [];
  console.log("[API] River readings received:", items.length, "items");

  if (items.length === 0) {
    console.warn("[API] No readings returned. Station ID may be wrong. Response keys:", Object.keys(data));
  }

  const readings = items
    .map((item: { dateTime: string; value: number }) => ({
      dateTime: item.dateTime,
      value: item.value,
    }))
    .filter((r: EAReading) => typeof r.value === "number" && !isNaN(r.value))
    .sort(
      (a: EAReading, b: EAReading) =>
        new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
    );

  console.log("[API] Valid readings after filtering:", readings.length);
  if (readings.length > 0) {
    console.log("[API] Latest reading:", readings[readings.length - 1].value, "m at", readings[readings.length - 1].dateTime);
  }

  return readings;
}

export async function fetchLatestReading(): Promise<EAReading | null> {
  const url = `${EA_BASE}/id/stations/${THRESHOLDS.STATION_ID}/readings?latest`;
  console.log("[API] Fetching latest reading:", url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error("[API] EA latest reading error:", res.status, res.statusText);
    throw new Error(`EA latest reading API error: ${res.status}`);
  }

  const data = await res.json();
  const items = data.items || [];
  console.log("[API] Latest reading items:", items.length);

  if (items.length === 0) {
    console.warn("[API] No latest reading returned");
    return null;
  }

  const reading = { dateTime: items[0].dateTime, value: items[0].value };
  console.log("[API] Latest level:", reading.value, "m at", reading.dateTime);
  return reading;
}

export async function fetchFloodWarnings(): Promise<FloodWarning[]> {
  const url = `${EA_BASE}/id/floods`;
  console.log("[API] Fetching flood warnings:", url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error("[API] EA floods error:", res.status, res.statusText);
    throw new Error(`EA floods API error: ${res.status}`);
  }

  const data = await res.json();
  const allWarnings = data.items || [];
  console.log("[API] Total flood warnings nationwide:", allWarnings.length);

  const relevant = allWarnings.filter(
    (w: FloodWarning) =>
      w.floodAreaID === THRESHOLDS.FLOOD_AREA_ID ||
      w.floodAreaID === "031WAF214"
  );
  console.log("[API] Relevant warnings for Maisemore:", relevant.length, relevant.map((w: FloodWarning) => w.severity));

  return relevant;
}

export async function fetchRouteCheck(): Promise<RouteCheckResponse> {
  console.log("[API] Fetching route check:", ROUTE_CHECK_URL);

  const res = await fetch(ROUTE_CHECK_URL);
  if (!res.ok) {
    console.error("[API] Route check error:", res.status, res.statusText);
    throw new Error(`Route check API error: ${res.status}`);
  }

  const data = await res.json();
  console.log("[API] Route status:", data.status, "| Duration:", data.route?.durationSec, "s | Delay:", data.route?.trafficDelaySec, "s");
  return data;
}

export async function fetchTraffic(
  since?: string
): Promise<TrafficResponse> {
  const url = since ? `${TRAFFIC_URL}?since=${since}` : TRAFFIC_URL;
  console.log("[API] Fetching traffic:", url);

  const res = await fetch(url);
  if (!res.ok) {
    console.error("[API] Traffic error:", res.status, res.statusText);
    throw new Error(`Traffic API error: ${res.status}`);
  }

  const data = await res.json();
  console.log("[API] Traffic status:", data.status, "| Live readings:", data.window?.readingsWithLiveData, "/", data.window?.readings, "| Avg speed:", data.averageSpeedMph, "mph");
  return data;
}
