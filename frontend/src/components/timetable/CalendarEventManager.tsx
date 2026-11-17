import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, subjectPatternQueryOptions } from '@/api/client';
import type {
  AcademicCalendarEvent,
  AcademicCalendarEventCreate,
  AcademicCalendarEventUpdate,
  Subject,
  Assessment,
} from '@/types/api';
import { isAssessmentExempt } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Calendar,
  Plus,
  Edit2,
  Trash2,
  Lock,
  AlertTriangle,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  internal_test: 'Internal Test',
  assignment: 'Assignment',
  quiz: 'Quiz',
  practical: 'Practical / Lab',
  viva: 'Viva / Oral',
  project: 'Project',
  midsem: 'Midterm Exam',
  endsem: 'Final / Endsem Exam',
  other: 'Other',
};

function formatApiError(err: any, fallback: string): string {
  if (err?.data?.detail) {
    if (typeof err.data.detail === 'string') return err.data.detail;
    if (Array.isArray(err.data.detail)) {
      return err.data.detail
        .map((d: any) => (d.loc && d.loc.length > 0 ? `${d.loc[d.loc.length - 1]}: ${d.msg}` : d.msg || JSON.stringify(d)))
        .join('; ');
    }
  }
  return err?.message || fallback;
}

const EVENT_TYPES = [
  { value: 'holiday', label: 'Holiday' },
  { value: 'non_working_day', label: 'Non-Working Day' },
  { value: 'exam', label: 'Exam' },
] as const;

type CalendarEventFormData = {
  title: string;
  event_type: 'holiday' | 'non_working_day' | 'exam';
  start_date: string;
  end_date: string;
  cancels_regular_classes: boolean;
  subject_ids: string[];
  subject_components?: Record<string, string>;
};

interface CalendarEventManagerProps {
  semesterId: string;
  semesterStartDate?: string | null;
  semesterEndDate?: string | null;
  subjects: Subject[];
}

