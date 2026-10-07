import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Volume2 } from 'lucide-react';
import type { ContentItem, Relation, Sense, WordPage } from './model';
import { relationLabels } from './model';

function marked(text: string, spans: { start: number; end: number }[] = []) {
  const chars = Array.from(text);
  if (!spans.length) return text;
  const fragments: React.ReactNode[] = [];
  let cursor = 0;
  spans.slice().sort((a, b) => a.start - b.start).forEach((span, index) => {
    if (span.start > cursor) fragments.push(chars.slice(cursor, span.start).join(''));
    fragments.push(<strong key={index}>{chars.slice(span.start, span.end).join('')}</strong>);
    cursor = span.end;
  });
  if (cursor < chars.length) fragments.push(chars.slice(cursor).join(''));
  return fragments;
}

function SourceBadge({ item }: { item: ContentItem }) {
  const label = item.generationMethod === 'ai_generated' ? 'AI 生成' : item.generationMethod === 'rule_derived' ? '规则推导' : '词典资料';
  return <span className={`source-badge ${item.generationMethod === 'ai_generated' ? 'ai' : ''}`}>{label}</span>;
}

function Sources({ item }: { item: ContentItem }) {
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!position) return;
    const closeOutside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPosition(null); trigger.current?.focus(); }
    };
    const closeOnScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) setPosition(null);
    };
    const closeOnResize = () => setPosition(null);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [position]);

  if (!item.sourceRefs?.length) return null;
  const toggle = () => {
    if (position) { setPosition(null); return; }
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const showAbove = below < 180 && above > below;
    const maxHeight = Math.min(280, Math.max(96, showAbove ? above - 8 : below - 8));
    setPosition({ left, width, maxHeight, top: showAbove ? rect.top - maxHeight - 8 : rect.bottom + 8 });
  };
  return <span className="sources">
    <button ref={trigger} type="button" className="sources-trigger" aria-expanded={!!position} aria-controls={id} onClick={toggle}>查看来源 · {item.sourceRefs.length}</button>
    {position && createPortal(<div ref={panel} id={id} className="sources-panel" style={position}>
      {item.sourceRefs.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">{({ cambridge: '剑桥词典', oxford: '牛津学习词典', longman: '朗文词典', thesaurus: '同义词词典', ecdict: 'ECDICT 英汉词典', wordnet: 'Open English WordNet' } as Record<string, string>)[source.site] || source.site}<small>{source.version && `${source.version} · `}{source.site === 'ecdict' ? '中文词义、音标与词形' : source.site === 'wordnet' ? '英文义项与词汇关系' : source.summary}</small></a>)}
    </div>, document.querySelector('.app-shell') ?? document.body)}
  </span>;
}

function Usage({ item, kind }: { item: ContentItem; kind: 'example' | 'collocation' | 'phrase' }) {
  return <div className={`usage usage-${kind}`}><div className="usage-main">
    <span className="usage-en">{kind === 'example' ? marked(item.text, item.emphasis?.en) : item.text}</span>
    {item.translationZh && <span className="usage-zh">{kind === 'example' ? marked(item.translationZh.text, item.emphasis?.zh) : item.translationZh.text}</span>}
  </div><div className="usage-meta"><SourceBadge item={item} /><Sources item={item} /></div></div>;
}

