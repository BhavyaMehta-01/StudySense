import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/api/client';
import type { TimetableSlot, Subject } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Clock, Calendar, Edit2, Trash2, Plus, AlertCircle } from 'lucide-react';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
] as const;

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const slotFormSchema = z.object({
  subject_id: z.string().min(1, 'Please select a subject'),
  day_of_week: z.string().min(1, 'Please select a day of the week'),
  start_time: z.string().min(1, 'Start time is required'),
  end_time: z.string().min(1, 'End time is required'),
  effective_from: z.string().min(1, 'Effective from date is required'),
  effective_to: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.start_time && data.end_time && data.start_time >= data.end_time) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Start time must be before end time',
      path: ['end_time'],
    });
  }
  if (data.effective_from && data.effective_to && data.effective_to.trim()) {
    if (data.effective_from > data.effective_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Effective-from date cannot be after effective-to date',
        path: ['effective_to'],
      });
    }
  }
});

type SlotFormData = z.infer<typeof slotFormSchema>;

interface TimetableSlotManagerProps {
  semesterId: string;
  semesterStartDate?: string | null;
  semesterEndDate?: string | null;
  subjects: Subject[];
}

export default function TimetableSlotManager({
  semesterId,
  semesterStartDate,
  semesterEndDate,
  subjects,
}: TimetableSlotManagerProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: slots, isLoading, error: fetchError } = useQuery<TimetableSlot[]>({
    queryKey: ['semesters', semesterId, 'timetable'],
    queryFn: () => api.get(`/semesters/${semesterId}/timetable`),
  });

  const safeSlots = Array.isArray(slots) ? slots : [];

  const defaultEffectiveFrom = semesterStartDate || getTodayString();
  const defaultEffectiveTo = semesterEndDate || '';

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<SlotFormData>({
    resolver: zodResolver(slotFormSchema),
    defaultValues: {
      subject_id: subjects[0]?.id || '',
      day_of_week: '0',
      start_time: '09:00',
      end_time: '10:30',
      effective_from: defaultEffectiveFrom,
      effective_to: defaultEffectiveTo,
    },
  });

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['semesters', semesterId, 'timetable'] });
    queryClient.invalidateQueries({ queryKey: ['semesters', semesterId, 'lectures'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: SlotFormData) => {
      // Validate against semester boundaries
      if (semesterStartDate && data.effective_to && data.effective_to < semesterStartDate) {
        throw new Error(`Slot effective_to cannot be before semester start date (${semesterStartDate})`);
      }
      if (semesterEndDate && data.effective_from > semesterEndDate) {
        throw new Error(`Slot effective_from cannot be after semester end date (${semesterEndDate})`);
      }

      // Format times to HH:MM:00 if needed
      const formatTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

      const payload: Record<string, any> = {
        subject_id: data.subject_id,
        day_of_week: Number(data.day_of_week),
        start_time: formatTime(data.start_time),
        end_time: formatTime(data.end_time),
        effective_from: data.effective_from,
        effective_to: data.effective_to && data.effective_to.trim() ? data.effective_to : null,
      };
      return api.post(`/semesters/${semesterId}/timetable`, payload);
    },
    onSuccess: () => {
      invalidateQueries();
      setIsAdding(false);
      reset();
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.data?.detail || err.message || 'Failed to create timetable slot');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ slotId, data }: { slotId: string; data: SlotFormData }) => {
      if (semesterStartDate && data.effective_to && data.effective_to < semesterStartDate) {
        throw new Error(`Slot effective_to cannot be before semester start date (${semesterStartDate})`);
      }
      if (semesterEndDate && data.effective_from > semesterEndDate) {
        throw new Error(`Slot effective_from cannot be after semester end date (${semesterEndDate})`);
      }

      const formatTime = (t: string) => (t.length === 5 ? `${t}:00` : t);

      const payload: Record<string, any> = {
        day_of_week: Number(data.day_of_week),
        start_time: formatTime(data.start_time),
        end_time: formatTime(data.end_time),
        effective_from: data.effective_from,
        effective_to: data.effective_to && data.effective_to.trim() ? data.effective_to : null,
      };
      return api.put(`/semesters/${semesterId}/timetable/${slotId}`, payload);
    },
    onSuccess: () => {
      invalidateQueries();
      setEditingSlotId(null);
      reset();
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.data?.detail || err.message || 'Failed to update timetable slot');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/semesters/${semesterId}/timetable/${slotId}`),
    onSuccess: () => invalidateQueries(),
    onError: (err: any) => {
      setFormError(err?.data?.detail || err.message || 'Failed to delete timetable slot');
    },
  });

  const handleStartEdit = (slot: TimetableSlot) => {
    setEditingSlotId(slot.id);
    setIsAdding(false);
    setFormError(null);
    clearErrors();

    // format time string HH:MM:SS to HH:MM for input type="time"
    const sliceTime = (t: string) => (t.length >= 5 ? t.slice(0, 5) : t);

    setValue('subject_id', slot.subject_id);
    setValue('day_of_week', String(slot.day_of_week));
    setValue('start_time', sliceTime(slot.start_time));
    setValue('end_time', sliceTime(slot.end_time));
    setValue('effective_from', slot.effective_from);
    setValue('effective_to', slot.effective_to || '');
  };

  const handleCancelForm = () => {
    setIsAdding(false);
    setEditingSlotId(null);
    setFormError(null);
    reset();
  };

  const onSubmit = (data: SlotFormData) => {
    setFormError(null);
    if (editingSlotId) {
      updateMutation.mutate({ slotId: editingSlotId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDeleteSlot = (slotId: string) => {
    if (window.confirm('Are you sure you want to delete this weekly timetable slot? Historical attendance will be preserved.')) {
      deleteMutation.mutate(slotId);
    }
  };

  // Build subject lookup map
  const subjectMap = new Map<string, Subject>();
  subjects.forEach(s => subjectMap.set(s.id, s));

  // Format time for clean display e.g. 09:00:00 -> 09:00
  const formatTimeDisplay = (timeStr: string) => {
    if (!timeStr) return '';
    return timeStr.slice(0, 5);
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm font-medium text-muted-foreground">Loading timetable...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Weekly Timetable</h2>
          <p className="text-sm text-muted-foreground">
            Configure repeating weekly lecture days and times for each subject.
          </p>
        </div>
        {!isAdding && !editingSlotId && (
          <Button
            onClick={() => {
              setIsAdding(true);
              setEditingSlotId(null);
              setFormError(null);
              reset({
                subject_id: subjects[0]?.id || '',
                day_of_week: '0',
                start_time: '09:00',
                end_time: '10:30',
                effective_from: defaultEffectiveFrom,
                effective_to: defaultEffectiveTo,
              });
            }}
            disabled={subjects.length === 0}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Lecture Slot
          </Button>
        )}
      </div>

      {subjects.length === 0 && (
        <div role="alert" className="p-4 bg-muted/60 border border-border rounded-xl text-sm text-muted-foreground flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-primary shrink-0" />
          <p>Please add at least one subject to this semester before creating timetable slots.</p>
        </div>
      )}

      {formError && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm">
          {formError}
        </div>
      )}

      {fetchError && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg text-sm">
          Failed to load timetable slots.
        </div>
      )}

      {/* CREATE / EDIT FORM */}
      {(isAdding || editingSlotId) && (
        <div className="p-6 bg-card text-card-foreground rounded-xl shadow-xs border border-border space-y-4">
          <h3 className="text-lg font-semibold text-foreground">
            {editingSlotId ? 'Edit Timetable Slot' : 'Add Weekly Lecture Slot'}
          </h3>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="slot-subject" className="text-foreground">Subject *</Label>
                <select
                  id="slot-subject"
                  disabled={Boolean(editingSlotId)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  {...register('subject_id')}
                >
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.code ? `(${s.code})` : ''}
                    </option>
                  ))}
                </select>
                {errors.subject_id && (
                  <p className="text-xs text-destructive">{errors.subject_id.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="slot-day" className="text-foreground">Day of the Week *</Label>
                <select
                  id="slot-day"
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground shadow-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  {...register('day_of_week')}
                >
                  {DAYS_OF_WEEK.map(d => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
                {errors.day_of_week && (
                  <p className="text-xs text-destructive">{errors.day_of_week.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="slot-start-time" className="text-foreground">Start Time *</Label>
                <Input
                  id="slot-start-time"
                  type="time"
                  {...register('start_time')}
                />
                {errors.start_time && (
                  <p className="text-xs text-destructive">{errors.start_time.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="slot-end-time" className="text-foreground">End Time *</Label>
                <Input
                  id="slot-end-time"
                  type="time"
                  {...register('end_time')}
                />
                {errors.end_time && (
                  <p className="text-xs text-destructive">{errors.end_time.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="slot-effective-from" className="text-foreground">Effective From *</Label>
                <Input
                  id="slot-effective-from"
                  type="date"
                  {...register('effective_from')}
                />
                {errors.effective_from && (
                  <p className="text-xs text-destructive">{errors.effective_from.message}</p>
                )}
                <p className="text-xs text-muted-foreground">Date from which this schedule begins</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="slot-effective-to" className="text-foreground">Effective To</Label>
                <Input
                  id="slot-effective-to"
                  type="date"
                  {...register('effective_to')}
                />
                {errors.effective_to && (
                  <p className="text-xs text-destructive">{errors.effective_to.message}</p>
                )}
                <p className="text-xs text-muted-foreground">Leave empty if effective through the end of semester</p>
              </div>
            </div>

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
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : editingSlotId
                  ? 'Update Slot'
                  : 'Add Slot'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* WEEKLY TIMETABLE LAYOUT */}
      {safeSlots.length === 0 && !isAdding && (
        <div className="text-center py-12 bg-card text-card-foreground rounded-xl border border-dashed border-border p-8">
          <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
          <h3 className="text-base font-medium text-foreground">No timetable slots configured</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
            Add recurring weekly slots to define when lectures occur for your subjects.
          </p>
        </div>
      )}

      {safeSlots.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {DAYS_OF_WEEK.map(day => {
            const daySlots = safeSlots
              .filter(s => s.day_of_week === day.value)
              .sort((a, b) => a.start_time.localeCompare(b.start_time));

            return (
              <div
                key={day.value}
                className="flex flex-col bg-card text-card-foreground rounded-xl border border-border shadow-2xs overflow-hidden"
              >
                <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                  <span className="font-semibold text-foreground text-sm">{day.label}</span>
                  <span className="text-xs text-muted-foreground font-medium">
                    {daySlots.length === 1 ? '1 class' : `${daySlots.length} classes`}
                  </span>
                </div>

                <div className="p-3 space-y-2.5 flex-1">
                  {daySlots.length === 0 ? (
                    <p className="text-xs text-muted-foreground/70 italic text-center py-4">
                      No classes
                    </p>
                  ) : (
                    daySlots.map(slot => {
                      const subject = subjectMap.get(slot.subject_id);
                      return (
                        <div
                          key={slot.id}
                          className="p-3 bg-background border border-border rounded-lg shadow-2xs flex flex-col gap-2 hover:border-border/80 transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-sm text-foreground leading-tight">
                                {subject ? subject.name : 'Unknown Subject'}
                              </p>
                              {subject?.code && (
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                  {subject.code}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStartEdit(slot)}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                aria-label="Edit slot"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteSlot(slot.id)}
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive/90"
                                aria-label="Delete slot"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              {formatTimeDisplay(slot.start_time)} &ndash; {formatTimeDisplay(slot.end_time)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t border-border/40">
                            <Calendar className="h-3 w-3 shrink-0" />
                            <span>
                              {slot.effective_to
                                ? `${slot.effective_from} to ${slot.effective_to}`
                                : `From ${slot.effective_from}`}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
