import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { QwenAPI, QwenEvent } from '../shared/qwen'

const api: QwenAPI = {
  prepareRuntime:()=>ipcRenderer.invoke('qwen:prepare-runtime'),
  cancelRuntime:()=>ipcRenderer.invoke('qwen:cancel-runtime'),
  getConnectionState:()=>ipcRenderer.invoke('qwen:get-connection-state'),
  setUiLanguage:language=>ipcRenderer.invoke('qwen:set-ui-language',language),
  completeOnboarding:(id,skip)=>ipcRenderer.invoke('qwen:complete-onboarding',id,skip),
  testConnection:id=>ipcRenderer.invoke('qwen:test-connection',id),
  cancelConnectionTest:()=>ipcRenderer.invoke('qwen:cancel-connection-test'),
  load: () => ipcRenderer.invoke('qwen:load'),
  selectFolder: () => ipcRenderer.invoke('qwen:select-folder'),
  selectChat: id => ipcRenderer.invoke('qwen:select-chat', id),
  selectWorkdir: id => ipcRenderer.invoke('qwen:select-workdir', id),
  closeWorkdir: id => ipcRenderer.invoke('qwen:close-workdir', id),
  renameChat: (id, title) => ipcRenderer.invoke('qwen:rename-chat', id, title),
  deleteChat: id => ipcRenderer.invoke('qwen:delete-chat', id),
  setMode: mode => ipcRenderer.invoke('qwen:set-mode', mode),
  getSettings: scope => ipcRenderer.invoke('qwen:get-settings', scope),
  saveSettings: request => ipcRenderer.invoke('qwen:save-settings', request),
  getCoreTools: scope => ipcRenderer.invoke('qwen:get-core-tools', scope),
  saveCoreTools: request => ipcRenderer.invoke('qwen:save-core-tools', request),
  getMcp: scope => ipcRenderer.invoke('qwen:get-mcp', scope),
  mutateMcp: request => ipcRenderer.invoke('qwen:mutate-mcp', request),
  probeMcp: request => ipcRenderer.invoke('qwen:probe-mcp', request),
  cancelMcpProbe: () => ipcRenderer.invoke('qwen:cancel-mcp-probe'),
  setTheme: theme => ipcRenderer.invoke('qwen:set-theme', theme),
  getStudio: scope => ipcRenderer.invoke('qwen:get-studio', scope),
  saveModel: request => ipcRenderer.invoke('qwen:save-model', request),
  deleteModel: (id, revision) => ipcRenderer.invoke('qwen:delete-model', id, revision),
  selectModel: id => ipcRenderer.invoke('qwen:select-model', id),
  savePrompt: request => ipcRenderer.invoke('qwen:save-prompt', request),
  getCommands: () => ipcRenderer.invoke('qwen:get-commands'),
  getSkills: scope => ipcRenderer.invoke('qwen:get-skills', scope),
  getSkill: (scope,id) => ipcRenderer.invoke('qwen:get-skill', scope,id),
  saveSkill: request => ipcRenderer.invoke('qwen:save-skill',request),
  saveRawSkill: (scope,id,revision,raw) => ipcRenderer.invoke('qwen:save-raw-skill',scope,id,revision,raw),
  toggleSkill: (scope,id,enabled,revision) => ipcRenderer.invoke('qwen:toggle-skill',scope,id,enabled,revision),
  deleteSkill: (scope,id,revision) => ipcRenderer.invoke('qwen:delete-skill',scope,id,revision),
  importSkill: scope => ipcRenderer.invoke('qwen:import-skill',scope),
  getSkillFile: (scope,id,path) => ipcRenderer.invoke('qwen:get-skill-file',scope,id,path),
  inspectSkillFile: (scope,id,path) => ipcRenderer.invoke('qwen:inspect-skill-file',scope,id,path),
  changeSkillPath: (scope,id,request) => ipcRenderer.invoke('qwen:change-skill-path',scope,id,request),
  importSkillFile: (scope,id,directory,revision) => ipcRenderer.invoke('qwen:import-skill-file',scope,id,directory,revision),
  saveSkillFile: (scope,id,file) => ipcRenderer.invoke('qwen:save-skill-file',scope,id,file),
  start: request => ipcRenderer.invoke('qwen:start', request),
  cancel: () => ipcRenderer.invoke('qwen:cancel'),
  newChat: () => ipcRenderer.invoke('qwen:new-chat'),
  approve: (id, decision) => ipcRenderer.invoke('qwen:approve', id, decision),
  onEvent: callback => {
    const listener = (_event: IpcRendererEvent, payload: QwenEvent): void => callback(payload)
    ipcRenderer.on('qwen:event', listener)
    return () => ipcRenderer.removeListener('qwen:event', listener)
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
