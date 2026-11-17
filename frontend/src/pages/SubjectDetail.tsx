import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/api/client';
import type { Semester, Subject, Assessment, Attendance } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Edit2, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';

const ALLOWED_CATEGORIES = [
  'internal_test',
  'assignment',
  'quiz',
  'practical',
  'viva',
  'project',
  'midsem',
  'endsem',
  'other',
] as const;

const ASSESSMENT_CATEGORIES = [
  { value: 'internal_test', label: 'Internal Test' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'practical', label: 'Practical / Lab' },
  { value: 'viva', label: 'Viva / Oral' },
  { value: 'project', label: 'Project' },
  { value: 'midsem', label: 'Midterm Exam' },
  { value: 'endsem', label: 'Final / Endsem Exam' },
  { value: 'other', label: 'Other' },
] as const;

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
    if (typeof err.data.detail === 'string') {
      return err.data.detail;
    }
    if (Array.isArray(err.data.detail)) {
      return err.data.detail
        .map((d: any) => (d.loc && d.loc.length > 0 ? `${d.loc[d.loc.length - 1]}: ${d.msg}` : d.msg || JSON.stringify(d)))
        .join('; ');
    }
  }
  return err?.message || fallback;
}

const isStep05 = (val: number) => Math.round(val * 10) % 5 === 0;

const assessmentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z
    .string()
    .min(1, 'Category is required')
    .refine((val) => !val || ALLOWED_CATEGORIES.includes(val as any), {
      message: 'Invalid category',
    }),
  max_marks: z.string().min(1, 'Max marks is required'),
  marks: z.string().optional(),
  weightage: z.string().optional(),
  scheduled_at: z.string().optional(),
  status: z.enum(['pending', 'scored', 'absent', 'exempt']),
}).superRefine((data, ctx) => {
  const maxMarks = Number(data.max_marks);
  if (isNaN(maxMarks) || maxMarks <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Max marks must be > 0', path: ['max_marks'] });
  } else if (!isStep05(maxMarks)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Max marks must be in increments of 0.5', path: ['max_marks'] });
  }
  
  if (data.marks && data.marks.trim() !== '') {
    const marks = Number(data.marks);
    if (isNaN(marks) || marks < 0 || (!isNaN(maxMarks) && maxMarks > 0 && marks > maxMarks)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Marks must be between 0 and ${maxMarks}`, path: ['marks'] });
    } else if (!isStep05(marks)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Marks must be in increments of 0.5', path: ['marks'] });
    }
  }

  if (data.weightage && data.weightage.trim() !== '') {
    const weightage = Number(data.weightage);
    if (isNaN(weightage) || weightage <= 0 || weightage > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Weightage must be between 0 and 100', path: ['weightage'] });
    } else if (!isStep05(weightage)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Weightage must be in increments of 0.5', path: ['weightage'] });
    }
  }

  if (data.status === 'scored' && (!data.marks || data.marks.trim() === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Marks are required when status is 'scored'", path: ['marks'] });
  }
  if (data.status === 'pending' && data.marks && data.marks.trim() !== '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pending assessments must not contain marks", path: ['marks'] });
  }
  if (data.status === 'absent' && data.marks && data.marks.trim() !== '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Absent assessments must not contain marks", path: ['marks'] });
  }
  if (data.status === 'exempt' && data.marks && data.marks.trim() !== '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Exempt assessments must not contain marks", path: ['marks'] });
  }
});

type AssessmentForm = z.infer<typeof assessmentSchema>;

const isValidDate = (dateStr: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

const attendanceSchema = z.object({
  classes_attended: z.string().min(1, 'Classes attended is required'),
  classes_held: z.string().min(1, 'Classes held is required'),
  recorded_on: z.string(),
}).superRefine((data, ctx) => {
  const inputEl = typeof document !== 'undefined' ? (document.getElementById('recorded_on') as HTMLInputElement | null) : null;
  const isBadInput = Boolean(inputEl?.validity?.badInput);

  if (isBadInput) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid date', path: ['recorded_on'] });
  } else if (!data.recorded_on || data.recorded_on.trim() === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date is required', path: ['recorded_on'] });
  } else if (!isValidDate(data.recorded_on)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid date', path: ['recorded_on'] });
  }

  if (data.classes_attended && data.classes_attended.trim() !== '') {
    const attended = Number(data.classes_attended);
    if (!isNaN(attended)) {
      if (attended < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be integer ≥ 0.', path: ['classes_attended'] });
      } else if (!Number.isInteger(attended)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Classes attended must be a whole number.', path: ['classes_attended'] });
      }
    } else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Classes attended must be a whole number.', path: ['classes_attended'] });
    }
  }

  if (data.classes_held && data.classes_held.trim() !== '') {
    const held = Number(data.classes_held);
    if (!isNaN(held)) {
      if (held <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Classes held must be greater than zero.', path: ['classes_held'] });
      } else if (!Number.isInteger(held)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Classes held must be a whole number.', path: ['classes_held'] });
      }
    } else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Classes held must be a whole number.', path: ['classes_held'] });
    }
  }

  if (data.classes_attended && data.classes_attended.trim() !== '' && data.classes_held && data.classes_held.trim() !== '') {
    const attended = Number(data.classes_attended);
    const held = Number(data.classes_held);
    if (!isNaN(attended) && !isNaN(held) && attended >= 0 && held > 0 && attended > held) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Attended cannot exceed held', path: ['classes_attended'] });
    }
  }
});

type AttendanceForm = z.infer<typeof attendanceSchema>;

const calculatorSchema = z.object({
  target_percentage: z.string().min(1, 'Target percentage is required'),
}).superRefine((data, ctx) => {
  const target = Number(data.target_percentage);
  if (isNaN(target) || target < 0 || target > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Target percentage must be between 0 and 100', path: ['target_percentage'] });
  }
});

type CalculatorForm = z.infer<typeof calculatorSchema>;

const subjectEditSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().optional(),
  credits: z.string().optional(),
  target_percentage: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.credits && data.credits.trim() !== '') {
    const creds = Number(data.credits);
    if (isNaN(creds) || !Number.isInteger(creds) || creds < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Credits must be >= 0 and a whole number',
        path: ['credits'],
      });
    }
  }
  if (data.target_percentage && data.target_percentage.trim() !== '') {
    const target = Number(data.target_percentage);
    if (isNaN(target) || !Number.isInteger(target) || target < 0 || target > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Target percentage must be an integer between 0 and 100',
        path: ['target_percentage'],
      });
    }
  }
});

type SubjectEditForm = z.infer<typeof subjectEditSchema>;

export default function SubjectDetail() {
  const { semesterId, subjectId } = useParams<{ semesterId: string, subjectId: string }>();
  const queryClient = useQueryClient();
  const [isCreatingAssessment, setIsCreatingAssessment] = useState(false);
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  
  const [isCreatingAttendance, setIsCreatingAttendance] = useState(false);
  const [editingAttendanceId, setEditingAttendanceId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [assessmentFormError, setAssessmentFormError] = useState('');
  const [attendanceFormError, setAttendanceFormError] = useState('');
  const [isEditingSubject, setIsEditingSubject] = useState(false);
  const [subjectFormError, setSubjectFormError] = useState('');

  const { data: semester } = useQuery<Semester>({
    queryKey: ['semesters', semesterId],
    queryFn: () => api.get(`/semesters/${semesterId}`),
  });

  const { data: subject, isLoading: isLoadingSubject } = useQuery<Subject>({
    queryKey: ['subjects', subjectId],
    queryFn: () => api.get(`/subjects/${subjectId}`),
  });

  const { data: assessments, isLoading: isLoadingAssessments } = useQuery<Assessment[]>({
    queryKey: ['subjects', subjectId, 'assessments'],
    queryFn: () => api.get(`/subjects/${subjectId}/assessments`),
  });

  const { data: attendanceList, isLoading: isLoadingAttendance } = useQuery<Attendance[]>({
    queryKey: ['subjects', subjectId, 'attendance'],
    queryFn: () => api.get(`/subjects/${subjectId}/attendance`),
  });

  const invalidateAssessments = () => {
    queryClient.invalidateQueries({ queryKey: ['subjects', subjectId, 'assessments'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const invalidateAttendance = () => {
    queryClient.invalidateQueries({ queryKey: ['subjects', subjectId, 'attendance'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  // Assessment Mutations
  const createAssessmentMutation = useMutation({
    mutationFn: (data: any) => api.post(`/subjects/${subjectId}/assessments`, data),
    onSuccess: () => {
      invalidateAssessments();
      setIsCreatingAssessment(false);
      resetAssessment();
      setAssessmentFormError('');
    },
    onError: (err: any) => {
      const msg = formatApiError(err, 'Failed to create assessment');
      if (err?.status === 409) {
        setErrorAssessment('name', { type: 'manual', message: msg });
      }
      setAssessmentFormError(msg);
    },
  });

  const updateAssessmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => api.put(`/assessments/${id}`, data),
    onSuccess: () => {
      invalidateAssessments();
      setEditingAssessmentId(null);
      setAssessmentFormError('');
    },
    onError: (err: any) => {
      const msg = formatApiError(err, 'Failed to update assessment');
      if (err?.status === 409) {
        setErrorAssessment('name', { type: 'manual', message: msg });
      }
      setAssessmentFormError(msg);
    },
  });

  const deleteAssessmentMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/assessments/${id}`),
    onSuccess: () => invalidateAssessments(),
    onError: (err: any) => setError(err.message || 'Failed to delete assessment'),
  });

  // Attendance Mutations
  const createAttendanceMutation = useMutation({
    mutationFn: (data: any) => api.post(`/subjects/${subjectId}/attendance`, data),
    onSuccess: () => {
      invalidateAttendance();
      setIsCreatingAttendance(false);
      resetAttendance();
      setAttendanceFormError('');
    },
    onError: (err: any) => setAttendanceFormError(formatApiError(err, 'Failed to create attendance')),
  });

  const updateAttendanceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => api.put(`/attendance/${id}`, data),
    onSuccess: () => {
      invalidateAttendance();
      setEditingAttendanceId(null);
      setAttendanceFormError('');
    },
    onError: (err: any) => setAttendanceFormError(formatApiError(err, 'Failed to update attendance')),
  });

  const deleteAttendanceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/attendance/${id}`),
    onSuccess: () => invalidateAttendance(),
    onError: (err: any) => setError(err.message || 'Failed to delete attendance'),
  });

  const [calculatorResult, setCalculatorResult] = useState<any>(null);
  const [lastTargetCalculated, setLastTargetCalculated] = useState<number | null>(null);

  const {
    register: registerCalculator,
    handleSubmit: handleSubmitCalculator,
    formState: { errors: calculatorErrors },
  } = useForm<CalculatorForm>({
    resolver: zodResolver(calculatorSchema),
  });

  const calculateMutation = useMutation({
    mutationFn: (data: any) => api.post(`/subjects/${subjectId}/calculate-required`, data),
    onSuccess: (res: any) => {
      setCalculatorResult(res);
      setError('');
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to calculate required score');
      setCalculatorResult(null);
    }
  });

  const onSubmitCalculator = (data: CalculatorForm) => {
    const target = Number(data.target_percentage);
    setLastTargetCalculated(target);
    calculateMutation.mutate({ target_percentage: target });
  };

  const updateSubjectMutation = useMutation({
    mutationFn: (data: any) => api.put(`/subjects/${subjectId}`, data),
    onSuccess: (updatedSubject: Subject) => {
      queryClient.setQueryData(['subjects', subjectId], updatedSubject);
      queryClient.invalidateQueries({ queryKey: ['subjects', subjectId] });
      queryClient.invalidateQueries({ queryKey: ['semesters', semesterId, 'subjects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setIsEditingSubject(false);
      setSubjectFormError('');
    },
    onError: (err: any) => {
      setSubjectFormError(formatApiError(err, 'Failed to update subject'));
    },
  });

  const {
    register: registerSubject,
    handleSubmit: handleSubmitSubject,
    reset: resetSubject,
    formState: { errors: subjectErrors },
  } = useForm<SubjectEditForm>({
    resolver: zodResolver(subjectEditSchema),
    defaultValues: {
      name: '',
      code: '',
      credits: '',
      target_percentage: '',
    },
    values: subject ? {
      name: subject.name || '',
      code: subject.code || '',
      credits: subject.credits != null ? subject.credits.toString() : '',
      target_percentage: subject.target_percentage != null ? subject.target_percentage.toString() : '',
    } : undefined,
  });

  const parseSubjectPayload = (data: SubjectEditForm) => {
    return {
      name: data.name.trim(),
      code: data.code && data.code.trim() !== '' ? data.code.trim() : null,
      credits: data.credits && data.credits.trim() !== '' ? Number(data.credits) : null,
      target_percentage: data.target_percentage && data.target_percentage.trim() !== '' ? Number(data.target_percentage) : null,
    };
  };

  const onSubmitUpdateSubject = (data: SubjectEditForm) => {
    setSubjectFormError('');
    updateSubjectMutation.mutate(parseSubjectPayload(data));
  };

  const startEditingSubject = () => {
    setSubjectFormError('');
    if (subject) {
      resetSubject({
        name: subject.name || '',
        code: subject.code || '',
        credits: subject.credits != null ? subject.credits.toString() : '',
        target_percentage: subject.target_percentage != null ? subject.target_percentage.toString() : '',
      });
    }
    setIsEditingSubject(true);
  };

  const cancelEditingSubject = () => {
    setIsEditingSubject(false);
    setSubjectFormError('');
    if (subject) {
      resetSubject({
        name: subject.name || '',
        code: subject.code || '',
        credits: subject.credits != null ? subject.credits.toString() : '',
        target_percentage: subject.target_percentage != null ? subject.target_percentage.toString() : '',
      });
    }
  };

  const editingAssessment = assessments?.find(a => a.id === editingAssessmentId);
  const {
    register: registerAssessment,
    handleSubmit: handleSubmitAssessment,
    reset: resetAssessment,
    setValue: setValueAssessment,
    getValues: getValuesAssessment,
    setError: setErrorAssessment,
    clearErrors: clearErrorsAssessment,
    formState: { errors: assessmentErrors },
  } = useForm<AssessmentForm>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: { status: 'pending', category: '' as any },
    values: editingAssessment ? {
      name: editingAssessment.name,
      category: editingAssessment.category as any,
      max_marks: editingAssessment.max_marks.toString(),
      status: editingAssessment.status as any,
      marks: editingAssessment.marks !== null ? editingAssessment.marks.toString() : '',
      weightage: editingAssessment.weightage !== null ? editingAssessment.weightage.toString() : '',
      scheduled_at: editingAssessment.scheduled_at ? editingAssessment.scheduled_at.split('T')[0] : '',
    } : undefined,
  });

  const getLocalDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const editingAttendance = attendanceList?.find(a => a.id === editingAttendanceId);
  const {
    register: registerAttendance,
    handleSubmit: handleSubmitAttendance,
    reset: resetAttendance,
    formState: { errors: attendanceErrors },
  } = useForm<AttendanceForm>({
    resolver: zodResolver(attendanceSchema),
    defaultValues: { recorded_on: getLocalDateString() },
    values: editingAttendance ? {
      classes_attended: editingAttendance.classes_attended.toString(),
      classes_held: editingAttendance.classes_held.toString(),
      recorded_on: editingAttendance.recorded_on,
    } : undefined,
  });

  const parseAssessmentPayload = (data: AssessmentForm) => {
    const isNoMarks = data.status === 'pending' || data.status === 'absent' || data.status === 'exempt';
    return {
      name: data.name,
      category: data.category,
      max_marks: Number(data.max_marks),
      status: data.status,
      marks: !isNoMarks && data.marks && data.marks.trim() !== '' ? Number(data.marks) : null,
      ...(data.weightage && data.weightage.trim() !== '' ? { weightage: Number(data.weightage) } : { weightage: null }),
      ...(data.scheduled_at ? { scheduled_at: new Date(data.scheduled_at).toISOString() } : { scheduled_at: null }),
    };
  };

  const parseAttendancePayload = (data: AttendanceForm) => {
    return {
      classes_attended: Number(data.classes_attended),
      classes_held: Number(data.classes_held),
      recorded_on: data.recorded_on,
    };
  };

  const onSubmitCreateAssessment = (data: AssessmentForm) => {
    setError('');
    setAssessmentFormError('');
    const trimmed = data.name.trim().toLowerCase();
    const isDuplicate = assessments?.some(
      (a) => a.name.trim().toLowerCase() === trimmed
    );
    if (isDuplicate) {
      setErrorAssessment('name', {
        type: 'manual',
        message: 'An assessment with this name already exists in this subject',
      });
      return;
    }
    createAssessmentMutation.mutate(parseAssessmentPayload(data));
  };

  const onSubmitUpdateAssessment = (data: AssessmentForm) => {
    if (!editingAssessmentId) return;
    setError('');
    setAssessmentFormError('');
    const trimmed = data.name.trim().toLowerCase();
    const isDuplicate = assessments?.some(
      (a) => a.id !== editingAssessmentId && a.name.trim().toLowerCase() === trimmed
    );
    if (isDuplicate) {
      setErrorAssessment('name', {
        type: 'manual',
        message: 'An assessment with this name already exists in this subject',
      });
      return;
    }
    updateAssessmentMutation.mutate({ id: editingAssessmentId, data: parseAssessmentPayload(data) });
  };

  const onSubmitCreateAttendance = (data: AttendanceForm) => {
    setError('');
    setAttendanceFormError('');
    createAttendanceMutation.mutate(parseAttendancePayload(data));
  };

  const onSubmitUpdateAttendance = (data: AttendanceForm) => {
    if (!editingAttendanceId) return;
    setError('');
    setAttendanceFormError('');
    updateAttendanceMutation.mutate({ id: editingAttendanceId, data: parseAttendancePayload(data) });
  };

  const startEditingAssessment = (assessment: Assessment) => {
    setError('');
    setAssessmentFormError('');
    setIsCreatingAssessment(false);
    setEditingAssessmentId(assessment.id);
  };

  const startEditingAttendance = (att: Attendance) => {
    setError('');
    setAttendanceFormError('');
    setIsCreatingAttendance(false);
    setEditingAttendanceId(att.id);
  };

  const cancelEditingAssessment = () => {
    setEditingAssessmentId(null);
    resetAssessment();
    setAssessmentFormError('');
    setError('');
  };

  const cancelEditingAttendance = () => {
    setEditingAttendanceId(null);
    resetAttendance();
    setAttendanceFormError('');
    setError('');
  };

  const handleDeleteAssessment = (id: string) => {
    if (window.confirm('Are you sure you want to delete this assessment? All associated marks will be removed.')) {
      deleteAssessmentMutation.mutate(id);
    }
  };

  const handleDeleteAttendance = (id: string) => {
    if (window.confirm('Are you sure you want to delete this attendance record?')) {
      deleteAttendanceMutation.mutate(id);
    }
  };

  if (isLoadingSubject || isLoadingAssessments || isLoadingAttendance) return <div>Loading...</div>;
  if (!subject) return <div>Subject not found</div>;

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20',
      scored: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
      absent: 'bg-destructive/10 text-destructive border border-destructive/20',
      exempt: 'bg-muted text-muted-foreground border border-border',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const AssessmentFormContent = ({ isEdit = false }) => (
    <div className="space-y-4">
      {assessmentFormError && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm border border-destructive/20">
          {assessmentFormError}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Assessment Name *</Label>
          <Input
            id="name"
            placeholder="e.g. Midterm"
            {...registerAssessment('name', {
              onChange: (e) => {
                const val = e.target.value.trim().toLowerCase();
                if (!val) return;
                const isDup = assessments?.some(
                  (a) => (!isEdit || a.id !== editingAssessmentId) && a.name.trim().toLowerCase() === val
                );
                if (isDup) {
                  setErrorAssessment('name', {
                    type: 'manual',
                    message: 'An assessment with this name already exists in this subject',
                  });
                } else if (assessmentErrors.name?.type === 'manual') {
                  clearErrorsAssessment('name');
                }
              },
            })}
          />
          {assessmentErrors.name && <p className="text-xs text-destructive">{assessmentErrors.name.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Category *</Label>
          <select
            id="category"
            className="flex h-9 w-full rounded-md border border-input bg-card text-foreground px-3 py-1.5 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            {...registerAssessment('category')}
          >
            <option value="" className="bg-card text-foreground">Select a category</option>
            {ASSESSMENT_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value} className="bg-card text-foreground">
                {cat.label}
              </option>
            ))}
          </select>
          {assessmentErrors.category && <p className="text-xs text-destructive">{assessmentErrors.category.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_marks">Max Marks *</Label>
          <Input id="max_marks" type="number" step="0.5" {...registerAssessment('max_marks')} />
          {assessmentErrors.max_marks && <p className="text-xs text-destructive">{assessmentErrors.max_marks.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="weightage">Weightage (%)</Label>
          <Input id="weightage" type="number" step="0.5" {...registerAssessment('weightage')} />
          {assessmentErrors.weightage && <p className="text-xs text-destructive">{assessmentErrors.weightage.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduled_at">Date</Label>
          <Input id="scheduled_at" type="date" {...registerAssessment('scheduled_at')} />
          {assessmentErrors.scheduled_at && <p className="text-xs text-destructive">{assessmentErrors.scheduled_at.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            className="flex h-9 w-full rounded-md border border-input bg-card text-foreground px-3 py-1.5 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            {...registerAssessment('status', {
              onChange: (e) => {
                const newStatus = e.target.value;
                if (newStatus === 'pending' || newStatus === 'absent' || newStatus === 'exempt') {
                  setValueAssessment('marks', '', { shouldValidate: true });
                }
              },
            })}
          >
            <option value="pending" className="bg-card text-foreground">Pending</option>
            <option value="scored" className="bg-card text-foreground">Scored</option>
            <option value="absent" className="bg-card text-foreground">Absent</option>
            <option value="exempt" className="bg-card text-foreground">Exempt</option>
          </select>
          {assessmentErrors.status && <p className="text-xs text-destructive">{assessmentErrors.status.message}</p>}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="marks">Marks</Label>
          <Input
            id="marks"
            type="number"
            step="0.5"
            placeholder="Leave blank if not graded"
            {...registerAssessment('marks', {
              onChange: (e) => {
                const val = e.target.value;
                if (val && val.trim() !== '') {
                  const currentStatus = getValuesAssessment('status');
                  if (currentStatus === 'pending') {
                    setValueAssessment('status', 'scored', { shouldValidate: true });
                  }
                }
              },
            })}
          />
          {assessmentErrors.marks && <p className="text-xs text-destructive">{assessmentErrors.marks.message}</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isEdit) cancelEditingAssessment();
            else { setIsCreatingAssessment(false); resetAssessment(); setAssessmentFormError(''); setError(''); }
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isEdit ? updateAssessmentMutation.isPending : createAssessmentMutation.isPending}>
          {isEdit ? 'Save Changes' : 'Create Assessment'}
        </Button>
      </div>
    </div>
  );

  const AttendanceFormContent = ({ isEdit = false }) => (
    <div className="space-y-4">
      {attendanceFormError && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm border border-destructive/20">
          {attendanceFormError}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="classes_attended">Attended *</Label>
          <Input id="classes_attended" type="number" step="1" min="0" {...registerAttendance('classes_attended')} />
          {attendanceErrors.classes_attended && <p className="text-xs text-destructive">{attendanceErrors.classes_attended.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="classes_held">Held *</Label>
          <Input id="classes_held" type="number" step="1" min="1" {...registerAttendance('classes_held')} />
          {attendanceErrors.classes_held && <p className="text-xs text-destructive">{attendanceErrors.classes_held.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="recorded_on">Date *</Label>
          <Input id="recorded_on" type="date" {...registerAttendance('recorded_on')} />
          {attendanceErrors.recorded_on && <p className="text-xs text-destructive">{attendanceErrors.recorded_on.message}</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isEdit) cancelEditingAttendance();
            else { setIsCreatingAttendance(false); resetAttendance(); setAttendanceFormError(''); setError(''); }
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isEdit ? updateAttendanceMutation.isPending : createAttendanceMutation.isPending}>
          {isEdit ? 'Save Changes' : 'Record Attendance'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link to={`/app/semesters/${semesterId}`} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {subject.name} {subject.code ? `(${subject.code})` : ''}
            </h1>
            {!isEditingSubject && (
              <Button
                variant="ghost"
                size="sm"
                onClick={startEditingSubject}
                aria-label="Edit subject"
                className="text-muted-foreground hover:text-foreground"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {semester?.name} • Subject Details
            {subject.credits != null && ` • ${subject.credits} Credits`}
            {subject.target_percentage != null && ` • Target: ${subject.target_percentage}%`}
          </p>
        </div>
      </div>

      {isEditingSubject && (
        <div className="p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border text-card-foreground">
          <form onSubmit={handleSubmitSubject(onSubmitUpdateSubject)} className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Edit Subject</h3>
            {subjectFormError && (
              <div role="alert" className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm border border-destructive/20">
                {subjectFormError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subject_name" className="text-foreground">Subject Name *</Label>
                <Input
                  id="subject_name"
                  placeholder="e.g. Data Structures"
                  {...registerSubject('name')}
                />
                {subjectErrors.name && (
                  <p className="text-xs text-destructive">{subjectErrors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject_code" className="text-foreground">Course Code</Label>
                <Input
                  id="subject_code"
                  placeholder="e.g. CS201"
                  {...registerSubject('code')}
                />
                {subjectErrors.code && (
                  <p className="text-xs text-destructive">{subjectErrors.code.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject_credits" className="text-foreground">Credits</Label>
                <Input
                  id="subject_credits"
                  type="number"
                  step="1"
                  placeholder="e.g. 3"
                  {...registerSubject('credits')}
                />
                {subjectErrors.credits && (
                  <p className="text-xs text-destructive">{subjectErrors.credits.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject_target_percentage" className="text-foreground">Target Percentage (%)</Label>
                <Input
                  id="subject_target_percentage"
                  type="number"
                  step="1"
                  placeholder="e.g. 85"
                  {...registerSubject('target_percentage')}
                />
                {subjectErrors.target_percentage && (
                  <p className="text-xs text-destructive">{subjectErrors.target_percentage.message}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={cancelEditingSubject}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateSubjectMutation.isPending}>
                {updateSubjectMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div role="alert" className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm border border-destructive/20">
          {error}
        </div>
      )}

      {/* ATTENDANCE SECTION */}
      <section>
        <div className="flex items-center justify-between border-t border-border pt-6 mb-4">
          <h2 className="text-xl font-semibold text-foreground">Attendance</h2>
          {!editingAttendanceId && (
            <Button onClick={() => { setIsCreatingAttendance(true); resetAttendance(); setError(''); }}>
              Record Attendance
            </Button>
          )}
        </div>

        {isCreatingAttendance && (
          <div className="p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border mb-4 text-card-foreground">
            <form onSubmit={handleSubmitAttendance(onSubmitCreateAttendance)} noValidate>
              <h3 className="text-lg font-semibold text-foreground mb-4">Record Attendance</h3>
              {AttendanceFormContent({ isEdit: false })}
            </form>
          </div>
        )}

        {!attendanceList?.length && !isCreatingAttendance ? (
          <div className="text-center py-12 bg-card/85 backdrop-blur-md rounded-xl border border-dashed border-border text-card-foreground">
            <h3 className="text-sm font-medium text-foreground">No attendance recorded</h3>
            <p className="mt-1 text-sm text-muted-foreground">Record attendance to track your classes.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {attendanceList?.map((att) => {
              let percentage = 0;
              if (att.classes_held > 0) {
                percentage = (att.classes_attended / att.classes_held) * 100;
              }
              return (
                <div key={att.id} className="p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border text-card-foreground">
                  {editingAttendanceId === att.id ? (
                    <form onSubmit={handleSubmitAttendance(onSubmitUpdateAttendance)} noValidate>
                      <h3 className="text-lg font-semibold text-foreground mb-4">Edit Attendance</h3>
                      {AttendanceFormContent({ isEdit: true })}
                    </form>
                  ) : (
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-3">
                          <p data-testid="attendance-pct" className="text-2xl font-bold text-foreground tabular-nums">
                            {att.classes_held === 0 ? 'N/A' : `${percentage.toFixed(1)}%`}
                          </p>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          <span data-testid="attendance-fraction" className="tabular-nums">{att.classes_attended} / {att.classes_held}</span> classes • Recorded on {att.recorded_on}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => startEditingAttendance(att)} aria-label="Edit attendance" className="text-muted-foreground hover:text-foreground">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteAttendance(att.id)} className="text-destructive hover:text-destructive/90" aria-label="Delete attendance">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ASSESSMENTS SECTION */}
      <section>
        <div className="flex items-center justify-between border-t border-border pt-6 mb-4">
          <h2 className="text-xl font-semibold text-foreground">Assessments</h2>
          {!editingAssessmentId && (
            <Button onClick={() => { setIsCreatingAssessment(true); resetAssessment(); setAssessmentFormError(''); setError(''); }}>
              Add Assessment
            </Button>
          )}
        </div>

        {isCreatingAssessment && (
          <div className="p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border mb-4 text-card-foreground">
            <form onSubmit={handleSubmitAssessment(onSubmitCreateAssessment)} noValidate>
              <h3 className="text-lg font-semibold text-foreground mb-4">Create New Assessment</h3>
              {AssessmentFormContent({ isEdit: false })}
            </form>
          </div>
        )}

        {!assessments?.length && !isCreatingAssessment ? (
          <div className="text-center py-12 bg-card/85 backdrop-blur-md rounded-xl border border-dashed border-border text-card-foreground">
            <h3 className="text-sm font-medium text-foreground">No assessments</h3>
            <p className="mt-1 text-sm text-muted-foreground">Add an assessment to track your progress.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {assessments?.map((assessment) => (
              <div key={assessment.id} className="p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border text-card-foreground">
                {editingAssessmentId === assessment.id ? (
                  <form onSubmit={handleSubmitAssessment(onSubmitUpdateAssessment)} noValidate>
                    <h3 className="text-lg font-semibold text-foreground mb-4">Edit Assessment</h3>
                    {AssessmentFormContent({ isEdit: true })}
                  </form>
                ) : (
                  <div>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-lg font-semibold text-foreground">{assessment.name}</h3>
                          {getStatusBadge(assessment.status)}
                          {Boolean(assessment.is_auto_generated || (assessment.calendar_event_id && assessment.calendar_event_id.trim() !== '')) && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                              Exam Linked
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {CATEGORY_LABELS[assessment.category] || assessment.category}
                          {assessment.weightage != null && ` • ${assessment.weightage}% weight`}
                          {assessment.scheduled_at && ` • ${new Date(assessment.scheduled_at).toLocaleDateString(undefined, { timeZone: 'UTC' })}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => startEditingAssessment(assessment)} aria-label="Edit assessment" className="text-muted-foreground hover:text-foreground">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteAssessment(assessment.id)} className="text-destructive hover:text-destructive/90" aria-label="Delete assessment">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-border/40 flex items-end gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Marks</p>
                        <p data-testid="assessment-marks" className="text-2xl font-bold text-foreground tabular-nums">
                          {assessment.marks !== null ? assessment.marks : '--'} <span className="text-lg text-muted-foreground font-normal">/ {assessment.max_marks}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* CALCULATOR SECTION */}
      <section>
        <div className="flex items-center justify-between border-t border-border pt-6 mb-4">
          <h2 className="text-xl font-semibold text-foreground">Required-Score Calculator</h2>
        </div>
        <div className="p-6 bg-card/85 backdrop-blur-md rounded-xl shadow-xs border border-border mb-4 text-card-foreground">
          <form onSubmit={handleSubmitCalculator(onSubmitCalculator)} noValidate>
            <div className="flex items-end gap-4">
              <div className="space-y-2 flex-1 max-w-sm">
                <Label htmlFor="target_percentage" className="text-foreground">Target Percentage</Label>
                <div className="relative flex items-center">
                  <Input
                    id="target_percentage"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="e.g. 75"
                    className="pr-8 bg-card text-foreground border-input"
                    {...registerCalculator('target_percentage')}
                  />
                  <span className="absolute right-3 text-sm font-medium text-muted-foreground pointer-events-none">%</span>
                </div>
                {calculatorErrors.target_percentage && <p className="text-xs text-destructive">{calculatorErrors.target_percentage.message}</p>}
              </div>
              <Button type="submit" disabled={calculateMutation.isPending}>
                {calculateMutation.isPending ? 'Calculating...' : 'Calculate'}
              </Button>
            </div>
          </form>

          {calculatorResult && (() => {
            const earnedPoints = Number(calculatorResult.earned_points);
            const remainingWeight = Number(calculatorResult.remaining_weight);
            const maxAchievable = calculatorResult.max_achievable_score != null
              ? Number(calculatorResult.max_achievable_score)
              : (earnedPoints + remainingWeight);

            if (calculatorResult.target_achieved) {
              return (
                <div className="mt-6 p-5 rounded-xl border border-success/30 bg-success/10 text-foreground">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                    <h3 className="font-semibold text-foreground text-base">Target Already Achieved</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    You have already achieved this target score! (Current points: <strong className="text-foreground tabular-nums">{earnedPoints.toFixed(2)}</strong> against target <strong className="text-foreground tabular-nums">{lastTargetCalculated}%</strong>)
                  </p>
                </div>
              );
            }

            if (calculatorResult.impossible) {
              return (
                <div className="mt-6 p-5 rounded-xl border border-destructive/30 bg-destructive/10 text-foreground">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                    <h3 className="font-semibold text-destructive text-base">Target Cannot Be Achieved</h3>
                  </div>
                  <p className="text-sm text-foreground font-medium mb-3">
                    {`It is impossible to reach this target. (Remaining weight: ${remainingWeight.toFixed(2)}%)`}
                  </p>

                  <div className="rounded-lg bg-card/80 border border-border/60 p-4 mb-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Maximum Achievable Score</p>
                    <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">{`${maxAchievable.toFixed(2)}%`}</p>
                  </div>

                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">How this is calculated:</p>
                    {remainingWeight <= 0 ? (
                      <p>
                        {`All non-exempt coursework assessments have already been completed or evaluated. With 0.00% remaining weight, your maximum achievable grade is strictly your current earned points of ${earnedPoints.toFixed(2)}%.`}
                      </p>
                    ) : (
                      <p>
                        {`You currently have ${earnedPoints.toFixed(2)} earned points. If you achieve a perfect 100% on all remaining assessments (${remainingWeight.toFixed(2)}% remaining weight), your maximum achievable score is ${earnedPoints.toFixed(2)}% + ${remainingWeight.toFixed(2)}% = ${maxAchievable.toFixed(2)}%, which is below your target of ${lastTargetCalculated}%.`}
                      </p>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div className="mt-6 p-5 rounded-xl border border-primary/30 bg-primary/10 text-foreground">
                <h3 className="font-semibold text-foreground text-base mb-2">
                  {`Calculation Result for ${lastTargetCalculated}%:`}
                </h3>
                <p className="text-sm text-foreground">
                  You need <strong className="text-primary font-bold tabular-nums">{`${Number(calculatorResult.required_remaining_percentage).toFixed(2)}%`}</strong> on all remaining assessments.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {`(Requires ${Number(calculatorResult.required_points_from_remaining).toFixed(2)} more points out of the ${remainingWeight.toFixed(2)}% remaining weight. Maximum achievable score: ${maxAchievable.toFixed(2)}%.)`}
                </p>
              </div>
            );
          })()}
        </div>
      </section>
    </div>
  );
}
