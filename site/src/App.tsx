import { useState, useEffect, useCallback } from "react";
import type {
  EAReading,
  FloodStatus,
  TrendDirection,
  RouteStatus,
  FloodWarning,
  TrafficResponse,
} from "./types";
import { THRESHOLDS } from "./types";
import {
  fetchRiverReadings,
  fetchLatestReading,
  fetchFloodWarnings,
  fetchRouteCheck,
  fetchTraffic,
} from "./api";
import {
  determineTrend,
  determineFloodStatus,
  findTimeWaterDroppedBelowFlood,
  assessRoadStatus,
} from "./logic";
import type { RoadAssessment } from "./logic";
import RiverChart from "./components/RiverChart";

function App() {
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);
  const [readings, setReadings] = useState<EAReading[]>([]);
  const [trend, setTrend] = useState<TrendDirection>("UNKNOWN");
  const [floodStatus, setFloodStatus] = useState<FloodStatus>("UNKNOWN");
  const [floodWarnings, setFloodWarnings] = useState<FloodWarning[]>([]);
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [routeDelay, setRouteDelay] = useState<number | null>(null);
  const [trafficData, setTrafficData] = useState<TrafficResponse | null>(null);
  const [roadAssessment, setRoadAssessment] = useState<RoadAssessment | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chartDays, setChartDays] = useState(3);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      console.log("[App] Starting data load...");

      // Fetch river data and warnings in parallel
      const [readingsData, latestData, warningsData] = await Promise.all([
        fetchRiverReadings(Math.max(chartDays, 7)).catch((e) => {
          console.error("[App] Readings fetch failed:", e);
          return [] as EAReading[];
        }),
        fetchLatestReading().catch((e) => {
          console.error("[App] Latest reading fetch failed:", e);
          return null;
        }),
        fetchFloodWarnings().catch((e) => {
          console.error("[App] Flood warnings fetch failed:", e);
          return [] as FloodWarning[];
        }),
      ]);

      const level = latestData?.value ?? null;
      const trendDir = determineTrend(readingsData);
      const status = determineFloodStatus(level, readingsData);

      console.log("[App] River level:", level, "| Trend:", trendDir, "| Flood status:", status);
      console.log("[App] Readings:", readingsData.length, "| Warnings:", warningsData.length);

      setReadings(readingsData);
      setCurrentLevel(level);
      setTrend(trendDir);
      setFloodStatus(status);
      setFloodWarnings(warningsData);

      // Fetch road data
      let rStatus: RouteStatus | null = null;
      let rDuration: number | null = null;
      let rDelay: number | null = null;
      let tData: TrafficResponse | null = null;
      let tSinceFlood: TrafficResponse | null = null;

      try {
        const routeData = await fetchRouteCheck();
        rStatus = routeData.status;
        if (routeData.route) {
          rDuration = routeData.route.durationSec;
          rDelay = routeData.route.trafficDelaySec;
        }
      } catch (e) {
        console.error("[App] Route check failed:", e);
      }

      try {
        tData = await fetchTraffic();
      } catch (e) {
        console.error("[App] Traffic fetch failed:", e);
      }

      // If there was a recent flood, check traffic since water dropped
      if (status === "RECEDING" || status === "CLEAR") {
        const dropTime = findTimeWaterDroppedBelowFlood(readingsData);
        console.log("[App] Drop time for flood-since-check:", dropTime);
        if (dropTime) {
          try {
            tSinceFlood = await fetchTraffic(dropTime);
          } catch (e) {
            console.error("[App] Traffic-since-flood fetch failed:", e);
          }
        }
      }

      setRouteDuration(rDuration);
      setRouteDelay(rDelay);
      setTrafficData(tData);

      const assessment = assessRoadStatus(status, rStatus, tData, tSinceFlood);
      console.log("[App] Road assessment:", assessment);
      setRoadAssessment(assessment);

      setLastUpdated(new Date());
      console.log("[App] Data load complete.");
    } catch (err) {
      console.error("[App] Top-level loadData error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load data"
      );
    } finally {
      setLoading(false);
    }
  }, [chartDays]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    console.log("[App] Chart range changed to", chartDays, "days, refetching readings");
    fetchRiverReadings(chartDays)
      .then((data) => {
        console.log("[App] Chart readings loaded:", data.length);
        setReadings(data);
      })
      .catch((e) => {
        console.error("[App] Chart readings refetch failed:", e);
      });
  }, [chartDays]);

  const statusConfig = getStatusConfig(floodStatus, trend, roadAssessment);

  return (
    <div className="app">
      <div className="bg-wash" />

      <header>
        <h1>
          Is Maisemore<br />Flooded?
        </h1>
        <p className="subtitle">A417 Maisemore – Over Roundabout</p>
      </header>

      <main>
        {/* Hero Status */}
        <section className="status-hero" data-status={floodStatus}>
          {loading && !currentLevel ? (
            <div className="loading-pulse">
              <div className="loading-dot" />
              <span>Checking conditions…</span>
            </div>
          ) : error && !currentLevel ? (
            <div className="error-msg">
              <span className="error-icon">⚠</span>
              <span>{error}</span>
            </div>
          ) : (
            <>
              <div className="status-answer">{statusConfig.answer}</div>
              <div className="status-detail">{statusConfig.detail}</div>
            </>
          )}
        </section>

        {/* Cards Grid */}
        <div className="card-grid">
          {/* River Level Card */}
          {currentLevel !== null && (
            <section className="card level-card">
              <div className="card-header">
                <h2>River Severn at Sandhurst</h2>
                <span className={`trend-badge trend-${trend.toLowerCase()}`}>
                  {trend === "RISING" && "↑ Rising"}
                  {trend === "FALLING" && "↓ Falling"}
                  {trend === "STEADY" && "→ Steady"}
                  {trend === "UNKNOWN" && "— Unknown"}
                </span>
              </div>

              <div className="level-display">
                <span className="level-value">{currentLevel.toFixed(2)}</span>
                <span className="level-unit">metres</span>
              </div>

              <div className="thresholds">
                <div
                  className={`threshold ${
                    currentLevel >= THRESHOLDS.ROAD_FLOOD ? "exceeded" : ""
                  }`}
                >
                  <span className="threshold-marker road-flood" />
                  <span className="threshold-label">Road floods</span>
                  <span className="threshold-value">{THRESHOLDS.ROAD_FLOOD}m</span>
                </div>
                <div
                  className={`threshold ${
                    currentLevel >= THRESHOLDS.FLOOD_WARNING ? "exceeded" : ""
                  }`}
                >
                  <span className="threshold-marker warning" />
                  <span className="threshold-label">Flood warning</span>
                  <span className="threshold-value">{THRESHOLDS.FLOOD_WARNING}m</span>
                </div>
                <div
                  className={`threshold ${
                    currentLevel >= THRESHOLDS.NORMAL_HIGH ? "exceeded" : ""
                  }`}
                >
                  <span className="threshold-marker normal" />
                  <span className="threshold-label">Normal high</span>
                  <span className="threshold-value">{THRESHOLDS.NORMAL_HIGH}m</span>
                </div>
              </div>
            </section>
          )}

          {/* Road Status Card */}
          {roadAssessment && (
            <section className="card road-card">
              <h2>Road Status</h2>
              <div className="road-status-row">
                <span
                  className={`road-indicator ${
                    roadAssessment.isOpen === true
                      ? "open"
                      : roadAssessment.isOpen === false
                      ? "closed"
                      : "unknown"
                  }`}
                >
                  {roadAssessment.isOpen === true
                    ? "Open"
                    : roadAssessment.isOpen === false
                    ? "Closed"
                    : "Uncertain"}
                </span>
                <span className={`confidence conf-${roadAssessment.confidence.toLowerCase()}`}>
                  {roadAssessment.confidence} confidence
                </span>
              </div>
              <p className="road-reason">{roadAssessment.reason}</p>

              {routeDuration !== null && roadAssessment.isOpen !== false && (
                <div className="transit-info">
                  <div className="transit-item">
                    <span className="transit-label">Transit time</span>
                    <span className="transit-value">
                      {Math.ceil(routeDuration / 60)} min
                    </span>
                  </div>
                  <div className="transit-item">
                    <span className="transit-label">Traffic congestion</span>
                    <span className={`transit-value congestion-${getCongestionLevel(routeDelay ?? 0, routeDuration)}`}>
                      {getCongestionLabel(routeDelay ?? 0, routeDuration)}
                    </span>
                  </div>
                </div>
              )}

              {trafficData && (
                <div className="traffic-meta">
                  {trafficData.status === "LIVE_DATA" ? (
                    <span className="traffic-live">
                      Live traffic detected
                      {trafficData.averageSpeedMph !== null &&
                        ` — avg ${Math.round(trafficData.averageSpeedMph)} mph`}
                    </span>
                  ) : (
                    <span className="traffic-no-data">
                      Unable to confirm presence of vehicles over the {trafficData.window.description}
                    </span>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Flood Warnings */}
          {floodWarnings.length > 0 && (
            <section className="card warnings-card">
              <h2>
                <span className="warning-icon">⚠</span> Active Flood Warnings
              </h2>
              {floodWarnings.map((w) => (
                <a
                  key={w["@id"]}
                  className="warning-item warning-link"
                  href={`https://check-for-flooding.service.gov.uk/target-area/${w.floodAreaID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="warning-severity">{w.severity} ↗</div>
                  <div className="warning-area">{w.description}</div>
                  {w.message && (
                    <p className="warning-message">{w.message}</p>
                  )}
                  <div className="warning-time">
                    Updated: {new Date(w.timeMessageChanged).toLocaleString("en-GB")}
                  </div>
                </a>
              ))}
            </section>
          )}
        </div>

        {/* Chart */}
        {readings.length > 0 && (
          <section className="card chart-card">
            <div className="card-header">
              <h2>Water Levels</h2>
              <div className="chart-range">
                {[1, 3, 7].map((d) => (
                  <button
                    key={d}
                    className={`range-btn ${chartDays === d ? "active" : ""}`}
                    onClick={() => setChartDays(d)}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <RiverChart readings={readings} days={chartDays} />
          </section>
        )}

        {/* Footer */}
        <footer>
          {lastUpdated && (
            <p className="last-updated">
              Last updated: {lastUpdated.toLocaleTimeString("en-GB")}
              <button className="refresh-btn" onClick={loadData} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </p>
          )}
          <p className="attribution">
            River level data from the Environment Agency real-time data API (Beta).
            <br />
            Road flooding threshold based on historical records at the Sandhurst gauge (3.98m).
          </p>
        </footer>
      </main>
    </div>
  );
}

function getCongestionLevel(delaySec: number, durationSec: number): string {
  if (durationSec <= 0) return "low";
  const ratio = delaySec / durationSec;
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.15 || delaySec >= 60) return "medium";
  return "low";
}

function getCongestionLabel(delaySec: number, durationSec: number): string {
  const level = getCongestionLevel(delaySec, durationSec);
  const delayMin = Math.ceil(delaySec / 60);
  if (level === "high") return `High (+${delayMin} min)`;
  if (level === "medium") return `Medium (+${delayMin} min)`;
  return "Low";
}

function getStatusConfig(
  status: FloodStatus,
  trend: TrendDirection,
  roadAssessment: RoadAssessment | null
): { answer: string; detail: string } {
  switch (status) {
    case "FLOODED":
      return {
        answer: "Yes.",
        detail:
          trend === "RISING"
            ? "The river is above the road flooding level and still rising. The A417 is impassable."
            : trend === "FALLING"
            ? "The river is above the road flooding level but starting to fall. The A417 is still impassable."
            : "The river is above the road flooding level. The A417 is impassable.",
      };
    case "NEAR_FLOOD":
      if (roadAssessment === null || roadAssessment.isOpen) {
        return {
          answer: "Maybe / soon.",
          detail:
            trend === "RISING"
              ? "The river is near the road flooding level and rising. The road may potentially be passable but conditions will likely worsen — drive with caution."
              : "The river is near the road flooding level. The road may potentially be passable but may be affected if levels rise.",
        };
      } else {
        return {
          answer: "Probably.",
          detail:           
             "The river is near the historic road flooding level and the road appears to have been closed."              
        };
      }
    case "RECEDING":
      return {
        answer: "Receding.",
        detail:
          "The river was recently above road flooding level but has now dropped. Check the road status below.",
      };
    case "CLEAR":
      return {
        answer: "No.",
        detail: "The river is within normal levels. The road should be clear.",
      };
    default:
      return {
        answer: "Unknown.",
        detail: "River level data is currently unavailable. Check the road status and flood warnings below.",
      };
  }
}

export default App;
