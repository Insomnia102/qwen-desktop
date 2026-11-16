import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {parse} from 'yaml'
import {sourceLinks,releaseNotes,writeLegalBundle,verifyLegalBundle} from '../scripts/release-legal.mjs'

const repository='test-owner/test-project',commit='a'.repeat(40)
const require=createRequire(import.meta.url)
const pkg={name:'qwen-desktop',version:'1.0.0',license:'GPL-3.0-only',dependencies:{'@fixture/a':'1.0.0',b:'2.0.0'},devDependencies:{devOnly:'1.0.0'}}
async function fixture(){
 const base=await mkdtemp(join(tmpdir(),'qwen-legal-')),resources=join(base,'output/resources')
 await writeFile(join(base,'package.json'),JSON.stringify(pkg))
 await writeFile(join(base,'LICENSE'),await readFile('LICENSE'))
 await writeFile(join(base,'THIRD_PARTY_NOTICES.md'),'Third-party components retain their own licenses.\n')
 async function dependency(path,metadata,documents={}){
  const dir=join(base,'node_modules',path);await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify(metadata))
  for(const [name,bytes] of Object.entries(documents)){await mkdir(dirname(join(dir,name)),{recursive:true});await writeFile(join(dir,name),bytes)}
 }
 await dependency('@fixture/a',{name:'@fixture/a',version:'1.0.0',license:'Apache-2.0',exports:{'.':'./index.js'},dependencies:{shared:'1.0.0'},peerDependencies:{missingOptionalPeer:'*'}},{'dist/LICENSE':Buffer.from('Apache notice\r\n'),'dist/vendor/tool/COPYING':'Vendor notice\n'})
 await dependency('@fixture/a/node_modules/shared',{name:'shared',version:'1.0.0',license:'MIT'},{LICENSE:'Shared v1 copyright and license\n'})
 await dependency('b',{name:'b',version:'2.0.0',license:'ISC',dependencies:{shared:'2.0.0'},optionalDependencies:{missingOptional:'*'}},{NOTICE:'B copyright notice\n'})
 await dependency('b/node_modules/shared',{name:'shared',version:'2.0.0',license:'MIT'},{LICENSE:'Shared v2 copyright and license\n'})
 await dependency('devOnly',{name:'devOnly',version:'1.0.0',license:'MIT'},{LICENSE:'Development-only notice\n'})
 return {base,resources}
}
async function use(run){const f=await fixture();try{await run(f)}finally{await rm(f.base,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}

test('legal bundle retains nested notices, blocked package exports and both transitive versions; dev-only dependencies are excluded',()=>use(async f=>{
 const manifest=await writeLegalBundle(f.base,f.resources,{repository,commit})
 assert.deepEqual(manifest.packages.map(p=>p.name+'@'+p.version).sort(),['@fixture/a@1.0.0','b@2.0.0','shared@1.0.0','shared@2.0.0'])
 const first=manifest.packages.find(p=>p.name==='@fixture/a')
 assert.equal(first.documents.length,2)
 const copied=first.documents.find(p=>p.endsWith('dist/LICENSE'))
 assert.deepEqual(await readFile(join(f.resources,'legal',copied)),Buffer.from('Apache notice\r\n'))
 assert.equal(await readFile(join(f.resources,'legal/LICENSE'),'utf8'),await readFile(join(f.base,'LICENSE'),'utf8'))
 assert.ok((await readFile(join(f.resources,'legal/SOURCE_CODE.txt'),'utf8')).includes(`/archive/${commit}.zip`))
 await verifyLegalBundle(f.resources,pkg,{repository,commit})
}))

test('missing GPL, altered notices and a mismatched release commit fail packaged verification',()=>use(async f=>{
 await writeLegalBundle(f.base,f.resources,{repository,commit})
 await assert.rejects(verifyLegalBundle(f.resources,pkg,{repository,commit:'b'.repeat(40)}),/source commit/)
 const notice=join(f.resources,'legal/THIRD_PARTY_NOTICES.md')
 await writeFile(notice,'changed');await assert.rejects(verifyLegalBundle(f.resources,pkg,{repository,commit}),/changed/)
 await writeLegalBundle(f.base,f.resources,{repository,commit})
 await rm(join(f.resources,'legal/LICENSE'));await assert.rejects(verifyLegalBundle(f.resources,pkg,{repository,commit}),{code:'ENOENT'})
}))

test('missing required dependencies and an incomplete project license stop packaging',()=>use(async f=>{
 await writeFile(join(f.base,'package.json'),JSON.stringify({...pkg,dependencies:{missingRequired:'1.0.0'}}))
 await assert.rejects(writeLegalBundle(f.base,f.resources),/Missing dependency/)
 await writeFile(join(f.base,'LICENSE'),'GNU GPL version 3')
 await assert.rejects(writeLegalBundle(f.base,f.resources),/complete GNU GPLv3/)
}))

test('source links and release notes pin an immutable commit and reject incomplete release metadata',()=>{
 const source=sourceLinks(repository,commit),notes=releaseNotes(pkg,repository,commit)
 assert.equal(source.tree,`https://github.com/${repository}/tree/${commit}`)
 for(const link of [source.tree,source.zip,source.tar])assert.ok(notes.includes(link))
 assert.match(notes,/GPL-3.0-only/);assert.match(notes,/Earlier Unlicense\/MIT/)
 assert.throws(()=>sourceLinks('../outside',commit),/repository/)
 assert.throws(()=>releaseNotes(pkg,repository,undefined),/exact source commit/)
 assert.throws(()=>releaseNotes({...pkg,license:'MIT'},repository,commit),/license/)
})

test('electron-builder loads the legal hook and the generated resource bundle is checked by package smoke',()=>use(async f=>{
 const config=parse(await readFile('electron-builder.yml','utf8'))
 assert.equal(config.afterPack,'scripts/release-legal.mjs')
 const builderRequire=createRequire(require.resolve('electron-builder/package.json')),lib=builderRequire.resolve('app-builder-lib/package.json')
 const {resolveFunction}=builderRequire(join(dirname(lib),'out/util/resolve.js'))
 const hook=await resolveFunction(undefined,config.afterPack,'afterPack',process.cwd())
 assert.equal(typeof hook,'function')
 const resources=join(f.base,'mac/Qwen Desktop.app/Contents/Resources')
 await hook({appOutDir:join(f.base,'mac'),packager:{projectDir:f.base,getResourcesDir:()=>resources}})
 await verifyLegalBundle(resources,pkg,{commit:''})
 assert.match(await readFile('scripts/package-smoke.mjs','utf8'),/await verifyLegalBundle\(directory,pkg\)/)
}))
