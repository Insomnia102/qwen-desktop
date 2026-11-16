// File/configuration checks run before loading tests or installing CI dependencies.
import {readFileSync,statSync} from 'node:fs'
import {resolve,isAbsolute,sep} from 'node:path'
import {pathToFileURL} from 'node:url'

export function inspectCiSetup(root=process.cwd()){
 const missing=[],problems=[];let manifest
 try{manifest=JSON.parse(readFileSync(resolve(root,'scripts/ci-files.json'),'utf8'))}
 catch(error){return{ok:false,missing:['scripts/ci-files.json'],problems:[`Не удалось прочитать список файлов CI: ${error.message}`]}}
 if(manifest.version!==1||!Array.isArray(manifest.requiredFiles))return{ok:false,missing:[],problems:['Неверный формат scripts/ci-files.json']}
 const base=resolve(root)
 for(const name of manifest.requiredFiles){
  if(typeof name!=='string'||isAbsolute(name)||!resolve(base,name).startsWith(base+sep)){problems.push('Недопустимый путь в списке CI');continue}
  try{if(!statSync(resolve(base,name)).isFile())missing.push(name)}catch{missing.push(name)}
 }
 const plist='build/entitlements.mac.plist',config='electron-builder.yml'
 if(problems.length===0&&manifest.requiredFiles.includes(plist)&&manifest.requiredFiles.includes(config)&&!missing.includes(plist)&&!missing.includes(config)){
  const yaml=readFileSync(resolve(base,config),'utf8'),xml=readFileSync(resolve(base,plist),'utf8')
  if(/^\s{2}identity:\s*(?:['"]-['"]|-)\s*(?:#.*)?$/m.test(yaml))for(const key of ['com.apple.security.cs.allow-jit','com.apple.security.cs.disable-library-validation']){
   const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
   if(!new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<true\\s*/>`).test(xml))problems.push(`${plist}: для этой ad-hoc macOS-конфигурации отсутствует ${key}=true; замените файл версией из CI-исправления.`)
  }
 }
 return{ok:missing.length===0&&problems.length===0,missing,problems}
}
export function checkCiSetup(root=process.cwd()){
 const result=inspectCiSetup(root)
 if(result.ok){console.log('CI: необходимые файлы и macOS-конфигурация на месте.');return true}
 console.error('CI не запущен: комплект файлов неполон или содержит старую конфигурацию.')
 for(const name of result.missing)console.error('  Нет файла: '+name)
 for(const text of result.problems)console.error('  '+text)
 console.error('Скопируйте содержимое CI-исправления в корень проекта, включая tests/, scripts/, build/ и .github/. Затем повторите команду.')
 return false
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=checkCiSetup()?0:1
