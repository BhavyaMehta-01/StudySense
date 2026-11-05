import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Semester, StudyPlan, StudyPlanCreate } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { getDefaultWeekRange, isMonday, isSunday } from './studyPlanDates';

export interface GenerateStudyPlanFormProps {
  activeSemester: Semester;
  onClose?: () => void;
  onSuccess?: () => void;
}

export default function GenerateStudyPlanForm({
  activeSemester,
  onClose,
  onSuccess,
}: GenerateStudyPlanFormProps) {
  const queryClient = useQueryClient();

  const defaultDates = getDefaultWeekRange();
  const [startDate, setStartDate] = useState(defaultDates.startDate);
  const [endDate, setEndDate] = useState(defaultDates.endDate);
  const [availableMinutes, setAvailableMinutes] = useState('600');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: StudyPlanCreate) => api.post<StudyPlan>('/study-plans', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study-plans'] });
      queryClient.invalidateQueries({ queryKey: ['study-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSuccessMessage('Weekly study plan generated successfully!');
      setFormError(null);
      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (err: any) => {
      setSuccessMessage(null);
      if (err?.status === 400) {
        setFormError(
          err?.data?.detail ||
          'No eligible subjects or assessments found. Please add upcoming, weighted assessments to your subjects before generating a plan.'
        );
      } else if (err?.status === 409) {
        const detail = err?.data?.detail || '';
        if (detail.includes('no active semester')) {
          setFormError('No active semester found. Please activate a semester on the Semesters page.');
        } else if (detail.includes('already has an active study plan')) {
          setFormError('An active study plan already exists for your account.');
        } else {
          setFormError(detail || 'A conflict occurred while creating the study plan.');
        }
      } else {
        setFormError(err?.data?.detail || err?.message || 'Failed to generate study plan.');
      }
    },
  });

  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    setFormError(null);
    if (isMonday(val)) {
      const [y, m, d] = val.split('-').map(Number);
      const sunday = new Date(y, m - 1, d + 6);
      const sy = sunday.getFullYear();
      const sm = String(sunday.getMonth() + 1).padStart(2, '0');
      const sd = String(sunday.getDate()).padStart(2, '0');
      setEndDate(`${sy}-${sm}-${sd}`);
    }
  };

  const handleEndDateChange = (val: string) => {
    setEndDate(val);
    setFormError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;

    setFormError(null);
    setSuccessMessage(null);

    if (!startDate) {
      setFormError('Please select a start date.');
      return;
    }

    if (!isMonday(startDate)) {
      setFormError('Start date must be a Monday.');
      return;
    }

    if (!endDate) {
      setFormError('Please select an end date.');
      return;
    }

    if (!isSunday(endDate)) {
      setFormError('End date must be a Sunday.');
      return;
    }

    if (startDate > endDate) {
      setFormError('Start date must be before or equal to end date.');
      return;
    }

    const mins = Number(availableMinutes);
    if (isNaN(mins) || mins <= 0 || !Number.isInteger(mins)) {
      setFormError('Weekly study time must be a positive whole number.');
      return;
    }

    if (mins % 5 !== 0) {
      setFormError('Weekly study time must be divisible by 5 minutes.');
      return;
    }

    mutation.mutate({
      start_date: startDate,
      end_date: endDate,
      available_minutes: mins,
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <h4 className="text-sm font-semibold text-gray-900">Create Weekly Study Plan</h4>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={mutation.isPending}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </Button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Generating plan for <span className="font-medium text-gray-700">{activeSemester.name}</span>. The allocation engine will distribute your available minutes across subjects based on assessment deadlines and grade targets.
      </p>

      {formError && (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-600" />
          <span>{formError}</span>
        </div>
      )}

      {successMessage && (
        <div role="status" className="flex items-start gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-green-600" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Start Date */}
        <div className="space-y-1.5">
          <Label htmlFor="plan-start-date">Week Start (Monday)</Label>
          <Input
            id="plan-start-date"
            type="date"
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
            disabled={mutation.isPending}
            required
          />
          <p className="text-[11px] text-gray-500">Must be a Monday.</p>
        </div>

        {/* End Date */}
        <div className="space-y-1.5">
          <Label htmlFor="plan-end-date">Week End (Sunday)</Label>
          <Input
            id="plan-end-date"
            type="date"
            value={endDate}
            onChange={(e) => handleEndDateChange(e.target.value)}
            disabled={mutation.isPending}
            required
          />
          <p className="text-[11px] text-gray-500">Must be a Sunday.</p>
        </div>

        {/* Available Minutes */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="plan-available-minutes">Weekly Available Study Time (minutes)</Label>
          <Input
            id="plan-available-minutes"
            type="number"
            min="5"
            step="5"
            value={availableMinutes}
            onChange={(e) => {
              setAvailableMinutes(e.target.value);
              setFormError(null);
            }}
            disabled={mutation.isPending}
            placeholder="e.g. 600"
            required
          />
          <p className="text-[11px] text-gray-500">
            Total available study time for the week (e.g. 600 min = 10 hours). Must be a positive integer divisible by 5.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {onClose && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Generating Plan...' : 'Generate Study Plan'}
        </Button>
      </div>
    </form>
  );
}
