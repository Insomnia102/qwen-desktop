// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Egor Svirin
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir,readdir,realpath,copyFile,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join,dirname,relative,isAbsolute} from 'node:path'

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
const licenseFile=/^(?:licen[cs]es?|copying|notice|copyright)(?:$|[._-])/i
const packageName=/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i
const defaultRepository='Tsukuyomi102/qwen-desktop'

export function sourceLinks(repository,commit){
 if(!/^[-\w.]+\/[-\w.]+$/.test(repository)||repository.split('/').some(p=>p==='.'||p==='..'))throw Error('Invalid source repository')
 if(!/^[a-f0-9]{40}$/.test(commit??''))throw Error('A release needs its exact source commit (GITHUB_SHA).')
 const base=`https://github.com/${repository}`
 return {repository,commit,tree:`${base}/tree/${commit}`,zip:`${base}/archive/${commit}.zip`,tar:`${base}/archive/${commit}.tar.gz`}
}

export function releaseNotes(pkg,repository,commit){
 if(pkg.license!=='GPL-3.0-only')throw Error('Expected package.json license: GPL-3.0-only')
 const source=sourceLinks(repository,commit)
 return `Qwen Desktop v${pkg.version}\n\nCommunity desktop client for Qwen Code.\n\n- Windows x64: .exe\n- Linux x64: .AppImage or .tar.gz\n- macOS: choose x64 (Intel) or arm64 (Apple Silicon)\n\n## License and source code\n\nThis publication is distributed under GPL-3.0-only. Earlier Unlicense/MIT permissions remain applicable to the revisions previously published under those terms. Third-party components retain their own licenses.\n\n- [Source tree for this build](${source.tree})\n- [Download source ZIP](${source.zip})\n- [Download source tar.gz](${source.tar})\n- Source commit: \`${source.commit}\`\n\nThe installed application includes the GPL text, dependency notices and SOURCE_CODE.txt in its resources/legal folder (Contents/Resources/legal on macOS). Preserve source availability while distributing these binaries.\n\nFirst Windows builds are unsigned; macOS uses an ad-hoc signature without notarization. Node.js 22+ with npm is required to prepare Qwen CLI on first launch (26.x recommended). Model credentials are configured in the app. SHA256SUMS.txt contains installer checksums.\n\nThis is a draft: complete the native smoke checks in docs/RELEASING.md before publishing.\n`
}

async function resolvePackage(name,parent){
 if(!packageName.test(name))throw Error('Invalid dependency name')
 for(const base of createRequire(join(parent,'package.json')).resolve.paths(name)??[]){
  const path=join(base,name,'package.json')
  try{await stat(path);return await realpath(join(base,name))}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error}
 }
 return null
}

