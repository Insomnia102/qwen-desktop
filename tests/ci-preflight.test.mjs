import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {inspectCiSetup} from '../scripts/ci-preflight.mjs'
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'qwen-ci-preflight-'));await mkdir(join(dir,'scripts'));await writeFile(join(dir,'scripts/ci-files.json'),JSON.stringify({version:1,requiredFiles:['tests/load-typescript.mjs','build/entitlements.mac.plist','electron-builder.yml']}));return dir}
test('an incomplete extraction lists all missing helpers before any tests run',async()=>{
 const dir=await fixture();try{const result=inspectCiSetup(dir);assert.equal(result.ok,false);assert.deepEqual(result.missing,['tests/load-typescript.mjs','build/entitlements.mac.plist','electron-builder.yml'])}finally{await rm(dir,{recursive:true,force:true})}
})
test('the old entitlements from the Windows error log are detected; the supplied replacement passes',async()=>{
 const dir=await fixture();try{for(const path of ['tests','build'])await mkdir(join(dir,path));await writeFile(join(dir,'tests/load-typescript.mjs'),'');await writeFile(join(dir,'electron-builder.yml'),"mac:\n  identity: '-'\n");await writeFile(join(dir,'build/entitlements.mac.plist'),'<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');let result=inspectCiSetup(dir);assert.equal(result.ok,false);assert.equal(result.missing.length,0);assert.match(result.problems.join('\n'),/disable-library-validation/);await writeFile(join(dir,'build/entitlements.mac.plist'),await readFile('build/entitlements.mac.plist'));assert.equal(inspectCiSetup(dir).ok,true)}finally{await rm(dir,{recursive:true,force:true})}
})
test('a repair manifest cannot address files outside the project',async()=>{
 const dir=await fixture();try{await writeFile(join(dir,'scripts/ci-files.json'),JSON.stringify({version:1,requiredFiles:['../outside']}));assert.match(inspectCiSetup(dir).problems.join('\n'),/Недопустимый/)}finally{await rm(dir,{recursive:true,force:true})}
})
test('the check runner fails clearly when its own preflight file is absent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'qwen-ci-runner-'));try{await mkdir(join(dir,'scripts'));await writeFile(join(dir,'scripts/ci-check.mjs'),await readFile('scripts/ci-check.mjs'));const run=spawnSync(process.execPath,['scripts/ci-check.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(run.status,1);assert.match(run.stderr,/Нет scripts\/ci-preflight/);assert.doesNotMatch(run.stderr,/ERR_MODULE_NOT_FOUND/)}finally{await rm(dir,{recursive:true,force:true})}
})
