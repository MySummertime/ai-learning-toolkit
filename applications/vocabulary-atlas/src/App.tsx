import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, CalendarDays, Compass, FolderOpen, Languages, PanelLeftClose, PanelLeftOpen, Pin, CircleHelp, Star, Waypoints } from 'lucide-react';
import { errorText, addToStage, bootstrap, candidate, createProject, deleteProject, graph, openFavorite, projects, updateProject, saveFavorite, saveUi, wordPage, wordSummaries, useWordlist } from './api';
import GraphView from './GraphView';
import FieldGuideArt from './FieldGuideArt';
import WordView from './WordView';
import { DictionaryPage, ProjectsPage } from './Pages';
import { StudyPage, StudyCalendarPage } from './StudyPage';
import type { Bootstrap, FavoritesState, GraphData, RelationType, Tab, UiState, WordPage } from './model';
import { relationLabels, relationTypes } from './model';

const isPreview = (tab: Tab) => (tab.kind === 'word' || tab.kind === 'candidate') && !tab.pinned;
function openedTabs(tabs: Tab[], tab: Tab) {
  if (tabs.some(item => item.tabId === tab.tabId)) return tabs;
  if (!isPreview(tab)) return [...tabs, tab];
  const index = tabs.findIndex(isPreview);
  return index < 0 ? [...tabs, tab] : tabs.flatMap((item, i) => i === index ? [tab] : isPreview(item) ? [] : [item]);
}

type SaveStatus = 'saved' | 'saving' | 'error';
type Section = 'projects' | 'graph' | 'dictionary' | 'flashcards' | 'calendar' | 'favorites';
type CandidateInfo = Awaited<ReturnType<typeof candidate>>;

function themeVariables(config: Bootstrap['config']): CSSProperties {
  return {
    '--bg': config.ui.background, '--surface': config.ui.surface, '--raised': config.ui.surfaceRaised,
    '--text': config.ui.text, '--muted': config.ui.mutedText, '--border': config.ui.border,
    '--hover': config.ui.hover, '--selected': config.ui.selected, '--disabled': config.ui.disabled,
    '--error': config.ui.error, '--success': config.ui.success, '--focus': config.controls.focus,
    '--control-active': config.controls.activeText, '--control-inactive': config.controls.inactiveText,
    '--action': config.controls.primaryAction,
    '--action-hover': config.controls.primaryActionHover,
    '--action-pressed': config.controls.primaryActionPressed,
    '--slider-track': config.controls.sliderTrack,
    '--star': config.favorites.star, '--family': config.graph.family, '--synonym': config.graph.relations.synonym,
    '--near': config.graph.relations.near_synonym, '--antonym': config.graph.relations.antonym,
    '--spelling': config.graph.relations.spelling_similar,
  } as CSSProperties;
}

