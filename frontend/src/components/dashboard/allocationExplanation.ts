import type { StudyPlanAllocation } from '@/types/api';

export type AllocationDriver = 'URGENCY' | 'DEFICIT' | 'WEIGHT' | 'BASELINE' | 'UNKNOWN';

export interface AllocationExplanation {
  driver: AllocationDriver;
  summary: string;
  details: string[];
  badgeText: string | null;
}

export function getAllocationDriver(alloc: StudyPlanAllocation): AllocationDriver {
  const snapshot = alloc.snapshot_state || {};
  if (snapshot.primary_driver) {
    const driver = String(snapshot.primary_driver).toUpperCase().trim();
    if (['URGENCY', 'DEFICIT', 'WEIGHT', 'BASELINE'].includes(driver)) {
      return driver as AllocationDriver;
    }
  }

  if (alloc.explanation_code) {
    const code = String(alloc.explanation_code).toUpperCase().trim();
    if (code.includes('URGENCY') || code.includes('URGENT') || code.includes('EXAM')) {
      return 'URGENCY';
    }
    if (code.includes('DEFICIT')) {
      return 'DEFICIT';
    }
    if (code.includes('WEIGHT')) {
      return 'WEIGHT';
    }
    if (code.includes('BASELINE') || code.includes('NONE') || code.includes('NO_WORK_NEEDED')) {
      return 'BASELINE';
    }
  }

  return 'UNKNOWN';
}

export function getAllocationBadge(alloc: StudyPlanAllocation): string | null {
  const code = alloc.explanation_code ? String(alloc.explanation_code).trim() : '';

  // Preserve non-ALLOCATED_ codes for backwards-compatibility with custom fixtures
  if (code && !code.toUpperCase().startsWith('ALLOCATED_')) {
    if (code.toLowerCase() === 'none') {
      return null;
    }
    return code.replace(/_/g, ' ');
  }

  const driver = getAllocationDriver(alloc);
  switch (driver) {
    case 'URGENCY':
      return 'Upcoming assessment';
    case 'DEFICIT':
      return 'Target deficit';
    case 'WEIGHT':
      return 'High weight';
    case 'BASELINE':
      return 'Standard review';
    default:
      return null;
  }
}

