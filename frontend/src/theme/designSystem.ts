/**
 * StudySense Design System — Deep Focus & Precision Theme
 *
 * Centralized theme constants and CSS variable references
 * for components and data visualizations (e.g., Recharts).
 */

export const brandColors = {
  primary: '#4F46E5', // Electric Indigo
  secondary: '#06B6D4', // Focus Cyan
} as const;

export const semanticColors = {
  urgency: '#F59E0B',
  deficit: '#EF4444',
  weight: '#8B5CF6',
  success: '#10B981',
} as const;

export const chartPalette = [
  '#4F46E5', // Electric Indigo
  '#06B6D4', // Focus Cyan
  '#8B5CF6', // Coursework Weight / Violet
  '#F59E0B', // Urgency / Amber
  '#10B981', // Success / Emerald
  '#EC4899', // Pink
] as const;

export const chartColors = {
  chart1: 'var(--chart-1)',
  chart2: 'var(--chart-2)',
  chart3: 'var(--chart-3)',
  chart4: 'var(--chart-4)',
  chart5: 'var(--chart-5)',
  chart6: 'var(--chart-6)',
} as const;
