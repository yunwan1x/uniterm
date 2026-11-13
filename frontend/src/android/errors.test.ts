import { describe, expect, it } from 'vitest'
import { androidErrorMessage } from './errors'
describe('Android error presentation',()=>{
 it('retains meaningful native and structured errors',()=>{
  for(const input of [new Error('connection refused'),{message:'connection refused'},{error:'connection refused'},'connection refused']) expect(androidErrorMessage(input)).toBe('connection refused')
 })
 it('uses an actionable fallback instead of object stringification',()=>{
  for(const input of [null,undefined,{},'',42]) {expect(androidErrorMessage(input)).toContain('wireless debugging');expect(androidErrorMessage(input)).not.toContain('[object Object]')}
 })
})
