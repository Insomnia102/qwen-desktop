import {accessSync,constants,readdirSync,statSync} from 'node:fs'
import {homedir} from 'node:os'
import {delimiter,isAbsolute,join} from 'node:path'

/** GUI launches on macOS/Linux may omit user-installed command directories.
 * Discover known installation locations without executing shell startup files. */
export function commandPath(home=homedir(),env:NodeJS.ProcessEnv=process.env,platform=process.platform):string {
 const original=env.PATH??''
 if(platform==='win32')return original
 const directories=original.split(delimiter).filter(Boolean)
 const add=(path:string):void=>{if(!isAbsolute(path)||directories.includes(path))return;try{if(statSync(path).isDirectory()){accessSync(path,constants.X_OK);directories.push(path)}}catch{}}
 for(const path of [join(home,'.local/bin'),join(home,'.volta/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin'])add(path)
 const versionRoots=[{root:join(env.NVM_DIR??join(home,'.nvm'),'versions/node'),suffix:'bin'},
  ...[join(home,'.fnm/node-versions'),join(home,'.local/share/fnm/node-versions'),join(home,'Library/Application Support/fnm/node-versions')].map(root=>({root,suffix:'installation/bin'}))]
 for(const {root,suffix}of versionRoots){try{
  const versions=readdirSync(root).filter(n=>/^v?\d+\.\d+\.\d+$/.test(n)).sort((a,b)=>{const x=a.replace(/^v/,'').split('.').map(Number),y=b.replace(/^v/,'').split('.').map(Number);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2]})
  for(const version of versions.slice(0,100))add(join(root,version,suffix))
 }catch{}}
 return directories.join(delimiter)
}
export function restoreCommandPath():void {if(process.platform!=='win32')process.env.PATH=commandPath()}
