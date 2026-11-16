import {existsSync,mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
import {isUiLanguage,type DesktopPreferences,type UiLanguage} from '../shared/desktop'
export class DesktopStore {
 constructor(private file:string,private systemLocale='en'){}
 read():DesktopPreferences {
  if(!existsSync(this.file))return {version:1,language:/^ru/i.test(this.systemLocale)?'ru':/^zh/i.test(this.systemLocale)?'zh-CN':'en',onboardingCompleted:false}
  const data:unknown=JSON.parse(readFileSync(this.file,'utf8'))
  if(!data||typeof data!=='object'||!('version' in data)||data.version!==1||!('language' in data)||!isUiLanguage(data.language)||!('onboardingCompleted' in data)||typeof data.onboardingCompleted!=='boolean')throw new Error('Не удалось прочитать настройки интерфейса Desktop')
  return data as DesktopPreferences
 }
 private write(data:DesktopPreferences):DesktopPreferences {
  mkdirSync(dirname(this.file),{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp'
  try{writeFileSync(temp,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});renameSync(temp,this.file)}finally{if(existsSync(temp))unlinkSync(temp)}return data
 }
 language(language:UiLanguage):DesktopPreferences {if(!isUiLanguage(language))throw new Error('Неизвестный язык интерфейса');return this.write({...this.read(),language})}
 complete():DesktopPreferences {return this.write({...this.read(),onboardingCompleted:true})}
}
