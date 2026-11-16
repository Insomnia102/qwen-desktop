import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {createRequire} from 'node:module'
import {parse} from 'yaml'
import {preparePackage} from '../scripts/prepare-release.mjs'
import {packageMetadata} from '../scripts/ci-metadata.mjs'
import {assetNames,collect,verify,targets} from '../scripts/release-assets.mjs'
const require=createRequire(import.meta.url)
function builderAssetNames(config,version,target){
 const builderRequire=createRequire(require.resolve('electron-builder/package.json'))
 const {PlatformPackager,Arch}=builderRequire('app-builder-lib')
 const [platform,arch]=target.split('-')
 // Exercise the installed builder's template and architecture expansion, rather
 // than manufacturing source files from the collector's own expected names.
 const packager=Object.assign(Object.create(PlatformPackager.prototype),{info:{config},platform:{buildConfigurationKey:platform},appInfo:{name:'qwen-desktop',version},platformSpecificBuildOptions:config[platform]??{}})
 return targets[target].map(ext=>packager.expandArtifactNamePattern(config[ext==='AppImage'?'appImage':ext==='exe'?'nsis':ext],ext,Arch[arch]))
}
test('release package preparation preserves existing scripts and pins the supported transport/build versions',()=>{
 const input={name:'qwen-desktop',version:'0.1.0',author:'Keep Author',scripts:{dev:'custom dev'},dependencies:{marked:'18.2.0'},devDependencies:{'@qwen-code/sdk':'^0.1.32'},custom:{keep:true}}
 const result=preparePackage(input,'11.0.0');assert.equal(result.scripts.dev,'custom dev');assert.equal(result.author,'Keep Author');assert.deepEqual(result.custom,{keep:true});assert.equal(result.packageManager,'pnpm@11.0.0');assert.equal(result.dependencies['@qwen-code/sdk'],'0.1.32');assert.equal(result.devDependencies['@qwen-code/sdk'],undefined);assert.equal(result.devDependencies['electron-builder'],'26.18.0');assert.deepEqual(preparePackage(result),result);assert.equal(input.packageManager,undefined)
 assert.throws(()=>preparePackage({...input,packageManager:'npm@11.0.0'},'11.0.0'),/pnpm/)
})
test('release tags must exactly match package version and cannot inject workflow commands',()=>{
 const p={version:'0.1.0-beta.1',packageManager:'pnpm@11.0.0'};assert.equal(packageMetadata(p,'refs/tags/v0.1.0-beta.1').prerelease,'true');assert.throws(()=>packageMetadata(p,'refs/tags/v0.1.0'),/Tag/);assert.throws(()=>packageMetadata({...p,version:'bad\nvalue'}),/valid/)
})
test('real builder filenames are collected with unique public names and verified checksums',async()=>{
 const base=await mkdtemp(join(tmpdir(),'qwen-release-assets-')),source=join(base,'dist'),destination=join(base,'collected');await mkdir(source)
 try{const config=parse(await readFile('electron-builder.yml','utf8'))
  assert.deepEqual(builderAssetNames(config,'0.1.0','linux-x64'),['qwen-desktop-0.1.0-linux-x86_64.AppImage','qwen-desktop-0.1.0-linux-x64.tar.gz'])
  for(const target of Object.keys(targets)){
   const native=builderAssetNames(config,'0.1.0',target),published=assetNames('0.1.0',target)
   for(const name of native)await writeFile(join(source,name),name)
   await collect('0.1.0',target,source,destination)
   for(let i=0;i<native.length;i++)assert.equal(await readFile(join(destination,published[i]),'utf8'),native[i])
  }
  const result=await verify('0.1.0',destination);assert.equal(result.length,8);assert.equal(new Set(result).size,8)
  await writeFile(join(destination,result[0]),'changed');await assert.rejects(verify('0.1.0',destination),/Checksum/)
  await rm(join(destination,result[0]));await assert.rejects(verify('0.1.0',destination),{code:'ENOENT'})
 }finally{await rm(base,{recursive:true,force:true})}
})
test('builder config validates against electron-builder 26 and keeps the SDK/bootstrap unpacked',async()=>{
 const builderRequire=createRequire(require.resolve('electron-builder/package.json')),lib=builderRequire.resolve('app-builder-lib/package.json'),{validateConfiguration}=builderRequire(join(dirname(lib),'out/util/config/config.js'))
 const config=parse(await readFile('electron-builder.yml','utf8'));await validateConfiguration(config,{add(){}})
 assert.equal(config.productName,'qwen-desktop');assert.equal(config.mac.identity,'-');assert.equal(config.mac.notarize,false);assert.ok(config.asarUnpack.includes('resources/**'));assert.ok(config.asarUnpack.includes('node_modules/@qwen-code/sdk/**'));assert.equal(config.publish,null)
 const plist=await readFile(config.mac.entitlements,'utf8');assert.match(plist,/allow-jit/);assert.match(plist,/disable-library-validation/)
})
test('workflows use four native targets, frozen install, least privilege, and draft-only tag publication',async()=>{
 const ci=parse(await readFile('.github/workflows/ci.yml','utf8')),release=parse(await readFile('.github/workflows/release.yml','utf8')),setup=parse(await readFile('.github/actions/setup-project/action.yml','utf8'))
 assert.equal(ci.permissions.contents,'read');assert.ok(ci.on.pull_request!==undefined);assert.equal(release.permissions.contents,'read');assert.equal(release.jobs.publish.permissions.contents,'write');assert.equal(release.jobs.publish.needs,'build');assert.match(release.jobs.publish.if,/refs\/tags\/v/);assert.match(release.jobs.publish.if,/github.event_name == 'push'/)
 const matrix=release.jobs.build.strategy.matrix.include;assert.equal(matrix.length,4);assert.deepEqual(matrix.map(m=>m.platform+'-'+m.arch).sort(),Object.keys(targets).sort());assert.ok(setup.runs.steps.some(s=>s.run==='pnpm install --frozen-lockfile'))
 assert.ok(release.jobs.build.steps.some(s=>s.run==='node scripts/package-smoke.mjs'));assert.match(await readFile('scripts/publish-release.mjs','utf8'),/--draft/)
})

test('Electron-vite dot-slash entry and version 1.0.0 survive preparation; scaffold branding is removed',()=>{
 const input={name:'qwen-desktop',version:'1.0.0',description:'A minimal Electron application with TypeScript',main:'./out/main/index.js',author:'example.com',homepage:'https://electron-vite.org',scripts:{postinstall:'install-electron && electron-builder install-app-deps'},devDependencies:{marked:'18.2.0',dompurify:'3.4.17'}}
 const p=preparePackage(input,'11.0.0');assert.equal(p.main,'out/main/index.js');assert.equal(p.version,'1.0.0');assert.equal(packageMetadata(p,'refs/tags/v1.0.0').tag,'v1.0.0');assert.equal(p.dependencies.marked,'18.2.0');assert.equal(p.dependencies.dompurify,'3.4.17');assert.equal(p.devDependencies.marked,undefined);assert.equal(p.devDependencies.dompurify,undefined);assert.equal(p.scripts.postinstall,input.scripts.postinstall);assert.equal(p.author,undefined);assert.equal(p.homepage,undefined);assert.match(p.description,/Qwen/);assert.deepEqual(preparePackage(p),p)
 assert.equal(input.main,'./out/main/index.js');assert.throws(()=>preparePackage({...input,main:'../out/main/index.js'},'11.0.0'),/entry point/)
})
