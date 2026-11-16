import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,writeFile,readdir,stat,symlink,chmod,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {loadTypeScript} from './load-typescript.mjs'
import {harness} from './main-harness.mjs'
const {SkillsStore}=loadTypeScript('src/main/skills-store.ts')
const source='---\nname: portable-demo\ndescription: A portable multi-file skill\nallowed-tools: Read Bash\nmetadata:\n  author: original\n---\n\nRead rules/style.md; execute scripts/check.py when requested.\n'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNHEAAAAASUVORK5CYII=','base64')
async function fixture(){const base=await mkdtemp(join(tmpdir(),'qwen-package-')),home=join(base,'home'),project=join(base,'project'),input=join(base,'incoming');await Promise.all([mkdir(home),mkdir(project),mkdir(input)]);const files={'SKILL.md':source,'rules/style.md':'# Rules\nUse concrete names.\n','scripts/check.py':'print("ok")\n','.config/defaults.json':'{"a":1}\n','assets/icon.png':png,'assets/template.bin':Buffer.from([0,255,1,2]),'references/nested/guide.yaml':'items:\n  - one\n'};for(const [name,body]of Object.entries(files)){await mkdir(dirname(join(input,name)),{recursive:true});await writeFile(join(input,name),body)}await mkdir(join(input,'assets/empty'),{recursive:true});await mkdir(join(input,'.git'));await writeFile(join(input,'.git/config'),'not shipped');return {base,home,project,input,files,env:{QWEN_CODE_SYSTEM_SETTINGS_PATH:join(base,'system.json')}}}
async function use(fn){const f=await fixture();try{await fn(f,new SkillsStore(f.home,f.env))}finally{await rm(f.base,{recursive:true,force:true})}}
function change(s,d,f,action,path,target){return s.changePath('project',d.entry.id,{action,path,target,revision:d.treeRevision},f.project)}
test('project, home and missing QWEN_HOME beneath a parent alias keep editable canonical skill paths',()=>use(async(f)=>{
 const alias=join(f.base,'parent-alias')
 await symlink(await realpath(f.base),alias,process.platform==='win32'?'junction':'dir')
 const project=join(alias,'project'),home=join(alias,'home'),store=new SkillsStore(home,f.env)
 let d=store.importDirectory('project',f.input,project)
 assert.equal(d.entry.editable,true)
 assert.equal(d.entry.path,await realpath(join(f.project,'.qwen/skills/portable-demo/SKILL.md')))
 const file=store.getFile('project',d.entry.id,'rules/style.md',project)
 store.saveFile('project',d.entry.id,{...file,text:'Edited through a parent alias\n'},project)
 assert.equal(await readFile(join(f.project,'.qwen/skills/portable-demo/rules/style.md'),'utf8'),'Edited through a parent alias\n')
 assert.equal(new SkillsStore(f.home,f.env).get('project',d.entry.id,f.project).entry.id,d.entry.id)
 d=store.importDirectory('user',f.input,project);assert.equal(d.entry.editable,true)
 assert.equal(d.entry.path,await realpath(join(f.home,'.qwen/skills/portable-demo/SKILL.md')))
 const custom=new SkillsStore(home,{...f.env,QWEN_HOME:join(alias,'missing-parent/custom-home')})
 d=custom.save({scope:'user',id:null,revision:null,name:'alias-skill',description:'Alias test',body:'Test instructions',userInvocable:true,modelInvocable:true},project)
 assert.equal(d.entry.editable,true)
 assert.equal(d.entry.path,await realpath(join(f.base,'missing-parent/custom-home/skills/alias-skill/SKILL.md')))
}))
for(const linked of ['.qwen','skills'])test(`a parent alias does not permit a redirected ${linked} directory`,()=>use(async(f,s)=>{
 const alias=join(f.base,'parent-alias');await symlink(await realpath(f.base),alias,process.platform==='win32'?'junction':'dir')
 const project=join(alias,'project')
 const outside=join(f.base,'outside-managed');await mkdir(outside)
 const parent=linked==='.qwen'?f.project:join(f.project,'.qwen');await mkdir(parent,{recursive:true})
 await symlink(outside,join(parent,linked),process.platform==='win32'?'junction':'dir')
 assert.throws(()=>s.importDirectory('project',f.input,project),/ссылк|перенаправ/)
 assert.throws(()=>s.save({scope:'project',id:null,revision:null,name:'blocked',description:'Blocked',body:'Do not write',userInvocable:true,modelInvocable:true},project),/ссылк|перенаправ/)
 assert.deepEqual(await readdir(outside),[])
}))
test('an explicitly configured QWEN_HOME link remains blocked for skill writes',()=>use(async(f)=>{
 const outside=join(f.base,'outside-home'),home=join(f.base,'configured-home');await mkdir(outside)
 await symlink(outside,home,process.platform==='win32'?'junction':'dir')
 const s=new SkillsStore(f.home,{...f.env,QWEN_HOME:home})
 assert.throws(()=>s.importDirectory('user',f.input,f.project),/ссылк|перенаправ/)
 assert.deepEqual(await readdir(outside),[])
}))
test('Anthropic-style package imports all resources, hidden configs and empty dirs without changing bytes or YAML',()=>use(async(f,s)=>{
 if(process.platform!=='win32')await chmod(join(f.input,'scripts/check.py'),0o751)
 let d=s.importDirectory('project',f.input,f.project)
 for(const [path,bytes]of Object.entries(f.files))assert.deepEqual(await readFile(join(dirname(d.entry.path),path)),Buffer.from(bytes))
 assert.ok(d.files.some(n=>n.path==='assets/empty'&&n.kind==='directory'));assert.ok(!d.files.some(n=>n.path.startsWith('.git')))
 assert.ok(d.files.find(n=>n.path==='.config/defaults.json').editable)
 const image=s.inspectFile('project',d.entry.id,'assets/icon.png',f.project);assert.equal(image.kind,'image');assert.match(image.dataUrl,/^data:image\/png;base64,/)
 assert.equal(s.inspectFile('project',d.entry.id,'assets/template.bin',f.project).kind,'binary')
 assert.throws(()=>s.getFile('project',d.entry.id,'assets/template.bin',f.project),/Двоичный/)
 if(process.platform!=='win32')assert.equal((await stat(join(dirname(d.entry.path),'scripts/check.py'))).mode&0o777,0o751)
 const old=d.treeRevision,file=s.getFile('project',d.entry.id,'rules/style.md',f.project)
 s.saveFile('project',d.entry.id,{...file,text:'Changed rules\n'},f.project);d=s.get('project',d.entry.id,f.project);assert.notEqual(d.treeRevision,old);assert.equal(d.raw,source)
 d=s.saveRaw('project',d.entry.id,d.entry.revision,d.raw.replace('portable multi-file','edited multi-file'),f.project);assert.match(d.raw,/allowed-tools: Read Bash/);assert.match(d.raw,/author: original/)
 assert.deepEqual(await readFile(join(dirname(d.entry.path),'assets/template.bin')),f.files['assets/template.bin'])
 const again=new SkillsStore(f.home,f.env).get('project',d.entry.id,f.project);assert.equal(again.treeRevision,d.treeRevision);assert.equal(s.getFile('project',d.entry.id,'rules/style.md',f.project).text,'Changed rules\n')
}))
test('file/folder CRUD, nested rename, soft removal and stale manifests',()=>use(async(f,s)=>{
 let d=s.importDirectory('project',f.input,f.project);d=change(s,d,f,'directory','rules/new-empty');assert.ok(d.files.some(n=>n.path==='rules/new-empty'))
 d=change(s,d,f,'file','rules/new-empty/test.toml');assert.equal(s.getFile('project',d.entry.id,'rules/new-empty/test.toml',f.project).text,'')
 d=change(s,d,f,'rename','rules/new-empty','references/renamed');assert.ok(d.files.some(n=>n.path==='references/renamed/test.toml'));assert.ok(!d.files.some(n=>n.path==='rules/new-empty'))
 assert.throws(()=>change(s,d,f,'rename','references','references/renamed/subfolder'),/внутрь себя/)
 assert.throws(()=>change(s,d,f,'file','SKILL.md'),/существуют/);assert.throws(()=>change(s,d,f,'remove','SKILL.md'),/точка входа/);assert.throws(()=>change(s,d,f,'rename','SKILL.md','OTHER.md'),/точка входа/)
 const stale=d;await writeFile(join(dirname(d.entry.path),'rules/style.md'),'external change');assert.throws(()=>change(s,stale,f,'directory','unwanted'),/изменились/)
 d=s.get('project',d.entry.id,f.project);d=change(s,d,f,'remove','references/renamed');assert.ok(!d.files.some(n=>n.path.startsWith('references/renamed')))
 const trash=join(f.project,'.qwen/desktop-skill-file-trash'),removed=(await readdir(trash))[0];assert.equal(await readFile(join(trash,removed,'test.toml'),'utf8'),'')
}))
test('UTF-8 BOM, UTF-16 BOM, CRLF and executable permissions survive text edits',()=>use(async(f,s)=>{
 let d=s.importDirectory('project',f.input,f.project);const root=dirname(d.entry.path)
 for(const [encoding,bytes]of [['utf8-bom',Buffer.concat([Buffer.from([239,187,191]),Buffer.from('Привет\r\n')])],['utf16le',Buffer.concat([Buffer.from([255,254]),Buffer.from('Привет\r\n','utf16le')])],['utf16be',Buffer.concat([Buffer.from([254,255]),Buffer.from('Привет\r\n','utf16le').swap16()])]]){
  const path=`references/${encoding}.txt`;await writeFile(join(root,path),bytes);let file=s.getFile('project',d.entry.id,path,f.project);assert.equal(file.encoding,encoding);assert.equal(file.lineEnding,'CRLF')
  s.saveFile('project',d.entry.id,{...file,text:'Пока\n'},f.project);const after=await readFile(join(root,path));assert.deepEqual(after.subarray(0,encoding==='utf8-bom'?3:2),bytes.subarray(0,encoding==='utf8-bom'?3:2));file=s.getFile('project',d.entry.id,path,f.project);assert.equal(file.text,'Пока\r\n')
 }
}))
test('path escape, Windows device names, links and invalid text never rewrite resources',()=>use(async(f,s)=>{
 let d=s.importDirectory('project',f.input,f.project)
 for(const path of ['../outside','nested/../../out','C:/escape','rules\\escape','/tmp/escape','rules/NUL.txt','rules/file.','rules/.git/config','node_modules/x'])assert.throws(()=>change(s,d,f,'file',path),/путь/)
 const file=s.getFile('project',d.entry.id,'scripts/check.py',f.project);await writeFile(join(dirname(d.entry.path),'scripts/check.py'),'outside');assert.throws(()=>s.saveFile('project',d.entry.id,{...file,text:'overwritten'},f.project),/изменился/)
 const binary=await readFile(join(dirname(d.entry.path),'assets/template.bin'));assert.throws(()=>s.saveFile('project',d.entry.id,{path:'assets/template.bin',revision:'x',text:'bad'},f.project),/Двоичный/);assert.deepEqual(await readFile(join(dirname(d.entry.path),'assets/template.bin')),binary)
 if(process.platform!=='win32'){await symlink(f.input,join(dirname(d.entry.path),'linked'));assert.throws(()=>s.getFile('project',d.entry.id,'linked/SKILL.md',f.project),/Ссылки/);assert.throws(()=>s.get('project',d.entry.id,f.project),/Ссылки/)}
}))
test('add a binary file from disk keeps bytes, never overwrites; package limits are enforced',()=>use(async(f,s)=>{
 let d=s.importDirectory('project',f.input,f.project);const external=join(f.base,'new.bin');await writeFile(external,Buffer.from([0,128,255]))
 d=s.importFile('project',d.entry.id,external,'assets',d.treeRevision,f.project);assert.deepEqual(await readFile(join(dirname(d.entry.path),'assets/new.bin')),Buffer.from([0,128,255]));assert.throws(()=>s.importFile('project',d.entry.id,external,'assets',d.treeRevision,f.project),/существует/)
 await writeFile(join(f.input,'huge.bin'),Buffer.alloc(20_000_001));assert.throws(()=>s.importDirectory('user',f.input,f.project),/20 МБ/);assert.equal(s.list('user',f.project).entries.length,0)
}))
test('package IPC supports create, inspect and rename and rejects invalid scopes',()=>use(async(f)=>{
 const h=await harness({userData:join(f.base,'app'),folder:f.project});try{
  await h.invoke('select-folder');const r=await h.invoke('save-skill',{scope:'project',id:null,revision:null,name:'ipc-package',description:'IPC package',body:'Instructions',userInvocable:true,modelInvocable:true});assert.equal(r.ok,true,r.error)
  let d=r.value;let next=await h.invoke('change-skill-path','project',d.entry.id,{action:'file',path:'scripts/check.ts',revision:d.treeRevision});assert.equal(next.ok,true,next.error);d=next.value
  let asset=await h.invoke('inspect-skill-file','project',d.entry.id,'scripts/check.ts');assert.equal(asset.value.kind,'text')
  next=await h.invoke('change-skill-path','project',d.entry.id,{action:'rename',path:'scripts','target':'rules',revision:d.treeRevision});assert.equal(next.ok,true,next.error);assert.ok(next.value.files.some(n=>n.path==='rules/check.ts'))
  assert.equal((await h.invoke('change-skill-path','bad',d.entry.id,{})).ok,false)
 }finally{await h.close()}
}))
test('moves validate descendant depth before mutation and nested mkdir respects directory budget',()=>use(async(f,s)=>{
 let d=s.importDirectory('project',f.input,f.project)
 const deep=Array.from({length:11},(_,i)=>'d'+i).join('/');d=change(s,d,f,'directory',deep)
 assert.throws(()=>change(s,d,f,'rename','rules',deep+'/rules'),/путь/)
 assert.ok(s.get('project',d.entry.id,f.project).files.some(n=>n.path==='rules/style.md'))
 const root=dirname(d.entry.path);let count=d.files.filter(n=>n.kind==='directory').length
 while(count<498){await mkdir(join(root,'budget-'+count));count++}
 d=s.get('project',d.entry.id,f.project)
 assert.throws(()=>change(s,d,f,'directory','new/deep'),/500 каталогов/)
 assert.ok(!s.get('project',d.entry.id,f.project).files.some(n=>n.path==='new'))
}))
