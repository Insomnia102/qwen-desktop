import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { KeySource, ModelProfile, ModelSaveRequest, PromptConfig, PromptSaveRequest, StudioView } from '../shared/studio'
import type { SettingsScope } from '../shared/settings'
export interface SecretCodec { available(): boolean; encrypt(text: string): Buffer; decrypt(data: Buffer): string }
interface StoredModel extends Omit<ModelProfile, 'hasKey'> { secret?: string }
interface Document { version: 1; defaultModelId?:string|null; profiles: StoredModel[]; selections: Record<string,string|null>; prompt: PromptConfig; projects: Record<string,PromptConfig> }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const defaultPrompt = (): PromptConfig => ({mode:'append',text:''})
const projectKey = (cwd: string): string => createHash('sha256').update(process.platform === 'win32' ? resolve(cwd).toLowerCase() : resolve(cwd)).digest('hex')
const validPrompt = (p: unknown): p is PromptConfig => object(p) && ['append','replace'].includes(String(p.mode)) && typeof p.text === 'string' && p.text.length <= 100000 && (p.mode !== 'replace' || Boolean(p.text.trim()))
export class StudioStore {
  constructor(private file: string, private codec: SecretCodec) {}
  private read(): {data: Document; revision:string} {
    const text=existsSync(this.file)?readFileSync(this.file,'utf8'):''
    const value: unknown=text?JSON.parse(text):{version:1,profiles:[],selections:{},prompt:defaultPrompt(),projects:{}}
    if(!object(value)||value.version!==1||!Array.isArray(value.profiles)||!object(value.selections)||!object(value.projects)||!validPrompt(value.prompt)) throw new Error('Не удалось прочитать настройки моделей и промпта Desktop. Исходный файл сохранён.')
    for(const profile of value.profiles) if(!object(profile)||typeof profile.id!=='string'||typeof profile.label!=='string'||typeof profile.model!=='string'||!['openai','anthropic','gemini'].includes(String(profile.provider))||!['inherit','environment','stored'].includes(String(profile.keySource))||typeof profile.baseUrl!=='string'||typeof profile.envKey!=='string'||(profile.secret!==undefined&&typeof profile.secret!=='string')) throw new Error('Повреждён профиль модели Desktop')
    if(value.defaultModelId!==undefined&&value.defaultModelId!==null&&typeof value.defaultModelId!=='string')throw new Error('Повреждены настройки Desktop')
    if(Object.values(value.projects).some(p=>!validPrompt(p))||Object.values(value.selections).some(v=>v!==null&&typeof v!=='string')) throw new Error('Повреждены настройки Desktop')
    return {data:value as unknown as Document,revision:createHash('sha256').update(text).digest('hex')}
  }
  private write(data: Document): void {
    mkdirSync(dirname(this.file),{recursive:true});const temp=`${this.file}.${randomUUID()}.tmp`
    try {writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});if(existsSync(this.file))copyFileSync(this.file,this.file+'.bak');renameSync(temp,this.file)}
    finally {if(existsSync(temp))unlinkSync(temp)}
  }
  view(chatId: string|null,cwd: string|null,scope: SettingsScope='user'): StudioView {
    const {data,revision}=this.read(),local=scope==='user'?data.prompt:cwd?data.projects[projectKey(cwd)]??null:null
    const project=cwd?data.projects[projectKey(cwd)]:undefined,selected=chatId&&Object.hasOwn(data.selections,chatId)?data.selections[chatId]:data.defaultModelId??null
    return {revision,defaultModelId:data.defaultModelId??null,profiles:data.profiles.map(({secret,...p})=>({...p,hasKey:Boolean(secret)})),selectedModelId:data.profiles.some(p=>p.id===selected)?selected:null,secureStorage:this.codec.available(),prompt:project??data.prompt,localPrompt:local,promptScope:scope,promptSource:project?'Текущая папка':'Для всех проектов'}
  }
  saveModel(request:ModelSaveRequest):void {
    const {data,revision}=this.read()
    if(!request||request.revision!==revision)throw new Error('Настройки изменились. Обновите список моделей.')
    if(typeof request.label!=='string'||!request.label.trim()||request.label.length>100||typeof request.model!=='string'||!request.model.trim()||request.model.length>200||/[\r\n\0]/.test(request.model)||!['openai','anthropic','gemini'].includes(request.provider))throw new Error('Укажите название, протокол и ID модели')
    if(typeof request.baseUrl!=='string'||request.baseUrl.length>2000)throw new Error('Некорректный адрес API')
    if(request.baseUrl){let url:URL;try{url=new URL(request.baseUrl)}catch{throw new Error('Укажите полный HTTP(S)-адрес API')};if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Нужен HTTP(S)-адрес без пароля в URL')}
    if(request.provider==='gemini'&&request.baseUrl)throw new Error('Для собственного Gemini endpoint используйте OpenAI-совместимый протокол, если он поддерживается сервером. Здесь Gemini использует штатный адрес SDK.')
    if(!['inherit','environment','stored'].includes(request.keySource))throw new Error('Неизвестный источник API-ключа')
    if(request.keySource==='environment'&&(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(request.envKey)))throw new Error('Укажите имя переменной окружения с ключом')
    const previous=request.id?data.profiles.find(p=>p.id===request.id):undefined
    if(data.profiles.some(p=>p.id!==request.id&&p.label.toLocaleLowerCase()===request.label.trim().toLocaleLowerCase()))throw new Error('Профиль с таким названием уже существует')
    if(request.id&&!previous)throw new Error('Профиль модели не найден')
    if(!previous&&data.profiles.length>=100)throw new Error('Можно сохранить до 100 моделей')
    let secret=previous?.secret
    if(request.keySource==='stored'){
      if(request.apiKey!==undefined&&typeof request.apiKey!=='string')throw new Error('Некорректный ключ')
      if(request.apiKey){if(request.apiKey.length>16000||/[\r\n\0]/.test(request.apiKey))throw new Error('Некорректный ключ');if(!this.codec.available())throw new Error('Защищённое хранилище недоступно. Используйте переменную окружения.');secret=this.codec.encrypt(request.apiKey).toString('base64')}
      if(!secret)throw new Error('Введите ключ или выберите другой источник')
    }else secret=undefined
    const next:StoredModel={id:previous?.id??randomUUID(),label:request.label.trim(),model:request.model.trim(),provider:request.provider,baseUrl:request.baseUrl.trim(),keySource:request.keySource as KeySource,envKey:request.keySource==='environment'?request.envKey:'',...(secret?{secret}:{})}
    data.profiles=previous?data.profiles.map(p=>p.id===next.id?next:p):[...data.profiles,next];this.write(data)
  }
  removeModel(id:string,revision:string):void {
    const {data,revision:actual}=this.read();if(actual!==revision)throw new Error('Настройки изменились. Обновите список.')
    if(!data.profiles.some(p=>p.id===id))throw new Error('Модель не найдена')
    data.profiles=data.profiles.filter(p=>p.id!==id);if(data.defaultModelId===id)data.defaultModelId=null;for(const key of Object.keys(data.selections))if(data.selections[key]===id)data.selections[key]=null;this.write(data)
  }
  select(chatId:string,id:string|null):void {
    const {data}=this.read();if(id!==null&&!data.profiles.some(p=>p.id===id))throw new Error('Модель не найдена');data.selections[chatId]=id;this.write(data)
  }
  setDefault(id:string|null,existingChats:string[]=[]):void {const {data}=this.read();if(id!==null&&!data.profiles.some(p=>p.id===id))throw new Error('Модель не найдена');for(const chatId of existingChats)if(!Object.hasOwn(data.selections,chatId))data.selections[chatId]=data.defaultModelId??null;data.defaultModelId=id;this.write(data)}
  savePrompt(request:PromptSaveRequest,cwd:string|null):void {
    const {data,revision}=this.read();if(!request||request.revision!==revision)throw new Error('Настройки изменились. Перечитайте промпт.')
    if(request.scope!=='user'&&request.scope!=='project')throw new Error('Неизвестная область промпта')
    if(request.prompt!==null&&!validPrompt(request.prompt))throw new Error('Задайте режим и текст промпта; замена требует непустой текст')
    if(request.scope==='user')data.prompt=request.prompt??defaultPrompt()
    else{if(!cwd)throw new Error('Сначала выберите рабочую папку');if(request.prompt===null)delete data.projects[projectKey(cwd)];else data.projects[projectKey(cwd)]=request.prompt}
    this.write(data)
  }
  runtime(chatId:string,cwd:string,env:NodeJS.ProcessEnv=process.env,override?:string|null):{model?:string;authType?:ModelProfile['provider'];env:Record<string,string>;systemPrompt:string|{type:'preset';preset:'qwen_code';append:string}} {
    const {data}=this.read(),p=data.profiles.find(p=>p.id===(override!==undefined?override:Object.hasOwn(data.selections,chatId)?data.selections[chatId]:data.defaultModelId)),prompt=data.projects[projectKey(cwd)]??data.prompt
    const bridge='Если нужно уточнение пользователя, задай вопрос обычным текстом. Интерактивный инструмент ask_user_question в этом интерфейсе не поддерживается.'
    const text=[prompt.text,bridge].filter(Boolean).join('\n\n')
    const result:{model?:string;authType?:ModelProfile['provider'];env:Record<string,string>;systemPrompt:string|{type:'preset';preset:'qwen_code';append:string}}={env:{},systemPrompt:prompt.mode==='replace'?text:{type:'preset',preset:'qwen_code',append:text}}
    if(!p)return result
    result.model=p.model;result.authType=p.provider
    const keyName=p.provider==='openai'?'OPENAI_API_KEY':p.provider==='anthropic'?'ANTHROPIC_API_KEY':'GEMINI_API_KEY'
    let key:string|undefined
    if(p.keySource==='environment'){key=env[p.envKey];if(!key)throw new Error(`Не найдена переменная ${p.envKey}. Перезапустите приложение после её настройки.`)}
    else if(p.keySource==='stored'){
      if(!p.secret||!this.codec.available())throw new Error('Не удалось открыть сохранённый ключ. Введите его заново или используйте переменную окружения.')
      try{key=this.codec.decrypt(Buffer.from(p.secret,'base64'))}catch{throw new Error('Не удалось расшифровать ключ модели. Введите его заново.')}
    }
    if(key)result.env[keyName]=key
    if(p.baseUrl)result.env[p.provider==='anthropic'?'ANTHROPIC_BASE_URL':'OPENAI_BASE_URL']=p.baseUrl
    return result
  }
}