function CandidateView({ lemma }: { lemma: string; onRefresh: () => void; onOpenWord: (id: string) => void }) {
  const [info, setInfo] = useState<CandidateInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; candidate(lemma).then(data => { if (live) setInfo(data); }).catch(() => { if (live) setError('单词信息加载失败，请重试。'); }); return () => { live = false; }; }, [lemma]);
  return <div className="candidate-page"><h1>{lemma}</h1>
    {!!info?.associations.length && <div className="candidate-card"><h2>已有关系</h2>{info.associations.map((item, index) => <div className="candidate-line" key={index}><strong>{item.sourceLemma}</strong><span>{relationLabels[item.type as keyof typeof relationLabels] || '关联词'}</span></div>)}</div>}
    {error && <p className="error-note" role="alert">{error}</p>}</div>;
}

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [favorites, setFavorites] = useState<FavoritesState | null>(null);
  const [deferredFavoriteRemovals, setDeferredFavoriteRemovals] = useState<FavoritesState['words']>({});
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [page, setPage] = useState<WordPage | null>(null);
  const pageCache = useRef<Record<string, WordPage>>({});
  const [graphGroup, setGraphGroup] = useState(0);
  const [lookupMode, setLookupMode] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<Section>('graph');
  const [mobilePane, setMobilePane] = useState<'graph' | 'entry'>('graph');
  const [guideOpen, setGuideOpen] = useState(false);
  const guideRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (guideOpen) guideRef.current?.showModal(); }, [guideOpen]);
  const [railCollapsed, setRailCollapsed] = useState(() => window.localStorage.getItem('vocabulary-atlas:rail-collapsed') === '1');
  const [resetToken, setResetToken] = useState(0);
  const [fitToken, setFitToken] = useState(0);
  const [showOthers, setShowOthers] = useState(false);
  const [showOutside, setShowOutside] = useState(false);
  const [notice, setNotice] = useState('');
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [loadingError, setLoadingError] = useState('');
  const uiRef = useRef<UiState | null>(null);
  const savedUiRef = useRef<UiState | null>(null);
  const candidateParents = useRef<Record<string, string>>({});
  const uiQueue = useRef(Promise.resolve());
  const favoritesRef = useRef<FavoritesState | null>(null);
  const draggedTab = useRef<string | null>(null);
  const [splitDrag, setSplitDrag] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});

  const refresh = useCallback(() => {
    const startedUi = uiRef.current;
    return bootstrap().then(data => {
    if (!Array.isArray(data.projects) || !data.ui?.activeProjectId) {
      throw new Error('当前词汇图谱服务仍在运行旧版代码；请停止旧服务并重新启动应用。');
    }
    setBoot(data);
    if (!startedUi && !data.projects.find(project => project.projectId === data.ui.activeProjectId)?.words.length) setSection('projects');
    if (!startedUi || uiRef.current === startedUi) {
      const previews = data.ui.tabs.filter(isPreview);
      const keep = previews.find(tab => tab.tabId === data.ui.activeTabId) || previews[previews.length - 1];
      data.ui.tabs = data.ui.tabs.filter(tab => !isPreview(tab) || tab === keep);
      setUi(data.ui); uiRef.current = data.ui; savedUiRef.current = data.ui;
      setSelected(data.ui.tabs.find(tab => tab.tabId === data.ui.activeTabId)?.wordId || null);
    }
    setFavorites(data.favorites); favoritesRef.current = data.favorites;
    pageCache.current = {};
    setLoadingError('');
    void projects().then(items => setBoot(current => current ? { ...current, projects: items } : current))
      .catch(exc => setNotice(errorText(exc)));
  }).catch(exc => setLoadingError(errorText(exc)));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (section !== 'favorites' && !(section === 'graph' && ui?.activeTabId === 'favorites')) setDeferredFavoriteRemovals({});
  }, [ui?.activeTabId, section]);
  const saveFailure = (message: string, exc: unknown, retry: () => void) => {
    const detail = errorText(exc);
    const hasConflict = detail.includes('版本冲突');
    setNotice(`${message}：${detail}`);
    setConflict(hasConflict);
    setRetryAction(() => hasConflict ? () => { void refresh(); } : retry);
    setSaveStatus('error');
  };
  useEffect(() => {
    if (!ui) return;
    let live = true;
    if (section === 'projects' || section === 'dictionary') return;
    const project = section === 'graph' && ui.activeTabId !== 'favorites' ? ui.activeProjectId : undefined;
    wordSummaries(ui.activeStageId, project).then(words => { if (live) setBoot(current => current ? { ...current, words } : current); }).catch(exc => { if (live) setNotice(errorText(exc)); });
    return () => { live = false; };
  }, [ui?.activeStageId, ui?.activeProjectId, ui?.activeTabId, section]);
  useEffect(() => { if (section === 'graph' && boot?.config.graph.initializeOnEnter) setFitToken(value => value + 1); }, [section, boot?.config.graph.initializeOnEnter, ui?.activeProjectId]);

  const commitUi = useCallback((transform: (current: UiState) => UiState) => {
    if (!uiRef.current) return;
    const next = transform(uiRef.current);
    uiRef.current = next; setUi(next); setSaveStatus('saving');
    uiQueue.current = uiQueue.current.then(async () => {
      const draft = uiRef.current!;
      let base = savedUiRef.current!;
      let saved: UiState | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { saved = await saveUi(transform(base), base.revision); break; }
        catch (exc) {
          if (!String(exc).includes('版本冲突') || attempt === 2) throw exc;
          base = (await bootstrap()).ui;
        }
      }
      if (!saved) throw new Error('界面状态未保存');
      savedUiRef.current = saved;
      if (uiRef.current === draft) { uiRef.current = saved; setUi(saved); setSaveStatus('saved'); }
    }).catch(exc => { saveFailure('界面状态未保存', exc, () => commitUi(current => ({ ...current }))); });
  }, []);
  useEffect(() => {
    if (!boot || section !== 'graph' || !uiRef.current) return;
    // 每次进入图谱默认只显示同族关系；用户可单选切换。
    if (relationTypes.some(kind => uiRef.current!.graph.visibleRelations[kind] !== (kind === 'family'))) {
      commitUi(current => ({ ...current, graph: { ...current.graph,
        visibleRelations: Object.fromEntries(relationTypes.map(kind => [kind, kind === 'family'])) as UiState['graph']['visibleRelations'] } }));
    }
  }, [section, !!boot, ui?.activeProjectId, commitUi]);
  const activeTab = ui?.tabs.find(tab => tab.tabId === ui.activeTabId) || ui?.tabs[0];
  useLayoutEffect(() => {
    if (!activeTab || !contentScrollRef.current) return;
    if (activeTab.kind === 'word' && page?.entry.wordId !== activeTab.wordId) return;
    contentScrollRef.current.scrollTop = scrollPositions.current[activeTab.tabId] || 0;
  }, [activeTab?.tabId, page?.entry.wordId]);
  const activeWordId = activeTab?.kind === 'word' ? activeTab.wordId : null;
  useEffect(() => {
    if (!activeWordId || !ui) { setPage(null); return; }
    const key = `${ui.activeStageId}:${activeWordId}`;
    if (pageCache.current[key]) { setPage(pageCache.current[key]); return; }
    setPage(null);
    let live = true;
    wordPage(activeWordId, ui.activeStageId).then(data => { if (live) { pageCache.current[key] = data; setPage(data); } }).catch(exc => { if (live) setNotice(errorText(exc)); });
    return () => { live = false; };
  }, [activeWordId, ui?.activeStageId]);

  useEffect(() => {
    if (!ui || section !== 'graph') return;
    const params = new URLSearchParams({ offset: String(graphGroup * (boot?.config.graph.browsing.wordlistGroupSize || 1)), stage: ui.activeStageId, project: ui.activeProjectId, others: showOthers ? '1' : '0', outside: showOutside ? '1' : '0', search });
    if (selected) params.set('selected', selected);
    relationTypes.forEach(kind => params.set(kind, ui.graph.visibleRelations[kind] ? '1' : '0'));
    let live = true;
    graph(params).then(data => { if (live) setGraphData(data); }).catch(exc => { if (live) setNotice(errorText(exc)); });
    return () => { live = false; };
  }, [ui?.activeStageId, ui?.activeProjectId, ui?.graph.visibleRelations, selected, showOthers, showOutside, search, section, graphGroup, boot?.config.graph.browsing.wordlistGroupSize]);

  useEffect(() => {
    if (!splitDrag) return;
    const move = (event: MouseEvent) => {
      if (!shellRef.current) return;
      const bounds = shellRef.current.getBoundingClientRect();
      const minRightWidth = 360;
      const minLeftWidth = Math.min(320, Math.max(160, bounds.width * 0.25));
      const maxLeftWidth = Math.max(minLeftWidth, bounds.width - minRightWidth - 8);
      const leftWidth = Math.min(maxLeftWidth, Math.max(minLeftWidth, event.clientX - bounds.left));
      const value = (leftWidth / bounds.width) * 100;
      if (uiRef.current) { const draft = { ...uiRef.current, split: { ...uiRef.current.split, leftWidthPercent: value } }; uiRef.current = draft; setUi(draft); }
    };
    const up = () => {
      const width = uiRef.current?.split.leftWidthPercent;
      setSplitDrag(false);
      if (width !== undefined) commitUi(current => ({ ...current, split: { ...current.split, leftWidthPercent: width } }));
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [splitDrag, commitUi]);

  const returnToGraph = useCallback(() => {
    setLookupMode(false); setSection('graph'); setMobilePane('graph'); setSelected(null); setShowOthers(false); setSearch('');
    commitUi(current => ({ ...current, activeTabId: 'graph' }));
  }, [commitUi]);
  const returnToParent = useCallback((tab?: Tab) => {
    if (!tab || tab.kind !== 'candidate') { returnToGraph(); return; }
    const parentId = candidateParents.current[tab.tabId] || 'graph';
    const parent = uiRef.current?.tabs.find(item => item.tabId === parentId);
    if (!parent || parent.kind === 'graph') { returnToGraph(); return; }
    setSection('graph'); setMobilePane('entry'); setSelected(parent.wordId); setShowOthers(false); setLookupMode(false);
    commitUi(current => ({ ...current, activeTabId: parent.tabId,
      split: { ...current.split, enabled: parent.kind === 'word' || parent.kind === 'candidate' } }));
  }, [commitUi, returnToGraph]);
  const activateTab = (tab: Tab) => {
    if (tab.kind === 'graph') { returnToGraph(); return; }
    setSelected(tab.wordId); setShowOthers(false); setMobilePane('entry');
    commitUi(current => ({ ...current, activeTabId: tab.tabId }));
  };

  const openTab = (tab: Tab) => commitUi(current => {
    const tabs = openedTabs(current.tabs, tab);
    return { ...current, tabs, activeTabId: tab.tabId, split: { ...current.split, enabled: tab.kind !== 'graph' ? current.split.enabled : false } };
  });
  const openWord = (id: string, projectId?: string) => {
    setSection('graph'); setMobilePane('entry');
    setSelected(id); setShowOthers(false);
    commitUi(current => {
      const tab: Tab = { tabId: `word:${id}`, kind: 'word', wordId: id, lemma: null, pinned: false };
      return { ...current, activeProjectId: projectId || current.activeProjectId,
        tabs: openedTabs(current.tabs, tab),
        activeTabId: tab.tabId, split: { ...current.split, enabled: true },
        graph: { ...current.graph, zoomPercent: Math.max(125, current.graph.zoomPercent) } };
    });
    const current = favoritesRef.current;
    if (current?.words[id]) openFavorite(id, current.revision).then(result => { favoritesRef.current = result; setFavorites(result); }).catch(exc => saveFailure('最后打开时间未保存', exc, () => openWord(id, projectId)));
  };
  const openCandidate = (lemma: string, projectId?: string) => { setSection('graph'); setMobilePane('entry');
    const nodeId = graphData?.nodes.find(node => node.lemma.toLowerCase() === lemma.toLowerCase())?.wordId || null;
    if (nodeId) { setSelected(nodeId); setShowOthers(false); }
    const tabId = `candidate:${lemma}`;
    const parentId = uiRef.current?.activeTabId || 'graph';
    if (parentId !== tabId) candidateParents.current[tabId] = parentId;
    commitUi(current => {
      const previous = current.tabs.find(item => item.tabId === tabId);
      const tab: Tab = { tabId, kind: 'candidate', wordId: nodeId, lemma, pinned: previous?.pinned || false };
      const tabs = current.tabs.filter(item => !isPreview(item) || item.tabId === parentId || item.tabId === tabId);
      const nextTabs = tabs.some(item => item.tabId === tabId)
        ? tabs.map(item => item.tabId === tabId ? tab : item)
        : [...tabs, tab];
      return { ...current, activeProjectId: projectId || current.activeProjectId, tabs: nextTabs, activeTabId: tabId,
        split: { ...current.split, enabled: true } };
    });
  };
  const openLookup = (id: string) => {
    setLookupMode(true); setSelected(id); setShowOthers(false); setSearch('');
    setSection('graph'); setMobilePane('graph');
    commitUi(current => ({ ...current, activeTabId: 'graph', split: { ...current.split, enabled: false } }));
  };
  const closeTab = (id: string) => commitUi(current => {
    const tab = current.tabs.find(item => item.tabId === id);
    if (!tab || tab.pinned) return current;
    const tabs = current.tabs.filter(item => item.tabId !== id);
    return { ...current, tabs, activeTabId: current.activeTabId === id ? tabs[tabs.length - 1].tabId : current.activeTabId };
  });
  const togglePin = (id: string) => commitUi(current => {
    const target = current.tabs.find(tab => tab.tabId === id);
    if (!target || id === 'graph') return current;
    const changed = { ...target, pinned: !target.pinned };
    const tabs = current.tabs.flatMap(tab => tab.tabId === id ? [changed] : isPreview(changed) && isPreview(tab) ? [] : [tab]);
    return { ...current, tabs, activeTabId: tabs.some(tab => tab.tabId === current.activeTabId) ? current.activeTabId : id };
  });
  const reorderTab = (target: string) => {
    const source = draggedTab.current;
    if (!source || source === target || source === 'graph' || target === 'graph') return;
    commitUi(current => {
      const tabs = current.tabs.slice();
      const from = tabs.findIndex(item => item.tabId === source), to = tabs.findIndex(item => item.tabId === target);
      if (from < 0 || to < 0) return current;
      tabs.splice(to, 0, tabs.splice(from, 1)[0]);
      return { ...current, tabs };
    });
    draggedTab.current = null;
  };
  const toggleFavorite = async (id: string) => {
    const current = favoritesRef.current;
    if (!current) return;
    const next = !current.words[id];
    try {
      const saved = await saveFavorite(id, next, current.revision);
      favoritesRef.current = saved; setFavorites(saved);
      if (uiRef.current?.activeTabId === 'favorites') {
        setDeferredFavoriteRemovals(previous => {
          const nextDeferred = { ...previous };
          if (next) delete nextDeferred[id];
          else if (current.words[id]) nextDeferred[id] = current.words[id];
          return nextDeferred;
        });
      }
    }
    catch (exc) { saveFailure('收藏未保存', exc, () => { void toggleFavorite(id); }); }
  };
  const includeInStage = async (id: string) => {
    if (!ui || !boot || ui.activeStageId === 'all') return;
    const stage = boot.stages.find(item => item.stageId === ui.activeStageId);
    if (!stage) return;
    setSaveStatus('saving');
    try {
      await addToStage(stage.stageId, id, stage.revision);
      await refresh();
      const updated = await wordPage(id, stage.stageId);
      pageCache.current[`${stage.stageId}:${id}`] = updated;
      setPage(updated);
      setSaveStatus('saved');
    } catch (exc) { saveFailure('加入学龄段未保存', exc, () => { void includeInStage(id); }); }
  };
  const updateGraph = (change: Partial<UiState['graph']>) => commitUi(current => ({ ...current, graph: { ...current.graph, ...change } }));
  const toggleRelation = (kind: RelationType) => commitUi(current => ({ ...current, graph: { ...current.graph,
    visibleRelations: Object.fromEntries(relationTypes.map(type => [type, type === kind])) as UiState['graph']['visibleRelations'] } }));
  const selectNode = (id: string | null) => {
    if (!id) { returnToGraph(); return; }
    openWord(id);
  };
  const zoom = (value: number) => updateGraph({ zoomPercent: Math.min(400, Math.max(25, Math.round(value / 5) * 5)) });
  const setPositions = (positions: Record<string, { x: number; y: number }>) => commitUi(current => ({ ...current, graph: { ...current.graph,
    positions: { ...current.graph.positions, ...positions } } }));
  const switchProject = (id: string) => { setGraphGroup(0); setLookupMode(false); setSearch(''); setSelected(null); setShowOthers(false); setGraphData(null); setSection('graph'); commitUi(current => ({ ...current, activeProjectId: id, activeTabId: 'graph' })); };
  const addProject = async (name: string, content: string, format: string) => {
    const created = await createProject(name, content, format);
    await refresh();
    switchProject(created.projectId);
  };
  const saveProject = async (project: Bootstrap['projects'][number], name: string, content: string, replan: boolean) => {
    const updated = await updateProject(project.projectId, name, content, project.revision, replan);
    setBoot(current => current ? { ...current, projects: current.projects.map(item => item.projectId === updated.projectId ? updated : item) } : current);
    if (project.projectId === uiRef.current?.activeProjectId) setGraphData(null);
  };
  const removeProject = async (project: Bootstrap['projects'][number]) => {
    await deleteProject(project.projectId, project.revision);
    await refresh();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editing = event.target instanceof HTMLElement && !!event.target.closest('input, textarea, select, [contenteditable="true"], dialog');
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'Backslash') {
        event.preventDefault();
        setRailCollapsed(value => { const next = !value; window.localStorage.setItem('vocabulary-atlas:rail-collapsed', next ? '1' : '0'); return next; });
        return;
      }
      if (event.key === 'Escape' && !editing) {
        const active = uiRef.current?.tabs.find(tab => tab.tabId === uiRef.current?.activeTabId);
        active?.kind === 'candidate' ? returnToParent(active) : returnToGraph();
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [returnToGraph, returnToParent]);

  if (!boot || !ui || !favorites) return <div className="loading-screen"><FieldGuideArt /><h1>探索手册</h1><p role="status">正在打开词表…</p>{loadingError && <><p className="error-note" role="alert">{loadingError}</p><button type="button" onClick={refresh}>重试连接</button></>}</div>;
  const graphProject = boot.projects.find(project => project.projectId === ui.activeProjectId);
  const favoriteStamps = { ...favorites.words, ...deferredFavoriteRemovals };
  const favoriteItems = Object.entries(favoriteStamps).sort((a, b) => b[1].favoritedAt.localeCompare(a[1].favoritedAt));
  const graphGroupSize = boot.config.graph.browsing.wordlistGroupSize;
  const graphGroupCount = Math.max(1, Math.ceil((graphProject?.words.filter(row => row.lemma.toLowerCase().includes(search.trim().toLowerCase())).length || 0) / graphGroupSize));
  const graphView = <GraphView lookupMode={lookupMode} groupIndex={graphGroup} groupCount={graphGroupCount} onGroupChange={index => { setGraphGroup(index); setResetToken(value => value + 1); }} key={ui.activeProjectId} data={graphData} theme={boot.config} selected={selected} zoom={ui.graph.zoomPercent} positions={ui.graph.positions}
    visible={ui.graph.visibleRelations} search={search} showOthers={showOthers} showOutside={showOutside} stageId={ui.activeStageId}
    onReturnToGraph={returnToGraph} onOpenProjects={() => setSection('projects')} onSearch={value => { setSearch(value); setGraphGroup(0); }} onSelect={selectNode} onToggle={toggleRelation} onShowOthers={() => setShowOthers(!showOthers)}
    onOpenCandidate={openCandidate} onShowOutside={() => setShowOutside(!showOutside)} onZoom={zoom} onPositions={setPositions}
    resetToken={resetToken} fitToken={fitToken} onInitialize={() => setResetToken(value => value + 1)} />;
  const railActiveSection = section === 'graph' && activeTab?.kind === 'favorites' ? 'favorites' : section;
  const sidebarShortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘ + \\' : 'Ctrl + \\';
  const content = activeTab?.kind === 'word' && page && page.entry.wordId === activeTab.wordId ? <WordView page={page}
    favorited={!!favorites.words[page.entry.wordId]}
    onFavorite={() => toggleFavorite(page.entry.wordId)} onOpenWord={openWord} onOpenCandidate={openCandidate}
    onAddToStage={() => includeInStage(page.entry.wordId)} />
    : activeTab?.kind === 'favorites' ? <div className="utility-page"><h1>收藏夹</h1>
      <div className="favorite-list">{favoriteItems.map(([id, stamp]) => {
        const item = boot.words.find(word => word.wordId === id);
        if (!item) return null;
        const favorited = !!favorites.words[id];
        return <div key={id} className="favorite-row"><button type="button" className={`favorite-glyph ${favorited ? 'is-favorite' : ''}`} aria-label={favorited ? `取消收藏 ${item.lemma}` : `收藏 ${item.lemma}`} aria-pressed={favorited} onClick={() => { void toggleFavorite(id); }}>★</button><button type="button" className="favorite-word" onClick={() => openWord(id)}><strong>{item.lemma}</strong><small>{item.core.map(s => s.text).join('；') || '释义待完善'}</small><small>{item.more.map(s => s.text).join('；')}</small></button><span className="favorite-times">收藏 {stamp.favoritedAt.slice(0, 10)}<br />上次打开 {stamp.lastOpenedAt.slice(0, 10)}</span><button type="button" className="favorite-open" aria-label={`打开 ${item.lemma}`} onClick={() => openWord(id)}>↗</button></div>;
      })}{!favoriteItems.length && <div className="empty-content">收藏夹还是空的。打开一个单词，点击词头旁的星标，就能把它留在这里。</div>}</div></div>
    : activeTab?.kind === 'candidate' && activeTab.lemma ? <CandidateView lemma={activeTab.lemma} onRefresh={refresh} onOpenWord={openWord} />
    : activeTab?.kind === 'graph' ? <div className="welcome-pane"><FieldGuideArt /><h1>选一个词，开始看。</h1><p>点地图上的单词，查看释义、例句和相关词。</p><div className="welcome-stats"><strong>{boot.words.length}</strong><span>个已入库词条</span></div></div> : <div className="empty-content" role="status">正在打开词条…</div>;

  return <div className="app-shell" style={themeVariables(boot.config)}>
    <div className="app-body"><nav className={`page-rail ${railCollapsed ? 'is-collapsed' : 'is-expanded'}`} aria-label="页面切换">
      <div className="rail-brand"><span className="brand-seal" aria-hidden="true"><Compass size={22} strokeWidth={1.8} /></span><span className="rail-brand-text"><strong>探索手册</strong><small>VOCABULARY ATLAS</small></span></div>
      <button type="button" className="rail-toggle" title={`${railCollapsed ? '展开侧栏' : '收起侧栏'}（${sidebarShortcut}）`} aria-label={`${railCollapsed ? '展开侧栏' : '收起侧栏'}，快捷键 ${sidebarShortcut}`} aria-expanded={!railCollapsed} onClick={() => {
        const next = !railCollapsed; setRailCollapsed(next); window.localStorage.setItem('vocabulary-atlas:rail-collapsed', next ? '1' : '0');
      }}>{railCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}<span>{railCollapsed ? '展开侧栏' : '收起侧栏'}</span></button>
      {([
        ['projects', FolderOpen, '词表'], ['graph', Waypoints, '词汇地图'],
        ['dictionary', Languages, '词典'], ['flashcards', BookOpen, '背单词'],
        ['calendar', CalendarDays, '日历'], ['favorites', Star, '收藏夹'],
      ] as const).map(([id, Icon, label]) => <button key={id} type="button" title={label} aria-label={label} aria-current={railActiveSection === id ? 'page' : undefined}
        className={railActiveSection === id ? 'active' : ''} onClick={() => {
          if (id === 'graph') returnToGraph();
          else if (id === 'favorites') { openTab({ tabId: 'favorites', kind: 'favorites', wordId: null, lemma: null, pinned: false }); setMobilePane('entry'); setSection('graph'); }
          else setSection(id);
        }}><Icon size={19} /><span>{label}</span></button>)}
      <button type="button" className="rail-help" title="使用帮助" aria-label="使用帮助" onClick={() => setGuideOpen(true)}><CircleHelp size={19} /><span>使用帮助</span></button>
    </nav><div className="app-main">{section === 'graph' ? <>
    <div className="tab-bar" role="tablist">{ui.tabs.map(tab => <div key={tab.tabId} role="tab" aria-selected={ui.activeTabId === tab.tabId} tabIndex={0}
      className={`tab ${ui.activeTabId === tab.tabId ? 'active' : ''}`} draggable={tab.tabId !== 'graph'} onDragStart={() => { draggedTab.current = tab.tabId; }} onDragOver={event => event.preventDefault()} onDrop={() => reorderTab(tab.tabId)}
      onDoubleClick={() => { if (isPreview(tab)) togglePin(tab.tabId); }} onClick={() => activateTab(tab)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateTab(tab); } }}>
      <span className="tab-icon">{tab.kind === 'graph' ? '◉' : tab.kind === 'favorites' ? '★' : '◌'}</span>
      <span>{tab.kind === 'graph' ? '词汇地图' : tab.kind === 'favorites' ? '收藏夹' : tab.kind === 'word' ? boot.words.find(w => w.wordId === tab.wordId)?.lemma || '单词' : tab.lemma}</span>
      {tab.tabId === 'graph' ? <span className="pin"><Pin size={13} fill="currentColor" /></span> : <><button type="button" className={`tab-pin ${tab.pinned ? 'is-pinned' : ''}`} aria-label={tab.pinned ? '取消固定标签' : '固定标签'} title={tab.pinned ? '取消固定' : '固定标签'} aria-pressed={tab.pinned} onClick={event => { event.stopPropagation(); togglePin(tab.tabId); }}><Pin size={14} fill={tab.pinned ? 'currentColor' : 'none'} /></button>
        {!tab.pinned && <button type="button" aria-label="关闭标签" onClick={event => { event.stopPropagation(); closeTab(tab.tabId); }}>×</button>}</>}</div>)}
      <span className={`save-state ${saveStatus}`}>{saveStatus === 'saved' ? '✓ 已保存' : saveStatus === 'saving' ? '◌ 保存中' : '! 未保存'}</span></div>
    {activeTab?.kind !== 'graph' && activeTab?.kind !== 'favorites' && <div className="mobile-pane-switch" role="group" aria-label="窄屏视图切换"><button type="button" aria-pressed={mobilePane === 'graph'} onClick={() => setMobilePane('graph')}>词汇地图</button><button type="button" aria-pressed={mobilePane === 'entry'} onClick={() => setMobilePane('entry')}>{activeTab?.kind === 'word' ? '单词条目' : activeTab?.kind === 'candidate' ? '待完善词条' : '收藏夹'}</button></div>}
    {activeTab?.kind === 'favorites' ? <main className="favorites-workspace"><div className="content-scroll" ref={contentScrollRef}>{content}</div></main> : <main ref={shellRef} data-mobile-pane={mobilePane} className={`workspace ${ui.split.enabled && activeTab?.kind !== 'graph' ? 'is-split' : 'graph-only'}`}>
      <div className="workspace-left" style={{ width: ui.split.enabled && activeTab?.kind !== 'graph' ? `${ui.split.leftWidthPercent}%` : '100%', flexBasis: ui.split.enabled && activeTab?.kind !== 'graph' ? `${ui.split.leftWidthPercent}%` : '100%', flexShrink: ui.split.enabled && activeTab?.kind !== 'graph' ? 0 : 1 }}>{graphView}</div>
      {ui.split.enabled && activeTab?.kind !== 'graph' && <div className="split-handle" role="separator" aria-orientation="vertical" aria-label="调整分屏宽度" onMouseDown={() => setSplitDrag(true)} />}
      {activeTab?.kind !== 'graph' && <div className={`workspace-right ${ui.split.enabled ? '' : 'independent'}`}>
        <div className="pane-actions"><button type="button" onClick={() => activeTab?.kind === 'word' ? returnToGraph() : returnToParent(activeTab)}>← 返回</button><span>{activeTab?.kind === 'word' ? '单词笔记' : activeTab?.kind === 'candidate' ? '关联词' : '收藏夹'}</span><button type="button" onClick={() => commitUi(current => ({ ...current, split: { ...current.split, enabled: !current.split.enabled } }))}>{ui.split.enabled ? '独立显示 ↗' : '返回分屏 ↙'}</button></div>
        <div className="content-scroll" ref={contentScrollRef} onScroll={event => { if (activeTab && (activeTab.kind !== 'word' || page?.entry.wordId === activeTab.wordId)) scrollPositions.current[activeTab.tabId] = event.currentTarget.scrollTop; }}>{content}</div></div>}
    </main>}</> : <div className="section-host">
      {section === 'projects' ? <ProjectsPage projects={boot.projects} activeId={ui.activeProjectId} onSelect={switchProject} onCreate={addProject} onSave={saveProject} onDelete={removeProject} onUseWordlist={async file => { const project = await useWordlist(file); await refresh(); switchProject(project.projectId); }} /> :
       section === 'dictionary' ? <DictionaryPage activeProjectId={ui.activeProjectId} onOpenWord={openLookup} onOpenCandidate={(_lemma, id) => openLookup(id)} /> :
       section === 'calendar' ? <StudyCalendarPage projects={boot.projects} words={boot.words} /> :
       section === 'favorites' ? content :
       <StudyPage projects={boot.projects} words={boot.words} activeProjectId={ui.activeProjectId} favorites={favorites} pageSize={ui.study.pageSize ?? boot.config.study.wordsPerPage} pageSizeOptions={boot.config.study.pageSizeOptions || [boot.config.study.wordsPerPage]} onPageSizeChange={pageSize => commitUi(current => ({ ...current, study: { ...current.study, pageSize } }))}
         tabs={ui.study.openPlanIds} active={ui.study.activeTabId} onTabsChange={(tabs, active) => commitUi(current => ({ ...current, study: { openPlanIds: tabs, activeTabId: active } }))}
         onFavorite={id => { void toggleFavorite(id); }} onOpenWord={openWord} onOpenCandidate={openCandidate} />}
    </div>}</div></div>
    {guideOpen && <dialog ref={guideRef} className="onboarding-dialog" aria-label="使用帮助" onCancel={event => { event.preventDefault(); setGuideOpen(false); }}><header><h2>从哪里开始？</h2><button type="button" aria-label="关闭使用帮助" onClick={() => setGuideOpen(false)}>×</button></header><p>先选词表，再看词，最后开始练习。</p>{([['projects', '1. 选词表', '选内置词表，或导入自己的单词。'], ['graph', '2. 看单词', '点地图上的单词看详情；拖动移动，滚动缩放。'], ['flashcards', '3. 去练习', '点“开始背单词”，就能练今天的词。']] as const).map(([section, title, description]) => <button type="button" className="onboarding-step" key={section} onClick={() => { setSection(section); setGuideOpen(false); }}><strong>{title}</strong><span>{description}</span><small>打开 →</small></button>)}<p className="shortcut-note">快捷键：{sidebarShortcut} 展开或收起侧栏；Esc 返回地图。</p></dialog>}
    {notice && <div className="toast" role="alert"><span>{notice}</span><button type="button" onClick={() => { setNotice(''); if (saveStatus === 'error') retryAction?.(); }}>{saveStatus === 'error' ? conflict ? '重新载入' : '重试保存' : '关闭'}</button></div>}
  </div>;
}
