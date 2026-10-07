import { useEffect, useRef, useState } from 'react';
import { availableWordlists, searchDictionary, studyPlans } from './api';
import type { Project, SearchHit } from './model';

export function ProjectsPage({ projects, activeId, onSelect, onCreate, onSave, onDelete, onUseWordlist }: {
  onUseWordlist: (file: string) => Promise<void>;
  projects: Project[]; activeId: string; onSelect: (id: string) => void;
  onCreate: (name: string, content: string, format: string) => Promise<void>;
  onSave: (project: Project, name: string, content: string, replan: boolean) => Promise<void>;
  onDelete: (project: Project) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'create' | 'edit' | 'replan' | 'delete' | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [preview, setPreview] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<{file: string; name: string; count: number; definitionCount?: number; source?: string}[]>([]);
  const [using, setUsing] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const loadCatalog = async () => {
    setCatalogLoading(true); setCatalogError('');
    try { setCatalog(await availableWordlists()); }
    catch (exc) { setCatalogError(exc instanceof Error ? exc.message : '词表加载失败，请重试。'); }
    finally { setCatalogLoading(false); }
  };
  useEffect(() => { void loadCatalog(); }, []);
  const chooseWordlist = async (file: string) => {
    if (using) return;
    setUsing(file); setError('');
    try { await onUseWordlist(file); } catch (exc) { setError(exc instanceof Error ? exc.message : '操作失败，请重试。'); } finally { setUsing(''); }
  };
  const [planCount, setPlanCount] = useState<Record<string, number>>({});
  useEffect(() => { setPreview(current => current ? projects.find(project => project.projectId === current.projectId) || null : null); }, [projects]);
  useEffect(() => { studyPlans().then(plans => setPlanCount(plans.reduce<Record<string, number>>((counts, plan) => {
    counts[plan.projectId] = (counts[plan.projectId] || 0) + 1; return counts;
  }, {}))).catch(exc => setError(exc instanceof Error ? exc.message : '操作失败，请重试。')); }, []);
  useEffect(() => { if (mode) dialogRef.current?.showModal(); }, [mode]);
  const close = () => { dialogRef.current?.close(); setMode(null); setError(''); };
  const openCreate = () => { setEditing(null); setName(''); setContent(''); setFile(null); setError(''); setMode('create'); };
  const openEdit = (project: Project) => { setEditing(project); setName(project.name); setContent(project.words.map(row => row.lemma).join('\n')); setError(''); setMode('edit'); };
  const save = async (replan: boolean) => {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'create') {
        const format = file?.name.toLowerCase().endsWith('.jsonl') ? 'jsonl' : file?.name.toLowerCase().endsWith('.json') ? 'json' : 'text';
        await onCreate(name.trim(), file ? await file.text() : content, format);
      } else if (editing) {
        const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
        const before = new Set(editing.words.map(row => normalize(row.lemma)));
        const after = new Set(content.split(/\r?\n/).map(normalize).filter(Boolean));
        if (mode === 'edit' && planCount[editing.projectId] && (before.size !== after.size || [...before].some(word => !after.has(word)))) {
          dialogRef.current?.close(); setMode('replan'); return;
        }
        await onSave(editing, name.trim(), content, replan);
      }
      close();
    } catch (exc) { setError(exc instanceof Error ? exc.message : '操作失败，请重试。'); }
    finally { setBusy(false); }
  };
  const remove = async () => { if (!editing || busy) return; setBusy(true); setError('');
    try { await onDelete(editing); setPreview(null); close(); } catch (exc) { setError(exc instanceof Error ? exc.message : '操作失败，请重试。'); } finally { setBusy(false); }
  };
  const myProjects = projects.filter(project => project.origin === 'user');
  return <section className="section-page projects-page"><header className="projects-heading"><div><h1>词表</h1></div><button type="button" className="primary-button" onClick={openCreate}>新建词表</button></header>
    {catalogError && <div className="notice-line" role="alert"><p>{catalogError}</p><button type="button" disabled={catalogLoading} onClick={() => void loadCatalog()}>{catalogLoading ? '正在加载…' : '重试加载词表'}</button></div>}
    <section className="builtin-wordlists" aria-label="内置词表"><h2>内置词表</h2>{catalog.length ? <div className="project-grid">{catalog.map(item => <button type="button" className="project-card" key={item.file} disabled={!!using} onClick={() => void chooseWordlist(item.file)}><strong>{item.name.replace(/\s*[·-]\s*\d+\s*$/, '')}</strong><span>{item.count} 个单词 · {item.definitionCount || 0} 个已有释义</span><span>{using === item.file ? '正在打开…' : '打开地图 →'}</span></button>)}</div> : <div className="empty-content">{catalogLoading ? '正在加载内置词表…' : catalogError ? '内置词表暂时无法加载。' : '当前没有可用的内置词表。'}</div>}</section>
    {error && !mode && <p className="error-note" role="alert">{error}</p>}
    <section aria-label="我的词表"><h2>我的词表</h2>
    <div className="projects-layout"><div className="project-grid">{myProjects.map(project => <article key={project.projectId}
      className={`project-card ${activeId === project.projectId ? 'selected' : ''}`}>
      <button type="button" className="project-settings" aria-label={`编辑${project.name}`} onClick={() => openEdit(project)}>编辑</button>
      <strong>{project.name}</strong><span>{project.words.length} 个单词</span>
      <div className="project-card-actions">
        <button type="button" className="project-preview" onClick={() => setPreview(project)}>预览</button>
        <button type="button" className="project-open" onClick={() => onSelect(project.projectId)}>打开地图 <span aria-hidden="true">↗</span></button>
      </div>
    </article>)}{!myProjects.length && <div className="empty-content">我的词表还为空；可导入词表或新建词表。</div>}</div>
    {preview && <aside className="project-preview-pane"><header><h2>{preview.name} · 单词列表</h2><button type="button" onClick={() => setPreview(null)} aria-label="关闭预览">×</button></header><p>{preview.words.length} 个单词</p><div>{preview.words.map((row, index) => <span key={row.wordId}>{index + 1}. {row.lemma}</span>)}</div></aside>}</div>
    </section>
    {mode && <dialog ref={dialogRef} className={`project-modal ${mode === 'create' ? 'create-project-modal' : ''} ${mode === 'delete' ? 'delete-project-modal' : ''}`} onCancel={event => { event.preventDefault(); close(); }}>
      <header><h2>{mode === 'create' ? '新建词表' : mode === 'edit' ? `设置 · ${editing?.name}` : mode === 'replan' ? '词表变更与背诵计划' : '确认删除词表'}</h2><button type="button" onClick={close} aria-label="关闭">×</button></header>
      {mode === 'create' && <><label>词表名<input value={name} onChange={event => setName(event.target.value)} /></label><label className="create-file-field">导入词表（TXT、JSON、JSONL）<span className="create-file-picker"><input type="file" accept=".txt,.json,.jsonl" aria-label="选择词表文件" onChange={event => setFile(event.target.files?.[0] || null)} /><span className="create-file-button">选择文件</span><span className="create-file-name">{file?.name || '未选择文件'}</span></span></label><label>或每行输入一个英文词<textarea value={content} onChange={event => setContent(event.target.value)} disabled={!!file} /></label><footer><button type="button" className="secondary-button" onClick={close}>取消</button><button type="button" className="primary-button" disabled={!name.trim() || busy} onClick={() => void save(false)}>创建词表</button></footer></>}
      {mode === 'edit' && <><label>词表名<input value={name} onChange={event => setName(event.target.value)} /></label><label>单词数<input value={new Set(content.split(/\r?\n/).map(word => word.normalize('NFKC').trim().toLowerCase()).filter(Boolean)).size} readOnly /></label><label>单词列表（每行一个英文词）<textarea value={content} onChange={event => setContent(event.target.value)} /></label><footer><button type="button" className="danger-button" disabled={!!planCount[editing?.projectId || ''] || projects.length <= 1} onClick={() => { dialogRef.current?.close(); setMode('delete'); }}>删除</button><button type="button" className="primary-button" disabled={!name.trim() || busy} onClick={() => void save(false)}>保存</button></footer>{!!planCount[editing?.projectId || ''] && <p>该词表有 {planCount[editing?.projectId || '']} 个背诵计划；请先处理计划后再删除。</p>}</>}
      {mode === 'replan' && <><p>词表内容已变化。此词表的 {planCount[editing?.projectId || ''] || 0} 个背诵计划是否重新生成排程？重新生成会清空这些计划的通过记录。</p><footer><button type="button" className="secondary-button" onClick={() => void save(false)} disabled={busy}>保留原排程</button><button type="button" className="primary-button" onClick={() => void save(true)} disabled={busy}>重新生成排程</button></footer></>}
      {mode === 'delete' && <><p>确定删除词表“{editing?.name}”吗？</p><footer><button type="button" className="secondary-button" onClick={close}>取消</button><button type="button" className="danger-button" onClick={() => void remove()} disabled={busy}>确认删除</button></footer></>}
      {error && <p role="alert" className="error-note">{error}</p>}
    </dialog>}
  </section>;
}

