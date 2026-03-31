// Minimal 5-field cron expression parser.
// Format: "minute hour day-of-month month day-of-week"
// Supports: * , - /  (ranges, lists, steps)
//
// Examples:
//   "0 * * * *"    — every hour on the hour
//   "30 9 * * 1-5" — 09:30 on weekdays
//   "0 0 1 * *"    — midnight on the 1st of every month
//   "0/5 * * * *"  — every 5 minutes (step from 0)
export function getNextCronTime(cronExpression: string, from: Date = new Date()): Date {
  const fields = cronExpression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): "${cronExpression}"`)
  }

  const [minuteField, hourField, domField, monthField, dowField] = fields

  function parseField(field: string, min: number, max: number): number[] {
    if (field === '*') {
      const values: number[] = []
      for (let i = min; i <= max; i++) values.push(i)
      return values
    }

    const values = new Set<number>()

    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [rangeStr, stepStr] = part.split('/')
        const step = parseInt(stepStr, 10)
        if (isNaN(step) || step <= 0) throw new Error(`Invalid step in cron field: "${part}"`)
        const [lo, hi] = rangeStr === '*'
          ? [min, max]
          : rangeStr.split('-').map(Number)
        for (let i = lo ?? min; i <= (hi ?? max); i += step) values.add(i)
      } else if (part.includes('-')) {
        const [lo, hi] = part.split('-').map(Number)
        for (let i = lo; i <= hi; i++) values.add(i)
      } else {
        values.add(parseInt(part, 10))
      }
    }

    return Array.from(values)
      .filter(v => v >= min && v <= max)
      .sort((a, b) => a - b)
  }

  const validMinutes = parseField(minuteField, 0, 59)
  const validHours = parseField(hourField, 0, 23)
  const validDoms = parseField(domField, 1, 31)
  const validMonths = parseField(monthField, 1, 12)
  const validDows = parseField(dowField, 0, 6)

  const domIsWildcard = domField === '*'
  const dowIsWildcard = dowField === '*'

  // Start searching from the next minute
  const current = new Date(from)
  current.setSeconds(0, 0)
  current.setMinutes(current.getMinutes() + 1)

  const limit = new Date(current)
  limit.setFullYear(limit.getFullYear() + 4)

  while (current < limit) {
    // Check month (1-based)
    if (!validMonths.includes(current.getMonth() + 1)) {
      current.setMonth(current.getMonth() + 1, 1)
      current.setHours(0, 0, 0, 0)
      continue
    }

    // Day match: when both dom and dow are restricted, either satisfies the condition
    const domMatch = validDoms.includes(current.getDate())
    const dowMatch = validDows.includes(current.getDay())
    const dayMatch = (!domIsWildcard && !dowIsWildcard)
      ? (domMatch || dowMatch)
      : (domMatch && dowMatch)

    if (!dayMatch) {
      current.setDate(current.getDate() + 1)
      current.setHours(0, 0, 0, 0)
      continue
    }

    // Check hour
    if (!validHours.includes(current.getHours())) {
      const nextHour = validHours.find(h => h > current.getHours())
      if (nextHour !== undefined) {
        current.setHours(nextHour, 0, 0, 0)
      } else {
        current.setDate(current.getDate() + 1)
        current.setHours(0, 0, 0, 0)
      }
      continue
    }

    // Check minute
    if (!validMinutes.includes(current.getMinutes())) {
      const nextMinute = validMinutes.find(m => m > current.getMinutes())
      if (nextMinute !== undefined) {
        current.setMinutes(nextMinute, 0, 0)
      } else {
        current.setHours(current.getHours() + 1, 0, 0, 0)
      }
      continue
    }

    return new Date(current)
  }

  throw new Error(`Could not determine next run for cron expression: "${cronExpression}"`)
}
