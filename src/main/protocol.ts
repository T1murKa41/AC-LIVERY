// acl://game/<path> serves files from the Assetto Corsa folder to the renderer.
// Using fetch() over a custom protocol streams large models without copying
// them through IPC.

import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveInside } from './paths'

export const SCHEME = 'acl'

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])
}

export function handleGameProtocol(getRoot: () => Promise<string | null>): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const root = await getRoot()
    if (url.host !== 'game' || !root) return new Response('Not found', { status: 404 })
    const abs = resolveInside(root, decodeURIComponent(url.pathname))
    if (!abs) return new Response('Forbidden', { status: 403 })
    try {
      const res = await net.fetch(pathToFileURL(abs).toString())
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', 'no-store')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
