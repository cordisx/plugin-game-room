/** Bounded JSON Schema subset for immutable game-package configuration. No executable schema nodes. */
const reserved = new Set(['__proto__', 'prototype', 'constructor', 'roomName'])
export function parseGameConfigSchema(input) {
  if (
    !input || typeof input !== 'object' || Array.isArray(input) || input.type !== 'object'
    || input.additionalProperties !== false || !input.properties || typeof input.properties !== 'object'
    || Array.isArray(input.properties) || JSON.stringify(input).length > 16384
  ) throw Error('invalid_config_schema')
  if (Object.keys(input).some(key => !['type', 'properties', 'additionalProperties'].includes(key))) {
    throw Error('unsupported_config_schema')
  }
  const entries = Object.entries(input.properties)
  if (entries.length > 32) throw Error('config_schema_too_large')
  for (const [key, field] of entries) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || reserved.has(key) || !field || typeof field !== 'object'
      || Array.isArray(field) || !['string', 'integer', 'number', 'boolean'].includes(field.type)
    ) throw Error('invalid_config_field')
    if (
      Object.keys(field).some(key =>
        !['type', 'title', 'description', 'default', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength'].includes(
          key,
        )
      )
    ) throw Error('unsupported_config_field')
    for (const label of ['title', 'description']) {
      if (field[label] !== undefined && (typeof field[label] !== 'string' || field[label].length > 500)) {
        throw Error('invalid_config_label')
      }
    }
    for (const bound of ['minimum', 'maximum', 'minLength', 'maxLength']) {
      if (field[bound] !== undefined && (typeof field[bound] !== 'number' || !Number.isFinite(field[bound]))) {
        throw Error('invalid_config_bound')
      }
    }
    if (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.length || field.enum.length > 32)) {
      throw Error('invalid_config_choices')
    }
    if (!Object.hasOwn(field, 'default')) throw Error('config_default_required')
    validateField(field, field.default)
    for (const choice of field.enum ?? []) validateField(field, choice)
  }
  return structuredClone(input)
}
function validateField(field, value) {
  const type = field.type === 'integer' ? 'number' : field.type
  if (
    typeof value !== type
    || type === 'number' && (!Number.isFinite(value) || field.type === 'integer' && !Number.isInteger(value))
  ) throw Error('invalid_game_config')
  if (field.enum && !field.enum.includes(value)) throw Error('invalid_game_config_choice')
  if (
    type === 'number'
    && (field.minimum !== undefined && value < field.minimum || field.maximum !== undefined && value > field.maximum)
  ) throw Error('invalid_game_config_range')
  if (
    type === 'string'
    && (value.length > 4096 || field.minLength !== undefined && value.length < field.minLength
      || field.maxLength !== undefined && value.length > field.maxLength)
  ) throw Error('invalid_game_config_length')
}
export function validateGameConfig(schema, input = {}) {
  const checked = parseGameConfigSchema(schema)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_game_config')
  if (Object.keys(input).some(key => !Object.hasOwn(checked.properties, key))) throw Error('unknown_game_config_field')
  const result = {}
  for (const [key, field] of Object.entries(checked.properties)) {
    const value = Object.hasOwn(input, key) ? input[key] : field.default
    validateField(field, value)
    result[key] = value
  }
  return result
}