export function DictionaryPage({ activeProjectId, onOpenWord, onOpenCandidate }: {
  activeProjectId: string; onOpenWord: (id: string) => void; onOpenCandidate: (lemma: string, id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(!!query.trim());
    setHits([]);
    const timer = window.setTimeout(() => {
      if (!query.trim()) { setError(''); return; }
      searchDictionary(query, activeProjectId).then(result => { if (live) { setHits(result); setError(''); setLoading(false); } })
        .catch(exc => { if (live) { setError(exc instanceof Error ? exc.message : '操作失败，请重试。'); setLoading(false); } });
    }, 180);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, activeProjectId]);
  return <section className="section-page dictionary-page"><h1>词典</h1>
    <label className="dictionary-search">搜索单词<input value={query} onChange={event => setQuery(event.target.value)} placeholder="输入英文单词…" autoFocus /></label>
    {error && <p role="alert" className="error-note">{error}</p>}
    {loading && <p role="status">搜索中…</p>}
    <div className="dictionary-results">{hits.map(hit => <button type="button" key={hit.wordId} onClick={() => hit.built ? onOpenWord(hit.wordId) : onOpenCandidate(hit.lemma, hit.wordId)}>
      <strong>{hit.lemma}</strong><span>{hit.projects.length ? hit.projects.map(project => project.name).join(' · ') : '词典'}</span><small>查看词汇地图 ↗</small>
    </button>)}{query.trim() && !loading && !hits.length && !error && <div className="empty-content">没找到这个词，试试别的拼写。</div>}</div>
  </section>;
}

export function CalendarPage() {
  const today = new Date();
  const months = Array.from({ length: 25 }, (_, index) => new Date(today.getFullYear(), today.getMonth() + index - 12, 1));
  return <section className="section-page calendar-page"><span className="eyebrow">CALENDAR</span><h1>日历</h1>
    <div className="calendar-scroll">{months.map(month => {
      const year = month.getFullYear(), number = month.getMonth();
      const offset = (month.getDay() + 6) % 7;
      const days = new Date(year, number + 1, 0).getDate();
      return <div className="calendar-month" key={`${year}-${number}`}><h2>{year} 年 {number + 1} 月</h2>
        <div className="calendar-grid">{['一', '二', '三', '四', '五', '六', '日'].map(day => <strong key={day}>{day}</strong>)}
          {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
          {Array.from({ length: days }, (_, index) => <span className={year === today.getFullYear() && number === today.getMonth() && index + 1 === today.getDate() ? 'today' : ''} key={index}>{index + 1}</span>)}
        </div></div>;
    })}</div>
  </section>;
}
