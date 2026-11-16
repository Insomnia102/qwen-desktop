// Run once from the repository root, then pnpm install and commit the lockfile.
import {readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
export function preparePackage(input,pnpmVersion){
 const p=structuredClone(input)
 const existing=p.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\+.*)?$/)
 if(!existing&&!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pnpmVersion??''))throw Error('Run with pnpm exec node scripts/prepare-release.mjs, or pass --pnpm-version X.Y.Z.')
 if(p.packageManager&&!existing)throw Error('This release workflow uses pnpm. Set packageManager to your exact pnpm version first.')
 p.packageManager??='pnpm@'+pnpmVersion;p.version??='0.1.0';p.main??='out/main/index.js'
 if(typeof p.main==='string')p.main=p.main.replace(/^\.\//,'')
 if(p.main!=='out/main/index.js')throw Error('Expected main: out/main/index.js. Review the entry point before enabling this workflow.')
 if(p.description==='A minimal Electron application with TypeScript')delete p.description
 if(p.author==='example.com')delete p.author
 if(p.homepage==='https://electron-vite.org')delete p.homepage
 p.description??='A community desktop interface for Qwen Code';p.private??=true
 p.dependencies??={};p.devDependencies??={};p.scripts??={}
 const runtime={'@qwen-code/sdk':'0.1.32','@modelcontextprotocol/sdk':'1.32.2','@electron-toolkit/preload':'3.0.2','@electron-toolkit/utils':'4.0.0','jsonc-parser':'3.3.1','marked':'18.2.0','dompurify':'3.4.17','yaml':'2.8.1'}
 for(const[name,fallback]of Object.entries(runtime)){p.dependencies[name]??=p.devDependencies[name]??fallback;delete p.devDependencies[name]}
 // The bridge and native tool catalogue in this source release target SDK 0.1.32.
 p.dependencies['@qwen-code/sdk']='0.1.32'
 const dev={electron:'44.10.2','electron-vite':'6.0.0',vite:'8.3.7','electron-builder':'26.18.0',typescript:'5.9.3','@types/node':'22.20.5',jsdom:'31.0.1',esbuild:'0.28.2'}
 for(const[name,version]of Object.entries(dev))if(!p.dependencies[name])p.devDependencies[name]??=version
 // This config uses the electron-builder v26 signing schema.
 p.devDependencies['electron-builder']='26.18.0';delete p.dependencies['electron-builder']
 const scripts={dev:'electron-vite dev',build:'electron-vite build','typecheck:ci':'tsc -p tsconfig.ci.json','check:ci':'node scripts/ci-check.mjs','build:win':'electron-vite build && electron-builder --win --x64 --publish never','build:mac':'electron-vite build && electron-builder --mac --publish never','build:linux':'electron-vite build && electron-builder --linux --x64 --publish never'}
 for(const[name,value]of Object.entries(scripts))p.scripts[name]??=value
 return p
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const p=JSON.parse(await readFile('package.json','utf8')),flag=process.argv.indexOf('--pnpm-version'),version=flag>=0?process.argv[flag+1]:process.env.npm_config_user_agent?.match(/pnpm\/(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1]
 const prepared=preparePackage(p,version)
 await writeFile('package.json',JSON.stringify(prepared,null,2)+'\n')
 let ignored='';try{ignored=await readFile('.gitignore','utf8')}catch(error){if(error.code!=='ENOENT')throw error}
 const extra=(await readFile('.gitignore.release','utf8')).split('\n').filter(line=>line&&!line.startsWith('#')&&!ignored.split(/\r?\n/).includes(line))
 if(extra.length)await writeFile('.gitignore',ignored.replace(/\n?$/,'\n')+'\n# Qwen Desktop release outputs and local credentials\n'+extra.join('\n')+'\n')
 console.log('Updated package.json. Run pnpm install and commit package.json and pnpm-lock.yaml together.')
 if(p.dependencies?.['node-pty']||p.devDependencies?.['node-pty'])console.warn('node-pty is still declared. The SDK bridge does not use it; remove it if no other feature needs it before building Electron.')
}
