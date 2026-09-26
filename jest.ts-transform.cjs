const ts = require('typescript');

module.exports = {
  process(source, filename) {
    return {
      code: ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2024,
          sourceMap: true,
        },
      }).outputText,
    };
  },
};
