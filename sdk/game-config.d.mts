export interface GameConfigField {
  type: 'string' | 'number' | 'integer' | 'boolean'
  title?: string
  description?: string
  default: string | number | boolean
  enum?: (string | number | boolean)[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}
export interface GameConfigSchema {
  type: 'object'
  additionalProperties: false
  properties: Record<string, GameConfigField>
}
export function parseGameConfigSchema(input: unknown): GameConfigSchema
export function validateGameConfig(schema: GameConfigSchema, input?: unknown): Record<string, string | number | boolean>
