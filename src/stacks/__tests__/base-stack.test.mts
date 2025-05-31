import { Testing } from 'cdktf'
import type { Construct } from 'constructs'
import { BaseStack } from '../base-stack.mjs'

describe('BaseStack', () => {
  let app: Construct
  let stack: BaseStack<{ user: string }>

  beforeEach(() => {
    app = Testing.app()
    stack = new BaseStack(app, 'TestBaseStack', 'project', {
      user: 'testuser',
    })
  })

  test('Stack has correct identifier', () => {
    expect(stack.identifier()).toBe('test-project-TestBaseStack')
  })

  test('Stack has correct id', () => {
    expect(stack.id('resource')).toBe('test-project-TestBaseStack-resource')
  })

  test('Stack has correct shortName', () => {
    expect(stack.shortName('resource')).toBe('testuser-TestBaseStack-resource')
  })

  // Add more tests for other methods or properties in your BaseStack
})