function SenseCard({ sense, index }: { sense: Sense; index: number; core: boolean }) {
  const posLabels: Record<string, string> = { adjective: '形容词', adverb: '副词', noun: '名词', verb: '动词', pronoun: '代词', preposition: '介词', conjunction: '连词', interjection: '感叹词', determiner: '限定词' };
  const zh = sense.definitionZh;
  const en = sense.definitionEn;
  const sameDefinitionStatus = zh && en && zh.generationMethod === en.generationMethod && zh.verificationStatus === en.verificationStatus && zh.confidence === en.confidence;
  const sameDefinitionSources = zh && en && JSON.stringify(zh.sourceRefs) === JSON.stringify(en.sourceRefs);
  return <article className="sense-card" id={sense.senseId}>
    <div className="sense-head"><span className="sense-number">{String(index + 1).padStart(2, '0')}</span><span className="pos">{posLabels[sense.partOfSpeech] || sense.partOfSpeech}</span>
</div>
    <h3>{(zh || en)?.text}</h3>{zh && en && <p className="definition-en">{en.text}</p>}{!zh && <p className="muted">英文义项</p>}
    <div className="sense-badges">{[...sense.grammarTags, ...sense.registerTags].map(tag => <span key={tag.itemId} className="tag-group"><span className="tag">{tag.text}</span><SourceBadge item={tag} /><Sources item={tag} /></span>)}
      {sameDefinitionStatus && sameDefinitionSources && zh ? <span className="definition-source">中英释义 <SourceBadge item={zh} /><Sources item={zh} /></span> : <>
        {zh && <span className="definition-source">中译 <SourceBadge item={zh} /><Sources item={zh} /></span>}
        {en && <span className="definition-source">英释 <SourceBadge item={en} /><Sources item={en} /></span>}</>}</div>
    {sense.examples.length > 0 && <div className="sense-section"><h4>例句</h4>{sense.examples.map(item => <Usage key={item.itemId} item={item} kind="example" />)}</div>}
    {sense.collocations.length > 0 && <div className="sense-section"><h4>搭配</h4>{sense.collocations.map(item => <Usage key={item.itemId} item={item} kind="collocation" />)}</div>}
    {sense.phrases.length > 0 && <div className="sense-section"><h4>短语与习语</h4>{sense.phrases.map(item => <Usage key={item.itemId} item={item} kind="phrase" />)}</div>}
  </article>;
}

type Props = { page: WordPage; favorited: boolean;
  onFavorite: () => void;
  onOpenWord: (id: string) => void; onOpenCandidate: (lemma: string) => void;
  onAddToStage: () => void };

