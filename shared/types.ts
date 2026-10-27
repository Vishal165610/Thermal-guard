// Shared data contract between the simulation server and the dashboard.
// The server owns all of this state. The client only displays it.

export type ZoneId =
  | 'boiler'
  | 'production'
  | 'cooling'
  | 'storage'
  | 'electrical'
  | 'packaging';

export type ZoneStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'RECOVERING';

export type ScenarioId = 'normal' | 'cooling-failure' | 'machine-overheating' | 'fire';

export interface ThermalGrid {
  width: number; // 40
  height: number; // 25
  values: number[]; // row-major, degrees C, rounded to 0.1
}

export interface ZoneState {
  id: ZoneId;
  name: string;
  avgTemp: number;
  /** Hottest cell in the zone. This is the value the rule engine and the AI use. */
  peakTemp: number;
  /** Configured critical limit (a breach happens at or above this). */
  limit: number;
  /** Warning starts here (limit - warning margin). */
  warningTemp: number;
  /** Peak temperature of this zone in settled normal operation (used for colour mapping). */
  nominalTemp: number;
  status: ZoneStatus;
  /** Change in peak temperature per step, over the last 5 steps. */
  trend: number;
  /** Last HISTORY_LEN peak temperatures, oldest first. */
  history: number[];
}

export type ForecastSource = 'neural-network' | 'trend-fallback';

export interface ZoneForecast {
  zoneId: ZoneId;
  /** Who produced this estimate. Fallback values are NOT neural-network outputs. */
  source: ForecastSource;
  /** Neural-network breach risk score 0..1 for the next 30 steps. Null for the fallback. */
  riskScore: number | null;
  /** True when this source says a breach is likely within the horizon. */
  warning: boolean;
  horizon: number;
  /** Estimated future peak temperature, `step` steps from now. */
  predicted: { step: number; temp: number }[];
  /** Estimated steps until the limit is reached, if the estimate crosses it. */
  projectedBreachInSteps: number | null;
  /** Recent slope in degrees C per step (8-step window). */
  slope: number;
}

export interface ModelStatus {
  state: 'ready' | 'missing' | 'error';
  message: string;
  horizon: number;
  trainedAt?: string;
  trainingSamples?: number;
  epochs?: number;
}

export interface Alert {
  id: string;
  zoneId: ZoneId;
  zoneName: string;
  /** Highest severity reached during this incident. */
  severity: 'warning' | 'critical';
  state: 'active' | 'recovering' | 'resolved';
  openedStep: number;
  /** First step where the configured limit was crossed (the actual breach). */
  criticalStep: number | null;
  resolvedStep: number | null;
  peakTemp: number;
  limit: number;
  acknowledged: boolean;
  acknowledgedStep: number | null;
  message: string;
}

export interface PredictionEvent {
  id: string;
  zoneId: ZoneId;
  zoneName: string;
  step: number;
  source: ForecastSource;
  riskScore: number | null;
  message: string;
}

export type TimelineVerdict =
  | 'ai-warning-pending'
  | 'early-warning'
  | 'no-advance-notice'
  | 'no-warning-before-breach'
  | 'warning-without-breach';

export interface TimelineEntry {
  id: string;
  zoneId: ZoneId;
  zoneName: string;
  /** Step when the first of the two events was recorded. */
  startedStep: number;
  aiWarningStep: number | null;
  aiWarningSource: ForecastSource | null;
  aiWarningRisk: number | null;
  breachStep: number | null;
  resolvedStep: number | null;
  /** breachStep - aiWarningStep. Only set when both events happened. */
  leadSteps: number | null;
  verdict: TimelineVerdict;
  summary: string;
}

export interface IncidentInfo {
  scenario: ScenarioId;
  zoneId: ZoneId | null;
  startedStep: number | null;
  description: string;
  /** 1 = cooling healthy, near 0 = cooling failed. */
  coolingEffectiveness: number;
}