async function dependencyInventory(project,root){
 const queue=Object.keys(root.dependencies??{}).map(name=>({name,parent:project,optional:false}))
 // Electron itself is supplied by the packager, rather than package.json's
 // production dependencies; retain its package license in the inventory too.
 if(root.devDependencies?.electron)queue.push({name:'electron',parent:project,optional:false})
 const visited=new Set(),result=[]
 while(queue.length){
  const item=queue.shift(),directory=await resolvePackage(item.name,item.parent)
  if(!directory){if(item.optional)continue;throw Error(`Missing dependency while collecting licenses: ${item.name}`)}
  if(visited.has(directory))continue;visited.add(directory)
  const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
  if(!packageName.test(pkg.name??'')||typeof pkg.version!=='string')throw Error('Invalid dependency metadata')
  result.push({directory,name:pkg.name,version:pkg.version,license:typeof pkg.license==='string'?pkg.license:'Not declared; see package notices'})
  for(const name of Object.keys(pkg.dependencies??{}))queue.push({name,parent:directory,optional:Boolean(pkg.optionalDependencies?.[name])})
  for(const name of new Set([...Object.keys(pkg.optionalDependencies??{}),...Object.keys(pkg.peerDependencies??{})]))queue.push({name,parent:directory,optional:true})
 }
 return result.sort((a,b)=>`${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
}

export async function writeLegalBundle(project,resources,{repository=defaultRepository,commit}={}){
 const pkg=JSON.parse(await readFile(join(project,'package.json'),'utf8'))
 if(pkg.license!=='GPL-3.0-only')throw Error('Set package.json license to GPL-3.0-only before packaging.')
 const license=await readFile(join(project,'LICENSE'))
 if(!license.toString().includes('Version 3, 29 June 2007')||!license.toString().includes('17. Interpretation of Sections 15 and 16.'))throw Error('LICENSE must contain the complete GNU GPLv3 text.')
 const introduction=await readFile(join(project,'THIRD_PARTY_NOTICES.md'),'utf8')
 const source=commit?sourceLinks(repository,commit):null
 const legal=join(resources,'legal'),files={},packages=[]
 await mkdir(legal,{recursive:true})
 async function put(name,bytes){const path=join(legal,...name.split('/'));await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);files[name]=sha256(bytes)}
 await put('LICENSE',license)
 await put('SOURCE_CODE.txt',source?`Qwen Desktop ${pkg.version}\nLicense: ${pkg.license}\nSource commit: ${source.commit}\nSource tree: ${source.tree}\nSource ZIP: ${source.zip}\nSource tar.gz: ${source.tar}\n\nKeep these sources available while distributing the matching binaries.\n`:'Local development build. No release source commit was supplied.\nUse GitHub Actions for a publication with exact source links.\n')
 for(const dependency of await dependencyInventory(project,pkg)){
  const folder=`third-party/${encodeURIComponent(dependency.name)}@${encodeURIComponent(dependency.version)}`,documents=[]
  async function walk(directory){
   for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.name==='node_modules'||entry.name==='.git'||entry.isSymbolicLink())continue
    const path=join(directory,entry.name)
    if(entry.isDirectory())await walk(path)
    else if(entry.isFile()&&licenseFile.test(entry.name)){
     const rel=relative(dependency.directory,path).split('\\').join('/'),name=`${folder}/${rel}`
     const target=join(legal,...name.split('/'));await mkdir(dirname(target),{recursive:true});await copyFile(path,target)
     files[name]=sha256(await readFile(target));documents.push(name)
    }
   }
  }
  await walk(dependency.directory)
  packages.push({name:dependency.name,version:dependency.version,license:dependency.license,documents:documents.sort()})
 }
 const cell=value=>String(value).replaceAll('|','\\|').replaceAll('\n',' ')
 const inventory=packages.map(p=>`| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license)} | ${p.documents.length} |`).join('\n')
 await put('THIRD_PARTY_NOTICES.md',introduction+'\n\n## Installed dependency inventory\n\n| Package | Version | Declared license | Copied notice files |\n| --- | --- | --- | --- |\n'+inventory+'\n')
 const manifest={application:{name:pkg.name,version:pkg.version,license:pkg.license},source,packages,files}
 await writeFile(join(legal,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
 return manifest
}

export async function verifyLegalBundle(resources,pkg,{repository=process.env.GITHUB_REPOSITORY??defaultRepository,commit=process.env.GITHUB_SHA}={}){
 const legal=join(resources,'legal'),manifest=JSON.parse(await readFile(join(legal,'manifest.json'),'utf8'))
 if(manifest.application?.name!==pkg.name||manifest.application?.version!==pkg.version||manifest.application?.license!=='GPL-3.0-only'||pkg.license!=='GPL-3.0-only')throw Error('Packaged license metadata does not match this build.')
 for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md','SOURCE_CODE.txt'])if(!manifest.files?.[name])throw Error('Missing packaged legal document: '+name)
 for(const [name,expected] of Object.entries(manifest.files)){
  if(isAbsolute(name)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid packaged legal path')
  if(sha256(await readFile(join(legal,...name.split('/'))))!==expected)throw Error('Packaged legal document changed: '+name)
 }
 if(commit){const expected=sourceLinks(repository,commit);if(manifest.source?.commit!==expected.commit||manifest.source?.repository!==expected.repository)throw Error('Packaged source commit does not match this release.')}
 return manifest
}

export default async function afterPack(context){
 const result=await writeLegalBundle(context.packager.projectDir,context.packager.getResourcesDir(context.appOutDir),{repository:process.env.GITHUB_REPOSITORY??defaultRepository,commit:process.env.GITHUB_SHA})
 console.log(`Included GPLv3 and notices for ${result.packages.length} dependency installations.`)
}
