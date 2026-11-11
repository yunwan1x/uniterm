import { describe, it, expect, vi } from 'vitest'
import { fetchOwner, ownersOf } from './k8sOwners'
const source = {metadata: {namespace: 'prod'}}
const owner = {apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'api-123', uid: 'rs1'}
describe('owner navigation', () => {
  it('loads the exact namespaced owner and exposes the correct edit path', async () => {
    const request = vi.fn().mockResolvedValue({status: 200, data: {metadata: {uid:'rs1'}}})
    const result = await fetchOwner('conn', source, owner, request)
    expect(request).toHaveBeenCalledWith('conn','GET','/apis/apps/v1/namespaces/prod/replicasets/api-123')
    expect(result.resourceKey).toBe('replicasets')
    expect(result.target.kind).toBe('ReplicaSet')
    expect(result.selfPath()).toBe('/apis/apps/v1/namespaces/prod/replicasets/api-123')
  })
  it('resolves custom resource plurals and cluster scope via discovery', async () => {
    const request = vi.fn().mockResolvedValueOnce({status:200,data:{resources:[{name:'policies/status',kind:'Policy',verbs:['get']},{name:'policies',kind:'Policy',namespaced:false,verbs:['get']}]}}).mockResolvedValueOnce({status:200,data:{metadata:{name:'root'}}})
    const result = await fetchOwner('conn',source,{apiVersion:'example.io/v1',kind:'Policy',name:'root'},request)
    expect(request).toHaveBeenLastCalledWith('conn','GET','/apis/example.io/v1/policies/root')
    expect(result.resourceKey).toBe('__custom_owner__')
  })
  it('rejects a deleted and recreated resource with the same name', async () => {
    await expect(fetchOwner('conn',source,owner,vi.fn().mockResolvedValue({status:200,data:{metadata:{uid:'other'}}}))).rejects.toThrow('UID mismatch')
  })
  it.each([403,404])('reports HTTP %i without manufacturing a resource',async status => {
    await expect(fetchOwner('conn',source,owner,vi.fn().mockResolvedValue({status,raw:'unavailable'}))).rejects.toThrow(`HTTP ${status}`)
  })
  it('rejects namespaced lookups without a namespace',async () => {
    const request=vi.fn()
    await expect(fetchOwner('conn',{},owner,request)).rejects.toThrow('Namespace unavailable')
    expect(request).not.toHaveBeenCalled()
  })
  it('retains multiple owners, with an empty list for unowned resources',() => {
    expect(ownersOf({})).toEqual([])
    expect(ownersOf({metadata:{ownerReferences:[owner,{...owner,name:'other'}]}})).toHaveLength(2)
  })
})
