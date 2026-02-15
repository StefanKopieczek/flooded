export type RouteStatus = "ROUTING_THROUGH" | "ROUTING_AROUND" | "NO_ROUTE" | "ERROR";

export interface RouteCheckResponse {
  timestamp: string;
  location: string;
  status: RouteStatus;
  route: {
    distanceM: number;
    durationSec: number;
    trafficDelaySec: number;
    distanceRatio: number;
    closestToMidpointM: number;
  } | null;
}

export interface TrafficResponse {
  timestamp: string;
  location: string;
  status: "LIVE_DATA" | "NO_LIVE_DATA" | "ERROR";
  window: {
    description: string;
    since: string | null;
    readings: number;
    readingsWithLiveData: number;
  };
  averageSpeedMph: number | null;
  mostRecentLiveSpeedMph: number | null;
  mostRecentLiveTimestamp: string | null;
}

export interface EAReading {
  dateTime: string;
  value: number;
}

export interface EAStation {
  label: string;
  stageScale?: {
    typicalRangeHigh?: number;
    typicalRangeLow?: number;
  };
  measures: Array<{
    "@id": string;
    parameter: string;
    qualifier: string;
    latestReading?: {
      dateTime: string;
      value: number;
    };
  }>;
}

export interface FloodWarning {
  "@id": string;
  description: string;
  floodAreaID: string;
  severity: string;
  severityLevel: number;
  message: string;
  timeRaised: string;
  timeMessageChanged: string;
}

export type FloodStatus =
  | "FLOODED"
  | "NEAR_FLOOD"
  | "RECEDING"
  | "CLEAR"
  | "UNKNOWN";

export type TrendDirection = "RISING" | "FALLING" | "STEADY" | "UNKNOWN";

export interface AppState {
  // River data
  currentLevel: number | null;
  readings: EAReading[];
  trend: TrendDirection;
  floodStatus: FloodStatus;
  floodWarnings: FloodWarning[];

  // Road data
  routeStatus: RouteStatus | null;
  routeDuration: number | null;
  routeDelay: number | null;
  trafficStatus: TrafficResponse | null;

  // Meta
  loading: boolean;
  lastUpdated: Date | null;
  error: string | null;
}

// Thresholds (Sandhurst gauge, meters)
export const THRESHOLDS = {
  ROAD_FLOOD: 3.98,       // Historical: A417 floods
  FLOOD_WARNING: 3.90,    // EA flood warning level
  NORMAL_HIGH: 3.00,      // Top of normal range
  STATION_ID: "2618",     // Sandhurst EA station reference
  FLOOD_AREA_ID: "031FWBSE570", // Sandhurst & Maisemore warning area
};
