// Keeps the last errors and warnings (including WebGL shader errors that
// three.js reports through console.error) so they can be shown in the app
// and included in diagnostics reports.

export interface LogEntry {
  time: number
  level: 'error' | 'warn'
  message: string
  count: number
}

const MAX = 50
let entries: LogEntry[] = []
const listeners = new Set<() => void>()
let installed = false

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
    .slice(0, 4000)
}

export function pushLog(level: LogEntry['level'], message: string): void {
  const last = entries.at(-1)
  if (last && last.level === level && last.message === message) {
    entries = [...entries.slice(0, -1), { ...last, count: last.count + 1, time: Date.now() }]
  } else {
    entries = [...entries, { time: Date.now(), level, message, count: 1 }].slice(-MAX)
  }
  for (const l of listeners) l()
}

export function installLogCapture(): void {
  if (installed) return
  installed = true
  const error = console.error.bind(console)
  const warn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    pushLog('error', stringify(args))
    error(...args)
  }
  console.warn = (...args: unknown[]) => {
    pushLog('warn', stringify(args))
    warn(...args)
  }
  window.addEventListener('error', (e) => pushLog('error', e.message || String(e.error)))
  window.addEventListener('unhandledrejection', (e) => pushLog('error', stringify([e.reason])))
}

export function logEntries(): readonly LogEntry[] {
  return entries
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
