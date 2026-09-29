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
