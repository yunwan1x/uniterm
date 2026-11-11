import { RESOURCES } from './k8sResources'

export interface OwnerReference { apiVersion: string; kind: string; name: string; uid?: string; controller?: boolean }
export function ownersOf(obj: any): OwnerReference[] {
  return (obj?.metadata?.ownerReferences || []).filter((r: any) => r.kind && r.name && r.apiVersion)
}
type Request = (conn: string, method: string, path: string) => Promise<{status: number; data?: any; raw?: string}>
export async function fetchOwner(conn: string, source: any, owner: OwnerReference, request: Request) {
  const base = owner.apiVersion.includes('/') ? `/apis/${owner.apiVersion.split('/').map(encodeURIComponent).join('/')}` : `/api/${encodeURIComponent(owner.apiVersion)}`
  const desc = RESOURCES.find(r => r.kind === owner.kind && r.apiVersion === owner.apiVersion)
  let resource = desc?.key
  let namespaced = desc?.namespaced
  if (!resource) {
    const discovery = await request(conn, 'GET', base)
    if (discovery.status !== 200) throw new Error(`HTTP ${discovery.status}: ${discovery.raw || owner.kind}`)
    const found = discovery.data?.resources?.find((r: any) => r.kind === owner.kind && !r.name.includes('/') && r.verbs?.includes('get'))
    if (!found) throw new Error(`Resource unavailable: ${owner.apiVersion} / ${owner.kind}`)
    resource = found.name; namespaced = found.namespaced
  }
  const ns = source.metadata?.namespace
  if (namespaced && !ns) throw new Error(`Namespace unavailable: ${owner.kind}/${owner.name}`)
  const path = `${base}${namespaced ? `/namespaces/${encodeURIComponent(ns)}` : ''}/${encodeURIComponent(resource!)}/${encodeURIComponent(owner.name)}`
  const result = await request(conn, 'GET', path)
  if (result.status !== 200 || !result.data) throw new Error(`HTTP ${result.status}: ${result.raw || owner.name}`)
  if (owner.uid && result.data.metadata?.uid !== owner.uid) throw new Error(`Owner UID mismatch: ${owner.kind}/${owner.name}`)
  return { target: {...result.data, kind: result.data.kind || owner.kind, apiVersion: result.data.apiVersion || owner.apiVersion}, resourceKey: desc?.key || '__custom_owner__', selfPath: () => path }
}
