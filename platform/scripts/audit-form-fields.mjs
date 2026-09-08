// Inventory every authored form control; dynamic catalogues are identified as
// expressions, not incorrectly treated as empty dropdowns. Read-only audit.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['src/app', 'src/components', 'src/modules'];
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(name);
    else if (/\.tsx$/.test(name)) files.push(name);
  }
}
roots.forEach(walk);
const fields = [];
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (['input', 'select', 'Select', 'textarea', 'CodedSearchField', 'PopupSelect'].includes(tag)) {
        const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(source), attr.initializer?.getText(source) ?? 'true']));
        const type = (attrs.type || 'text').replaceAll('"', '').replaceAll("'", '');
        const container = ts.isJsxOpeningElement(node) ? node.parent.getText(source) : '';
        const warnings = [];
        if (tag === 'input' && type === 'number' && !attrs.step) warnings.push('number-step-unspecified');
        if ((tag === 'Select' || tag === 'select') && !container.includes('<option') && !container.includes('{')) warnings.push('empty-options');
        fields.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, tag, type, binding: attrs.value || attrs.checked || attrs.name || attrs.id || '', constraints: Object.fromEntries(Object.entries(attrs).filter(([key]) => ['min', 'max', 'step', 'required', 'placeholder', 'list', 'aria-label'].includes(key))), options: container.match(/<option\b/g)?.length ?? 0, warnings });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
console.log(JSON.stringify({ scannedFiles: files.length, formFiles: new Set(fields.map(field => field.file)).size, controls: fields.length, fields }, null, 2));
