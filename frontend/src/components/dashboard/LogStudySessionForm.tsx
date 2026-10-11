import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { StudyPlan, StudySession, StudySessionCreate, StudySessionStatus } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export interface LogStudySessionFormProps {
  plan: StudyPlan;
  subjectMap?: Record<string, string>;
  initialAllocationId?: string;
  onClose?: () => void;
  onSuccess?: () => void;
}

function getDefaultSessionDate(startDate: string, endDate: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  if (todayStr >= startDate && todayStr <= endDate) {
    return todayStr;
  }
  return startDate;
}

export default function LogStudySessionForm({
  plan,
  subjectMap = {},
  initialAllocationId,
  onClose,
  onSuccess,
}: LogStudySessionFormProps) {
  const queryClient = useQueryClient();

  const defaultAllocId =
    initialAllocationId || (plan.allocations.length > 0 ? plan.allocations[0].id : '');

  const [allocationId, setAllocationId] = useState(defaultAllocId);
  const [sessionDate, setSessionDate] = useState(() =>
    getDefaultSessionDate(plan.start_date, plan.end_date)
  );
  const [status, setStatus] = useState<StudySessionStatus>('completed');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: StudySessionCreate) =>
      api.post<StudySession>('/study-sessions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['study-plans'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSuccessMessage('Study session logged successfully!');
      setFormError(null);
      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (err: any) => {
      setSuccessMessage(null);
      setFormError(err?.data?.detail || err?.message || 'Failed to log study session.');
    },
  });

  const handleStatusChange = (newStatus: StudySessionStatus) => {
    setStatus(newStatus);
    setFormError(null);
    if (newStatus === 'skipped') {
      setDurationMinutes('0');
    } else if (durationMinutes === '0' || durationMinutes === '') {
      setDurationMinutes('60');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;

    setFormError(null);
    setSuccessMessage(null);

    if (!allocationId) {
      setFormError('Please select a subject allocation.');
      return;
    }

    if (!sessionDate) {
      setFormError('Please select a session date.');
      return;
    }

    if (sessionDate < plan.start_date || sessionDate > plan.end_date) {
      setFormError(`Date must be within the plan period (${plan.start_date} to ${plan.end_date}).`);
      return;
    }

    const dur = Number(durationMinutes);
    if (isNaN(dur) || dur < 0 || !Number.isInteger(dur)) {
      setFormError('Duration must be a positive whole number of minutes.');
      return;
    }

    if (status === 'skipped' && dur !== 0) {
      setFormError('Duration must be 0 for skipped sessions.');
      return;
    }

    if ((status === 'completed' || status === 'partial') && dur <= 0) {
      setFormError(`Duration must be greater than 0 for ${status} sessions.`);
      return;
    }

    mutation.mutate({
      allocation_id: allocationId,
      date: sessionDate,
      duration_minutes: dur,
      status,
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <h4 className="text-sm font-semibold text-gray-900">Log Study Session</h4>
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
        {/* Allocation selection */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="session-allocation">Subject Allocation</Label>
          <select
            id="session-allocation"
            value={allocationId}
            onChange={(e) => {
              setAllocationId(e.target.value);
              setFormError(null);
            }}
            disabled={mutation.isPending}
            className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {plan.allocations.map((alloc) => {
              const name =
                alloc.snapshot_state?.subject_name ||
                (alloc.subject_id ? subjectMap[alloc.subject_id] : null) ||
                'Subject';
              return (
                <option key={alloc.id} value={alloc.id}>
                  {name} ({alloc.allocated_minutes} min planned)
                </option>
              );
            })}
          </select>
        </div>

        {/* Date input */}
        <div className="space-y-1.5">
          <Label htmlFor="session-date">Date</Label>
          <Input
            id="session-date"
            type="date"
            value={sessionDate}
            min={plan.start_date}
            max={plan.end_date}
            onChange={(e) => {
              setSessionDate(e.target.value);
              setFormError(null);
            }}
            disabled={mutation.isPending}
            required
          />
          <p className="text-[11px] text-gray-500">
            Within plan week: {plan.start_date} to {plan.end_date}
          </p>
        </div>

        {/* Status selection */}
        <div className="space-y-1.5">
          <Label htmlFor="session-status">Status</Label>
          <select
            id="session-status"
            value={status}
            onChange={(e) => handleStatusChange(e.target.value as StudySessionStatus)}
            disabled={mutation.isPending}
            className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="completed">Completed</option>
            <option value="partial">Partial</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>

        {/* Duration input */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="session-duration">Duration (minutes)</Label>
          <Input
            id="session-duration"
            type="number"
            min="0"
            step="1"
            value={durationMinutes}
            onChange={(e) => {
              setDurationMinutes(e.target.value);
              setFormError(null);
            }}
            disabled={status === 'skipped' || mutation.isPending}
            placeholder={status === 'skipped' ? '0' : 'e.g. 45'}
            required={status !== 'skipped'}
          />
          {status === 'skipped' ? (
            <p className="text-[11px] text-gray-500">Duration is set to 0 minutes for skipped sessions.</p>
          ) : (
            <p className="text-[11px] text-gray-500">Actual minutes spent studying.</p>
          )}
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
          {mutation.isPending ? 'Saving...' : 'Save Study Session'}
        </Button>
      </div>
    </form>
  );
}
