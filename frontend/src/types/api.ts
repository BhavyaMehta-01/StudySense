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
