// Executed only by the tag workflow, after all native build jobs succeed.
import {spawnSync} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import {verify} from './release-assets.mjs'
import {packageMetadata} from './ci-metadata.mjs'
import {releaseNotes} from './release-legal.mjs'
const pkg=JSON.parse(await readFile('package.json','utf8')),meta=packageMetadata(pkg)
if(process.env.GITHUB_REF!=='refs/tags/'+meta.tag)throw Error('Only the exact version tag can create a release.')
const repo=process.env.GITHUB_REPOSITORY;if(!repo||!/^[-\w.]+\/[-\w.]+$/.test(repo))throw Error('Missing repository')
const body=releaseNotes(pkg,repo,process.env.GITHUB_SHA)
const assets=await verify(pkg.version)
const view=spawnSync('gh',['release','view',meta.tag,'--repo',repo,'--json','isDraft'],{encoding:'utf8'})
if(view.status===0){if(!JSON.parse(view.stdout).isDraft)throw Error('The release is already public. Published assets are never overwritten.')}
else{
 await writeFile('release-notes.md',body)
 const args=['release','create',meta.tag,'--repo',repo,'--verify-tag','--draft','--title',`Qwen Desktop ${meta.tag}`,'--notes-file','release-notes.md']
 if(meta.prerelease==='true')args.push('--prerelease')
 const result=spawnSync('gh',args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1)
}
// Keep an existing draft's notes synchronized when a failed upload is retried.
await writeFile('release-notes.md',body)
const edit=spawnSync('gh',['release','edit',meta.tag,'--repo',repo,'--notes-file','release-notes.md'],{stdio:'inherit'})
if(edit.status!==0)process.exit(edit.status??1)
const result=spawnSync('gh',['release','upload',meta.tag,...assets.map(n=>'release-assets/'+n),'--repo',repo,'--clobber'],{stdio:'inherit'})
if(result.status!==0)process.exit(result.status??1)
