import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const js = join(process.argv[2], 'ironrdp.js')
const source = readFileSync(js, 'utf8')
const constructors = /const ret = (new WebSocket\([^;]*\));/g
if (Array.from(source.matchAll(constructors)).length !== 2) throw new Error('Check the generated WebSocket constructors')
const observer = readFileSync(new URL('./socket-observer.js', import.meta.url), 'utf8')
writeFileSync(js, source.replace(constructors, 'const ret = observeSocket($1);') + '\n' + observer)
appendFileSync(join(process.argv[2], 'ironrdp.d.ts'),
  '\nexport function observeProxySocket(url: string, callback: (socket: WebSocket) => void): () => void;\n')
writeFileSync(join(process.argv[2],'package.json'), JSON.stringify({
  name:'@ys-ll/ironrdp-wasm',version:'0.5.3-uniterm.26',type:'module',
  description:'Pinned IronRDP with Standard RDP Security, frame-atomic EGFX, batched Canvas presentation browser PCM audio and microphone/camera capture',
  main:'ironrdp.js',types:'ironrdp.d.ts',license:'MIT OR Apache-2.0',
  repository:'https://github.com/Devolutions/IronRDP',
  files:['ironrdp.js','ironrdp.d.ts','ironrdp_bg.wasm','ironrdp_bg.wasm.d.ts','snippets','LICENSE-*']
},null,2)+'\n');
