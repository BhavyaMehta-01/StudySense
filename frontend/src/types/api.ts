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
  user_id: string;
  created_at: string;
  updated_at: string | null;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
  credits: number | null;
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
  created_at: string;
  updated_at: string | null;
}

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
