/**
 * Interest Calculation Utilities
 * 
 * Rules:
 * - 0.5% compound interest per complete week (Monday-Sunday)
 * - Week 1 starts from the coming Monday after deposit
 * - 0.5% is awarded on the Monday after each complete week
 * 
 * Example: Deposit on Tuesday, Jan 14th:
 *   - Week 1 starts: Monday, Jan 20th
 *   - Week 1 ends: Sunday, Jan 26th
 *   - First 0.5% awarded: Monday, Jan 27th (1 complete week)
 *   - Second 0.5% awarded: Monday, Feb 3rd (2 complete weeks)
 */

const WEEKLY_INTEREST_RATE = 0.005 // 0.5%

/**
 * Gets the next Monday from a given date
 * If the date is already Monday, returns the NEXT Monday (not the same day)
 */
function getNextMonday(date: Date): Date {
  const result = new Date(date)
  result.setUTCHours(0, 0, 0, 0)
  const dayOfWeek = result.getUTCDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // Calculate days until next Monday
  // If today is Monday (1), we want next Monday (7 days)
  // If today is Tuesday (2), we want 6 days
  // If today is Sunday (0), we want 1 day
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek)

  result.setUTCDate(result.getUTCDate() + daysUntilMonday)
  return result
}

/**
 * Parse a stored date into a UTC instant. A plain 'YYYY-MM-DD' (or a
 * 'YYYY-MM-DDTHH:MM:SS' without a timezone) is interpreted at UTC midnight, so
 * all day-of-week / week math is timezone-independent.
 */
export function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`)
  if (value.includes('T') && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(`${value}Z`)
  return new Date(value)
}

/** Today's calendar date (YYYY-MM-DD) in UTC. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Gets the date when the first week starts (coming Monday after deposit)
 */
export function getFirstWeekStart(depositDate: Date): Date {
  return getNextMonday(depositDate)
}

/**
 * Gets the date when interest is first awarded (Monday after first complete week)
 * This is when the first 0.5% is given
 */
export function getInterestStartDate(depositDate: Date): Date {
  const firstWeekStart = getFirstWeekStart(depositDate)
  const firstAwardDate = new Date(firstWeekStart)
  firstAwardDate.setUTCDate(firstAwardDate.getUTCDate() + 7) // Monday after week 1 completes
  return firstAwardDate
}

/**
 * Calculates the number of complete weeks that have earned interest
 * 
 * On the first award date (Monday after week 1), this returns 1
 * Each subsequent Monday adds 1 more week
 */
export function getCompleteWeeks(depositDate: Date, currentDate: Date = new Date()): number {
  const interestStartDate = getInterestStartDate(depositDate)
  
  // Normalize currentDate to start of day (UTC)
  const today = new Date(currentDate)
  today.setUTCHours(0, 0, 0, 0)
  
  // If we haven't reached the first interest award date yet
  if (today < interestStartDate) {
    return 0
  }
  
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const timeDiff = today.getTime() - interestStartDate.getTime()
  
  // On interestStartDate: 1 week completed
  // 7 days later: 2 weeks completed
  // etc.
  return Math.floor(timeDiff / msPerWeek) + 1
}

/**
 * Calculates the current value with compound interest
 * Formula: principal * (1 + rate)^weeks
 */
export function calculateCurrentValue(principal: number, depositDate: Date, currentDate: Date = new Date()): number {
  const weeks = getCompleteWeeks(depositDate, currentDate)
  return principal * Math.pow(1 + WEEKLY_INTEREST_RATE, weeks)
}

/**
 * Calculates the interest earned
 */
export function calculateInterestEarned(principal: number, depositDate: Date, currentDate: Date = new Date()): number {
  const currentValue = calculateCurrentValue(principal, depositDate, currentDate)
  return currentValue - principal
}

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Format date
 */
export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parseDate(date))
}

/**
 * Get day of week name
 */
export function getDayOfWeek(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(parseDate(date))
}
