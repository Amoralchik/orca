import type { BrowserScreencastResult } from '../../../../shared/browser/runtime/runtime-browser-contracts'
import { addBrowserPagePromptViewer } from '../../../browser/guest-lifecycle/prompts/browser-page-prompt-viewers'
import { browserManager } from '../../../browser/guest-lifecycle/manager/browser-manager'
import type { BrowserScreencastParams } from './browser-screencast-contracts'

type ScreencastViewer = { emit?: (event: BrowserScreencastResult) => void; pairedDeviceId?: string }

/** Starts the page events this viewer asked for beyond frames; returns what stops them. */
export function startScreencastViewerEvents(
  page: { guestWebContentsId: number; browserPageId: string },
  params: Pick<BrowserScreencastParams, 'pagePrompts' | 'downloads'>,
  { emit, pairedDeviceId }: ScreencastViewer
): (() => void) | null {
  if (!emit) {
    return null
  }
  const stops: (() => void)[] = []
  // Only a paired device's answer can be checked.
  if (params.pagePrompts === 1 && pairedDeviceId) {
    stops.push(
      addBrowserPagePromptViewer(page.guestWebContentsId, {
        pairedDeviceId,
        show: (request) => emit({ type: 'pagePrompt', request }),
        close: (requestId) => emit({ type: 'pagePromptClosed', requestId })
      })
    )
  }
  if (params.downloads === 1) {
    stops.push(browserManager.watchDownloads(page.browserPageId, emit))
  }
  return () => {
    for (const stop of stops) {
      stop()
    }
  }
}
