import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {closeDB,listSubjects} from '../src/lib/db';
import {createSession} from '../src/lib/auth';
import {profileDirection,subjectsForProfile} from '../src/lib/catalog';
import {GET} from '../src/app/api/catalog/route';

test('catalog uses the authenticated profile direction on the server and in the interface, ignoring query overrides',async()=>{
  const previous={data:process.env.PREVIEW_DATA_DIR,group:process.env.PREVIEW_OWNER_GROUP};
  const dir=await mkdtemp(join(tmpdir(),'otmetki-direction-'));process.env.PREVIEW_DATA_DIR=dir;closeDB();
  try {
    assert.equal((await GET(new Request('http://localhost/api/catalog'))).status,401);
    const token=createSession();const request=new Request('http://localhost/api/catalog?direction=economics&group=E104',{headers:{cookie:`otmetki_preview=${token}`}});
    for(const [group,direction] of [['M104','management'],['м104','management'],['E104','economics'],['Э104','economics']] as const){
      process.env.PREVIEW_OWNER_GROUP=group;assert.equal(profileDirection(group),direction);
      const response=await GET(request);assert.equal(response.status,200);
      const {subjects}=await response.json();assert.ok(subjects.length>0);assert.ok(subjects.every((s:{direction:string})=>s.direction===direction));
      assert.deepEqual(subjects.map((s:{id:string})=>s.id),subjectsForProfile(listSubjects(),group).map(s=>s.id));
    }
    process.env.PREVIEW_OWNER_GROUP='104';assert.equal(profileDirection('104'),null);assert.deepEqual((await (await GET(request)).json()).subjects,[]);
  } finally {
    closeDB();await rm(dir,{recursive:true,force:true});
    for(const [key,value] of [['PREVIEW_DATA_DIR',previous.data],['PREVIEW_OWNER_GROUP',previous.group]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
  }
});
