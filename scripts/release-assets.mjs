import {mkdir,readdir,copyFile,readFile,writeFile} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
export const targets={'win-x64':['exe'],'linux-x64':['AppImage','tar.gz'],'mac-x64':['dmg','zip'],'mac-arm64':['dmg','zip']}
const safeVersion=v=>{if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(v))throw Error('Invalid package version');return v}
export function assetNames(version,target){safeVersion(version);if(!targets[target])throw Error('Unsupported release target');return targets[target].map(ext=>`qwen-desktop-${version}-${target}.${ext}`)}
async function hash(path){const h=createHash('sha256');for await(const bytes of createReadStream(path))h.update(bytes);return h.digest('hex')}
export async function collect(version,target,source='dist',destination='release-assets'){
 const expected=assetNames(version,target);await mkdir(destination,{recursive:true})
 for(const name of expected){
  // electron-builder expands ${arch} to x86_64 for AppImage, and to x64
  // for tar.gz. Keep the public release naming consistent across formats.
  const builtName=target==='linux-x64'&&name.endsWith('.AppImage')?name.replace('-linux-x64.AppImage','-linux-x86_64.AppImage'):name
  await copyFile(join(source,builtName),join(destination,name))
 }
 const lines=[];for(const name of expected)lines.push(`${await hash(join(destination,name))}  ${name}`)
 await writeFile(join(destination,`SHA256SUMS-${target}.txt`),lines.join('\n')+'\n')
 return expected
}
export async function verify(version,directory='release-assets'){
 const expected=Object.keys(targets).flatMap(target=>assetNames(version,target)),allowed=new Set([...expected,...Object.keys(targets).map(t=>`SHA256SUMS-${t}.txt`),'SHA256SUMS.txt'])
 const files=await readdir(directory);for(const name of files)if(!allowed.has(name))throw Error('Unexpected release asset: '+name)
 const lines=[]
 for(const target of Object.keys(targets)){
  const entries=(await readFile(join(directory,`SHA256SUMS-${target}.txt`),'utf8')).trim().split('\n'),names=assetNames(version,target)
  if(entries.length!==names.length)throw Error('Incomplete checksum manifest: '+target)
  for(let i=0;i<names.length;i++){
   const entry=entries[i].match(/^([a-f0-9]{64})  (.+)$/)
   if(!entry||entry[2]!==names[i])throw Error('Invalid checksum manifest: '+target)
   if(await hash(join(directory,names[i]))!==entry[1])throw Error('Checksum mismatch: '+names[i])
   lines.push(entries[i])
  }
 }
 await writeFile(join(directory,'SHA256SUMS.txt'),lines.sort().join('\n')+'\n')
 return [...expected,'SHA256SUMS.txt']
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const pkg=JSON.parse(await readFile('package.json','utf8'));if(pkg.name!=='qwen-desktop')throw Error('Update asset naming together with package.name before renaming this app.')
 if(process.argv[2]==='collect')console.log(await collect(pkg.version,`${({win32:'win',darwin:'mac',linux:'linux'})[process.platform]}-${process.arch}`))
 else if(process.argv[2]==='verify')console.log(await verify(pkg.version))
 else throw Error('Use collect or verify')
}
