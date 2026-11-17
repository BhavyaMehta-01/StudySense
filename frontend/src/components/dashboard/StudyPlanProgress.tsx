import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Semester, StudyPlan, StudySession } from '@/types/api';
import { Calendar, Clock, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router';
import LogStudySessionForm from './LogStudySessionForm';
import GenerateStudyPlanForm from './GenerateStudyPlanForm';
import { isPlanExpired } from './studyPlanDates';
import { formatAllocationExplanation } from './allocationExplanation';

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
  const queryClient = useQueryClient();
  const [isLogging, setIsLogging] = useState(false);
  const [selectedAllocId, setSelectedAllocId] = useState<string | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [expandedAllocIds, setExpandedAllocIds] = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [expandedHistoryPlanId, setExpandedHistoryPlanId] = useState<string | null>(null);

  const toggleExplanation = (allocId: string) => {
    setExpandedAllocIds((prev) => ({
      ...prev,
      [allocId]: !prev[allocId],
    }));
  };

  const deactivateMutation = useMutation({
    mutationFn: (planId: string) => api.patch<StudyPlan>(`/study-plans/${planId}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study-plans'] });
      queryClient.invalidateQueries({ queryKey: ['study-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setDeactivateError(null);
    },
    onError: (err: any) => {
      setDeactivateError(err?.data?.detail || err.message || 'Failed to deactivate study plan');
    },
  });

  const handleDeactivate = () => {
    if (!activePlan?.id || deactivateMutation.isPending) return;
    setDeactivateError(null);
    deactivateMutation.mutate(activePlan.id);
  };

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
    data: allPlans,
  } = useQuery<StudyPlan[]>({
    queryKey: ['study-plans'],
    queryFn: async () => {
      try {
        const res = await api.get<StudyPlan[]>('/study-plans');
        return Array.isArray(res) ? res : [];
      } catch {
        return [];
      }
    },
  });

  const {
    data: allSessions,
  } = useQuery<StudySession[]>({
    queryKey: ['study-sessions', 'all'],
    queryFn: async () => {
      try {
        const res = await api.get<StudySession[]>('/study-sessions');
        return Array.isArray(res) ? res : [];
      } catch {
        return [];
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
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs text-card-foreground">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-sm font-medium">Loading study plan progress...</p>
        </div>
      </div>
    );
  }

  if (semestersError || (planError && (planError as any)?.status !== 404)) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-destructive">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
          <h3 className="text-sm font-semibold">Error loading study plan</h3>
        </div>
        <p className="mt-1 text-xs pl-7 opacity-90">
          Could not retrieve study plan data. Please try again later.
        </p>
      </div>
    );
  }

  if (!activeSemester) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-card-foreground">
        <h3 className="text-sm font-semibold text-foreground">No active semester</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          You do not have an active semester selected. Please mark a semester as active to view your weekly study plan.
        </p>
        <div className="mt-4">
          <Link to="/app/semesters">
            <Button variant="outline" size="sm">Go to Semesters</Button>
          </Link>
        </div>
      </div>
    );
  }

  const historicalPlans = Array.isArray(allPlans)
    ? allPlans.filter((p) => !p.is_active || (activePlan && p.id !== activePlan.id))
    : [];

  const renderHistorySection = () => {
    if (!historicalPlans.length) return null;

    const safeAllSessions = Array.isArray(allSessions) ? allSessions : [];

    return (
      <div className="rounded-xl border border-border bg-card/85 backdrop-blur-md shadow-xs overflow-hidden text-card-foreground">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Plan History</h3>
            <span className="rounded-full bg-muted border border-border px-2 py-0.5 text-xs text-muted-foreground font-medium">
              {historicalPlans.length} past {historicalPlans.length === 1 ? 'plan' : 'plans'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory((prev) => !prev)}
            className="text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            {showHistory ? (
              <>
                <span>Hide History</span>
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span>View History</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>

        {showHistory && (
          <div className="divide-y divide-border/60">
            {historicalPlans.map((plan) => {
              const planAllocIds = new Set((plan.allocations || []).map((a) => a.id));
              const planSessions = safeAllSessions.filter(
                (s) => s.allocation_id && planAllocIds.has(s.allocation_id)
              );
              const totalLogged = planSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
              const isPlanExpanded = expandedHistoryPlanId === plan.id;

              return (
                <div key={plan.id} className="p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground text-sm">
                        {formatDateRange(plan.start_date, plan.end_date)}
                      </span>
                      <span className="rounded-full bg-muted text-muted-foreground border border-border px-2.5 py-0.5 text-xs font-medium">
                        Past Plan
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Planned: <strong className="text-foreground tabular-nums">{plan.available_minutes}m</strong></span>
                      <span>•</span>
                      <span>Logged: <strong className="text-foreground tabular-nums">{totalLogged}m</strong></span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedHistoryPlanId(isPlanExpanded ? null : plan.id)}
                        className="text-xs text-primary hover:underline h-7 px-2"
                      >
                        {isPlanExpanded ? 'Hide Details' : 'View Details'}
                      </Button>
                    </div>
                  </div>

                  {isPlanExpanded && (
                    <div className="pt-2 space-y-4">
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Subject Allocations
                        </h4>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(plan.allocations || []).map((alloc) => {
                            const allocSessions = planSessions.filter(
                              (s) => s.allocation_id === alloc.id
                            );
                            const allocLogged = allocSessions.reduce(
                              (sum, s) => sum + (s.duration_minutes || 0),
                              0
                            );
                            const subjName = (alloc.subject_id && subjectMap[alloc.subject_id]) || 'Subject';

                            return (
                              <div
                                key={alloc.id}
                                className="rounded-lg bg-muted/40 border border-border/60 p-3 text-xs"
                              >
                                <div className="flex justify-between font-medium text-foreground mb-1">
                                  <span>{subjName}</span>
                                  <span className="tabular-nums">
                                    {allocLogged} / {alloc.allocated_minutes}m
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                  <div
                                    className="h-full bg-primary/70 transition-all"
                                    style={{
                                      width: `${alloc.allocated_minutes > 0 ? Math.min(100, Math.round((allocLogged / alloc.allocated_minutes) * 100)) : 0}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {planSessions.length > 0 && (
                        <div className="space-y-1.5 pt-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Logged Sessions ({planSessions.length})
                          </h4>
                          <div className="space-y-1">
                            {planSessions.map((sess) => (
                              <div
                                key={sess.id}
                                className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-muted/20 border border-border/40"
                              >
                                <span className="text-muted-foreground">{sess.date}</span>
                                <span className="capitalize font-medium text-foreground">{sess.status}</span>
                                <span className="tabular-nums text-foreground font-medium">{sess.duration_minutes} min</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (!activePlan) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-card-foreground">
          {!isGenerating ? (
            <div className="text-center">
              <h3 className="text-sm font-semibold text-foreground">No active study plan</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                No active study plan found for {activeSemester.name}.
              </p>
              <div className="mt-4">
                <Button onClick={() => setIsGenerating(true)} size="sm">
                  Create Weekly Study Plan
                </Button>
              </div>
            </div>
          ) : (
            <GenerateStudyPlanForm
              activeSemester={activeSemester}
              onClose={() => setIsGenerating(false)}
              onSuccess={() => setIsGenerating(false)}
            />
          )}
        </div>
        {renderHistorySection()}
      </div>
    );
  }

  if (!activePlan.allocations || activePlan.allocations.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs text-center text-card-foreground">
          <h3 className="text-sm font-semibold text-foreground">Empty study plan</h3>
          <p className="mt-1 text-xs text-muted-foreground">This study plan has no allocations.</p>
        </div>
        {renderHistorySection()}
      </div>
    );
  }

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const totalAllocated = activePlan.allocations.reduce((sum, a) => sum + (a.allocated_minutes || 0), 0);
  const totalLogged = safeSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const overallPercent = totalAllocated > 0 ? Math.round((totalLogged / totalAllocated) * 100) : 0;
  const isOverallOver = totalLogged > totalAllocated;
  const isExpired = isPlanExpired(activePlan.end_date);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card/85 backdrop-blur-md shadow-xs overflow-hidden text-card-foreground">
        {/* Plan Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">Weekly Study Plan</h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-xs font-medium">
                  <Calendar className="h-3 w-3" />
                  {formatDateRange(activePlan.start_date, activePlan.end_date)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {activeSemester.name} • {activePlan.available_minutes} min available weekly
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">Total Planned</span>
                <span className="font-semibold text-foreground tabular-nums">{totalAllocated} min</span>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <span className="text-xs text-muted-foreground block">Total Logged</span>
                <span className={`font-semibold tabular-nums ${isOverallOver ? 'text-primary font-bold' : 'text-foreground'}`}>
                  {totalLogged} min
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={deactivateMutation.isPending}
                onClick={handleDeactivate}
              >
                {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate plan'}
              </Button>
              <Button
                size="sm"
                disabled={deactivateMutation.isPending}
                onClick={() => {
                  setSelectedAllocId(undefined);
                  setIsLogging((prev) => !prev);
                }}
              >
                {isLogging ? 'Cancel' : 'Log study session'}
              </Button>
            </div>
          </div>

          {/* Deactivation error banner */}
          {deactivateError && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-destructive" />
              <span>{deactivateError}</span>
            </div>
          )}

          {/* Expired plan notice */}
          {isExpired && (
            <div
              role="status"
              className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span>
                  This study plan's week has ended. Deactivate it to create a new weekly study plan.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={deactivateMutation.isPending}
                onClick={handleDeactivate}
                className="border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 self-start sm:self-auto flex-shrink-0"
              >
                {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate plan'}
              </Button>
            </div>
          )}

          {/* Overall Progress Bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Overall Plan Progress</span>
              <span className="font-medium text-foreground tabular-nums">
                {totalLogged} / {totalAllocated} min ({overallPercent}%)
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={totalLogged}
              aria-valuemin={0}
              aria-valuemax={totalAllocated}
              aria-label={`Overall plan progress: ${totalLogged} of ${totalAllocated} minutes logged (${overallPercent}%)`}
              className="h-2 w-full bg-muted rounded-full overflow-hidden"
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${isOverallOver ? 'bg-primary' : overallPercent >= 100 ? 'bg-success' : 'bg-brand-secondary'
                  }`}
                style={{ width: `${Math.min(100, Math.max(0, overallPercent))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Log Study Session Form */}
        {isLogging && (
          <div className="border-b border-border bg-muted/30 p-6">
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
        <div className="divide-y divide-border">
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

            const explanation = formatAllocationExplanation(alloc);
            const isExpanded = !!expandedAllocIds[alloc.id];

            return (
              <div key={alloc.id} className="p-6 hover:bg-muted/40 transition-colors">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground truncate">{subjectName}</p>
                      {isComplete && (
                        <span title="Planned time completed" className="inline-flex items-center">
                          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                        </span>
                      )}
                      {explanation.badgeText && (
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground border border-border/50 capitalize">
                          {explanation.badgeText}
                        </span>
                      )}
                    </div>
                    {alloc.snapshot_state?.subject_target != null && (
                      <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        Target: {alloc.snapshot_state.subject_target}%
                      </p>
                    )}
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={`alloc-explanation-${alloc.id}`}
                      onClick={() => toggleExplanation(alloc.id)}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium transition-colors mt-1.5 focus:outline-none focus-visible:underline"
                    >
                      <span>Why this allocation?</span>
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>

                  <div className="flex flex-col sm:items-end gap-1 sm:w-64">
                    <div className="flex items-center justify-between w-full text-xs">
                      <span className="text-muted-foreground flex items-center gap-1 tabular-nums">
                        <Clock className="h-3 w-3" />
                        Planned: {alloc.allocated_minutes} min
                      </span>
                      <span className={`font-semibold tabular-nums ${isOver ? 'text-primary' : 'text-foreground'}`}>
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
                      className="h-2.5 w-full bg-muted rounded-full overflow-hidden"
                    >
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${isOver ? 'bg-primary' : isComplete ? 'bg-success' : 'bg-brand-secondary'
                          }`}
                        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                      />
                    </div>

                    {isOver && (
                      <span className="text-[11px] font-medium text-primary tabular-nums">
                        +{logged - alloc.allocated_minutes} min over planned allocation
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAllocId(alloc.id);
                        setIsLogging(true);
                      }}
                      className="text-xs text-primary hover:underline font-medium self-end transition-colors focus:outline-none focus-visible:underline"
                    >
                      Log session
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div
                    id={`alloc-explanation-${alloc.id}`}
                    className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-foreground border border-border/60"
                  >
                    <p className="font-medium text-foreground">{explanation.summary}</p>
                    {explanation.details.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        {explanation.details.map((detail, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-secondary flex-shrink-0" />
                            {detail}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer session history status */}
        <div className="bg-muted/30 px-6 py-3 border-t border-border">
          {isLoadingSessions ? (
            <p className="text-xs text-muted-foreground">Loading session history...</p>
          ) : sessionsError ? (
            <p className="text-xs text-destructive">Failed to load session history for this plan.</p>
          ) : safeSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No study sessions recorded yet for this plan.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {safeSessions.length} study session{safeSessions.length === 1 ? '' : 's'} recorded for this plan
            </p>
          )}
        </div>
      </div>
      {renderHistorySection()}
    </div>
  );
}

