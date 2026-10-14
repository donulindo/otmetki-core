import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {publicRepositoryUrl} from '../../src/components/public-source';

test('public repository link stays closed until explicitly verified',()=>{
  assert.equal(publicRepositoryUrl('https://github.com/donulindo/otmetki-core',undefined),null);
  assert.equal(publicRepositoryUrl('https://github.com/donulindo/otmetki-core','false'),null);
  assert.equal(publicRepositoryUrl('https://github.com/donulindo/otmetki-core/','true'),'https://github.com/donulindo/otmetki-core');
});
test('public repository link rejects personal accounts, origin addresses and credential URLs',()=>{
  for(const value of ['https://github.com/personal-user/project','http://github.com/donulindo/otmetki-core',('https:'+'//'+['192','0','2','1'].join('.')+'/repo'),('https:'+'//'+'secret'+'@github.com/donulindo/otmetki-core'),'https://github.com/donulindo/../private','https://github.com/donulindo/..','https://github.com/donulindo/otmetki-core?token=secret','https://github.com/donulindo/otmetki-core#private',('https:'+'//github.com.evil.example/donulindo/otmetki-core')])assert.equal(publicRepositoryUrl(value,'true'),null,value);
});
test('standalone stable collaboration pages contain acceptance gate and no private controls',()=>{
  for(const name of ['contribution.html','develop.html']){
    const source=readFileSync(new URL(`../../public/contribution/${name}`,import.meta.url),'utf8');
    assert.ok(!source.includes('SPEC.md'));
    assert.ok(!source.includes('/api/developers'));
    assert.ok(!source.includes('/api/proxy'));
    assert.ok(!source.includes('preview-access'));
    assert.ok(!source.includes('app/.data'));
    assert.ok(!source.includes('https://github.com/personal-user'));
    assert.ok(source.includes('__PUBLIC_SOURCE_REPOSITORY_URL__'));
  }
  const source=readFileSync(new URL('../../public/contribution/contribution.html',import.meta.url),'utf8');
  assert.ok(source.includes('Для принятия правки нужен статус разработчика'));
  assert.ok(source.includes('верифицированного разработчика с действующим статусом'));
  assert.ok(source.includes('Приём заявок готовится'));
  assert.ok(source.includes('disabled=""'));
});
