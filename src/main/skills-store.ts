import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { parseDocument, Document as YamlDocument } from 'yaml'
import type { SettingsScope } from '../shared/settings'
import type { SkillDocument, SkillEntry, SkillFile, SkillSaveRequest, SkillsView, SkillPathChange, SkillAsset } from '../shared/studio'
import { SettingsStore } from './settings-store'
import { SkillPackage } from './skill-package'
const hash=(text:string|Buffer):string=>createHash('sha256').update(text).digest('hex')
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)
const key=(text:string):string=>process.platform==='win32'?text.toLowerCase():text
const NAME=/^[a-z0-9][a-z0-9-]{0,63}$/
// Resolve aliases in the selected project/home, including macOS /var and
// Windows short paths. Missing home directories are kept as a relative tail.
// Managed descendants (.qwen, skills and packages) are checked separately.
// Match fs/promises.realpath: legacy realpathSync can retain RUNNER~1 aliases.
function canonicalBase(path:string):string {
  let ancestor=resolve(path)
  const tail:string[]=[]
  for(;;){
    try{return join(realpathSync.native(ancestor),...tail)}catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT'||dirname(ancestor)===ancestor)throw error
      tail.unshift(basename(ancestor));ancestor=dirname(ancestor)
    }
  }
}
function parseSkill(raw:string):{meta:Record<string,unknown>;body:string;yaml:YamlDocument.Parsed} {
  if(raw.length>150000)throw new Error('SKILL.md больше 150 КБ')
  const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw)
  if(!match)throw new Error('В SKILL.md нужен YAML-заголовок между ---')
  const yaml=parseDocument(match[1],{uniqueKeys:true}),meta:unknown=yaml.toJS({maxAliasCount:0})
  if(yaml.errors.length||!record(meta)||typeof meta.name!=='string'||!meta.name.trim()||!/^([\p{L}\p{N}_:.-]+)$/u.test(meta.name)||typeof meta.description!=='string'||!meta.description.trim())throw new Error('В заголовке SKILL.md нужны корректные name и description')
  return {meta,body:match[2].trimStart(),yaml}
}
export class SkillsStore {
  private settings:SettingsStore
  constructor(private home=homedir(),private env:NodeJS.ProcessEnv=process.env){this.settings=new SettingsStore(home,env)}
  private userHome():string{return this.env.QWEN_HOME?resolve(this.env.QWEN_HOME.replace(/^~(?=$|[\\/])/,this.home)):join(this.home,'.qwen')}
  root(scope:SettingsScope,cwd:string|null):string {
    if(scope==='user'){const home=this.userHome();return join(canonicalBase(dirname(home)),basename(home),'skills')}
    if(scope!=='project'||!cwd)throw new Error('Сначала выберите рабочую папку')
    return join(canonicalBase(cwd),'.qwen','skills')
  }
  private roots(scope:SettingsScope,cwd:string|null):{path:string;editable:boolean;source:string}[]{
    return [{path:this.root(scope,cwd),editable:true,source:scope==='user'?'Личные .qwen/skills':'Проект .qwen/skills'}, {path:join(canonicalBase(scope==='user'?this.home:cwd!),'.agents','skills'),editable:false,source:'.agents/skills (просмотр)'}]
  }
  private ensureRoot(root:string):void {
    let ancestor=root;while(!existsSync(ancestor)&&dirname(ancestor)!==ancestor)ancestor=dirname(ancestor)
    if(lstatSync(ancestor).isSymbolicLink()||key(realpathSync(ancestor))!==key(resolve(ancestor)))throw new Error('Редактор не записывает skills через ссылки или перенаправленные каталоги')
    mkdirSync(root,{recursive:true})
  }
  private read(path:string,max=260000):string {if(lstatSync(path).isSymbolicLink()||!statSync(path).isFile()||statSync(path).size>max)throw new Error('Файл недоступен для текстового редактора');const buffer=readFileSync(path);if(buffer.includes(0))throw new Error('Двоичный файл доступен только вне текстового редактора');return buffer.toString('utf8')}
  list(scope:SettingsScope,cwd:string|null):SkillsView {
    const entries:SkillEntry[]=[],warnings:string[]=[],seen=new Set<string>()
    for(const root of this.roots(scope,cwd)){
      if(!existsSync(root.path))continue
      if(lstatSync(root.path).isSymbolicLink()){warnings.push(`Каталог ${root.path} является ссылкой; редактирование не предоставляется.`);continue}
      for(const dir of readdirSync(root.path,{withFileTypes:true}).slice(0,1000)){
        if(dir.name.startsWith('.')||!dir.isDirectory())continue
        const path=join(root.path,dir.name,'SKILL.md');if(!existsSync(path))continue
        try{
          const raw=this.read(path,150000),parsed=parseSkill(raw),name=String(parsed.meta.name)
          if(seen.has(name))continue;seen.add(name)
          const policy=this.settings.skillPolicy(name,scope,cwd,scope)
          entries.push({id:hash(path),name,description:String(parsed.meta.description),path,scope,source:root.source,editable:root.editable&&key(realpathSync(dirname(path)))===key(resolve(dirname(path))),...policy,userInvocable:parsed.meta['user-invocable']!==false,modelInvocable:parsed.meta['disable-model-invocation']!==true,revision:hash(raw)})
        }catch(e){warnings.push(`${dir.name}: ${e instanceof Error?e.message:'Не удалось прочитать skill'}`)}
      }
    }
    return {scope,root:this.root(scope,cwd),entries:entries.sort((a,b)=>a.name.localeCompare(b.name)),warnings}
  }
  effective(cwd:string|null):SkillEntry[]{const all=[...(cwd?this.list('project',cwd).entries:[]),...this.list('user',cwd).entries],names=new Set<string>();return all.filter(s=>{if(names.has(s.name))return false;names.add(s.name);return true})}
  private entry(scope:SettingsScope,id:string,cwd:string|null,edit=false):SkillEntry {
    const entry=this.list(scope,cwd).entries.find(e=>e.id===id);if(!entry||edit&&!entry.editable)throw new Error('Skill не найден или доступен только для просмотра');return entry
  }
  get(scope:SettingsScope,id:string,cwd:string|null):SkillDocument {
    const entry=this.entry(scope,id,cwd),raw=this.read(entry.path,150000)
    return {entry,raw,body:parseSkill(raw).body,...new SkillPackage(dirname(entry.path)).tree()}
  }
  private safePath(root:string,path:string,create=false):string {
    if(typeof path!=='string'||path.length>300||!path||isAbsolute(path)||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\0]/.test(p)||p.startsWith('.')||/[. ]$/.test(p)))throw new Error('Некорректный относительный путь файла')
    const target=resolve(root,path),rel=relative(root,target)
    if(rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('Файл вне каталога skill')
    let current=root
    for(const part of path.split('/')){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('Редактор не изменяет символические ссылки')}
    if(!create&&!existsSync(target))throw new Error('Файл не найден')
    return target
  }
  private atomic(path:string,text:string):void {
    mkdirSync(dirname(path),{recursive:true});const temp=`${path}.${randomUUID()}.tmp`
    try{try{if(lstatSync(path+'.desktop.bak').isSymbolicLink())throw new Error('Резервная копия является ссылкой')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e};writeFileSync(temp,text,{flag:'wx',mode:0o600|(existsSync(path)?statSync(path).mode&0o100:0)});if(existsSync(path))copyFileSync(path,path+'.desktop.bak');renameSync(temp,path)}finally{if(existsSync(temp))unlinkSync(temp)}
  }
  save(request:SkillSaveRequest,cwd:string|null):SkillDocument {
    if(!request||!['user','project'].includes(request.scope)||typeof request.name!=='string'||typeof request.description!=='string'||!request.description.trim()||request.description.length>4000||typeof request.body!=='string'||!request.body.trim()||request.body.length>100000||typeof request.userInvocable!=='boolean'||typeof request.modelInvocable!=='boolean')throw new Error('Укажите имя, описание и инструкции skill')
    if(!request.userInvocable&&!request.modelInvocable)throw new Error('Разрешите хотя бы один способ вызова skill')
    let path:string,yaml:YamlDocument
    if(request.id){const entry=this.entry(request.scope,request.id,cwd,true);if(entry.revision!==request.revision)throw new Error('Skill изменён извне. Перечитайте файл.');if(entry.name!==request.name)throw new Error('Изменение зарегистрированного имени требует создания отдельного skill');path=entry.path;yaml=parseSkill(this.read(path,150000)).yaml}
    else{
      if(!NAME.test(request.name))throw new Error('Новое имя: строчные латинские буквы, цифры и дефисы, до 64 символов')
      if(this.list(request.scope,cwd).entries.some(s=>s.name===request.name))throw new Error('Skill с таким именем уже существует')
      const root=this.root(request.scope,cwd);this.ensureRoot(root);if(lstatSync(root).isSymbolicLink())throw new Error('Каталог skills является ссылкой');path=this.safePath(root,request.name+'/SKILL.md',true);if(existsSync(dirname(path)))throw new Error('Папка с таким именем уже существует');yaml=new YamlDocument()
    }
    yaml.set('name',request.name);yaml.set('description',request.description.trim());yaml.set('user-invocable',request.userInvocable);yaml.set('disable-model-invocation',!request.modelInvocable)
    const text=`---\n${yaml.toString().trimEnd()}\n---\n\n${request.body.trim()}\n`;parseSkill(text);this.atomic(path,text)
    return this.get(request.scope,hash(path),cwd)
  }
  toggle(scope:SettingsScope,id:string,enabled:boolean,revision:string,cwd:string|null):void {const e=this.entry(scope,id,cwd);if(e.revision!==revision)throw new Error('Skill изменился. Обновите список.');this.settings.toggleSkill(e.name,enabled,scope,cwd,e.scope)}
  saveRaw(scope:SettingsScope,id:string,revision:string,raw:string,cwd:string|null):SkillDocument {
    const e=this.entry(scope,id,cwd,true);if(e.revision!==revision)throw new Error('Skill изменён извне. Перечитайте файл.')
    if(typeof raw!=='string')throw new Error('Ожидается текст SKILL.md');const parsed=parseSkill(raw)
    if(parsed.meta.name!==e.name||!parsed.body.trim())throw new Error('Имя существующего skill должно сохраняться, а инструкции не должны быть пустыми')
    this.atomic(e.path,raw.endsWith('\n')?raw:raw+'\n');return this.get(scope,id,cwd)
  }
  remove(scope:SettingsScope,id:string,revision:string,cwd:string|null):void {
    const e=this.entry(scope,id,cwd,true);if(e.revision!==revision)throw new Error('Skill изменился. Обновите список.');const trash=join(dirname(this.root(scope,cwd)),'desktop-skill-trash');mkdirSync(trash,{recursive:true});renameSync(dirname(e.path),join(trash,randomUUID()+'-'+basename(dirname(e.path))))
  }
  private package(scope:SettingsScope,id:string,cwd:string|null,edit=false):SkillPackage {return new SkillPackage(dirname(this.entry(scope,id,cwd,edit).path))}
  getFile(scope:SettingsScope,id:string,path:string,cwd:string|null):SkillFile {return this.package(scope,id,cwd).read(path)}
  inspectFile(scope:SettingsScope,id:string,path:string,cwd:string|null):SkillAsset {return this.package(scope,id,cwd).inspect(path)}
  saveFile(scope:SettingsScope,id:string,file:SkillFile,cwd:string|null):SkillFile {return this.package(scope,id,cwd,true).save(file)}
  changePath(scope:SettingsScope,id:string,request:SkillPathChange,cwd:string|null):SkillDocument {
    const trash=join(dirname(this.root(scope,cwd)),'desktop-skill-file-trash')
    this.package(scope,id,cwd,true).change(request,trash);return this.get(scope,id,cwd)
  }
  importFile(scope:SettingsScope,id:string,source:string,directory:string,revision:string,cwd:string|null):SkillDocument {
    this.package(scope,id,cwd,true).importFile(source,directory,revision);return this.get(scope,id,cwd)
  }
  importDirectory(scope:SettingsScope,source:string,cwd:string|null):SkillDocument {
    source=realpathSync(source);const raw=this.read(join(source,'SKILL.md'),150000),parsed=parseSkill(raw),name=String(parsed.meta.name)
    if(!NAME.test(name))throw new Error('Для импорта используйте имя из строчных латинских букв, цифр и дефисов')
    const root=this.root(scope,cwd);this.ensureRoot(root);if(lstatSync(root).isSymbolicLink())throw new Error('Каталог skills является ссылкой')
    if(existsSync(join(root,name))||this.list(scope,cwd).entries.some(e=>e.name===name))throw new Error('Skill с таким именем уже существует')
    const temp=join(root,'.import-'+randomUUID())
    try{SkillPackage.copy(source,temp);renameSync(temp,join(root,name))}finally{if(existsSync(temp))rmSync(temp,{recursive:true,force:true})}
    return this.get(scope,hash(join(root,name,'SKILL.md')),cwd)
  }
}
