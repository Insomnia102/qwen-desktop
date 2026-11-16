import type {UiLanguage} from './desktop'
import {catalogs} from './translations'
const browser=globalThis as unknown as {localStorage?:{getItem(key:string):string|null};navigator?:{language?:string}}
const detected='document' in globalThis?browser.navigator?.language??'en':'ru'
let language:UiLanguage=/^ru/i.test(detected)?'ru':/^zh/i.test(detected)?'zh-CN':'en'
try{const saved=browser.localStorage?.getItem('qwen-desktop-language');if(saved==='ru'||saved==='en'||saved==='zh-CN')language=saved}catch{}
export const getLanguage=():UiLanguage=>language
export function setLanguage(value:UiLanguage):void {language=value}
export function t(source:string,locale:UiLanguage=language):string {return catalogs[locale][source]??source}
export function msg(parts:TemplateStringsArray,...values:unknown[]):string {
 const key=parts.reduce((s,p,i)=>s+(i?'{'+(i-1)+'}':'')+p,'')
 const pattern=t(key)
 return pattern.replace(/\{(\d+)\}/g,(_all,index:string)=>String(values[Number(index)]??''))
}
// Translate only application-owned diagnostics, never arbitrary message/model/file content.
const patterns=new Map<UiLanguage,{source:string;regex:RegExp;target:string}[]>()
export function translateMessage(source:string,locale:UiLanguage=language):string {
 if(locale==='ru')return source
 const exact=catalogs[locale][source];if(exact!==undefined)return exact
 let list=patterns.get(locale)
 if(!list){list=Object.entries(catalogs[locale]).filter(([s])=>/\{\d+\}/.test(s)).map(([s,target])=>{
   const escaped=s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\\\{\d+\\\}/g,'([\\s\\S]*?)')
   return {source:s,regex:new RegExp('^'+escaped+'$'),target}
  });patterns.set(locale,list)}
 for(const {source:key,regex,target} of list){const match=regex.exec(source);if(match)return target.replace(/\{(\d+)\}/g,(_m,i:string)=>{
   const value=match[Number(i)+1]??''
   const metadata:Record<string,number[]>={'Отключено в области «{0}».':[0],'Ограничено правилом {0}: {1} ({2}).':[2],'Функция {0} выключена ({1}).':[1],'Источник {0} отключён ({1}).':[1],'Перекрыто: {0}':[0],'Некорректное значение параметра «{0}»':[0],'Параметр «{0}» задан на другом уровне':[0]}
   return metadata[key]?.includes(Number(i))?t(value,locale):value
  })}
 return source
}
export const dateLocale=():string=>language==='zh-CN'?'zh-CN':language==='en'?'en-US':'ru-RU'
