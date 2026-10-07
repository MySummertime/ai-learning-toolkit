import type { Bootstrap, FavoritesState, GraphData, Project, SearchHit, StudyDay, StudyPlan, UiState, WordPage, WordSummary } from './model';

export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/, '').replace(/详细原因已记录在服务日志中。?/, '').trim();
}

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('连接失败，请启动服务后重试。'); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('内容加载失败，请刷新页面重试。'); }
  if (!response.ok) {
    if (response.status === 404 && path.startsWith('/api/wordlists')) {
      throw new Error('词表加载失败。请重启服务，然后点击“重试加载词表”。');
    }
    const message = (data as { error?: unknown })?.error;
    throw new Error(typeof message === 'string' && !message.startsWith('/api/') ? message : '操作未完成，请刷新后重试。');
  }
  return data as T;
}
export const bootstrap = () => request<Bootstrap>('/api/bootstrap');
export const projects = () => request<Project[]>('/api/projects');
export const wordPage = (id: string, stage: string) => request<WordPage>(`/api/words/${encodeURIComponent(id)}?stage=${encodeURIComponent(stage)}`);
export const wordSummaries = (stage: string, project?: string) => request<WordSummary[]>(`/api/words?stage=${encodeURIComponent(stage)}${project ? `&project=${encodeURIComponent(project)}` : ''}`);
export const graph = (params: URLSearchParams) => request<GraphData>(`/api/graph?${params}`);
export const createProject = (name: string, content: string, format: string) => request<Project>('/api/projects', 'POST', { name, content, format });
export const renameProject = (id: string, name: string, expectedRevision: number) => request<Project>(`/api/projects/${id}`, 'PUT', { name, expectedRevision });
export const updateProject = (id: string, name: string, content: string, expectedRevision: number, replan?: boolean) => request<Project>(`/api/projects/${id}`, 'PUT', { name, content, expectedRevision, replan });
export const deleteProject = (id: string, expectedRevision: number) => request<{ deleted: boolean }>(`/api/projects/${id}`, 'DELETE', { expectedRevision });
export const searchDictionary = (query: string, projectId: string) => request<SearchHit[]>(`/api/dictionary/search?q=${encodeURIComponent(query)}&project=${encodeURIComponent(projectId)}`);
export const addToStage = (stage: string, wordId: string, expectedRevision: number) => request<{ revision: number }>(`/api/stages/${encodeURIComponent(stage)}/words`, 'POST', { wordId, expectedRevision });
export const candidate = (lemma: string) => request<{ lemma: string; existingRunId?: string | null; associations: { sourceLemma: string; sourceSenseId?: string; sourceSenseText?: string; type?: string; status?: string }[] }>(`/api/candidates?lemma=${encodeURIComponent(lemma)}`);
export const saveUi = (state: UiState, expectedRevision: number) => request<UiState>('/api/state/ui', 'PUT', { state, expectedRevision });
export const saveFavorite = (id: string, favorited: boolean, expectedRevision: number) => request<FavoritesState>(`/api/favorites/${id}`, 'POST', { favorited, expectedRevision });
export const openFavorite = (id: string, expectedRevision: number) => request<FavoritesState>(`/api/favorites/${id}/opened`, 'POST', { expectedRevision });
export const startWord = (lemma: string) => request<{ jobId: string | null; runId: string | null; status: string }>('/api/runs', 'POST', { lemma });
export const jobStatus = (id: string) => request<{ jobId: string; runId: string | null; status: string; message?: string }>(`/api/jobs/${id}`);
export const runStatus = (id: string) => request<{ status: string; message: string; canResume: boolean }>(`/api/runs/${id}`);
export const resumeRun = (id: string) => request<{ jobId: string; status: string }>(`/api/runs/${id}/resume`, 'POST', {});
export const studyPlans = () => request<StudyPlan[]>('/api/plans');
export const studyToday = () => request<{ day: string }>('/api/today');
export const studyPlan = (id: string) => request<StudyPlan>(`/api/plans/${encodeURIComponent(id)}`);
export const createStudyPlan = (value: { projectId: string; name: string; method: string; startDate: string; dailyItems?: number; firstPassDays?: number }) => request<StudyPlan>('/api/plans', 'POST', value);
export const updateStudyPlan = (plan: StudyPlan, action: string, value: object = {}) => request<StudyPlan>(`/api/plans/${plan.planId}`, 'PATCH', { expectedRevision: plan.revision, action, ...value });
export const deleteStudyPlan = (plan: StudyPlan) => request<{ deleted: boolean }>(`/api/plans/${plan.planId}`, 'DELETE', { expectedRevision: plan.revision });
export const studyDate = (day: string) => request<StudyDay[]>(`/api/plans/date/${encodeURIComponent(day)}`);
export const studyPlanDay = (planId: string, day: string, pageSize: number) => request<{ day: string; wordIds: string[]; passedWordIds: string[]; newWordIds: string[]; reviewWordIds: string[] }>(`/api/plans/${encodeURIComponent(planId)}/day/${encodeURIComponent(day)}?pageSize=${pageSize}`);

export const availableWordlists = () => request<{ file: string; name: string; count: number; definitionCount?: number; source?: string }[]>('/api/wordlists');
export const useWordlist = (file: string) => request<Project>('/api/wordlists/use', 'POST', { file });
