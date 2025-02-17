import { Selection, ViewColumn, window, workspace } from 'vscode';
import path from 'path';
import { isWindows } from '../utils';
import { URI } from '../core/model/uri';
import { fromVsCodeUri } from '../utils/vsc-utils';
import { determineNewNoteFilepath, NoteFactory } from '../services/templates';
import {
  closeEditors,
  createFile,
  deleteFile,
  getUriInWorkspace,
  showInEditor,
} from '../test/test-utils-vscode';
import { Resolver } from './variable-resolver';

describe('Create note from template', () => {
  beforeEach(async () => {
    await closeEditors();
  });

  describe('User flow', () => {
    it('should ask a user to confirm the path if note already exists', async () => {
      const templateA = await createFile('Template A', [
        '.foam',
        'templates',
        'template-a.md',
      ]);
      const spy = jest
        .spyOn(window, 'showInputBox')
        .mockImplementationOnce(jest.fn(() => Promise.resolve(undefined)));

      const fileA = await createFile('Content of file A');
      await NoteFactory.createFromTemplate(
        templateA.uri,
        new Resolver(new Map(), new Date()),
        fileA.uri
      );
      expect(spy).toBeCalledWith(
        expect.objectContaining({
          prompt: `Enter the filename for the new note`,
        })
      );

      await deleteFile(fileA.uri);
    });

    it('should focus the editor on the newly created note', async () => {
      const templateA = await createFile('Template A', [
        '.foam',
        'templates',
        'template-a.md',
      ]);
      const target = getUriInWorkspace();
      await NoteFactory.createFromTemplate(
        templateA.uri,
        new Resolver(new Map(), new Date()),
        target
      );
      expect(fromVsCodeUri(window.activeTextEditor.document.uri)).toEqual(
        target
      );

      await deleteFile(target);
    });
  });

  it('should expand variables when using a template', async () => {
    // eslint-disable-next-line no-template-curly-in-string
    const template = await createFile('${FOAM_DATE_YEAR}', [
      '.foam',
      'templates',
      'template-with-variables.md',
    ]);
    const target = getUriInWorkspace();
    await NoteFactory.createFromTemplate(
      template.uri,
      new Resolver(new Map(), new Date()),
      target
    );

    expect(window.activeTextEditor.document.getText()).toEqual(
      `${new Date().getFullYear()}`
    );
    await deleteFile(target);
    await deleteFile(template.uri);
  });

  describe('Creation with active text selection', () => {
    it('should populate FOAM_SELECTED_TEXT with the current selection', async () => {
      const templateA = await createFile('Template A', [
        '.foam',
        'templates',
        'template-a.md',
      ]);
      const file = await createFile('Content of first file');
      const { editor } = await showInEditor(file.uri);
      editor.selection = new Selection(0, 11, 1, 0);
      const target = getUriInWorkspace();
      const resolver = new Resolver(new Map(), new Date());
      await NoteFactory.createFromTemplate(templateA.uri, resolver, target);
      expect(await resolver.resolve('FOAM_SELECTED_TEXT')).toEqual(
        'first file'
      );
    });

    it('should open created note in a new column if there was a selection', async () => {
      const templateA = await createFile('Template A', [
        '.foam',
        'templates',
        'template-a.md',
      ]);
      const file = await createFile('This is my first file: for new file');
      const { editor } = await showInEditor(file.uri);
      editor.selection = new Selection(0, 23, 0, 35);
      const target = getUriInWorkspace();
      await NoteFactory.createFromTemplate(
        templateA.uri,
        new Resolver(new Map(), new Date()),
        target
      );
      expect(window.activeTextEditor.viewColumn).toEqual(ViewColumn.Two);
      expect(fromVsCodeUri(window.visibleTextEditors[0].document.uri)).toEqual(
        file.uri
      );
      expect(fromVsCodeUri(window.visibleTextEditors[1].document.uri)).toEqual(
        target
      );
      await deleteFile(target);
      await closeEditors();
    });

    it('should replace selection with a link to the newly created note', async () => {
      const template = await createFile(
        // eslint-disable-next-line no-template-curly-in-string
        'Hello ${FOAM_SELECTED_TEXT} ${FOAM_SELECTED_TEXT}',
        ['.foam', 'templates', 'template-with-selection.md']
      );
      const file = await createFile('This is my first file: World');
      const { editor } = await showInEditor(file.uri);
      editor.selection = new Selection(0, 23, 0, 28);
      const target = getUriInWorkspace();
      await NoteFactory.createFromTemplate(
        template.uri,
        new Resolver(new Map(), new Date()),
        target
      );
      expect(window.activeTextEditor.document.getText()).toEqual(
        'Hello World World'
      );
      expect(window.visibleTextEditors[0].document.getText()).toEqual(
        `This is my first file: [[${URI.getBasename(target)}]]`
      );
    });
  });
});

describe('determineNewNoteFilepath', () => {
  it('should use the template path if absolute', async () => {
    const winAbsolutePath = 'C:\\absolute_path\\journal\\My Note Title.md';
    const linuxAbsolutePath = '/absolute_path/journal/My Note Title.md';
    const winResult = await determineNewNoteFilepath(
      winAbsolutePath,
      undefined,
      new Resolver(new Map(), new Date())
    );
    expect(URI.toFsPath(winResult)).toMatch(winAbsolutePath);
    const linuxResult = await determineNewNoteFilepath(
      linuxAbsolutePath,
      undefined,
      new Resolver(new Map(), new Date())
    );
    expect(URI.toFsPath(linuxResult)).toMatch(linuxAbsolutePath);
  });

  it('should compute the relative template filepath from the current directory', async () => {
    const relativePath = isWindows
      ? 'journal\\My Note Title.md'
      : 'journal/My Note Title.md';
    const resultFilepath = await determineNewNoteFilepath(
      relativePath,
      undefined,
      new Resolver(new Map(), new Date())
    );
    const expectedPath = path.join(
      URI.toFsPath(fromVsCodeUri(workspace.workspaceFolders[0].uri)),
      relativePath
    );
    expect(URI.toFsPath(resultFilepath)).toMatch(expectedPath);
  });

  it('should use the note title if nothing else is available', async () => {
    const noteTitle = 'My new note';
    const resultFilepath = await determineNewNoteFilepath(
      undefined,
      undefined,
      new Resolver(new Map().set('FOAM_TITLE', noteTitle), new Date())
    );
    const expectedPath = path.join(
      URI.toFsPath(fromVsCodeUri(workspace.workspaceFolders[0].uri)),
      `${noteTitle}.md`
    );
    expect(URI.toFsPath(resultFilepath)).toMatch(expectedPath);
  });

  it('should ask the user for a note title if nothing else is available', async () => {
    const noteTitle = 'My new note';
    const spy = jest
      .spyOn(window, 'showInputBox')
      .mockImplementationOnce(jest.fn(() => Promise.resolve(noteTitle)));
    const resultFilepath = await determineNewNoteFilepath(
      undefined,
      undefined,
      new Resolver(new Map(), new Date())
    );
    const expectedPath = path.join(
      URI.toFsPath(fromVsCodeUri(workspace.workspaceFolders[0].uri)),
      `${noteTitle}.md`
    );
    expect(spy).toHaveBeenCalled();
    expect(URI.toFsPath(resultFilepath)).toMatch(expectedPath);
  });
});
