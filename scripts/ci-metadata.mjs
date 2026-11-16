import {pathToFileURL} from 'node:url'
import {readFileSync,appendFileSync,existsSync} from 'node:fs'
export function packageMetadata(pkg,ref=process.env.GITHUB_REF??''){
 const version=pkg.version
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))throw Error('package.json needs a valid release version, for example 0.1.0 or 0.1.0-beta.1.')
 if(!/^pnpm@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+.*)?$/.test(pkg.packageManager??''))throw Error('Pin packageManager first: pnpm exec node scripts/prepare-release.mjs; then pnpm install.')
 const tag='v'+version
 if(ref.startsWith('refs/tags/')&&ref!=='refs/tags/'+tag)throw Error(`Tag must be ${tag} to match package.json.`)
 return{version,tag,prerelease:String(version.includes('-'))}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const meta=packageMetadata(JSON.parse(readFileSync('package.json','utf8')))
if(!existsSync('pnpm-lock.yaml'))throw Error('Commit pnpm-lock.yaml before running CI.')
if(process.env.GITHUB_OUTPUT)for(const[k,v]of Object.entries(meta))appendFileSync(process.env.GITHUB_OUTPUT,`${k}=${v}\n`)
console.log('Release metadata:',meta)
}
