import { extractAoDetail } from '@shared/image/ao'

self.onmessage = (e: MessageEvent<{ rgba: Uint8Array; width: number; height: number }>) => {
  const { rgba, width, height } = e.data
  const detail = extractAoDetail(rgba, width, height)
  ;(self as unknown as Worker).postMessage(detail, [detail.buffer])
}
