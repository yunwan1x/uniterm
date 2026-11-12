import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
writeFileSync(join(process.argv[2],'package.json'), JSON.stringify({
  name:'@ys-ll/ironrdp-wasm',version:'0.5.1-uniterm.2',type:'module',
  description:'Pinned IronRDP with opt-in frame-atomic EGFX and batched Canvas presentation',
  main:'ironrdp.js',types:'ironrdp.d.ts',license:'MIT OR Apache-2.0',
  repository:'https://github.com/Devolutions/IronRDP',
  files:['ironrdp.js','ironrdp.d.ts','ironrdp_bg.wasm','ironrdp_bg.wasm.d.ts','snippets','LICENSE-*']
},null,2)+'\n');
