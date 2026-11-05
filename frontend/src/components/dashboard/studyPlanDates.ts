/**
 * Date calculation and validation helpers for weekly study plans.
 */

export function getDefaultWeekRange(baseDate: Date = new Date()): { startDate: string; endDate: string } {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const day = baseDate.getDate();
  const dayOfWeek = baseDate.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat

  let daysUntilMonday = 0;
  if (dayOfWeek === 1) {
    daysUntilMonday = 0;
  } else if (dayOfWeek === 0) {
    daysUntilMonday = 1;
  } else {
    daysUntilMonday = 8 - dayOfWeek;
  }

  const monday = new Date(year, month, day + daysUntilMonday);
  const sunday = new Date(year, month, day + daysUntilMonday + 6);

  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dt = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dt}`;
  };

  return {
    startDate: formatLocalDate(monday),
    endDate: formatLocalDate(sunday),
  };
}

export function isMonday(dateStr: string): boolean {
  if (!dateStr) return false;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.getDay() === 1;
}

export function isSunday(dateStr: string): boolean {
  if (!dateStr) return false;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.getDay() === 0;
}

export function isPlanExpired(endDateStr: string, baseDate: Date = new Date()): boolean {
  if (!endDateStr) return false;
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, '0');
  const day = String(baseDate.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  return todayStr > endDateStr;
}