export default function CalendarEventManager({
  semesterId,
  semesterStartDate,
  semesterEndDate,
  subjects,
}: CalendarEventManagerProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AcademicCalendarEvent | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit mode assessment loading and selection tracking
  const [isLoadingAssessments, setIsLoadingAssessments] = useState(false);
  const [assessmentLoadError, setAssessmentLoadError] = useState<string | null>(null);
  const [linkedAssessments, setLinkedAssessments] = useState<Record<string, Assessment>>({});
  const [initialSubjectIds, setInitialSubjectIds] = useState<string[]>([]);
  const [initialSubjectComponents, setInitialSubjectComponents] = useState<Record<string, string>>({});

  const { data: events, isLoading, error: fetchError } = useQuery<AcademicCalendarEvent[]>({
    queryKey: ['semesters', semesterId, 'calendar'],
    queryFn: () => api.get(`/semesters/${semesterId}/calendar`),
  });

  const safeEvents = Array.isArray(events) ? events : [];

  const patternQueries = useQueries({
    queries: subjects.map(s => subjectPatternQueryOptions(s.id)),
  });

  // Track if exam subjects or their components were modified compared to edit-mode baseline
  const didSubjectsChange = (currentSubjectIds: string[], currentSubjectComponents: Record<string, string>): boolean => {
    if (!editingEventId) return true;
    if (currentSubjectIds.length !== initialSubjectIds.length) return true;
    const initialSet = new Set(initialSubjectIds);
    if (currentSubjectIds.some(id => !initialSet.has(id))) return true;
    for (const sid of currentSubjectIds) {
      const initialComp = initialSubjectComponents[sid] || '';
      const currentComp = currentSubjectComponents[sid] || '';
      if (initialComp !== currentComp) return true;
    }
    return false;
  };

  const calendarEventSchema = useMemo(() => {
    return z.object({
      title: z.string().min(1, 'Title is required'),
      event_type: z.enum(['holiday', 'non_working_day', 'exam']),
      start_date: z.string().min(1, 'Start date is required'),
      end_date: z.string().min(1, 'End date is required'),
      cancels_regular_classes: z.boolean(),
      subject_ids: z.array(z.string()),
      subject_components: z.record(z.string(), z.string()).optional(),
    }).superRefine((data, ctx) => {
      if (data.start_date && data.end_date && data.start_date > data.end_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Start date cannot be after end date',
          path: ['end_date'],
        });
      }
      if (data.event_type === 'exam' && data.subject_ids && data.subject_ids.length > 0) {
        const subjectsChanged = didSubjectsChange(data.subject_ids, data.subject_components || {});
        for (const sid of data.subject_ids) {
          const compId = data.subject_components?.[sid];
          if (!compId || compId.trim() === '') {
            // If this is an existing unchanged subject that had no component ID initially, allow title/date edit
            const isUnchangedLegacyWithoutComp =
              Boolean(editingEventId) &&
              initialSubjectIds.includes(sid) &&
              !initialSubjectComponents[sid] &&
              !subjectsChanged;

            if (!isUnchangedLegacyWithoutComp) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Please select an assessment component for this subject',
                path: ['subject_components', sid],
              });
            }
          }
        }
      }
    });
  }, [editingEventId, initialSubjectIds, initialSubjectComponents]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    clearErrors,
    formState: { errors },
  } = useForm<CalendarEventFormData>({
    resolver: zodResolver(calendarEventSchema),
    defaultValues: {
      title: '',
      event_type: 'holiday',
      start_date: semesterStartDate || '',
      end_date: semesterStartDate || '',
      cancels_regular_classes: true,
      subject_ids: [],
      subject_components: {},
    },
  });

  const selectedEventType = watch('event_type');
  const watchedSubjectIds = watch('subject_ids') || [];
  const watchedSubjectComponents = watch('subject_components') || {};

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['semesters', semesterId, 'calendar'] });
    queryClient.invalidateQueries({ queryKey: ['semesters', semesterId, 'lectures'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    subjects.forEach(s => {
      queryClient.invalidateQueries({ queryKey: ['subjects', s.id, 'assessments'] });
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: CalendarEventFormData) => {
      if (semesterStartDate && data.start_date < semesterStartDate) {
        throw new Error(`Event start date cannot precede semester start date (${semesterStartDate})`);
      }
      if (semesterEndDate && data.end_date > semesterEndDate) {
        throw new Error(`Event end date cannot exceed semester end date (${semesterEndDate})`);
      }

      const payload: AcademicCalendarEventCreate = {
        title: data.title.trim(),
        event_type: data.event_type,
        start_date: data.start_date,
        end_date: data.end_date,
        cancels_regular_classes: data.cancels_regular_classes,
        subject_ids: data.event_type === 'exam' ? data.subject_ids : [],
        subject_components: data.event_type === 'exam'
          ? data.subject_ids.map(sid => ({
              subject_id: sid,
              pattern_component_id: data.subject_components?.[sid] || '',
            }))
          : undefined,
      };
      return api.post(`/semesters/${semesterId}/calendar`, payload);
    },
    onSuccess: () => {
      invalidateQueries();
      handleCancelForm();
    },
    onError: (err: any) => {
      setFormError(formatApiError(err, 'Failed to create calendar event'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ eventId, data }: { eventId: string; data: CalendarEventFormData }) => {
      if (semesterStartDate && data.start_date < semesterStartDate) {
        throw new Error(`Event start date cannot precede semester start date (${semesterStartDate})`);
      }
      if (semesterEndDate && data.end_date > semesterEndDate) {
        throw new Error(`Event end date cannot exceed semester end date (${semesterEndDate})`);
      }

      const payload: AcademicCalendarEventUpdate = {
        title: data.title.trim(),
        event_type: data.event_type,
        start_date: data.start_date,
        end_date: data.end_date,
        cancels_regular_classes: data.cancels_regular_classes,
      };

      if (data.event_type === 'exam') {
        const subjectsModified = didSubjectsChange(data.subject_ids, data.subject_components || {});
        if (subjectsModified) {
          payload.subject_ids = data.subject_ids;
          payload.subject_components = data.subject_ids.map(sid => ({
            subject_id: sid,
            pattern_component_id: data.subject_components?.[sid] || '',
          }));
        }
        // When subjects were not modified (e.g. title/date only), subject_ids and subject_components are omitted
      } else {
        payload.subject_ids = [];
      }

      return api.put(`/semesters/${semesterId}/calendar/${eventId}`, payload);
    },
    onSuccess: () => {
      invalidateQueries();
      handleCancelForm();
    },
    onError: (err: any) => {
      setFormError(formatApiError(err, 'Failed to update calendar event'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => api.delete(`/semesters/${semesterId}/calendar/${eventId}`),
    onSuccess: () => invalidateQueries(),
    onError: (err: any) => {
      setFormError(formatApiError(err, 'Failed to delete calendar event'));
    },
  });

  const loadLinkedAssessments = async (event: AcademicCalendarEvent) => {
    if (event.event_type !== 'exam' || !event.subject_ids || event.subject_ids.length === 0) {
      setIsLoadingAssessments(false);
      setAssessmentLoadError(null);
      setLinkedAssessments({});
      setInitialSubjectIds(event.subject_ids || []);
      setInitialSubjectComponents({});
      setValue('subject_components', {});
      return;
    }

    setIsLoadingAssessments(true);
    setAssessmentLoadError(null);

    try {
      const results = await Promise.all(
        event.subject_ids.map(async (sid) => {
          const assessments = await queryClient.fetchQuery<Assessment[]>({
            queryKey: ['subjects', sid, 'assessments'],
            queryFn: () => api.get(`/subjects/${sid}/assessments`),
          });
          const linked = Array.isArray(assessments)
            ? assessments.find(a => a.calendar_event_id === event.id && a.subject_id === sid)
            : undefined;
          return { sid, linked };
        })
      );

      const linkedMap: Record<string, Assessment> = {};
      const compMap: Record<string, string> = {};

      for (const { sid, linked } of results) {
        if (linked) {
          linkedMap[sid] = linked;
          if (linked.pattern_component_id) {
            compMap[sid] = linked.pattern_component_id;
          }
        }
      }

      setLinkedAssessments(linkedMap);
      setInitialSubjectIds(event.subject_ids || []);
      setInitialSubjectComponents(compMap);
      setValue('subject_components', compMap, { shouldValidate: true });
      setIsLoadingAssessments(false);
    } catch (err: any) {
      setIsLoadingAssessments(false);
      setAssessmentLoadError(formatApiError(err, 'Failed to load existing assessment links'));
    }
  };

  const handleRetryLoadAssessments = () => {
    if (editingEvent) {
      loadLinkedAssessments(editingEvent);
    }
  };

  const handleStartEdit = (event: AcademicCalendarEvent) => {
    setEditingEvent(event);
    setEditingEventId(event.id);
    setIsAdding(false);
    setFormError(null);
    clearErrors();

    setValue('title', event.title);
    setValue('event_type', event.event_type);
    setValue('start_date', event.start_date);
    setValue('end_date', event.end_date);
    setValue('cancels_regular_classes', event.cancels_regular_classes);
    setValue('subject_ids', event.subject_ids || []);
    setValue('subject_components', {});

    loadLinkedAssessments(event);
  };

  const handleCancelForm = () => {
    setIsAdding(false);
    setEditingEvent(null);
    setEditingEventId(null);
    setFormError(null);
    setIsLoadingAssessments(false);
    setAssessmentLoadError(null);
    setLinkedAssessments({});
    setInitialSubjectIds([]);
    setInitialSubjectComponents({});
    clearErrors();
    reset();
  };

  const onSubmit = (data: CalendarEventFormData) => {
    setFormError(null);
    if (semesterStartDate && data.start_date < semesterStartDate) {
      setFormError(`Event start date cannot precede semester start date (${semesterStartDate})`);
      return;
    }
    if (semesterEndDate && data.end_date > semesterEndDate) {
      setFormError(`Event end date cannot exceed semester end date (${semesterEndDate})`);
      return;
    }
    if (isLoadingAssessments) {
      setFormError('Please wait for linked assessments to finish loading.');
      return;
    }
    if (assessmentLoadError) {
      setFormError('Cannot save while linked assessment loading has failed. Please retry.');
      return;
    }
    if (data.event_type === 'exam' && data.subject_ids.length > 0) {
      for (const sid of data.subject_ids) {
        const idx = subjects.findIndex(s => s.id === sid);
        if (idx !== -1) {
          const q = patternQueries[idx];
          if (q.isLoading) {
            setFormError('Please wait for assessment patterns to finish loading.');
            return;
          }
          if (q.isError) {
            setFormError('Failed to load assessment pattern for one or more selected subjects. Please retry.');
            return;
          }
        }
      }
    }
    if (editingEventId) {
      updateMutation.mutate({ eventId: editingEventId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDeleteEvent = (eventId: string, title: string) => {
    if (window.confirm(`Are you sure you want to delete "${title}"?`)) {
      deleteMutation.mutate(eventId);
    }
  };

  const handleToggleSubject = (subjectId: string, isEligible: boolean) => {
    if (!isEligible) return;
    const current = watchedSubjectIds;
    if (current.includes(subjectId)) {
      setValue('subject_ids', current.filter(id => id !== subjectId), { shouldValidate: true, shouldDirty: true });
      const nextComps = { ...watchedSubjectComponents };
      delete nextComps[subjectId];
      setValue('subject_components', nextComps, { shouldValidate: true, shouldDirty: true });
    } else {
      setValue('subject_ids', [...current, subjectId], { shouldValidate: true, shouldDirty: true });
      // If this subject had an initial component from edit mode, restore it
      if (editingEventId && initialSubjectComponents[subjectId]) {
        setValue('subject_components', {
          ...watchedSubjectComponents,
          [subjectId]: initialSubjectComponents[subjectId],
        }, { shouldValidate: true, shouldDirty: true });
      }
    }
  };

  const handleComponentChange = (subjectId: string, componentId: string) => {
    setValue('subject_components', {
      ...watchedSubjectComponents,
      [subjectId]: componentId,
    }, { shouldValidate: true, shouldDirty: true });
  };

  // Build subject lookup map
  const subjectMap = new Map<string, Subject>();
  subjects.forEach(s => subjectMap.set(s.id, s));

  const getEventTypeBadge = (type: string) => {
    switch (type) {
      case 'holiday':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Holiday</span>;
      case 'non_working_day':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">Non-Working Day</span>;
      case 'exam':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">Exam</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-muted text-muted-foreground">{type}</span>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm font-medium text-muted-foreground">Loading calendar events...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Academic Calendar</h2>
          <p className="text-sm text-muted-foreground">
            Configure holidays, exams, and non-working days that affect lecture schedules.
          </p>
        </div>
        {!isAdding && !editingEventId && (
          <Button
            onClick={() => {
              setIsAdding(true);
              setEditingEventId(null);
              setFormError(null);
              clearErrors();
              reset({
                title: '',
                event_type: 'holiday',
                start_date: semesterStartDate || '',
                end_date: semesterStartDate || '',
                cancels_regular_classes: true,
                subject_ids: [],
                subject_components: {},
              });
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Calendar Event
          </Button>
        )}
      </div>

      {formError && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm">
          {formError}
        </div>
      )}

      {fetchError && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm">
          Failed to load calendar events.
        </div>
      )}

      {/* CREATE / EDIT FORM */}
      {(isAdding || editingEventId) && (
        <div className="p-6 bg-card text-card-foreground rounded-xl shadow-xs border border-border space-y-4">
          <h3 className="text-lg font-semibold text-foreground">
            {editingEventId ? 'Edit Calendar Event' : 'Add Calendar Event'}
          </h3>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-title" className="text-foreground">Event Title *</Label>
                <Input
                  id="event-title"
                  placeholder="e.g. Midterm Examination Week"
                  {...register('title')}
                />
                {errors.title && (
                  <p className="text-xs text-destructive">{errors.title.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="event-type" className="text-foreground">Event Type *</Label>
                <select
                  id="event-type"
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  {...register('event_type', {
                    onChange: (e) => {
                      if (e.target.value === 'exam') {
                        setValue('cancels_regular_classes', false);
                      } else {
                        setValue('cancels_regular_classes', true);
                        setValue('subject_ids', []);
                        setValue('subject_components', {});
                      }
                    },
                  })}
                >
                  {EVENT_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {errors.event_type && (
                  <p className="text-xs text-destructive">{errors.event_type.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-start-date" className="text-foreground">Start Date *</Label>
                <Input
                  id="event-start-date"
                  type="date"
                  {...register('start_date', {
                    onChange: (e) => {
                      // If end date is empty or was matching old start date, sync it
                      const startVal = e.target.value;
                      const endVal = getValues('end_date');
                      if (!endVal || endVal < startVal) {
                        setValue('end_date', startVal);
                      }
                    },
                  })}
                />
                {errors.start_date && (
                  <p className="text-xs text-destructive">{errors.start_date.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="event-end-date" className="text-foreground">End Date *</Label>
                <Input
                  id="event-end-date"
                  type="date"
                  {...register('end_date')}
                />
                {errors.end_date && (
                  <p className="text-xs text-destructive">{errors.end_date.message}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                id="event-cancels-classes"
                type="checkbox"
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                {...register('cancels_regular_classes')}
              />
              <Label htmlFor="event-cancels-classes" className="text-sm font-normal text-foreground cursor-pointer">
                Cancels regular timetable lectures during this period
              </Label>
            </div>

            {/* Subject Selector for Exam Events */}
            {selectedEventType === 'exam' && (
              <div className="space-y-3 pt-2 border-t border-border">
                <div>
                  <Label className="text-foreground text-sm font-medium">
                    Associated Exam Subjects & Components
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Select which subjects have examinations during this event and choose an evaluation component for each.
                  </p>
                </div>

                {editingEventId && isLoadingAssessments && (
                  <div className="p-3 bg-muted/40 text-muted-foreground rounded-lg border border-border text-xs flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading existing assessment links for this exam event...</span>
                  </div>
                )}

                {editingEventId && assessmentLoadError && (
                  <div role="alert" className="p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-xs flex items-center justify-between">
                    <span>Failed to load assessment mappings: {assessmentLoadError}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRetryLoadAssessments}
                      className="h-7 text-xs"
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {subjects.length === 0 ? (
                  <div className="p-3 bg-muted/40 text-muted-foreground rounded-lg border border-border text-xs">
                    No subjects configured in this semester. Please add subjects to the semester first.
                  </div>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    {subjects.map((s, idx) => {
                      const isChecked = watchedSubjectIds.includes(s.id);
                      const query = patternQueries[idx];
                      const isLoadingPattern = query?.isLoading;
                      const isPatternError = query?.isError;
                      const pattern = query?.data;

                      const eligibleComponents = (pattern && pattern.is_active && Array.isArray(pattern.components))
                        ? pattern.components.filter(c => c.is_active && c.weightage > 0 && c.max_marks > 0)
                        : [];

                      const isExistingLinked = Boolean(editingEventId && initialSubjectIds.includes(s.id));
                      const linkedAss = isExistingLinked ? linkedAssessments[s.id] : undefined;
                      const isExempt = linkedAss ? isAssessmentExempt(linkedAss) : false;
                      const isComponentLocked = Boolean(editingEventId && isExistingLinked && linkedAss && !isExempt);
                      const isNewlyAdded = Boolean(editingEventId && !initialSubjectIds.includes(s.id) && isChecked);
                      const isMarkedForRemoval = Boolean(editingEventId && initialSubjectIds.includes(s.id) && !isChecked);

                      const isEligible = !isLoadingPattern && !isPatternError && eligibleComponents.length > 0;
                      const canToggle = isEligible || isExistingLinked;
                      const selectedComponentId = watchedSubjectComponents[s.id] || '';
                      const compError = (errors.subject_components as any)?.[s.id]?.message;

                      return (
                        <div
                          key={s.id}
                          className={`p-3 rounded-lg border text-sm transition-colors ${
                            !canToggle
                              ? 'bg-muted/30 border-border/60 opacity-80'
                              : isChecked
                              ? 'bg-primary/5 border-primary/60 text-foreground'
                              : 'bg-background border-border text-foreground hover:border-border/80'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <label
                              className={`flex items-center gap-2.5 ${
                                canToggle && !isLoadingAssessments ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isLoadingAssessments || !canToggle}
                                onChange={() => handleToggleSubject(s.id, canToggle)}
                                className="h-4 w-4 rounded border-input text-primary focus:ring-primary disabled:opacity-50"
                                aria-label={`Select ${s.name} ${s.code ? `(${s.code})` : ''}`}
                              />
                              <span className="font-medium text-foreground inline-flex items-center flex-wrap gap-1.5">
                                <span>
                                  {s.name} {s.code ? `(${s.code})` : ''}
                                  {s.credits != null && (
                                    <span className="text-xs font-normal text-muted-foreground ml-1.5">
                                      • {s.credits} {s.credits === 1 ? 'Credit' : 'Credits'}
                                    </span>
                                  )}
                                </span>
                                {isExistingLinked && isChecked && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                                    Existing Linked
                                  </span>
                                )}
                                {isNewlyAdded && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                                    New
                                  </span>
                                )}
                              </span>
                            </label>

                            {/* Pattern Status Badges */}
                            <div className="flex items-center gap-2 pl-6 sm:pl-0">
                              {isLoadingPattern && (
                                <span className="inline-flex items-center text-xs text-muted-foreground">
                                  Loading pattern...
                                </span>
                              )}
                              {isPatternError && (
                                <div className="flex items-center gap-1.5 text-xs text-destructive">
                                  <span>Failed to load pattern</span>
                                  <button
                                    type="button"
                                    onClick={() => query?.refetch()}
                                    className="text-primary hover:underline font-medium text-xs cursor-pointer"
                                  >
                                    Retry
                                  </button>
                                </div>
                              )}
                              {!isLoadingPattern && !isPatternError && (!pattern || !pattern.is_active) && (
                                <span className="inline-flex items-center text-xs text-amber-600 dark:text-amber-400">
                                  ⚠️ No active pattern configured
                                </span>
                              )}
                              {!isLoadingPattern && !isPatternError && pattern?.is_active && eligibleComponents.length === 0 && (
                                <span className="inline-flex items-center text-xs text-amber-600 dark:text-amber-400">
                                  ⚠️ No eligible active components
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Removal Warning */}
                          {isMarkedForRemoval && (
                            <div className="mt-1.5 pl-6 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              <span>Subject will be removed from this exam. Its linked assessment will be detached but preserved in your gradebook.</span>
                            </div>
                          )}

                          {/* Unavailability Explanation */}
                          {!isLoadingPattern && !isPatternError && !canToggle && (
                            <p className="text-xs text-muted-foreground mt-1.5 pl-6">
                              Configure an assessment pattern in this subject&apos;s details to select it for exam generation.
                            </p>
                          )}

                          {/* Component Selector when checked */}
                          {isChecked && canToggle && (
                            <div className="mt-2.5 pt-2.5 border-t border-border/50 pl-6 space-y-1.5">
                              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                <Label htmlFor={`component-select-${s.id}`} className="text-xs font-medium text-muted-foreground shrink-0">
                                  Assessment Component *
                                </Label>
                                <select
                                  id={`component-select-${s.id}`}
                                  value={selectedComponentId}
                                  disabled={isComponentLocked || isLoadingAssessments}
                                  onChange={(e) => handleComponentChange(s.id, e.target.value)}
                                  className="w-full sm:max-w-md px-2.5 py-1.5 text-xs rounded-md border border-input bg-background text-foreground shadow-2xs focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-70 disabled:cursor-not-allowed"
                                  aria-label={`Assessment component for ${s.name}`}
                                >
                                  <option value="">Select assessment component...</option>
                                  {eligibleComponents.map(comp => (
                                    <option key={comp.id} value={comp.id}>
                                      {comp.name} ({CATEGORY_LABELS[comp.category] || comp.category}) • {comp.weightage}% weight • {comp.max_marks} marks
                                    </option>
                                  ))}
                                  {selectedComponentId && !eligibleComponents.some(c => c.id === selectedComponentId) && (
                                    <option value={selectedComponentId}>
                                      {linkedAss?.name || 'Existing Component'} (Current)
                                    </option>
                                  )}
                                </select>
                              </div>
                              {isComponentLocked && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                  <span>Component cannot be changed: active assessment ({linkedAss?.status || 'pending'}) exists. To change component, exempt or delete it in Subject Details first.</span>
                                </p>
                              )}
                              {isExistingLinked && linkedAss && isExempt && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                                  <span>Exempt assessment: component replacement is permitted.</span>
                                </p>
                              )}
                              {isExistingLinked && (!linkedAss || !linkedAss.pattern_component_id) && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  <span>Linked assessment has no pattern component configured.</span>
                                </p>
                              )}
                              {compError && (
                                <p className="text-xs text-destructive">{compError}</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelForm}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  isLoadingAssessments ||
                  Boolean(assessmentLoadError)
                }
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingEventId
                  ? 'Update Event'
                  : 'Add Event'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* EVENT LIST */}
      {safeEvents.length === 0 && !isAdding && (
        <div className="text-center py-12 bg-card text-card-foreground rounded-xl border border-dashed border-border p-8">
          <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
          <h3 className="text-base font-medium text-foreground">No calendar events configured</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
            Add holidays, non-working days, or exams to automatically adjust lecture attendance schedules.
          </p>
        </div>
      )}

      {safeEvents.length > 0 && (
        <div className="space-y-3">
          {safeEvents.map(event => {
            const hasMultipleDays = event.start_date !== event.end_date;
            return (
              <div
                key={event.id}
                className="p-4 bg-card text-card-foreground rounded-xl border border-border shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:border-border/80 transition-all"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground text-sm">
                      {event.title}
                    </span>
                    {getEventTypeBadge(event.event_type)}
                    {event.cancels_regular_classes ? (
                      <span className="text-xs text-muted-foreground">
                        &bull; Cancels regular classes
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        &bull; Regular classes held
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {hasMultipleDays ? `${event.start_date} to ${event.end_date}` : event.start_date}
                    </span>
                  </div>

                  {event.subject_ids && event.subject_ids.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs text-muted-foreground">Subjects:</span>
                      {event.subject_ids.map(sid => {
                        const subj = subjectMap.get(sid);
                        return (
                          <span
                            key={sid}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground border border-border"
                          >
                            {subj ? subj.name : 'Unknown Subject'}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {event.assessment_ids && event.assessment_ids.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                        {event.assessment_ids.length} linked assessment{event.assessment_ids.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleStartEdit(event)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    aria-label="Edit event"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteEvent(event.id, event.title)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive/90"
                    aria-label="Delete event"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
