import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  api,
  ApiError,
  subjectPatternQueryKey,
  fetchSubjectPattern,
  subjectPatternQueryOptions,
} from './client';

describe('API Client - patch helper', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('calls fetch with PATCH method and authorization header', async () => {
    localStorage.setItem('token', 'my-token');

    const mockResponse = { id: 'sem-1', is_active: true };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.patch('/semesters/sem-1/activate');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/semesters/sem-1/activate', {
      method: 'PATCH',
      body: undefined,
      headers: expect.any(Headers),
    });

    const callHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(callHeaders.get('Authorization')).toBe('Bearer my-token');
    expect(result).toEqual(mockResponse);
  });

  test('calls fetch with JSON body when data is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ updated: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.patch('/users/me', { name: 'New Name' });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
      headers: expect.any(Headers),
    });

    const callHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(callHeaders.get('Content-Type')).toBe('application/json');
  });

  test('throws ApiError on error response and dispatches auth-unauthorized on 401', async () => {
    localStorage.setItem('token', 'expired-token');

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ detail: 'Token expired' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.patch('/semesters/1/activate')).rejects.toThrow(ApiError);
    expect(localStorage.getItem('token')).toBeNull();
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth-unauthorized' }));
  });
});

describe('Assessment Pattern query helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('subjectPatternQueryKey formats key scoped to subject id', () => {
    expect(subjectPatternQueryKey('subj-123')).toEqual(['subjects', 'subj-123', 'pattern']);
  });

  test('fetchSubjectPattern fetches active pattern when present', async () => {
    localStorage.setItem('token', 'auth-token');

    const mockPattern = {
      id: 'pat-1',
      subject_id: 'subj-123',
      name: 'Standard Pattern',
      is_active: true,
      components: [
        {
          id: 'comp-1',
          pattern_id: 'pat-1',
          name: 'Midterm',
          category: 'midsem',
          max_marks: 50,
          weightage: 30,
          is_active: true,
          order_index: 0,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: null,
        },
      ],
      created_at: '2026-09-01T00:00:00Z',
      updated_at: null,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockPattern),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSubjectPattern('subj-123');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/subjects/subj-123/pattern', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    expect(result).toEqual(mockPattern);
  });

  test('fetchSubjectPattern returns null when no active pattern exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(null),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSubjectPattern('subj-456');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/subjects/subj-456/pattern', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    expect(result).toBeNull();
  });

  test('fetchSubjectPattern throws ApiError on failure without swallowing error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({ detail: 'Subject not found' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSubjectPattern('nonexistent-subj')).rejects.toThrow(ApiError);
  });

  test('subjectPatternQueryOptions constructs valid options for React Query', async () => {
    const options = subjectPatternQueryOptions('subj-789');
    expect(options.queryKey).toEqual(['subjects', 'subj-789', 'pattern']);
    expect(options.enabled).toBe(true);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(null),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await options.queryFn();
    expect(result).toBeNull();
  });
});