export type ActionId =
  | 'restart-cooling'
  | 'reduce-load'
  | 'shutdown-machine'
  | 'sprinklers'
  | 'ventilate'
  | 'dispatch-technician';

/** One corrective action the operator took. */
export interface ActionRecord {
  id: string;
  step: number;
  actionId: ActionId;
  label: string;
  zoneId: ZoneId | null;
}

/** A rule-based suggestion (NOT an AI output). */
export interface Recommendation {
  actionId: ActionId;
  zoneId: ZoneId;
  /** The open issue this suggestion is about, when there is one. */
  faultId?: string;
  urgency: 'now' | 'soon';
  reason: string;
}

export interface OutcomeReport {
  status: 'idle' | 'in-progress' | 'closed';
  startedStep: number | null;
  closedStep: number | null;
  breached: boolean;
  stepsAboveLimit: number;
  /** Highest amount (in degrees C) any zone went above its limit. */
  peakOverLimit: number | null;
  firstActionStep: number | null;
  aiWarningStep: number | null;
  /** firstActionStep - aiWarningStep, when both exist. */
  reactionSteps: number | null;
  closedBy: 'actions' | 'restore' | 'recovered' | null;
  /** Issues that still need an on-site repair when the incident closed. */
  openIssues: number;
  headline: string;
  detail: string;
}

/** Recovery progress for a zone that is not NORMAL. Numbers are measured; the ETA is a rough estimate. */
export interface RecoveryInfo {
  zoneId: ZoneId;
  phase: 'heating' | 'cooling' | 'steady';
  peakTemp: number;
  /** The zone returns to NORMAL once its peak is below this. */
  targetTemp: number;
  /** Peak change per step over the last 5 steps. */
  trend: number;
  /** Rough steps until NORMAL, from the current cooling rate. Null unless cooling. */
  etaSteps: number | null;
}

export type FaultKind = 'cooling-pump' | 'machine-bearing' | 'fire';

/**
 * A root-cause issue behind an incident. An "online" fix (done from the dashboard) only
 * contains the symptoms. The issue stays open until a technician repairs it on site.
 */
export interface FaultInfo {
  id: string;
  kind: FaultKind;
  zoneId: ZoneId;
  title: string;
  state: 'failing' | 'contained' | 'travelling' | 'waiting' | 'repairing' | 'fixed';
  /** What is happening right now, in plain words. */
  summary: string;
  /** Online actions that make sense right now. */
  onlineFixes: ActionId[];
  canDispatch: boolean;
  /** Steps left in the current technician phase (travel or repair). */
  jobStepsLeft: number | null;
  /** Explains a waiting technician or a blocked job. */
  note: string;
  openedStep: number;
  resolvedStep: number | null;
}

export interface PlaybackControl {
  paused: boolean;
  /** 1 = one step every 0.5 s. 0.5 = one step per second, and so on. */
  speed: number;
}

export interface SimulationSnapshot {
  step: number;
  control: PlaybackControl;
  actions: ActionRecord[];
  recommendations: Recommendation[];
  recovery: RecoveryInfo[];
  faults: FaultInfo[];
  outcome: OutcomeReport;
  serverTime: number;
  ambient: number;
  grid: ThermalGrid;
  minTemp: number;
  maxTemp: number;
  zones: ZoneState[];
  forecasts: ZoneForecast[];
  model: ModelStatus;
  incident: IncidentInfo;
  alerts: Alert[];
  predictions: PredictionEvent[];
  timeline: TimelineEntry[];
}

export interface ServerToClientEvents {
  snapshot: (snapshot: SimulationSnapshot) => void;
}

export interface ClientToServerEvents {
  'scenario:set': (payload: { scenario: ScenarioId; zoneId?: ZoneId }) => void;
  'simulation:reset': () => void;
  'action:apply': (payload: { actionId: ActionId; zoneId?: ZoneId; faultId?: string }) => void;
  'simulation:control': (payload: { paused?: boolean; speed?: number; stepOnce?: boolean }) => void;
  'alert:ack': (payload: { id: string }) => void;
}
