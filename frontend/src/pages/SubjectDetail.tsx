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
import { ArrowLeft, Edit2, Trash2 } from 'lucide-react';

const assessmentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.string().min(1, 'Category is required'),
  max_marks: z.string().min(1, 'Max marks is required'),
  marks: z.string().optional(),
  weightage: z.string().optional(),
  scheduled_at: z.string().optional(),
  status: z.enum(['pending', 'scored', 'absent', 'exempt']),
}).superRefine((data, ctx) => {
  const maxMarks = Number(data.max_marks);
  if (isNaN(maxMarks) || maxMarks <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Max marks must be > 0', path: ['max_marks'] });
  }
  
  if (data.marks) {
    const marks = Number(data.marks);
    if (isNaN(marks) || marks < 0 || marks > maxMarks) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Marks must be between 0 and ${maxMarks}`, path: ['marks'] });
    }
  }

  if (data.weightage) {
    const weightage = Number(data.weightage);
    if (isNaN(weightage) || weightage <= 0 || weightage > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Weightage must be between 0 and 100', path: ['weightage'] });
    }
  }

  if (data.status === 'scored' && (!data.marks || data.marks.trim() === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Marks are required when status is 'scored'", path: ['marks'] });
  }
});

type AssessmentForm = z.infer<typeof assessmentSchema>;

const attendanceSchema = z.object({
  classes_attended: z.string().min(1, 'Classes attended is required'),
  classes_held: z.string().min(1, 'Classes held is required'),
  recorded_on: z.string().min(1, 'Date is required'),
}).superRefine((data, ctx) => {
  const attended = Number(data.classes_attended);
  const held = Number(data.classes_held);
  if (isNaN(attended) || attended < 0 || !Number.isInteger(attended)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be integer >= 0', path: ['classes_attended'] });
  }
  if (isNaN(held) || held < 0 || !Number.isInteger(held)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be integer >= 0', path: ['classes_held'] });
  }
  if (!isNaN(attended) && !isNaN(held) && attended > held) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Attended cannot exceed held', path: ['classes_attended'] });
  }
});

type AttendanceForm = z.infer<typeof attendanceSchema>;

const calculatorSchema = z.object({
  target_percentage: z.string().min(1, 'Target percentage is required'),
}).superRefine((data, ctx) => {
  const target = Number(data.target_percentage);
  if (isNaN(target) || target < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a non-negative number', path: ['target_percentage'] });
  }
});

type CalculatorForm = z.infer<typeof calculatorSchema>;

export default function SubjectDetail() {
  const { semesterId, subjectId } = useParams<{ semesterId: string, subjectId: string }>();
  const queryClient = useQueryClient();
  const [isCreatingAssessment, setIsCreatingAssessment] = useState(false);
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  
  const [isCreatingAttendance, setIsCreatingAttendance] = useState(false);
  const [editingAttendanceId, setEditingAttendanceId] = useState<string | null>(null);

  const [error, setError] = useState('');

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
    },
    onError: (err: any) => setError(err.message || 'Failed to create assessment'),
  });

  const updateAssessmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => api.put(`/assessments/${id}`, data),
    onSuccess: () => {
      invalidateAssessments();
      setEditingAssessmentId(null);
    },
    onError: (err: any) => setError(err.message || 'Failed to update assessment'),
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
    },
    onError: (err: any) => setError(err.message || 'Failed to create attendance'),
  });

  const updateAttendanceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: any }) => api.put(`/attendance/${id}`, data),
    onSuccess: () => {
      invalidateAttendance();
      setEditingAttendanceId(null);
    },
    onError: (err: any) => setError(err.message || 'Failed to update attendance'),
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

  const editingAssessment = assessments?.find(a => a.id === editingAssessmentId);
  const {
    register: registerAssessment,
    handleSubmit: handleSubmitAssessment,
    reset: resetAssessment,
    formState: { errors: assessmentErrors },
  } = useForm<AssessmentForm>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: { status: 'pending' },
    values: editingAssessment ? {
      name: editingAssessment.name,
      category: editingAssessment.category,
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
    return {
      name: data.name,
      category: data.category,
      max_marks: Number(data.max_marks),
      status: data.status,
      ...(data.marks ? { marks: Number(data.marks) } : { marks: null }),
      ...(data.weightage ? { weightage: Number(data.weightage) } : { weightage: null }),
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
    createAssessmentMutation.mutate(parseAssessmentPayload(data));
  };

  const onSubmitUpdateAssessment = (data: AssessmentForm) => {
    if (!editingAssessmentId) return;
    setError('');
    updateAssessmentMutation.mutate({ id: editingAssessmentId, data: parseAssessmentPayload(data) });
  };

  const onSubmitCreateAttendance = (data: AttendanceForm) => {
    setError('');
    createAttendanceMutation.mutate(parseAttendancePayload(data));
  };

  const onSubmitUpdateAttendance = (data: AttendanceForm) => {
    if (!editingAttendanceId) return;
    setError('');
    updateAttendanceMutation.mutate({ id: editingAttendanceId, data: parseAttendancePayload(data) });
  };

  const startEditingAssessment = (assessment: Assessment) => {
    setError('');
    setIsCreatingAssessment(false);
    setEditingAssessmentId(assessment.id);
  };

  const startEditingAttendance = (att: Attendance) => {
    setError('');
    setIsCreatingAttendance(false);
    setEditingAttendanceId(att.id);
  };

  const cancelEditingAssessment = () => {
    setEditingAssessmentId(null);
    resetAssessment();
    setError('');
  };

  const cancelEditingAttendance = () => {
    setEditingAttendanceId(null);
    resetAttendance();
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
      pending: 'bg-yellow-100 text-yellow-800',
      scored: 'bg-green-100 text-green-800',
      absent: 'bg-red-100 text-red-800',
      exempt: 'bg-gray-100 text-gray-800',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const AssessmentFormContent = ({ isEdit = false }) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Assessment Name *</Label>
          <Input id="name" placeholder="e.g. Midterm" {...registerAssessment('name')} />
          {assessmentErrors.name && <p className="text-sm text-red-600">{assessmentErrors.name.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Category *</Label>
          <Input id="category" placeholder="e.g. Exam" {...registerAssessment('category')} />
          {assessmentErrors.category && <p className="text-sm text-red-600">{assessmentErrors.category.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_marks">Max Marks *</Label>
          <Input id="max_marks" type="number" step="0.1" {...registerAssessment('max_marks')} />
          {assessmentErrors.max_marks && <p className="text-sm text-red-600">{assessmentErrors.max_marks.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="weightage">Weightage (%)</Label>
          <Input id="weightage" type="number" step="0.1" {...registerAssessment('weightage')} />
          {assessmentErrors.weightage && <p className="text-sm text-red-600">{assessmentErrors.weightage.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduled_at">Date</Label>
          <Input id="scheduled_at" type="date" {...registerAssessment('scheduled_at')} />
          {assessmentErrors.scheduled_at && <p className="text-sm text-red-600">{assessmentErrors.scheduled_at.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            className="flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            {...registerAssessment('status')}
          >
            <option value="pending">Pending</option>
            <option value="scored">Scored</option>
            <option value="absent">Absent</option>
            <option value="exempt">Exempt</option>
          </select>
          {assessmentErrors.status && <p className="text-sm text-red-600">{assessmentErrors.status.message}</p>}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="marks">Marks</Label>
          <Input id="marks" type="number" step="0.1" placeholder="Leave blank if not graded" {...registerAssessment('marks')} />
          {assessmentErrors.marks && <p className="text-sm text-red-600">{assessmentErrors.marks.message}</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isEdit) cancelEditingAssessment();
            else { setIsCreatingAssessment(false); resetAssessment(); setError(''); }
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="classes_attended">Attended *</Label>
          <Input id="classes_attended" type="number" step="1" {...registerAttendance('classes_attended')} />
          {attendanceErrors.classes_attended && <p className="text-sm text-red-600">{attendanceErrors.classes_attended.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="classes_held">Held *</Label>
          <Input id="classes_held" type="number" step="1" {...registerAttendance('classes_held')} />
          {attendanceErrors.classes_held && <p className="text-sm text-red-600">{attendanceErrors.classes_held.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="recorded_on">Date *</Label>
          <Input id="recorded_on" type="date" {...registerAttendance('recorded_on')} />
          {attendanceErrors.recorded_on && <p className="text-sm text-red-600">{attendanceErrors.recorded_on.message}</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isEdit) cancelEditingAttendance();
            else { setIsCreatingAttendance(false); resetAttendance(); setError(''); }
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
        <Link to={`/app/semesters/${semesterId}`} className="text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{subject.name} {subject.code ? `(${subject.code})` : ''}</h1>
          <p className="text-sm text-gray-500">{semester?.name} • Subject Details</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* ATTENDANCE SECTION */}
      <section>
        <div className="flex items-center justify-between border-t border-gray-200 pt-6 mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Attendance</h2>
          {!editingAttendanceId && (
            <Button onClick={() => { setIsCreatingAttendance(true); resetAttendance(); setError(''); }}>
              Record Attendance
            </Button>
          )}
        </div>

        {isCreatingAttendance && (
          <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 mb-4">
            <form onSubmit={handleSubmitAttendance(onSubmitCreateAttendance)}>
              <h3 className="text-lg font-medium mb-4">Record Attendance</h3>
              {AttendanceFormContent({ isEdit: false })}
            </form>
          </div>
        )}

        {!attendanceList?.length && !isCreatingAttendance ? (
          <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
            <h3 className="text-sm font-medium text-gray-900">No attendance recorded</h3>
            <p className="mt-1 text-sm text-gray-500">Record attendance to track your classes.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {attendanceList?.map((att) => {
              let percentage = 0;
              if (att.classes_held > 0) {
                percentage = (att.classes_attended / att.classes_held) * 100;
              }
              return (
                <div key={att.id} className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
                  {editingAttendanceId === att.id ? (
                    <form onSubmit={handleSubmitAttendance(onSubmitUpdateAttendance)}>
                      <h3 className="text-lg font-medium mb-4">Edit Attendance</h3>
                      {AttendanceFormContent({ isEdit: true })}
                    </form>
                  ) : (
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-3">
                          <p data-testid="attendance-pct" className="text-2xl font-bold text-gray-900">
                            {att.classes_held === 0 ? 'N/A' : `${percentage.toFixed(1)}%`}
                          </p>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          <span data-testid="attendance-fraction">{att.classes_attended} / {att.classes_held}</span> classes • Recorded on {att.recorded_on}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => startEditingAttendance(att)} aria-label="Edit attendance">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteAttendance(att.id)} className="text-red-600 hover:text-red-700" aria-label="Delete attendance">
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
        <div className="flex items-center justify-between border-t border-gray-200 pt-6 mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Assessments</h2>
          {!editingAssessmentId && (
            <Button onClick={() => { setIsCreatingAssessment(true); resetAssessment(); setError(''); }}>
              Add Assessment
            </Button>
          )}
        </div>

        {isCreatingAssessment && (
          <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 mb-4">
            <form onSubmit={handleSubmitAssessment(onSubmitCreateAssessment)}>
              <h3 className="text-lg font-medium mb-4">Create New Assessment</h3>
              {AssessmentFormContent({ isEdit: false })}
            </form>
          </div>
        )}

        {!assessments?.length && !isCreatingAssessment ? (
          <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
            <h3 className="text-sm font-medium text-gray-900">No assessments</h3>
            <p className="mt-1 text-sm text-gray-500">Add an assessment to track your progress.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {assessments?.map((assessment) => (
              <div key={assessment.id} className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
                {editingAssessmentId === assessment.id ? (
                  <form onSubmit={handleSubmitAssessment(onSubmitUpdateAssessment)}>
                    <h3 className="text-lg font-medium mb-4">Edit Assessment</h3>
                    {AssessmentFormContent({ isEdit: true })}
                  </form>
                ) : (
                  <div>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-gray-900">{assessment.name}</h3>
                          {getStatusBadge(assessment.status)}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {assessment.category}
                          {assessment.weightage != null && ` • ${assessment.weightage}% weight`}
                          {assessment.scheduled_at && ` • ${new Date(assessment.scheduled_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => startEditingAssessment(assessment)} aria-label="Edit assessment">
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteAssessment(assessment.id)} className="text-red-600 hover:text-red-700" aria-label="Delete assessment">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-gray-100 flex items-end gap-4">
                      <div>
                        <p className="text-sm text-gray-500">Marks</p>
                        <p data-testid="assessment-marks" className="text-2xl font-bold text-gray-900">
                          {assessment.marks !== null ? assessment.marks : '--'} <span className="text-lg text-gray-400 font-normal">/ {assessment.max_marks}</span>
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
        <div className="flex items-center justify-between border-t border-gray-200 pt-6 mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Required-Score Calculator</h2>
        </div>
        <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 mb-4">
          <form onSubmit={handleSubmitCalculator(onSubmitCalculator)}>
            <div className="flex items-end gap-4">
              <div className="space-y-2 flex-1 max-w-sm">
                <Label htmlFor="target_percentage">Target Percentage</Label>
                <div className="flex items-center gap-2">
                  <Input id="target_percentage" type="number" step="0.1" {...registerCalculator('target_percentage')} />
                  <span className="text-gray-500">%</span>
                </div>
                {calculatorErrors.target_percentage && <p className="text-sm text-red-600">{calculatorErrors.target_percentage.message}</p>}
              </div>
              <Button type="submit" disabled={calculateMutation.isPending}>
                {calculateMutation.isPending ? 'Calculating...' : 'Calculate'}
              </Button>
            </div>
          </form>

          {calculatorResult && (
            <div className="mt-6 p-4 rounded-md border border-blue-100 bg-blue-50 text-blue-900">
              <h3 className="font-semibold mb-2">Calculation Result for {lastTargetCalculated}%:</h3>
              {calculatorResult.target_achieved ? (
                <p>You have already achieved this target score! (Current points: {Number(calculatorResult.earned_points).toFixed(2)})</p>
              ) : calculatorResult.impossible ? (
                <p>It is impossible to reach this target. (Remaining weight: {Number(calculatorResult.remaining_weight).toFixed(2)}%)</p>
              ) : (
                <div>
                  <p>You need <strong>{Number(calculatorResult.required_remaining_percentage).toFixed(2)}%</strong> on all remaining assessments.</p>
                  <p className="text-sm text-blue-800 mt-2">
                    (Requires {Number(calculatorResult.required_points_from_remaining).toFixed(2)} more points out of the {Number(calculatorResult.remaining_weight).toFixed(2)}% remaining weight.)
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
