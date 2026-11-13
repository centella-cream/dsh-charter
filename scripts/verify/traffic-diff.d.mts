export interface TrafficMetricRow {
  readonly metric: string
  readonly before: number | null
  readonly after: number | null
  readonly delta: number | null
  readonly percent: number | null
}

export function compareTrafficReports(before: unknown, after: unknown): TrafficMetricRow[]
export function formatTrafficDiff(rows: readonly TrafficMetricRow[]): string