export function formatAllocationExplanation(alloc: StudyPlanAllocation): AllocationExplanation {
  const driver = getAllocationDriver(alloc);
  const snapshot = alloc.snapshot_state || {};

  // Extract next assessment days & weight safely
  const nextAss = snapshot.next_assessment;
  let days: number | null = null;
  if (nextAss?.days != null && !isNaN(Number(nextAss.days))) {
    days = Number(nextAss.days);
  } else if (snapshot.days_to_exam != null && !isNaN(Number(snapshot.days_to_exam))) {
    days = Number(snapshot.days_to_exam);
  }

  let upcomingWeight: number | null = null;
  if (nextAss?.weight != null && !isNaN(Number(nextAss.weight))) {
    upcomingWeight = Number(nextAss.weight);
  } else if (snapshot.upcoming_weight != null && !isNaN(Number(snapshot.upcoming_weight))) {
    upcomingWeight = Number(snapshot.upcoming_weight);
  }

  // Extract target & current grade safely
  let target: number | null = null;
  if (snapshot.subject_target != null && !isNaN(Number(snapshot.subject_target))) {
    target = Number(snapshot.subject_target);
  }

  let current: number | null = null;
  if (snapshot.subject_current != null && !isNaN(Number(snapshot.subject_current))) {
    current = Number(snapshot.subject_current);
  } else if (snapshot.current_percentage != null && !isNaN(Number(snapshot.current_percentage))) {
    current = Number(snapshot.current_percentage);
  }

  let deficit: number | null = null;
  if (snapshot.target_deficit != null && !isNaN(Number(snapshot.target_deficit))) {
    deficit = Number(snapshot.target_deficit);
  } else if (target != null && current != null && target > current) {
    deficit = Number((target - current).toFixed(1));
  }

  // Extract remaining weight safely
  let remainingWeight: number | null = null;
  if (snapshot.remaining_weight != null && !isNaN(Number(snapshot.remaining_weight))) {
    remainingWeight = Number(snapshot.remaining_weight);
  }

  const details: string[] = [];
  let summary = '';

  switch (driver) {
    case 'URGENCY': {
      if (days !== null) {
        const daysSchedule =
          days === 0
            ? 'scheduled for today'
            : days === 1
            ? 'scheduled for tomorrow'
            : days > 1
            ? `scheduled in ${days} days`
            : `scheduled ${Math.abs(days)} days ago`;

        if (upcomingWeight !== null && upcomingWeight > 0) {
          summary = `Prioritized for an upcoming assessment (${upcomingWeight}% weight) ${daysSchedule}.`;
        } else {
          summary = `Prioritized for an upcoming assessment ${daysSchedule}.`;
        }

        const daysDetail =
          days === 0
            ? 'Next assessment: Today'
            : days === 1
            ? 'Next assessment: Tomorrow'
            : days > 1
            ? `Next assessment: in ${days} days`
            : `Next assessment: ${Math.abs(days)} days overdue`;
        details.push(daysDetail);
      } else if (upcomingWeight !== null && upcomingWeight > 0) {
        summary = `Prioritized due to an upcoming assessment worth ${upcomingWeight}% of the course grade.`;
      } else {
        summary = 'Prioritized due to an upcoming assessment deadline.';
      }

      if (upcomingWeight !== null && upcomingWeight > 0) {
        details.push(`Assessment weight: ${upcomingWeight}%`);
      }
      if (remainingWeight !== null && remainingWeight > 0) {
        details.push(`Remaining weight: ${remainingWeight}%`);
      }
      break;
    }

    case 'DEFICIT': {
      if (target !== null && current !== null) {
        summary = `Allocated to close a grade deficit: currently at ${Number(current.toFixed(1))}% toward your target of ${target}%.`;
      } else if (target !== null && deficit !== null && deficit > 0) {
        summary = `Allocated to close a grade deficit of ${Number(deficit.toFixed(1))}% toward your target of ${target}%.`;
      } else if (target !== null) {
        summary = `Allocated to help you achieve your target grade of ${target}%.`;
      } else {
        summary = 'Allocated to help improve your grade toward your target score.';
      }

      if (target !== null) details.push(`Target grade: ${target}%`);
      if (current !== null) details.push(`Current grade: ${Number(current.toFixed(1))}%`);
      if (deficit !== null && deficit > 0) details.push(`Score deficit: ${Number(deficit.toFixed(1))}%`);
      if (remainingWeight !== null && remainingWeight > 0) details.push(`Remaining weight: ${remainingWeight}%`);
      break;
    }

    case 'WEIGHT': {
      if (upcomingWeight !== null && upcomingWeight > 0) {
        summary = `Prioritized due to heavy assessment weight (${upcomingWeight}% of course grade).`;
        details.push(`Assessment weight: ${upcomingWeight}%`);
      } else if (remainingWeight !== null && remainingWeight > 0) {
        summary = `Prioritized due to substantial remaining coursework weight (${remainingWeight}% of course grade).`;
      } else {
        summary = 'Prioritized due to significant coursework weight in this subject.';
      }

      if (remainingWeight !== null && remainingWeight > 0 && !details.some((d) => d.includes('Remaining'))) {
        details.push(`Remaining weight: ${remainingWeight}%`);
      }
      break;
    }

    case 'BASELINE': {
      summary = 'Standard weekly study time allocated to maintain balanced progress across active subjects.';
      if (target !== null) details.push(`Target grade: ${target}%`);
      if (remainingWeight !== null && remainingWeight > 0) details.push(`Remaining weight: ${remainingWeight}%`);
      break;
    }

    case 'UNKNOWN':
    default: {
      if (alloc.allocated_minutes) {
        summary = `${alloc.allocated_minutes} minutes allocated for regular study in this subject.`;
      } else {
        summary = 'Study time allocated for this subject based on your weekly study plan.';
      }
      if (target !== null) details.push(`Target grade: ${target}%`);
      if (current !== null) details.push(`Current grade: ${Number(current.toFixed(1))}%`);
      if (remainingWeight !== null && remainingWeight > 0) details.push(`Remaining weight: ${remainingWeight}%`);
      break;
    }
  }

  return {
    driver,
    summary,
    details,
    badgeText: getAllocationBadge(alloc),
  };
}
