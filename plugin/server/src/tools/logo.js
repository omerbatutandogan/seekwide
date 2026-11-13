// Loading the report logo. The file is embedded into a report that is sent to
// clients, so its content is verified, not only its name, and a path taken from
// the project profile (which a repository can supply) must stay inside the project.

import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from '../mcp/stdio.js';
import { entryKind } from '../repo/scan.js';

export const LOGO_MAX_BYTES = 200 * 1024;

/** @typedef {'arguments'|'profile'|'settings'} LogoSource */

const SOURCE_NAMES = {
  arguments: 'logo_path',
  profile: "the profile's report.logo_path",
  settings: 'the SEEKWIDE_REPORT_LOGO setting',
};

/**
 * True when `text` is an XML document whose root element is `<svg>`: only an
 * XML declaration, comments, a doctype and whitespace may come before it.
 * @param {string} text
 * @returns {boolean}
 */
export function hasSvgRoot(text) {
  let rest = text.startsWith('﻿') ? text.slice(1) : text;
  for (;;) {
    rest = rest.trimStart();
    /** @type {number} */
    let end;
    if (/^<\?xml\s/.test(rest)) {
      end = rest.indexOf('?>');
      if (end === -1) return false;
      rest = rest.slice(end + 2);
    } else if (rest.startsWith('<!--')) {
      end = rest.indexOf('-->');
      if (end === -1) return false;
      rest = rest.slice(end + 3);
    } else if (/^<!DOCTYPE/i.test(rest)) {
      const close = rest.indexOf('>');
      const subset = rest.indexOf('[');
      // An internal subset ("[ ... ]") may contain ">" itself.
      const from = subset !== -1 && (close === -1 || subset < close) ? rest.indexOf(']', subset) : 0;
      end = from === -1 ? -1 : rest.indexOf('>', from);
      if (end === -1) return false;
      rest = rest.slice(end + 1);
    } else {
      return /^<svg[\s>/]/.test(rest);
    }
  }
}

/**
 * Media type of a logo from its content; null for anything else. PNG, JPEG and
 * WebP are recognized by their magic bytes. SVG needs a `.svg` file name and an
 * `<svg>` root element.
 * @param {Buffer} bytes
 * @param {string} fileName
 * @returns {string|null}
 */
export function detectImageType(bytes, fileName) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (path.extname(fileName).toLowerCase() !== '.svg') return null;
  const text = bytes.toString('utf8');
  if (text.includes('\u0000') || text.includes('�')) return null;
  return hasSvgRoot(text) ? 'image/svg+xml' : null;
}

/**
 * @param {string} parent  Real path of a directory.
 * @param {string} child   Real path of a file.
 */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Read a logo file and return it as a data URI.
 * @param {{path: string, source: LogoSource}} logo  The path is absolute, or relative to the project folder.
 * @param {string} projectDir
 * @returns {Promise<string>}
 * @throws {ToolError} when the file is missing, outside the project (for a profile path), too large or not a supported image.
 */
export async function loadLogo(logo, projectDir) {
  const file = path.resolve(projectDir, logo.path);
  // A profile can arrive with someone else's repository, so its path is named by the setting, never quoted.
  const fromProfile = logo.source === 'profile';
  const named = fromProfile ? 'The logo that report.logo_path in the project profile names' : `The logo ${file} (from ${SOURCE_NAMES[logo.source]})`;
  const profileAdvice = 'Fix or remove report.logo_path in the profile; pass logo_path, or use the report logo setting, for a file elsewhere.';
  const outsideProject = () =>
    new ToolError(`${named} is outside the project folder. A profile may only point at a logo inside the project. ${profileAdvice}`);
  if (fromProfile) {
    // A profile's path is checked before the file is touched, and the way to it is walked without following a link,
    // so a path such as \\host\share\logo.png on Windows, or a link in the project that points there, never makes the
    // system contact another machine.
    const project = await realpath(projectDir).catch(() => path.resolve(projectDir));
    const lexical = path.resolve(projectDir);
    if (!isInside(lexical, file) && !isInside(project, file)) throw outsideProject();
    const base = isInside(lexical, file) ? lexical : project;
    if ((await entryKind(base, path.relative(base, file).split(path.sep).join('/'))) !== 'file') {
      throw new ToolError(`${named} is not a file inside the project folder: it is missing, or a symbolic link is on the way to it. ${profileAdvice}`);
    }
  }
  let info;
  let real;
  try {
    info = await stat(file);
    real = await realpath(file);
  } catch {
    throw new ToolError(`${named} could not be read. Check the path, or leave the logo out to render without one.`);
  }
  if (!info.isFile()) throw new ToolError(`${named} is not a file. Point it at a PNG, JPEG, WebP or SVG file.`);
  if (fromProfile) {
    const project = await realpath(projectDir).catch(() => path.resolve(projectDir));
    if (!isInside(project, real)) throw outsideProject();
  }
  const tooLarge = (/** @type {number} */ size) =>
    new ToolError(`${named} is ${Math.ceil(size / 1024)} KB; the limit is 200 KB. Use a smaller PNG, JPEG, WebP or SVG file.`);
  if (info.size > LOGO_MAX_BYTES) throw tooLarge(info.size);
  const bytes = await readFile(real);
  if (bytes.length > LOGO_MAX_BYTES) throw tooLarge(bytes.length);
  const type = detectImageType(bytes, real);
  if (type === null) {
    throw new ToolError(`${named} is not a PNG, JPEG, WebP or SVG image (an SVG needs a .svg name and an <svg> root element). Convert it to one of those formats.`);
  }
  return `data:${type};base64,${bytes.toString('base64')}`;
}
