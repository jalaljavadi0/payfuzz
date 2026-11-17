import { ModuleKind, Project, ScriptTarget, ts, type SourceFile } from 'ts-morph';

/**
 * In-memory project: PayFuzz parses source text it already read, it never loads a tsconfig,
 * never resolves node_modules and never runs the user's build. See SECURITY.md.
 */
export function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      noEmit: true,
    },
  });
}

export function parseSource(
  project: Project,
  relativePath: string,
  sourceText: string,
): SourceFile {
  return project.createSourceFile(relativePath, sourceText, { overwrite: true });
}
