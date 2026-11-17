// Refresh the assets embedded in the Windows launcher after rebuilding TS.
import {mkdir,copyFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const web=resolve(root,'launcher/web');
await mkdir(web,{recursive:true});
for(const file of ['index.html','styles.css'])await copyFile(resolve(root,file),resolve(web,file));
await cp(resolve(root,'dist/js'),resolve(web,'dist/js'),{recursive:true,force:true});
console.log('Windows embedded web assets refreshed.');
