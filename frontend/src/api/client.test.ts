import { describe, test, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from './client';

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
