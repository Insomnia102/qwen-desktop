import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SkillAsset, SkillFile, SkillPathChange, SkillTreeNode } from '../shared/studio'
const digest=(data:Buffer|string):string=>createHash('sha256').update(data).digest('hex')
const LIMIT=20_000_000, TEXT_LIMIT=512_000, FILES=500
const reserved=(name:string):boolean=>['.git','node_modules'].includes(name.toLowerCase())||/\.desktop\.bak$|\.[a-f\d-]{36}\.tmp$/i.test(name)
const same=(a:string,b:string):boolean=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b
function decode(bytes:Buffer):{text:string;encoding:string}|null {
  if(bytes.length>TEXT_LIMIT)return null
  let encoding='utf8',offset=0,label='utf-8'
  if(bytes[0]===0xff&&bytes[1]===0xfe){encoding='utf16le';label='utf-16le';offset=2}
  else if(bytes[0]===0xfe&&bytes[1]===0xff){encoding='utf16be';label='utf-16be';offset=2}
  else if(bytes.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))){encoding='utf8-bom';offset=3}
  try{const text=new TextDecoder(label,{fatal:true,ignoreBOM:true}).decode(bytes.subarray(offset));return /[\x00-\x08\x0b\x0e-\x1f]/.test(text)?null:{text,encoding}}catch{return null}
}
function encode(text:string,encoding:string,lineEnding:string):Buffer {
  if(lineEnding==='CRLF')text=text.replace(/\r?\n/g,'\r\n')
  if(encoding==='utf16le'||encoding==='utf16be'){const body=Buffer.from(text,'utf16le');if(encoding==='utf16be')body.swap16();return Buffer.concat([Buffer.from(encoding==='utf16le'?[0xff,0xfe]:[0xfe,0xff]),body])}
  return Buffer.concat([Buffer.from(encoding==='utf8-bom'?[0xef,0xbb,0xbf]:[]),Buffer.from(text,'utf8')])
}
export class SkillPackage {
  constructor(readonly root:string){
    if(lstatSync(root).isSymbolicLink()||!same(realpathSync(root),resolve(root)))throw new Error('Папка skill перенаправлена через ссылку')
  }
  path(path:string,create=false):string {
    if(typeof path!=='string'||!path||path.length>300||isAbsolute(path)||path.includes('\\')||path.split('/').length>12||path.split('/').some(n=>!n||n==='.'||n==='..'||/[<>:"|?*\x00-\x1f]/.test(n)||/[. ]$/.test(n)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n)||reserved(n)))throw new Error('Некорректный относительный путь файла или папки')
    const target=resolve(this.root,path),rel=relative(this.root,target)
    if(rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('Путь вне папки skill')
    let current=this.root
    for(const part of path.split('/')){current=join(current,part);try{const st=lstatSync(current);if(st.isSymbolicLink())throw new Error('Ссылки внутри skill не поддерживаются')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}
    if(!create&&!existsSync(target))throw new Error('Файл или папка не найдены')
    return target
  }
  tree():{files:SkillTreeNode[];treeRevision:string} {
    const files:SkillTreeNode[]=[],manifest:string[]=[];let total=0,dirs=0
    const walk=(dir:string,prefix=''):void=>{
      if(++dirs>500||prefix.split('/').filter(Boolean).length>12)throw new Error('Пакет skill: слишком много папок или уровней вложенности')
      for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        if(reserved(item.name))continue
        const path=prefix+item.name,target=this.path(path),st=lstatSync(target)
        if(st.isDirectory()){files.push({path,kind:'directory',size:0,editable:false});manifest.push('d:'+path);walk(target,path+'/')}
        else if(st.isFile()){
          total+=st.size;if(total>LIMIT||files.filter(f=>f.kind==='file').length>=FILES)throw new Error('Пакет skill: максимум 500 файлов и 20 МБ')
          const bytes=readFileSync(target);files.push({path,kind:'file',size:bytes.length,editable:decode(bytes)!==null});manifest.push(JSON.stringify([path,digest(bytes),st.mode&0o111]))
        }else throw new Error('Поддерживаются только обычные файлы и папки')
      }
    };walk(this.root)
    return {files,treeRevision:digest(manifest.join('\n'))}
  }
  private checkDirectories(path:string,includeLast:boolean,files:SkillTreeNode[]):void {
    const parts=path.split('/');if(!includeLast)parts.pop()
    let missing=0,current=this.root
    for(const part of parts){current=join(current,part);if(!existsSync(current))missing++}
    if(1+files.filter(f=>f.kind==='directory').length+missing>500)throw new Error('Пакет skill: максимум 500 каталогов с корнем')
  }
  private bytes(path:string):Buffer {const target=this.path(path),st=statSync(target);if(!st.isFile()||st.size>LIMIT)throw new Error('Не обычный файл или размер больше 20 МБ');return readFileSync(target)}
  read(path:string):SkillFile {
    const bytes=this.bytes(path),content=decode(bytes);if(!content)throw new Error('Двоичный файл или текст больше 512 КБ: доступен просмотр свойств и замена через импорт')
    return {path,...content,revision:digest(bytes),lineEnding:content.text.includes('\r\n')?'CRLF':'LF'}
  }
  inspect(path:string):SkillAsset {
    const bytes=this.bytes(path),content=decode(bytes),base={path,size:bytes.length,revision:digest(bytes)}
    if(content)return {...base,kind:'text',encoding:content.encoding}
    // Only raster formats, and only after signature validation. HTML/SVG are never executed.
    const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':/^GIF8[79]a$/.test(bytes.subarray(0,6).toString())?'image/gif':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null
    return mime&&bytes.length<=2_000_000?{...base,kind:'image',dataUrl:`data:${mime};base64,${bytes.toString('base64')}`}:{...base,kind:'binary'}
  }
  private atomic(target:string,bytes:Buffer,mode?:number):void {
    mkdirSync(dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.tmp'
    try{try{if(lstatSync(target+'.desktop.bak').isSymbolicLink())throw new Error('Резервная копия является ссылкой')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e};writeFileSync(temp,bytes,{flag:'wx',mode:mode??(existsSync(target)?statSync(target).mode&0o777:0o600)});if(existsSync(target))copyFileSync(target,target+'.desktop.bak');renameSync(temp,target)}finally{if(existsSync(temp))unlinkSync(temp)}
  }
  save(file:SkillFile):SkillFile {
    if(!file||typeof file.text!=='string'||Buffer.byteLength(file.text)>TEXT_LIMIT||typeof file.path!=='string'||file.path.toLowerCase()==='skill.md')throw new Error('SKILL.md изменяется через редактор основного файла; текст до 512 КБ')
    const target=this.path(file.path,true),current=existsSync(target)?this.read(file.path):{text:'',revision:digest(''),encoding:'utf8',lineEnding:'LF'}
    if(current.revision!==file.revision)throw new Error('Файл изменился. Перечитайте его перед сохранением.')
    const bytes=encode(file.text,current.encoding??'utf8',current.lineEnding??'LF'),tree=this.tree()
    if(bytes.length>TEXT_LIMIT)throw new Error('Текст в исходной кодировке больше 512 КБ')
    if(tree.files.reduce((n,f)=>n+f.size,0)-(tree.files.find(f=>f.path===file.path)?.size??0)+bytes.length>LIMIT||!existsSync(target)&&tree.files.filter(f=>f.kind==='file').length>=FILES)throw new Error('Пакет skill: максимум 500 файлов и 20 МБ')
    this.checkDirectories(file.path,false,tree.files);this.atomic(target,bytes);return this.read(file.path)
  }
  private check(revision:string):void {if(this.tree().treeRevision!==revision)throw new Error('Состав или содержимое пакета изменились. Обновите дерево файлов.')}
  change(request:SkillPathChange,trash:string):void {
    if(!request||!['file','directory','rename','remove'].includes(request.action))throw new Error('Неизвестная операция с файлом')
    this.check(request.revision);const target=this.path(request.path,true)
    if(request.action==='rename'||request.action==='remove'){
      if(request.path.toLowerCase()==='skill.md')throw new Error('SKILL.md — обязательная точка входа: его нельзя убрать или переименовать')
      this.path(request.path)
      if(request.action==='remove'){mkdirSync(trash,{recursive:true});renameSync(target,join(trash,randomUUID()+'-'+basename(target)));return}
      const dest=this.path(request.target??'',true)
      if(existsSync(dest)||same(dest,target))throw new Error('Путь назначения уже существует')
      if(relative(target,dest).startsWith('..')===false&&statSync(target).isDirectory())throw new Error('Нельзя перенести папку внутрь себя')
      if(!existsSync(dirname(dest)))throw new Error('Сначала создайте папку назначения')
      for(const item of this.tree().files.filter(f=>f.path.startsWith(request.path+'/')))this.path(request.target+item.path.slice(request.path.length),true)
      renameSync(target,dest);return
    }
    if(existsSync(target))throw new Error('Такой файл или папка уже существуют')
    const tree=this.tree();if(request.action==='file'&&tree.files.filter(f=>f.kind==='file').length>=FILES||request.action==='directory'&&tree.files.filter(f=>f.kind==='directory').length>=499)throw new Error('Достигнут предел файлов или папок')
    this.checkDirectories(request.path,request.action==='directory',tree.files)
    if(request.action==='directory')mkdirSync(target,{recursive:true});else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,'',{flag:'wx',mode:0o600})}
  }
  importFile(source:string,directory:string,revision:string):void {
    this.check(revision)
    if(directory&&!statSync(this.path(directory)).isDirectory())throw new Error('Выберите папку назначения')
    const st=lstatSync(source);if(st.isSymbolicLink()||!st.isFile()||st.size>LIMIT)throw new Error('Выберите обычный файл до 20 МБ')
    const path=(directory?directory+'/':'')+basename(source),target=this.path(path,true),tree=this.tree()
    if(path.toLowerCase()==='skill.md'||existsSync(target))throw new Error('Файл уже существует. Импорт не перезаписывает файлы; сначала переименуйте или уберите прежний.')
    if(tree.files.filter(f=>f.kind==='file').length>=FILES||tree.files.reduce((n,f)=>n+f.size,0)+st.size>LIMIT)throw new Error('Пакет skill: максимум 500 файлов и 20 МБ')
    this.atomic(target,readFileSync(source),st.mode&0o777)
  }
  static copy(source:string,destination:string):void {
    const pkg=new SkillPackage(source),tree=pkg.tree();mkdirSync(destination,{recursive:true})
    try{for(const item of tree.files){const target=join(destination,item.path);if(item.kind==='directory')mkdirSync(target,{recursive:true});else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(pkg.path(item.path)),{flag:'wx',mode:statSync(pkg.path(item.path)).mode&0o777})}}}catch(e){rmSync(destination,{recursive:true,force:true});throw e}
  }
}
