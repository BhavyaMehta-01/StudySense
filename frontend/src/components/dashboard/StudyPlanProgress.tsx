import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Semester, StudyPlan, StudySession } from '@/types/api';
import { Calendar, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LogStudySessionForm from './LogStudySessionForm';

interface StudyPlanProgressProps {
  subjectMap?: Record<string, string>;
}

function formatDateRange(startStr: string, endStr: string): string {
  try {
    const [sYear, sMonth, sDay] = startStr.split('-').map(Number);
    const [eYear, eMonth, eDay] = endStr.split('-').map(Number);
    const sDate = new Date(Date.UTC(sYear, sMonth - 1, sDay));
    const eDate = new Date(Date.UTC(eYear, eMonth - 1, eDay));
    const sFormatted = sDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const eFormatted = eDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `${sFormatted} – ${eFormatted}`;
  } catch {
    return `${startStr} – ${endStr}`;
  }
}

export default function StudyPlanProgress({ subjectMap = {} }: StudyPlanProgressProps) {
  const [isLogging, setIsLogging] = useState(false);
  const [selectedAllocId, setSelectedAllocId] = useState<string | undefined>(undefined);

  const {
    data: semesters,
    isLoading: isLoadingSemesters,
    error: semestersError,
  } = useQuery<Semester[]>({
    queryKey: ['semesters'],
    queryFn: () => api.get('/semesters'),
  });

  const activeSemester = Array.isArray(semesters)
    ? semesters.find((s) => s.is_active)
    : undefined;

  const {
    data: activePlan,
    isLoading: isLoadingPlan,
    error: planError,
  } = useQuery<StudyPlan | null>({
    queryKey: ['study-plans', 'active'],
    queryFn: async () => {
      try {
        const res = await api.get<StudyPlan>('/study-plans/active');
        return res && typeof res === 'object' && Array.isArray((res as any).allocations) ? res : null;
      } catch (err: any) {
        if (err?.status === 404) {
          return null;
        }
        throw err;
      }
    },
  });

  const {
    data: sessions,
    isLoading: isLoadingSessions,
    error: sessionsError,
  } = useQuery<StudySession[]>({
    queryKey: ['study-sessions', activePlan?.id],
    queryFn: () => api.get(`/study-sessions?plan_id=${activePlan!.id}`),
    enabled: !!activePlan?.id,
  });

  if (isLoadingSemesters || isLoadingPlan) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <p className="text-sm font-medium">Loading study plan progress...</p>
        </div>
      </div>
    );
  }

  if (semestersError || (planError && (planError as any)?.status !== 404)) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-700">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <h3 className="text-sm font-medium">Error loading study plan</h3>
        </div>
        <p className="mt-1 text-xs text-red-600 pl-7">
          Could not retrieve study plan data. Please try again later.
        </p>
      </div>
    );
  }

  if (!activeSemester) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
        <h3 className="text-sm font-medium text-gray-900">No active semester</h3>
        <p className="mt-1 text-xs text-gray-500">
          You do not have an active semester selected. Please mark a semester as active to view your weekly study plan.
        </p>
      </div>
    );
  }

  if (!activePlan) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
        <h3 className="text-sm font-medium text-gray-900">No active study plan</h3>
        <p className="mt-1 text-xs text-gray-500">
          No active study plan found for {activeSemester.name}.
        </p>
      </div>
    );
  }

  if (!activePlan.allocations || activePlan.allocations.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm text-center">
        <h3 className="text-sm font-medium text-gray-900">Empty study plan</h3>
        <p className="mt-1 text-xs text-gray-500">This study plan has no allocations.</p>
      </div>
    );
  }

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const totalAllocated = activePlan.allocations.reduce((sum, a) => sum + (a.allocated_minutes || 0), 0);
  const totalLogged = safeSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const overallPercent = totalAllocated > 0 ? Math.round((totalLogged / totalAllocated) * 100) : 0;
  const isOverallOver = totalLogged > totalAllocated;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Plan Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium text-gray-900">Weekly Study Plan</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                <Calendar className="h-3 w-3" />
                {formatDateRange(activePlan.start_date, activePlan.end_date)}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {activeSemester.name} • {activePlan.available_minutes} min available weekly
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-xs text-gray-500 block">Total Planned</span>
              <span className="font-semibold text-gray-900">{totalAllocated} min</span>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <span className="text-xs text-gray-500 block">Total Logged</span>
              <span className={`font-semibold ${isOverallOver ? 'text-indigo-600' : 'text-gray-900'}`}>
                {totalLogged} min
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setSelectedAllocId(undefined);
                setIsLogging((prev) => !prev);
              }}
            >
              {isLogging ? 'Cancel' : 'Log study session'}
            </Button>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Overall Plan Progress</span>
            <span className="font-medium text-gray-700">
              {totalLogged} / {totalAllocated} min ({overallPercent}%)
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={totalLogged}
            aria-valuemin={0}
            aria-valuemax={totalAllocated}
            aria-label={`Overall plan progress: ${totalLogged} of ${totalAllocated} minutes logged (${overallPercent}%)`}
            className="h-2 w-full bg-gray-100 rounded-full overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isOverallOver ? 'bg-indigo-600' : overallPercent >= 100 ? 'bg-green-600' : 'bg-blue-600'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, overallPercent))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Log Study Session Form */}
      {isLogging && (
        <div className="border-b border-gray-200 bg-gray-50/60 p-6">
          <LogStudySessionForm
            plan={activePlan}
            subjectMap={subjectMap}
            initialAllocationId={selectedAllocId}
            onClose={() => {
              setIsLogging(false);
              setSelectedAllocId(undefined);
            }}
            onSuccess={() => {
              setIsLogging(false);
              setSelectedAllocId(undefined);
            }}
          />
        </div>
      )}

      {/* Allocation breakdown */}
      <div className="divide-y divide-gray-200">
        {activePlan.allocations.map((alloc) => {
          const subjectName =
            alloc.snapshot_state?.subject_name ||
            (alloc.subject_id ? subjectMap[alloc.subject_id] : null) ||
            'Subject';

          const logged = safeSessions
            .filter((s) => s.allocation_id === alloc.id)
            .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);

          const percent = alloc.allocated_minutes > 0
            ? Math.round((logged / alloc.allocated_minutes) * 100)
            : 0;

          const isOver = logged > alloc.allocated_minutes;
          const isComplete = percent >= 100;

          return (
            <div key={alloc.id} className="p-6 hover:bg-gray-50 transition-colors">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{subjectName}</p>
                    {isComplete && (
                      <span title="Planned time completed" className="inline-flex items-center">
                        <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                      </span>
                    )}
                    {alloc.explanation_code && (
                      <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 capitalize">
                        {alloc.explanation_code.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {alloc.snapshot_state?.subject_target != null && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Target: {alloc.snapshot_state.subject_target}%
                    </p>
                  )}
                </div>

                <div className="flex flex-col sm:items-end gap-1 sm:w-64">
                  <div className="flex items-center justify-between w-full text-xs">
                    <span className="text-gray-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Planned: {alloc.allocated_minutes} min
                    </span>
                    <span className={`font-semibold ${isOver ? 'text-indigo-600' : 'text-gray-900'}`}>
                      {logged} / {alloc.allocated_minutes} min ({percent}%)
                    </span>
                  </div>

                  {/* Accessible Progress Indicator */}
                  <div
                    role="progressbar"
                    aria-valuenow={logged}
                    aria-valuemin={0}
                    aria-valuemax={alloc.allocated_minutes}
                    aria-label={`Study progress for ${subjectName}: ${logged} of ${alloc.allocated_minutes} minutes logged (${percent}%)`}
                    className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden"
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isOver ? 'bg-indigo-600' : isComplete ? 'bg-green-600' : 'bg-blue-600'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>

                  {isOver && (
                    <span className="text-[11px] font-medium text-indigo-600">
                      +{logged - alloc.allocated_minutes} min over planned allocation
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAllocId(alloc.id);
                      setIsLogging(true);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium self-end transition-colors"
                  >
                    Log session
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer session history status */}
      <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
        {isLoadingSessions ? (
          <p className="text-xs text-gray-400">Loading session history...</p>
        ) : sessionsError ? (
          <p className="text-xs text-red-500">Failed to load session history for this plan.</p>
        ) : safeSessions.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No study sessions recorded yet for this plan.</p>
        ) : (
          <p className="text-xs text-gray-600">
            {safeSessions.length} study session{safeSessions.length === 1 ? '' : 's'} recorded for this plan
          </p>
        )}
      </div>
    </div>
  );
}
