// profile_get and profile_set.

/** @import { ToolDef } from '../mcp/stdio.js' */
/** @import { ToolDeps } from './index.js' */

import { PROJECT_DIR_SCHEMA, resolveProjectDir, withStoreErrors } from './common.js';

const STRING_LIST = { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 50 };

// The shape is described for the model; writeProfile is the authority on what is valid.
const PROFILE_SCHEMA = {
  type: 'object',
  description: 'Site profile. site_url and brand.name are required.',
  properties: {
    site_url: { type: 'string', maxLength: 2048 },
    brand: {
      type: 'object',
      properties: { name: { type: 'string', maxLength: 200 }, alternate_names: STRING_LIST },
    },
    business_model: {
      type: 'string',
      enum: ['b2b_saas', 'ecommerce', 'local_service', 'publisher', 'mobile_app', 'international', 'other'],
    },
    markets: {
      type: 'array',
      maxItems: 50,
      items: { type: 'object', properties: { country: { type: 'string', maxLength: 10 }, languages: STRING_LIST } },
    },
    competitors: STRING_LIST,
    target_queries: STRING_LIST,
    report: {
      type: 'object',
      properties: { brand_name: { type: 'string', maxLength: 200 }, logo_path: { type: 'string', maxLength: 4096 } },
    },
  },
};

/**
 * @param {ToolDeps} deps
 * @returns {ToolDef[]}
 */
export function profileTools(deps) {
  return [
    {
      name: 'profile_get',
      title: 'Read the site profile',
      description: 'Read the site profile saved in <project>/.seekwide/profile.json (site URL, brand, markets, report branding).',
      inputSchema: {
        type: 'object',
        properties: { project_dir: PROJECT_DIR_SCHEMA },
        additionalProperties: false,
      },
      async handler(args) {
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        const profile = await withStoreErrors(() => deps.readProfile(projectDir));
        return { exists: profile !== null, profile };
      },
    },
    {
      name: 'profile_set',
      title: 'Save the site profile',
      description: 'Validate and save the site profile in <project>/.seekwide/profile.json. Returns the profile as saved.',
      inputSchema: {
        type: 'object',
        properties: { project_dir: PROJECT_DIR_SCHEMA, profile: PROFILE_SCHEMA },
        required: ['profile'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        const saved = await withStoreErrors(() => deps.writeProfile(projectDir, args.profile, deps.now()));
        return { project_dir: projectDir, profile: saved };
      },
    },
  ];
}
