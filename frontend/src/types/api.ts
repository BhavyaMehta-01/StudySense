export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface DashboardSummary {
  total_semesters: number;
  total_subjects: number;
  subject_summaries: SubjectSummary[];
}

export interface SubjectSummary {
  semester_id: string;
  semester_name: string;
  subject_id: string;
  subject_name: string;
  earned_points: string | number;
  completed_weight: string | number;
  pending_weight: string | number;
  completed_work_percentage: string | number | null;
  attendance_percentage: string | number | null;
}

export interface Semester {
  id: string;
  name: string;
  academic_year: string;
  start_date?: string | null;
  end_date?: string | null;
  user_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
  credits: number | null;
  target_percentage?: number | null;
  attendance_target_percentage?: number;
  semester_id: string;
  created_at: string;
  updated_at: string | null;
}

export interface Attendance {
  id: string;
  classes_attended: number;
  classes_held: number;
  recorded_on: string;
  subject_id: string;
  created_at: string;
  updated_at: string | null;
}

export interface CalculatorRequest {
  target_percentage: number;
}

export interface CalculatorResponse {
  earned_points: number;
  remaining_weight: number;
  total_valid_weight: number;
  target_achieved: boolean;
  impossible: boolean;
  required_remaining_percentage: number;
  required_points_from_remaining: number;
  max_achievable_score?: number | string;
}

export interface Assessment {
  id: string;
  name: string;
  category: string;
  max_marks: number;
  marks: number | null;
  weightage: number | null;
  scheduled_at: string | null;
  status: 'pending' | 'scored' | 'absent' | 'exempt';
  subject_id: string;
  calendar_event_id?: string | null;
  pattern_component_id?: string | null;
  is_auto_generated?: boolean;
  is_exempt?: boolean;
  created_at: string;
  updated_at: string | null;
}

export const isAssessmentExempt = (assessment?: { status?: string; is_exempt?: boolean } | null): boolean => {
  if (!assessment) return false;
  return assessment.status === 'exempt' || Boolean(assessment.is_exempt);
};

export interface ImportError {
  row: number;
  column: string | null;
  message: string;
}

export interface ImportResponse {
  success: boolean;
  total_processed: number;
  imported_records: number;
  errors: ImportError[];
}

export interface ConsentStatus {
  data_donation_consent: boolean;
  consent_updated_at: string | null;
  consent_text_version: string | null;
}

export interface AllocationSnapshotState {
  subject_name: string;
  target_deficit: number | null;
  urgency_score: number | null;
  raw_weight: number;
  scaled_weight: number;
  days_to_exam: number | null;
  subject_target: number | null;
  current_percentage: number | null;
  remaining_weight: number | null;
  [key: string]: any;
}

export interface StudyPlanAllocation {
  id: string;
  plan_id: string;
  subject_id: string | null;
  allocated_minutes: number;
  snapshot_state: AllocationSnapshotState | Record<string, any>;
  explanation_code: string;
}

export interface StudyPlan {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  available_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  allocations: StudyPlanAllocation[];
}

export interface StudyPlanCreate {
  start_date: string;
  end_date: string;
  available_minutes: number;
}

export type StudySessionStatus = 'completed' | 'partial' | 'skipped';

export interface StudySessionCreate {
  allocation_id: string;
  date: string;
  duration_minutes: number;
  status: StudySessionStatus;
}

export interface StudySession {
  id: string;
  allocation_id: string | null;
  user_id: string;
  date: string;
  duration_minutes: number;
  status: StudySessionStatus;
  created_at: string;
  updated_at: string | null;
}

export interface TimetableSlot {
  id: string;
  semester_id: string;
  subject_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TimetableSlotCreate {
  subject_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_to?: string | null;
}

export interface TimetableSlotUpdate {
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  effective_from?: string;
  effective_to?: string | null;
}

export interface AcademicCalendarEvent {
  id: string;
  semester_id: string;
  title: string;
  event_type: 'holiday' | 'non_working_day' | 'exam';
  start_date: string;
  end_date: string;
  cancels_regular_classes: boolean;
  subject_ids?: string[];
  assessment_ids?: string[];
  created_at: string;
  updated_at: string | null;
}

export interface ExamSubjectComponentSelection {
  subject_id: string;
  pattern_component_id: string;
}

export interface AcademicCalendarEventCreate {
  title: string;
  event_type: 'holiday' | 'non_working_day' | 'exam';
  start_date: string;
  end_date: string;
  cancels_regular_classes?: boolean;
  subject_ids?: string[];
  subject_components?: ExamSubjectComponentSelection[];
}

export interface AcademicCalendarEventUpdate {
  title?: string;
  event_type?: 'holiday' | 'non_working_day' | 'exam';
  start_date?: string;
  end_date?: string;
  cancels_regular_classes?: boolean;
  subject_ids?: string[];
  subject_components?: ExamSubjectComponentSelection[];
}

export interface TimetableOverride {
  id: string;
  semester_id: string;
  subject_id: string;
  override_type: 'cancelled' | 'extra' | 'rescheduled';
  timetable_slot_id: string | null;
  original_date: string | null;
  target_date: string;
  start_time: string;
  end_time: string;
  note: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TimetableOverrideCreate {
  subject_id: string;
  override_type: 'cancelled' | 'extra' | 'rescheduled';
  target_date: string;
  start_time: string;
  end_time: string;
  timetable_slot_id?: string | null;
  original_date?: string | null;
  note?: string | null;
}

export interface LectureAttendance {
  id: string;
  semester_id: string;
  subject_id: string;
  timetable_slot_id: string | null;
  override_id: string | null;
  lecture_date: string;
  start_time: string;
  end_time: string;
  status: 'attended' | 'missed' | 'class_cancelled';
  created_at: string;
  updated_at: string | null;
}

export interface AttendanceMetrics {
  attended: number;
  missed: number;
  held: number;
  cancelled: number;
  target_percentage: number;
  percentage: number | null;
  is_at_or_above_target: boolean;
  classes_to_attend: number | null;
  classes_can_miss: number | null;
  impossible_to_reach_target: boolean;
}

export interface LectureOccurrence {
  lecture_date: string;
  start_time: string;
  end_time: string;
  subject_id: string;
  occurrence_type: 'regular' | 'extra' | 'rescheduled' | 'historical';
  is_cancelled: boolean;
  cancellation_reason?: string | null;
  timetable_slot_id?: string | null;
  override_id?: string | null;
  attendance_id?: string | null;
  attendance_status?: 'attended' | 'missed' | 'class_cancelled' | null;
}

export type AssessmentPatternCategory =
  | 'internal_test'
  | 'assignment'
  | 'quiz'
  | 'practical'
  | 'viva'
  | 'project'
  | 'midsem'
  | 'endsem'
  | 'other';

export interface AssessmentPatternComponent {
  id: string;
  pattern_id: string;
  name: string;
  category: AssessmentPatternCategory;
  max_marks: number;
  weightage: number;
  is_active: boolean;
  order_index: number;
  created_at: string;
  updated_at: string | null;
}

export type AssessmentPatternComponentResponse = AssessmentPatternComponent;

export interface AssessmentPattern {
  id: string;
  subject_id: string;
  name: string;
  is_active: boolean;
  components: AssessmentPatternComponent[];
  created_at: string;
  updated_at: string | null;
}

export type AssessmentPatternResponse = AssessmentPattern;

