import type {
  EAReading,
  FloodStatus,
  TrendDirection,
  RouteStatus,
  TrafficResponse,
} from "./types";
import { THRESHOLDS } from "./types";

export function determineTrend(readings: EAReading[]): TrendDirection {
  if (readings.length < 4) return "UNKNOWN";

  // Look at last ~2 hours of readings
  const recent = readings.slice(-8);
  if (recent.length < 2) return "UNKNOWN";

  const first = recent[0].value;
  const last = recent[recent.length - 1].value;
  const diff = last - first;

  if (Math.abs(diff) < 0.02) return "STEADY";
  return diff > 0 ? "RISING" : "FALLING";
}

export function determineFloodStatus(
  currentLevel: number | null,
  readings: EAReading[]
): FloodStatus {
  if (currentLevel === null) return "UNKNOWN";

  if (currentLevel >= THRESHOLDS.ROAD_FLOOD - 0.05) return "FLOODED";
  if (currentLevel >= THRESHOLDS.FLOOD_WARNING - 0.05) return "NEAR_FLOOD";

  // Check if there was a flood in the last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentFlood = readings.some(
    (r) =>
      r.value >= THRESHOLDS.ROAD_FLOOD &&
      new Date(r.dateTime).getTime() > sevenDaysAgo
  );

  if (recentFlood && currentLevel > THRESHOLDS.NORMAL_HIGH) return "RECEDING";
  return "CLEAR";
}

export function findRecentFloodPeakTime(readings: EAReading[]): string | null {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let peakValue = 0;
  let peakTime: string | null = null;

  for (const r of readings) {
    if (
      r.value >= THRESHOLDS.ROAD_FLOOD &&
      new Date(r.dateTime).getTime() > sevenDaysAgo &&
      r.value > peakValue
    ) {
      peakValue = r.value;
      peakTime = r.dateTime;
    }
  }

  return peakTime;
}

export function findTimeWaterDroppedBelowFlood(
  readings: EAReading[]
): string | null {
  // Find the last time the water was above flood level
  for (let i = readings.length - 1; i >= 0; i--) {
    if (readings[i].value >= THRESHOLDS.ROAD_FLOOD) {
      // The next reading after this is when it dropped below
      if (i + 1 < readings.length) {
        return readings[i + 1].dateTime;
      }
      return readings[i].dateTime;
    }
  }
  return null;
}

export interface RoadAssessment {
  isOpen: boolean | null; // null = uncertain
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

export function assessRoadStatus(
  floodStatus: FloodStatus,
  routeStatus: RouteStatus | null,
  _trafficData: TrafficResponse | null,
  trafficSinceFlood: TrafficResponse | null
): RoadAssessment {
  // If currently above flood level, road is closed
  if (floodStatus === "FLOODED") {
    return {
      isOpen: false,
      confidence: "HIGH",
      reason: "Water levels are above the road flooding threshold.",
    };
  }

  // If near flood level, road is probably still open unless evidence suggests otherwise
  if (floodStatus === "NEAR_FLOOD") {
    // Check if route planner is routing around
    if (routeStatus === "ROUTING_AROUND" || routeStatus === "NO_ROUTE") {
      return {
        isOpen: false,
        confidence: "MEDIUM",
        reason:
          "Water levels are near the road flooding threshold and the route planner is directing traffic around this road. The road may be impassable. Note that the route planner can sometimes be wrong.",
      };
    }
    return {
      isOpen: true,
      confidence: "MEDIUM",
      reason:
        "Water levels are near the road flooding threshold but the road is likely still passable. Conditions may deteriorate — drive with caution.",
    };
  }

  // If receding from flood, use traffic and route data
  if (floodStatus === "RECEDING") {
    // If we have traffic data since the flood and cars were seen
    if (
      trafficSinceFlood &&
      trafficSinceFlood.window.readingsWithLiveData > 0
    ) {
      return {
        isOpen: true,
        confidence: "HIGH",
        reason:
          "Cars have been detected on the road since water levels dropped. The road appears to be open.",
      };
    }

    // Check route planner
    if (routeStatus === "ROUTING_THROUGH") {
      // Route planner says open, but no traffic confirmation
      if (
        trafficSinceFlood &&
        trafficSinceFlood.window.readingsWithLiveData === 0
      ) {
        return {
          isOpen: true,
          confidence: "MEDIUM",
          reason:
            "The route planner is directing traffic through this road, but no cars have been detected yet. The traffic sensor can be unreliable, so the road is probably open.",
        };
      }
      return {
        isOpen: true,
        confidence: "MEDIUM",
        reason:
          "The route planner is directing traffic through this road. However, the route planner occasionally shows the road as open prematurely.",
      };
    }

    if (
      routeStatus === "ROUTING_AROUND" ||
      routeStatus === "NO_ROUTE"
    ) {
      return {
        isOpen: false,
        confidence: "MEDIUM",
        reason:
          "Water levels have dropped, but the route planner is still directing traffic around this road. The road may still be closed or obstructed. Note that the route planner sometimes shows the road as closed when it has reopened.",
      };
    }

    return {
      isOpen: null,
      confidence: "LOW",
      reason:
        "Water levels have dropped below the flood threshold recently. We can't confirm whether the road has reopened yet.",
    };
  }

  // CLEAR status
  if (routeStatus === "ROUTING_THROUGH") {
    return {
      isOpen: true,
      confidence: "HIGH",
      reason: "Water levels are normal and traffic is routing through.",
    };
  }

  if (routeStatus === "ROUTING_AROUND") {
    return {
      isOpen: false,
      confidence: "MEDIUM",
      reason:
        "Water levels are normal, but the route planner is directing traffic around this road. There may be a closure for other reasons. The route planner can sometimes be wrong.",
    };
  }

  return {
    isOpen: true,
    confidence: "LOW",
    reason: "Water levels are within normal range.",
  };
}
