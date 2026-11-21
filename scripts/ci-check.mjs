import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {dirname,join} from 'node:path'
import {readdirSync,readFileSync,existsSync} from 'node:fs'
if(!existsSync(new URL('./ci-preflight.mjs',import.meta.url))){console.error('Нет scripts/ci-preflight.mjs. Скопируйте CI-исправление целиком в корень проекта.');process.exit(1)}
const {checkCiSetup}=await import('./ci-preflight.mjs')
if(!checkCiSetup())process.exit(1)
if(process.argv.includes('--check-files'))process.exit(0)
const require=createRequire(import.meta.url)
const env={...process.env,QWEN_USAGE_STATISTICS_ENABLED:'false',QWEN_TELEMETRY_ENABLED:'false',OTEL_SDK_DISABLED:'true',QWEN_CODE_MODELS_DEV_REFRESH:'off'}
function node(args){const result=spawnSync(process.execPath,args,{stdio:'inherit',env,windowsHide:true});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1)}
const pkg=JSON.parse(readFileSync('package.json','utf8'))
for(const name of ['@qwen-code/sdk','@modelcontextprotocol/sdk','@electron-toolkit/preload','@electron-toolkit/utils','jsonc-parser','yaml','marked','dompurify'])if(!pkg.dependencies?.[name])throw Error(`${name} must be a production dependency. Run scripts/prepare-release.mjs.`)
node([require.resolve('typescript/bin/tsc'),'-p','tsconfig.ci.json','--noUnusedLocals','--noUnusedParameters'])
const files=readdirSync('tests').filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'tests/'+n)
node(['--test','--test-concurrency=4',...files])
node([join(dirname(require.resolve('electron-vite/package.json')),'bin/electron-vite.js'),'build'])
node(['tests/ui-onboarding.mjs']);node(['tests/ui-studio.mjs']);node(['tests/ui-skill-tests.mjs']);node(['tests/ui-skill-dialogue.mjs'])
