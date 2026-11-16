import type { ElectronAPI } from '@electron-toolkit/preload'
import type { QwenAPI } from '../shared/qwen'

declare global {
  interface Window {
    electron: ElectronAPI
    api: QwenAPI
  }
}