export default function WordView({ page, favorited, onFavorite, onOpenWord, onOpenCandidate, onAddToStage }: Props) {
  const { entry, coreSenses, moreSenses } = page;
  const [audioAvailable, setAudioAvailable] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    setAudioAvailable({});
    for (const variety of ['uk', 'us']) {
      if (!entry.pronunciations.some(item => item.variety === variety)) continue;
      fetch(`/api/audio/${entry.wordId}/${variety}?check=1`).then(response => {
        if (active) setAudioAvailable(current => ({ ...current, [variety]: response.ok }));
      }).catch(() => { if (active) setAudioAvailable(current => ({ ...current, [variety]: false })); });
    }
    return () => { active = false; };
  }, [entry.wordId, entry.pronunciations]);
  const play = (variety: string) => {
    const audio = new Audio(`/api/audio/${entry.wordId}/${variety}`);
    audio.onerror = () => setAudioAvailable(current => ({ ...current, [variety]: false }));
    audio.play().catch(() => setAudioAvailable(current => ({ ...current, [variety]: false })));
  };
  const relations = (items: Relation[]) => items.map((relation, index) => <button key={relation.relationshipId || relation.candidateId || index}
    type="button" className="relation-pill" onClick={() => relation.targetWordId ? onOpenWord(relation.targetWordId) : relation.targetLemma && onOpenCandidate(relation.targetLemma)}>
    <span className={`relation-mark relation-${relation.proposedType === 'synonym_or_near_synonym' ? 'near_synonym' : relation.type || relation.proposedType}`} />
    <span><strong>{relation.targetLemma || relation.targetWordId || '关联词'}</strong><small>{relation.proposedType === 'synonym_or_near_synonym' ? '近义词 · 按规则分类' : relation.type && relation.type in relationLabels ? relationLabels[relation.type] : relation.proposedType || '候选关系'}</small></span><span aria-hidden="true">↗</span>
  </button>);
  return <div className="word-page">
    <div className="word-head"><h1>{entry.lemma}</h1><div className="word-head-actions"><button type="button" className={`favorite-button ${favorited ? 'is-favorite' : ''}`} aria-label={favorited ? '取消收藏' : '加入收藏夹'} aria-pressed={favorited} onClick={onFavorite}>★</button>
      </div></div>
    <div className="pronunciations">{entry.pronunciations.map(item => <div key={item.pronunciationId} className="pronunciation"><span className="ipa">/{item.ipa.text}/</span>{audioAvailable[item.variety] && <button type="button" className="audio-button" onClick={() => play(item.variety)} aria-label={`播放${item.variety === 'uk' ? '英式' : '美式'}发音`} title="播放发音"><Volume2 size={15} /></button>}{item.partOfSpeech && <span className="muted">{item.partOfSpeech}</span>}<SourceBadge item={item.ipa} /><Sources item={item.ipa} /></div>)}</div>
    {page.outsideStage && <div className="notice-line">学习分组<button type="button" onClick={onAddToStage}>加入当前学龄段</button></div>}
    {entry.dictionaryGlossZh && <section className="page-section"><div className="section-heading"><h2>中文释义</h2></div><article className="sense-card"><p style={{ whiteSpace: 'pre-line' }}>{entry.dictionaryGlossZh.text}</p><Sources item={entry.dictionaryGlossZh} /></article></section>}
    <section className="page-section"><div className="section-heading"><h2>核心释义</h2></div>
      {coreSenses.length ? coreSenses.map((sense, index) => <SenseCard key={sense.senseId} sense={sense} index={index} core />) : <div className="empty-content">单词笔记</div>}</section>
    {moreSenses.length > 0 && <section className="page-section"><div className="section-heading"><h2>更多释义</h2></div>
      {moreSenses.map((sense, index) => <SenseCard key={sense.senseId} sense={sense} index={coreSenses.length + index} core={false} />)}</section>}
    {entry.inflections.length > 0 && <section className="page-section"><div className="section-heading"><h2>词形变化</h2></div><div className="form-grid">
      {entry.inflections.map(form => <button type="button" className="relation-pill" key={form.formId} onClick={() => form.targetWordId ? onOpenWord(form.targetWordId) : onOpenCandidate(form.form.text)}><span className="relation-mark relation-family"/><span><strong>{form.form.text}</strong><small>{({past: '过去式', past_participle: '过去分词', present_participle: '现在分词', third_person_singular: '第三人称单数', comparative: '比较级', superlative: '最高级', plural: '复数'} as Record<string, string>)[form.kind] || form.kind}{form.form.generationMethod === 'rule_derived' ? ' · 规则推导' : ''}</small></span><span aria-hidden="true">↗</span></button>)}</div></section>}
    {entry.derivatives.length > 0 && <section className="page-section"><div className="section-heading"><h2>派生词</h2></div><div className="relation-grid derivative-grid">
      {entry.derivatives.map(item => <button key={item.derivativeId} type="button" className="relation-pill" onClick={() => item.targetWordId ? onOpenWord(item.targetWordId) : onOpenCandidate(item.word)}><span className="relation-mark relation-family"/><span><strong>{item.word}</strong><small>派生词</small></span><span aria-hidden="true">↗</span></button>)}</div></section>}
    {(page.relationships.length > 0 || page.pendingRelations.length > 0) && <section className="page-section"><div className="section-heading"><h2>关联词</h2></div>
      {(['synonym', 'near_synonym', 'antonym', 'spelling_similar'] as const).map(kind => { const group = [...page.relationships, ...page.pendingRelations].filter(item => (item.proposedType === 'synonym_or_near_synonym' ? 'near_synonym' : item.type || item.proposedType) === kind).sort((a, b) => (a.targetLemma || '').localeCompare(b.targetLemma || '', 'en')); return group.length ? <div className="relation-group" key={kind}><h3>{relationLabels[kind]}{kind === 'near_synonym' && entry.schemaVersion === '1.6' ? ' · 形容词' : ''}</h3><div className="relation-grid">{relations(group)}</div></div> : null; })}</section>}
  </div>;
}
