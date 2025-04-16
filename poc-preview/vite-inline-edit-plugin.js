import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from '@babel/parser';
import traverseBabel from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VITE_PROJECT_ROOT = path.resolve(__dirname)

export default function inlineEditPlugin() {

  function parseEditId(editId) {

    const parts = editId.split(':');
    if (parts.length < 3) {

      return null;
    }
    const columnStr = parts.pop();
    const lineStr = parts.pop();
    const filePath = parts.join(':');
    const line = parseInt(lineStr, 10);
    const column = parseInt(columnStr, 10);
    if (!filePath || isNaN(line) || isNaN(column)) {

      return null;
    }
    return { filePath, line, column };
  }

  return {
    name: 'vite-inline-edit-plugin',
    enforce: 'pre',

    transform(code, id) {
      if (!/\.(jsx|tsx)$/.test(id) || !id.startsWith(VITE_PROJECT_ROOT) || id.includes('node_modules')) {

        return null;
      }

      const relativeFilePath = path.relative(VITE_PROJECT_ROOT, id);
      const webRelativeFilePath = relativeFilePath.split(path.sep).join('/');

      try {
        const babelAst = parse(code, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
          errorRecovery: true
        });

        let attributesAdded = 0;

        const traverseFunction = traverseBabel.default || traverseBabel;
        traverseFunction(babelAst, {
          enter(path) {
            if (path.isJSXOpeningElement()) {
              const node = path.node;
              if (node.loc) {

                const alreadyHasId = node.attributes.some(
                  (attr) => t.isJSXAttribute(attr) && attr.name.name === 'data-edit-id'
                );

                if (!alreadyHasId) {
                  const line = node.loc.start.line;
                  const column = node.loc.start.column + 1;
                  const editId = `${webRelativeFilePath}:${line}:${column}`;
                  
                  const idAttribute = t.jsxAttribute(
                    t.jsxIdentifier('data-edit-id'),
                    t.stringLiteral(editId)
                  );

                  path.node.attributes.push(idAttribute);
                  attributesAdded++;
                }
              } else {

              }
            }
          }
        });

        if (attributesAdded > 0) {
          const generateFunction = generate.default || generate;
          const output = generateFunction(babelAst, {
            sourceMaps: true,
            sourceFileName: webRelativeFilePath
          }, code);

          return { code: output.code, map: output.map };
        } else {

          return null;
        }

      } catch (error) {
        console.error(`[Plugin Error] Error processing ${webRelativeFilePath} with Babel:`, error);
        return null;
      }
    },


    configureServer(server) {
      server.middlewares.use('/api/apply-edit', async (req, res, next) => {
        if (req.method !== 'POST') return next();

        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          let absoluteFilePath = '';
          try {
            const { editId, newValue } = JSON.parse(body);
            if (!editId || newValue === undefined) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Missing editId or newValue' }));
            }

            const parsedId = parseEditId(editId);
            if (!parsedId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Invalid editId format (filePath:line:column)' }));
            }

            const { filePath, line: targetLine, column: targetColumn } = parsedId;

            absoluteFilePath = path.resolve(VITE_PROJECT_ROOT, filePath);
            if (filePath.includes('..') || !absoluteFilePath.startsWith(VITE_PROJECT_ROOT) || absoluteFilePath.includes('node_modules')) {

              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Invalid path' }));
            }

            const originalContent = await fs.readFile(absoluteFilePath, 'utf-8');

            const babelAst = parse(originalContent, {
              sourceType: 'module',
              plugins: ['jsx', 'typescript'],
              errorRecovery: true
            });

            let targetNodePath = null;
            const visitor = {
              JSXOpeningElement(path) {
                const node = path.node;
                if (node.loc && node.loc.start.line === targetLine && node.loc.start.column + 1 === targetColumn) {

                  targetNodePath = path;
                  path.stop();
                }
              }
            };

            const traverseFunction = traverseBabel.default || traverseBabel;
            traverseFunction(babelAst, visitor);

            if (!targetNodePath) {

              res.writeHead(404, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'AST Modification Failed - Target node not found by line/column.' }));
            }

            let modified = false;

            const parentElementNode = targetNodePath.parentPath?.node;
            if (parentElementNode && t.isJSXElement(parentElementNode) && Array.isArray(parentElementNode.children)) {

              for (let i = 0; i < parentElementNode.children.length; i++) {
                const child = parentElementNode.children[i];

                if (t.isJSXText(child)) {

                  child.value = newValue;
                  modified = true;
                  break;
                }

              }
            }

            if (!modified) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'AST Modification Failed - Target node found, but failed to modify text child.' }));
            }

            const generateFunction = generate.default || generate;
            const output = generateFunction(babelAst, { /* options */ }, originalContent);
            const newContent = output.code;

            await fs.writeFile(absoluteFilePath, newContent, 'utf-8');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, filePath, newContent }));

          } catch (error) {

            console.error(`[Plugin API /apply-edit Error]`, error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error during edit application.' }));
          }
        });
      });
    }
  };
} 