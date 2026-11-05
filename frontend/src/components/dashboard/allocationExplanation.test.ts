import { describe, it, expect } from 'vitest';
import {
  getAllocationDriver,
  getAllocationBadge,
  formatAllocationExplanation,
} from './allocationExplanation';
import type { StudyPlanAllocation } from '@/types/api';

describe('allocationExplanation utility', () => {
  describe('getAllocationDriver', () => {
    it('identifies URGENCY driver from snapshot primary_driver', () => {
      const alloc: StudyPlanAllocation = {
        id: '1',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 60,
        explanation_code: 'ALLOCATED_URGENCY',
        snapshot_state: { primary_driver: 'URGENCY' },
      };
      expect(getAllocationDriver(alloc)).toBe('URGENCY');
    });

    it('identifies DEFICIT driver from snapshot primary_driver', () => {
      const alloc: StudyPlanAllocation = {
        id: '2',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 60,
        explanation_code: 'ALLOCATED_DEFICIT',
        snapshot_state: { primary_driver: 'DEFICIT' },
      };
      expect(getAllocationDriver(alloc)).toBe('DEFICIT');
    });

    it('identifies WEIGHT driver from snapshot primary_driver', () => {
      const alloc: StudyPlanAllocation = {
        id: '3',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 60,
        explanation_code: 'ALLOCATED_WEIGHT',
        snapshot_state: { primary_driver: 'WEIGHT' },
      };
      expect(getAllocationDriver(alloc)).toBe('WEIGHT');
    });

    it('identifies BASELINE driver from snapshot primary_driver', () => {
      const alloc: StudyPlanAllocation = {
        id: '4',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 60,
        explanation_code: 'ALLOCATED_BASELINE',
        snapshot_state: { primary_driver: 'BASELINE' },
      };
      expect(getAllocationDriver(alloc)).toBe('BASELINE');
    });

    it('falls back to explanation_code when primary_driver is missing', () => {
      const alloc: StudyPlanAllocation = {
        id: '5',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 60,
        explanation_code: 'ALLOCATED_URGENCY',
        snapshot_state: {},
      };
      expect(getAllocationDriver(alloc)).toBe('URGENCY');
    });

    it('returns UNKNOWN for missing or unfamiliar codes', () => {
      const alloc: StudyPlanAllocation = {
        id: '6',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 60,
        explanation_code: '',
        snapshot_state: {},
      };
      expect(getAllocationDriver(alloc)).toBe('UNKNOWN');

      const alloc2: StudyPlanAllocation = {
        ...alloc,
        explanation_code: 'CUSTOM_UNKNOWN_CODE',
        snapshot_state: { primary_driver: 'MAGIC_FACTOR' },
      };
      expect(getAllocationDriver(alloc2)).toBe('UNKNOWN');
    });
  });

  describe('getAllocationBadge', () => {
    it('returns student-friendly badge for standard engine drivers', () => {
      expect(getAllocationBadge({
        id: '1', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: 'ALLOCATED_URGENCY', snapshot_state: { primary_driver: 'URGENCY' },
      })).toBe('Upcoming assessment');

      expect(getAllocationBadge({
        id: '2', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: 'ALLOCATED_DEFICIT', snapshot_state: { primary_driver: 'DEFICIT' },
      })).toBe('Target deficit');

      expect(getAllocationBadge({
        id: '3', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: 'ALLOCATED_WEIGHT', snapshot_state: { primary_driver: 'WEIGHT' },
      })).toBe('High weight');

      expect(getAllocationBadge({
        id: '4', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: 'ALLOCATED_BASELINE', snapshot_state: { primary_driver: 'BASELINE' },
      })).toBe('Standard review');
    });

    it('preserves custom non-ALLOCATED_ explanation codes formatted with spaces', () => {
      expect(getAllocationBadge({
        id: '1', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: 'urgent_and_deficit', snapshot_state: {},
      })).toBe('urgent and deficit');

      expect(getAllocationBadge({
        id: '2', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: 'exam_approaching', snapshot_state: {},
      })).toBe('exam approaching');
    });

    it('returns null for "none" or unknown without custom code', () => {
      expect(getAllocationBadge({
        id: '1', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: 'none', snapshot_state: {},
      })).toBeNull();

      expect(getAllocationBadge({
        id: '2', plan_id: 'p1', subject_id: 's1', allocated_minutes: 60,
        explanation_code: '', snapshot_state: {},
      })).toBeNull();
    });
  });

  describe('formatAllocationExplanation', () => {
    it('explains URGENCY with upcoming assessment days and weight', () => {
      const alloc: StudyPlanAllocation = {
        id: '1',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 120,
        explanation_code: 'ALLOCATED_URGENCY',
        snapshot_state: {
          primary_driver: 'URGENCY',
          next_assessment: { days: 4, weight: 25 },
          remaining_weight: 60,
        },
      };

      const result = formatAllocationExplanation(alloc);
      expect(result.driver).toBe('URGENCY');
      expect(result.summary).toBe('Prioritized for an upcoming assessment (25% weight) scheduled in 4 days.');
      expect(result.details).toContain('Next assessment: in 4 days');
      expect(result.details).toContain('Assessment weight: 25%');
      expect(result.details).toContain('Remaining weight: 60%');
      expect(result.badgeText).toBe('Upcoming assessment');
      expect(result.summary).not.toContain('ALLOCATED_URGENCY');
    });

    it('handles URGENCY scheduled for today (days = 0) and tomorrow (days = 1)', () => {
      const allocToday: StudyPlanAllocation = {
        id: '1',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 90,
        explanation_code: 'ALLOCATED_URGENCY',
        snapshot_state: {
          primary_driver: 'URGENCY',
          next_assessment: { days: 0, weight: 15 },
        },
      };
      const resultToday = formatAllocationExplanation(allocToday);
      expect(resultToday.summary).toContain('scheduled for today');
      expect(resultToday.details).toContain('Next assessment: Today');

      const allocTomorrow: StudyPlanAllocation = {
        ...allocToday,
        snapshot_state: {
          primary_driver: 'URGENCY',
          next_assessment: { days: 1, weight: 15 },
        },
      };
      const resultTomorrow = formatAllocationExplanation(allocTomorrow);
      expect(resultTomorrow.summary).toContain('scheduled for tomorrow');
      expect(resultTomorrow.details).toContain('Next assessment: Tomorrow');
    });

    it('explains DEFICIT with target, current, and score deficit', () => {
      const alloc: StudyPlanAllocation = {
        id: '2',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 90,
        explanation_code: 'ALLOCATED_DEFICIT',
        snapshot_state: {
          primary_driver: 'DEFICIT',
          subject_target: 85,
          subject_current: 72.5,
          remaining_weight: 45,
        },
      };

      const result = formatAllocationExplanation(alloc);
      expect(result.driver).toBe('DEFICIT');
      expect(result.summary).toBe('Allocated to close a grade deficit: currently at 72.5% toward your target of 85%.');
      expect(result.details).toContain('Target grade: 85%');
      expect(result.details).toContain('Current grade: 72.5%');
      expect(result.details).toContain('Score deficit: 12.5%');
      expect(result.details).toContain('Remaining weight: 45%');
      expect(result.badgeText).toBe('Target deficit');
    });

    it('explains WEIGHT driver with upcoming assessment or remaining weight', () => {
      const alloc: StudyPlanAllocation = {
        id: '3',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 80,
        explanation_code: 'ALLOCATED_WEIGHT',
        snapshot_state: {
          primary_driver: 'WEIGHT',
          next_assessment: { days: 14, weight: 35 },
          remaining_weight: 70,
        },
      };

      const result = formatAllocationExplanation(alloc);
      expect(result.driver).toBe('WEIGHT');
      expect(result.summary).toBe('Prioritized due to heavy assessment weight (35% of course grade).');
      expect(result.details).toContain('Assessment weight: 35%');
      expect(result.details).toContain('Remaining weight: 70%');
      expect(result.badgeText).toBe('High weight');
    });

    it('explains BASELINE driver cleanly', () => {
      const alloc: StudyPlanAllocation = {
        id: '4',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 60,
        explanation_code: 'ALLOCATED_BASELINE',
        snapshot_state: {
          primary_driver: 'BASELINE',
          subject_target: 80,
          remaining_weight: 50,
        },
      };

      const result = formatAllocationExplanation(alloc);
      expect(result.driver).toBe('BASELINE');
      expect(result.summary).toBe('Standard weekly study time allocated to maintain balanced progress across active subjects.');
      expect(result.details).toContain('Target grade: 80%');
      expect(result.details).toContain('Remaining weight: 50%');
      expect(result.badgeText).toBe('Standard review');
    });

    it('handles UNKNOWN or completely empty snapshot gracefully without throwing', () => {
      const allocEmpty: StudyPlanAllocation = {
        id: '5',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 45,
        explanation_code: '',
        snapshot_state: {},
      };

      const result = formatAllocationExplanation(allocEmpty);
      expect(result.driver).toBe('UNKNOWN');
      expect(result.summary).toBe('45 minutes allocated for regular study in this subject.');
      expect(result.details).toEqual([]);
      expect(result.badgeText).toBeNull();
    });

    it('handles corrupt or null numerical values gracefully without NaN in strings', () => {
      const allocCorrupt: StudyPlanAllocation = {
        id: '6',
        plan_id: 'p1',
        subject_id: 's1',
        allocated_minutes: 30,
        explanation_code: 'ALLOCATED_URGENCY',
        snapshot_state: {
          primary_driver: 'URGENCY',
          next_assessment: { days: 'invalid' as any, weight: null as any },
          remaining_weight: undefined,
          subject_target: 'not-a-number' as any,
        },
      };

      const result = formatAllocationExplanation(allocCorrupt);
      expect(result.driver).toBe('URGENCY');
      expect(result.summary).toBe('Prioritized due to an upcoming assessment deadline.');
      expect(result.summary).not.toContain('NaN');
      expect(result.summary).not.toContain('undefined');
      expect(result.summary).not.toContain('null');
      expect(result.summary).not.toContain('ALLOCATED_URGENCY');
    });
  });
});
