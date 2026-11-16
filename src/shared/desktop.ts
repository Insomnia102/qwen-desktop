export const UI_LANGUAGES = ['ru','en','zh-CN'] as const
export type UiLanguage = typeof UI_LANGUAGES[number]
export interface DesktopPreferences { version:1; language:UiLanguage; onboardingCompleted:boolean }
export type RuntimePhase = 'checking'|'installing'|'verifying'
export interface RuntimeStatus {ready:boolean;source:'managed'|'system'|null;cliVersion:string|null;detectedCliVersion:string|null;requiredVersion:string;nodeVersion:string|null;npmVersion:string|null;issue:'node-missing'|'node-old'|'npm-missing'|'cli-missing'|'cli-incompatible'|'cli-broken'|null}
export interface ConnectionState {
  runtime:RuntimeStatus;
  preferences:DesktopPreferences; runtimeReady:boolean; configurationFound:boolean
  profiles:{id:string;label:string;model:string}[]; defaultModelId:string|null; selectedModelId:string|null
  secureStorage:boolean; nativeConfigurationFound:boolean
}
export interface ConnectionTestResult { verified:boolean; code:'ok'|'cancelled'|'timeout'|'auth'|'network'|'model'|'runtime'|'unknown' }
export function isUiLanguage(value:unknown):value is UiLanguage {return (UI_LANGUAGES as readonly unknown[]).includes(value)}
