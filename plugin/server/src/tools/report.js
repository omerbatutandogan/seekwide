// report_render: write the Markdown and HTML reports of a saved run.

/** @import { ToolDef } from '../mcp/stdio.js' */
/** @import { ToolDeps } from './index.js' */

import { ToolError } from '../mcp/stdio.js';
import { InputError } from '../util/errors.js';
import { writeFileAtomic } from '../store/fs-util.js';
import { ensureRunDir } from '../store/project.js';
import { PROJECT_DIR_SCHEMA, loadBaseRun, resolveProjectDir, runRefSchema, settingValue, withStoreErrors } from './common.js';
import { loadLogo } from './logo.js';

const FORMATS = /** @type {const} */ (['markdown', 'html']);
const FILE_FORMATS = /** @type {const} */ ({ markdown: 'md', html: 'html' });

/**
 * The first logo path that is set, with where it came from.
 * @param {string|undefined} fromArguments
 * @param {string|undefined} fromProfile
 * @param {string|undefined} fromSettings
 * @returns {{path: string, source: import('./logo.js').LogoSource}|null}
 */
function pickLogo(fromArguments, fromProfile, fromSettings) {
  if (fromArguments) return { path: fromArguments, source: 'arguments' };
  if (fromProfile) return { path: fromProfile, source: 'profile' };
  if (fromSettings) return { path: fromSettings, source: 'settings' };
  return null;
}

/**
 * @param {ToolDeps} deps
 * @returns {ToolDef[]}
 */
export function reportTools(deps) {
  return [
    {
      name: 'report_render',
      title: 'Render the report',
      description:
        "Write the Markdown and/or HTML report of a saved run into the run's folder. Brand name and logo come from the " +
        'arguments, then the profile, then SEEKWIDE_REPORT_BRAND and SEEKWIDE_REPORT_LOGO. The logo must be a PNG, JPEG, WebP or SVG image ' +
        'of at most 200 KB; a logo named by the profile must be inside the project folder.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: runRefSchema('Run id, "last" (default) or "previous".'),
          project_dir: PROJECT_DIR_SCHEMA,
          formats: { type: 'array', items: { type: 'string', enum: [...FORMATS] }, maxItems: FORMATS.length, description: 'Defaults to both.' },
          executive_summary: { type: 'string', maxLength: 4000, description: 'Summary written for the reader. Not scored.' },
          recommendations: {
            type: 'array',
            maxItems: 20,
            description: 'Suggestions shown in their own section. Not scored.',
            items: {
              type: 'object',
              properties: { title: { type: 'string', maxLength: 200 }, detail: { type: 'string', maxLength: 2000 } },
              required: ['title', 'detail'],
              additionalProperties: false,
            },
          },
          brand_name: { type: 'string', maxLength: 200, description: 'Shown as "Prepared by".' },
          logo_path: { type: 'string', maxLength: 4096, description: 'Logo file, absolute or relative to project_dir.' },
          compare_to: runRefSchema('Run id, or "previous" for the newest run older than the one rendered, to include a "changes since" section.'),
        },
        additionalProperties: false,
      },
      async handler(args) {
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        const run = await withStoreErrors(() => deps.loadRun(projectDir, args.run_id ?? 'last'));

        let comparison;
        if (args.compare_to !== undefined) {
          const base = await loadBaseRun(deps, projectDir, args.compare_to, run, 'Leave compare_to out, or pass another run id from runs_list.');
          if (base.run_id === run.run_id) {
            throw new ToolError(`compare_to names the run being rendered (${run.run_id}). Pass an older run id, or leave compare_to out.`);
          }
          comparison = deps.compareRuns(base, run);
        }

        const profile = await withStoreErrors(() => deps.readProfile(projectDir));
        const brandName = settingValue(args.brand_name) ?? settingValue(profile?.report?.brand_name) ?? settingValue(deps.env.SEEKWIDE_REPORT_BRAND);
        const logo = pickLogo(settingValue(args.logo_path), settingValue(profile?.report?.logo_path), settingValue(deps.env.SEEKWIDE_REPORT_LOGO));
        const logoDataUri = logo ? await loadLogo(logo, projectDir) : undefined;

        const options = {
          ...(args.executive_summary !== undefined ? { executiveSummary: args.executive_summary } : {}),
          ...(args.recommendations !== undefined ? { recommendations: args.recommendations } : {}),
          ...(brandName ? { brandName } : {}),
          ...(logoDataUri ? { logoDataUri } : {}),
          ...(comparison ? { comparison } : {}),
        };

        const formats = args.formats && args.formats.length > 0 ? [...new Set(/** @type {('markdown'|'html')[]} */ (args.formats))] : [...FORMATS];
        /** @type {Record<string, string>} */
        const files = {};
        /** @type {Record<string, number>} */
        const bytes = {};
        const paths = await withStoreErrors(() => deps.projectPaths(projectDir));
        for (const format of formats) {
          let content;
          try {
            content = format === 'markdown' ? deps.renderMarkdown(run, options) : deps.renderHtml(run, options);
          } catch (error) {
            if (!(error instanceof InputError)) throw error;
            throw new ToolError(`The ${format} report could not be rendered: ${error.message} Fix the arguments and call report_render again.`);
          }
          const file = await withStoreErrors(() => paths.reportFile(run.run_id, FILE_FORMATS[format]));
          // Created when missing; a folder on the way that is a symbolic link is refused, so no report lands outside the project.
          await withStoreErrors(() => ensureRunDir(paths, run.run_id));
          await writeFileAtomic(file, content);
          files[format] = file;
          bytes[format] = Buffer.byteLength(content, 'utf8');
        }
        return { run_id: run.run_id, files, bytes };
      },
    },
  ];
}
