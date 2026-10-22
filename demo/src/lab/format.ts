const MS_PER_SECOND = 1_000

export const formatNumber = (value: number, digits = 2): string => String(Number(value.toFixed(digits)))

export const formatSeconds = (ms: number): string => `${formatNumber(ms / MS_PER_SECOND)}s`

export const formatPercent = (ratio: number): string => `${Math.round(ratio * 100)}%`
