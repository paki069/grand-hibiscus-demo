'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, FileCode2, Send } from 'lucide-react'
import { LEARN_LESSONS } from '@/lib/learn-content'
import type { LearnSourceRevision } from '@/lib/learn-source'
import styles from './LearnCenter.module.css'

type ChatMessage = { role: 'user' | 'assistant'; content: string }
type SourceResult = { path: string; content: string; revision: LearnSourceRevision }

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'Hi, I’m Hibi. Ask me about this lesson, a project file, or an error you copied from your terminal. Please remove passwords, API keys, and guest or personal information before sharing anything.',
}

export default function LearnCenter({ revision }: { revision: LearnSourceRevision }) {
  const [lessonIndex, setLessonIndex] = useState(0)
  const [selectedSourcePath, setSelectedSourcePath] = useState<string | null>(null)
  const [sourceResult, setSourceResult] = useState<SourceResult | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  const [draft, setDraft] = useState('')
  const [chatError, setChatError] = useState('')
  const [sending, setSending] = useState(false)
  const [hibiOpen, setHibiOpen] = useState(false)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const questionRef = useRef<HTMLTextAreaElement>(null)

  const lesson = LEARN_LESSONS[lessonIndex]
  const progress = ((lessonIndex + 1) / LEARN_LESSONS.length) * 100

  useEffect(() => {
    if (!hibiOpen) return
    const focusTimer = window.setTimeout(() => questionRef.current?.focus(), 80)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHibiOpen(false)
        launcherRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [hibiOpen])

  function selectLesson(index: number) {
    setLessonIndex(index)
    setSelectedSourcePath(null)
    setSourceResult(null)
    setSourceError('')
  }

  async function openSource(source: { path: string }) {
    setSelectedSourcePath(source.path)
    setSourceResult(null)
    setSourceError('')
    setSourceLoading(true)
    try {
      const query = new URLSearchParams({ path: source.path })
      const response = await fetch(`/api/admin/learn/source?${query.toString()}`, { cache: 'no-store' })
      const result: unknown = await response.json()
      if (
        !response.ok
        || !result
        || typeof result !== 'object'
        || !('content' in result)
        || typeof result.content !== 'string'
        || !('path' in result)
        || result.path !== source.path
        || !('revision' in result)
        || !result.revision
        || typeof result.revision !== 'object'
        || !('mode' in result.revision)
        || (result.revision.mode !== 'public-demo' && result.revision.mode !== 'deployment' && result.revision.mode !== 'local')
        || !('sha' in result.revision)
        || (result.revision.sha !== null && typeof result.revision.sha !== 'string')
      ) {
        const error = result && typeof result === 'object' && 'error' in result ? result.error : null
        throw new Error(typeof error === 'string' ? error : 'The source file could not be loaded.')
      }
      setSourceResult({
        path: result.path,
        content: result.content,
        revision: { mode: result.revision.mode, sha: result.revision.sha },
      })
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : 'The source file could not be loaded.')
    } finally {
      setSourceLoading(false)
    }
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || sending) return

    const nextMessages = [...messages, { role: 'user' as const, content: question }]
    setMessages(nextMessages)
    setDraft('')
    setChatError('')
    setSending(true)
    try {
      const response = await fetch('/api/admin/learn/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lessonId: lesson.id,
          sourcePath: selectedSourcePath,
          messages: nextMessages.slice(-8),
        }),
      })
      const result = await response.json()
      if (!response.ok || typeof result.reply !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : 'Hibi could not respond just now.')
      }
      setMessages((current) => [...current, { role: 'assistant', content: result.reply }])
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Hibi could not respond just now.')
      setDraft(question)
    } finally {
      setSending(false)
    }
  }

  function closeHibi() {
    setHibiOpen(false)
    launcherRef.current?.focus()
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ADMIN LEARNING CENTER</p>
          <h1>Learn with Hibi</h1>
          <p className={styles.intro}>A practical guide to how this hotel platform is built, tested, and improved.</p>
        </div>
        <div className={styles.revision} aria-label="Source revision">
          <span>Source snapshot</span>
          <strong>{revision.sha ? revision.sha.slice(0, 7) : 'Revision unavailable'}</strong>
          <small>
            {revision.mode === 'public-demo'
              ? 'pinned public demo commit'
              : revision.mode === 'deployment'
                ? 'deployed commit'
                : 'local working copy may include uncommitted changes'}
          </small>
          {revision.sha && (
            <a
              href={`https://github.com/paki069/grand-hibiscus-demo/tree/${revision.sha}`}
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub <ExternalLink aria-hidden="true" size={13} />
            </a>
          )}
        </div>
      </header>

      <div className={styles.progressRow}>
        <label htmlFor="learn-progress">Course progress</label>
        <progress id="learn-progress" value={lessonIndex + 1} max={LEARN_LESSONS.length} />
        <span>Lesson {lessonIndex + 1} of {LEARN_LESSONS.length}</span>
      </div>

      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="Course contents">
          <div className={styles.tocHeading}><BookOpen size={17} aria-hidden="true" /> Course contents</div>
          <label className={styles.mobileSelectLabel} htmlFor="learn-lesson-select">Choose a lesson</label>
          <select
            className={styles.mobileSelect}
            id="learn-lesson-select"
            value={lesson.id}
            onChange={(event) => selectLesson(LEARN_LESSONS.findIndex((item) => item.id === event.target.value))}
          >
            {LEARN_LESSONS.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title}</option>)}
          </select>
          <ol className={styles.lessonList}>
            {LEARN_LESSONS.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={index === lessonIndex ? styles.activeLesson : ''}
                  aria-current={index === lessonIndex ? 'step' : undefined}
                  onClick={() => selectLesson(index)}
                >
                  <span className={styles.lessonNumber}>{String(index + 1).padStart(2, '0')}</span>
                  <span>{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main className={styles.lesson}>
          <p className={styles.eyebrow}>LESSON {String(lessonIndex + 1).padStart(2, '0')}</p>
          <h2>{lesson.title}</h2>
          <p className={styles.lessonSummary}>{lesson.summary}</p>
          <article className={styles.lessonContent}>
            <ReactMarkdown>{lesson.content}</ReactMarkdown>
          </article>

          <section className={styles.sources} aria-labelledby="source-heading">
            <div className={styles.sourceHeading}>
              <div>
                <h3 id="source-heading">Explore the related files</h3>
                <p>
                  {revision.mode === 'public-demo'
                    ? 'Read-only source from the pinned public demo repository.'
                    : revision.mode === 'deployment'
                      ? 'Read-only source from this deployment snapshot.'
                      : 'Read-only source from the local working copy.'}
                </p>
              </div>
              <FileCode2 size={20} aria-hidden="true" />
            </div>
            <div className={styles.sourceList}>
              {lesson.sources.map((source) => (
                <button
                  type="button"
                  key={source.path}
                  className={selectedSourcePath === source.path ? styles.activeSource : ''}
                  onClick={() => openSource(source)}
                  aria-expanded={selectedSourcePath === source.path && Boolean(sourceResult)}
                >
                  <code>{source.path}</code>
                  <span>{source.description}</span>
                </button>
              ))}
            </div>
            {sourceLoading && <p className={styles.sourceStatus} role="status">Loading source…</p>}
            {sourceError && <p className={styles.error} role="alert">{sourceError}</p>}
            {sourceResult && (
              <div className={styles.sourcePreview} id="learn-source-preview">
                <div className={styles.previewHeading}>
                  <strong>{sourceResult.path}</strong>
                  <button type="button" className={styles.closeSource} onClick={() => { setSourceResult(null); setSelectedSourcePath(null) }}>Close source</button>
                </div>
                <pre tabIndex={0} aria-label={`Read-only source code: ${sourceResult.path}`}><code>{sourceResult.content}</code></pre>
              </div>
            )}
          </section>

          <nav className={styles.lessonNavigation} aria-label="Lesson navigation">
            <button type="button" disabled={lessonIndex === 0} onClick={() => selectLesson(lessonIndex - 1)}>
              <ChevronLeft size={17} aria-hidden="true" /> Previous
            </button>
            <button type="button" disabled={lessonIndex === LEARN_LESSONS.length - 1} onClick={() => selectLesson(lessonIndex + 1)}>
              Next <ChevronRight size={17} aria-hidden="true" />
            </button>
          </nav>
        </main>

      </div>
      <div className={styles.hibiWidget}>
        {hibiOpen && (
          <section className={styles.hibiPanel} id="hibi-panel" role="dialog" aria-modal="false" aria-labelledby="hibi-title">
            <header className={styles.hibiHeader}>
              <img className={styles.hibiAvatar} src="/images/hibi-avatar.png" alt="" width={48} height={48} />
              <div className={styles.hibiHeading}>
                <strong id="hibi-title">Hibi</strong>
                <span>Your project tutor · Lesson {lessonIndex + 1}</span>
              </div>
              <button className={styles.hibiClose} type="button" onClick={closeHibi} aria-label="Close Hibi chat">×</button>
            </header>
            <p className={styles.privacyNote}>Ask about this lesson or paste an error after removing passwords, keys, and all guest or personal information.</p>
            <div className={styles.chatMessages} aria-live="polite" aria-relevant="additions text">
              {messages.map((message, index) => (
                <div key={`${index}-${message.role}`} className={message.role === 'user' ? styles.userMessage : styles.hibiMessage}>
                  <span className={styles.messageRole}>{message.role === 'user' ? 'You' : 'Hibi'}</span>
                  <div className={styles.messageBody}><ReactMarkdown>{message.content}</ReactMarkdown></div>
                </div>
              ))}
              {sending && <p className={styles.thinking} role="status">Hibi is thinking…</p>}
            </div>
            {chatError && <p className={styles.error} role="alert">{chatError}</p>}
            <form className={styles.chatForm} onSubmit={submitQuestion}>
              <label htmlFor="hibi-question">Ask about this lesson</label>
              <textarea
                ref={questionRef}
                id="hibi-question"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={2_500}
                rows={3}
                placeholder="What does this file do?"
                disabled={sending}
              />
              <div className={styles.chatFooter}>
                <span>{draft.length}/2500</span>
                <button type="submit" disabled={sending || !draft.trim()}>
                  <Send size={15} aria-hidden="true" /> Ask Hibi
                </button>
              </div>
            </form>
          </section>
        )}
        <button
          ref={launcherRef}
          className={styles.hibiLauncher}
          type="button"
          aria-label={hibiOpen ? 'Close Hibi chat' : 'Chat with Hibi, your project tutor'}
          aria-haspopup="dialog"
          aria-expanded={hibiOpen}
          aria-controls="hibi-panel"
          onClick={() => hibiOpen ? closeHibi() : setHibiOpen(true)}
        >
          {hibiOpen ? <span aria-hidden="true">×</span> : <img src="/images/hibi-avatar.png" alt="" width={48} height={48} />}
        </button>
      </div>
    </div>
  )
}
