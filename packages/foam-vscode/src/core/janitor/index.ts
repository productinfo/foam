import GithubSlugger from 'github-slugger';
import { Resource } from '../model/note';
import { Range } from '../model/range';
import {
  createMarkdownReferences,
  stringifyMarkdownLinkReferenceDefinition,
} from '../markdown-provider';
import { getHeadingFromFileName } from '../utils';
import { FoamWorkspace } from '../model/workspace';
import { uriToSlug } from '../utils/slug';

export const LINK_REFERENCE_DEFINITION_HEADER = `[//begin]: # "Autogenerated link references for markdown compatibility"`;
export const LINK_REFERENCE_DEFINITION_FOOTER = `[//end]: # "Autogenerated link references"`;

const slugger = new GithubSlugger();

export interface TextEdit {
  range: Range;
  newText: string;
}

export const generateLinkReferences = (
  note: Resource,
  workspace: FoamWorkspace,
  includeExtensions: boolean
): TextEdit | null => {
  if (!note) {
    return null;
  }

  const markdownReferences = createMarkdownReferences(
    workspace,
    note.uri,
    includeExtensions
  );

  const newReferences =
    markdownReferences.length === 0
      ? ''
      : [
          LINK_REFERENCE_DEFINITION_HEADER,
          ...markdownReferences.map(stringifyMarkdownLinkReferenceDefinition),
          LINK_REFERENCE_DEFINITION_FOOTER,
        ].join(note.source.eol);

  if (note.definitions.length === 0) {
    if (newReferences.length === 0) {
      return null;
    }

    const padding =
      note.source.end.character === 0
        ? note.source.eol
        : `${note.source.eol}${note.source.eol}`;
    return {
      newText: `${padding}${newReferences}`,
      range: Range.createFromPosition(note.source.end, note.source.end),
    };
  } else {
    const first = note.definitions[0];
    const last = note.definitions[note.definitions.length - 1];

    var nonGeneratedReferenceDefinitions = note.definitions;

    // if we have more definitions then referenced pages AND the page refers to a page
    // we expect non-generated link definitions to be present
    // Collect all non-generated definitions, by removing the generated ones
    if (
      note.definitions.length > markdownReferences.length &&
      markdownReferences.length > 0
    ) {
      // remove all autogenerated definitions
      const beginIndex = note.definitions.findIndex(
        ({ label }) => label === '//begin'
      );
      const endIndex = note.definitions.findIndex(
        ({ label }) => label === '//end'
      );

      const generatedDefinitions = [...note.definitions].splice(
        beginIndex,
        endIndex - beginIndex + 1
      );

      nonGeneratedReferenceDefinitions = note.definitions.filter(
        x => !generatedDefinitions.includes(x)
      );
    }

    // When we only have explicitly defined link definitions &&
    // no indication of previously defined generated links &&
    // there is no reference to another page, return null
    if (
      nonGeneratedReferenceDefinitions.length > 0 &&
      note.definitions.findIndex(({ label }) => label === '//begin') < 0 &&
      markdownReferences.length === 0
    ) {
      return null;
    }

    // Format link definitions for non-generated links
    const nonGeneratedReferences = nonGeneratedReferenceDefinitions
      .map(stringifyMarkdownLinkReferenceDefinition)
      .join(note.source.eol);

    const oldReferences = note.definitions
      .map(stringifyMarkdownLinkReferenceDefinition)
      .join(note.source.eol);

    // When the newly formatted references match the old ones, OR
    // when non-generated references are present, but no new ones are generated
    // return null
    if (
      oldReferences === newReferences ||
      (nonGeneratedReferenceDefinitions.length > 0 &&
        newReferences === '' &&
        markdownReferences.length > 0)
    ) {
      return null;
    }

    var fullReferences = `${newReferences}`;
    // If there are any non-generated definitions, add those to the output as well
    if (
      nonGeneratedReferenceDefinitions.length > 0 &&
      markdownReferences.length > 0
    ) {
      fullReferences = `${nonGeneratedReferences}${note.source.eol}${newReferences}`;
    }

    return {
      // @todo: do we need to ensure new lines?
      newText: `${fullReferences}`,
      range: Range.createFromPosition(first.range!.start, last.range!.end),
    };
  }
};

export const generateHeading = (note: Resource): TextEdit | null => {
  if (!note) {
    return null;
  }

  // TODO now the note.title defaults to file name at parsing time, so this check
  // doesn't work anymore. Decide:
  // - whether do we actually want to continue generate the headings
  // - whether it should be under a config option
  // A possible approach would be around having a `sections` field in the note, and inspect
  // it to see if there is an h1 title. Alternatively parse directly the markdown in this function.
  if (note.title) {
    return null;
  }

  const frontmatterExists = note.source.contentStart.line !== 1;

  let newLineExistsAfterFrontmatter = false;
  if (frontmatterExists) {
    const lines = note.source.text.split(note.source.eol);
    const index = note.source.contentStart.line - 1;
    const line = lines[index];
    newLineExistsAfterFrontmatter = line === '';
  }

  const paddingStart = frontmatterExists ? note.source.eol : '';
  const paddingEnd = newLineExistsAfterFrontmatter
    ? note.source.eol
    : `${note.source.eol}${note.source.eol}`;

  return {
    newText: `${paddingStart}# ${getHeadingFromFileName(
      uriToSlug(note.uri)
    )}${paddingEnd}`,
    range: Range.createFromPosition(
      note.source.contentStart,
      note.source.contentStart
    ),
  };
};

/**
 *
 * @param fileName
 * @returns null if file name is already in kebab case otherise returns
 * the kebab cased file name
 */
export const getKebabCaseFileName = (fileName: string) => {
  const kebabCasedFileName = slugger.slug(fileName);
  return kebabCasedFileName === fileName ? null : kebabCasedFileName;
};
