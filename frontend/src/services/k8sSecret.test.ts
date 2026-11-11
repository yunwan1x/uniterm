import {describe, it, expect} from 'vitest'
import {decodeSecret, encodeSecret, secretPatch} from './k8sSecret'
describe('Secret plaintext editing', () => {
  it.each(['hello', '中文🔐\nline two\n', '', '\ufeffBOM', 'a\r\nb'])('round trips UTF-8 %j without changing bytes', text => {
    const encoded = encodeSecret(text)
    expect(decodeSecret({key: encoded})[0]).toMatchObject({text,binary:false})
  })
  it('preserves binary and invalid base64 without presenting them as editable text', () => {
    expect(decodeSecret({binary:'/wAA',invalid:'***'}).every(e=>e.binary)).toBe(true)
  })
  it('patches only changed text keys and guards the resourceVersion', () => {
    const entries=decodeSecret({password:encodeSecret('old'),unchanged:encodeSecret('same'),binary:'/wAA'})
    entries[0].text='新密码'
    expect(secretPatch({metadata:{resourceVersion:'17'}},entries)).toEqual({metadata:{resourceVersion:'17'},data:{password:encodeSecret('新密码')}})
  })
  it('supports clearing a value without deleting its key', () => {
    const entries=decodeSecret({key:encodeSecret('old')});entries[0].text=''
    expect(secretPatch({metadata:{resourceVersion:'2'}},entries).data).toEqual({key:''})
  })
  it('rejects immutable or unversioned changes', () => {
    expect(()=>secretPatch({immutable:true},[])).toThrow('immutable')
    expect(()=>secretPatch({},[])).toThrow('resourceVersion')
  })
})
