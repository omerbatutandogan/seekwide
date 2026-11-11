// A validator for the small subset of JSON Schema that the tool input schemas
// use. Supported keywords: type, properties, required, enum, minimum, maximum,
// maxLength, items, maxItems and additionalProperties (true or false).
// Annotation keywords (description, title, default, examples, $schema) are
// accepted and ignored. Any other keyword is rejected when the schema is
// registered, so a schema can never silently promise a check that is not made.

const VALIDATION_KEYWORDS = new Set([
  'type', 'properties', 'required', 'enum', 'minimum', 'maximum',
  'maxLength', 'items', 'maxItems', 'additionalProperties',
]);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples', '$schema']);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/**
 * @typedef {Object} JsonSchema
 * @property {string|string[]} [type]
 * @property {Record<string, JsonSchema>} [properties]
 * @property {string[]} [required]
 * @property {unknown[]} [enum]
 * @property {number} [minimum]
 * @property {number} [maximum]
 * @property {number} [maxLength]
 * @property {JsonSchema} [items]
 * @property {number} [maxItems]
 * @property {boolean} [additionalProperties]
 * @property {string} [description]  Annotation; not validated.
 * @property {string} [title]  Annotation; not validated.
 * @property {unknown} [default]  Annotation; handlers apply defaults themselves.
 * @property {unknown[]} [examples]  Annotation; not validated.
 * @property {string} [$schema]  Annotation; not validated.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Throw a TypeError when `schema` uses anything outside the supported subset.
 * Called once per tool when the server is created.
 * @param {unknown} schema
 * @param {string} [where]
 */
export function assertSupportedSchema(schema, where = 'schema') {
  if (!isPlainObject(schema)) throw new TypeError(`${where} must be an object`);
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    if (!VALIDATION_KEYWORDS.has(key)) throw new TypeError(`${where} uses unsupported keyword "${key}"`);
    if (key === 'type') {
      const types = Array.isArray(value) ? value : [value];
      if (types.length === 0 || types.some((type) => !TYPES.has(/** @type {string} */ (type)))) {
        throw new TypeError(`${where}.type has an unknown type`);
      }
    } else if (key === 'properties') {
      if (!isPlainObject(value)) throw new TypeError(`${where}.properties must be an object`);
      for (const [name, sub] of Object.entries(value)) assertSupportedSchema(sub, `${where}.properties.${name}`);
    } else if (key === 'items') {
      assertSupportedSchema(value, `${where}.items`);
    } else if (key === 'required' || key === 'enum') {
      if (!Array.isArray(value)) throw new TypeError(`${where}.${key} must be an array`);
    } else if (key === 'additionalProperties') {
      if (typeof value !== 'boolean') throw new TypeError(`${where}.additionalProperties must be true or false`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${where}.${key} must be a number`);
    }
  }
}

/**
 * @param {unknown} value
 * @param {string} type
 */
function hasType(value, type) {
  switch (type) {
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

/** @param {string} type */
function typeName(type) {
  if (type === 'null') return 'null';
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

/**
 * @param {string} path
 * @param {string} key
 */
function child(path, key) {
  return path === '' ? key : `${path}.${key}`;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function sameValue(a, b) {
  if (a === b) return true;
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Validate `value` against `schema`.
 * @param {JsonSchema} schema  A schema that passed `assertSupportedSchema`.
 * @param {unknown} value
 * @param {string} [path]  Name of the value in messages; '' for the root arguments object.
 * @returns {string[]} One readable message per problem; empty when the value is valid.
 */
export function validate(schema, value, path = '') {
  /** @type {string[]} */
  const errors = [];
  const name = path === '' ? 'arguments' : path;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => hasType(value, type))) {
      errors.push(`${name} must be ${types.map(typeName).join(' or ')}`);
      return errors;
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((option) => sameValue(option, value))) {
    errors.push(`${name} must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${name} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${name} must be at most ${schema.maximum}`);
  }

  if (typeof value === 'string' && schema.maxLength !== undefined) {
    // JSON Schema counts characters as Unicode code points.
    const length = [...value].length;
    if (length > schema.maxLength) errors.push(`${name} must be at most ${schema.maxLength} characters (got ${length})`);
  }

  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${name} must have at most ${schema.maxItems} items (got ${value.length})`);
    }
    if (schema.items !== undefined) {
      const items = schema.items;
      value.forEach((item, index) => errors.push(...validate(items, item, `${name}[${index}]`)));
    }
  }

  if (isPlainObject(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) errors.push(`${child(path, key)} is required`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        errors.push(...validate(properties[key], item, child(path, key)));
      } else if (schema.additionalProperties === false) {
        errors.push(`${child(path, key)} is not an accepted argument`);
      }
    }
  }

  return errors;
}
