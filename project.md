# Minimal Action Plan: Inline Editing Feature PoC (Plugin AST - Line/Column ID)

## Goal
Create minimalist Frontend, Preview (Sandbox), and Backend projects to validate the core inline editing flow. A Vite Plugin handles AST manipulation using stable **line/column** identifiers. **Babel** is used during the transform step to add `data-edit-id` attributes with line/column info. The plugin hosts an API endpoint (`/api/apply-edit`) that receives edits, re-parses the original file (using SWC), finds the target node by line/column, modifies the AST, and writes the file back.

## Core Workflow (Plugin AST - Line/Column ID)
1.  **Plugin Transform (Babel):** Vite plugin's `transform` hook (with `enforce: 'pre'`):
    *   Parses code with `@babel/parser`.
    *   Traverses Babel AST using `@babel/traverse`.
    *   For `JSXOpeningElement` nodes, gets `line` and `column` from `node.loc.start`.
    *   Creates `data-edit-id="filePath:line:column"` attribute using `@babel/types`.
    *   Adds the attribute to the node in the Babel AST.
    *   Generates modified code string (including the new attributes) using `@babel/generator`.
    *   Returns the modified code and source map to Vite.
2.  **Sandbox Edit:** User edits `contentEditable` text in Preview iframe (rendered with `data-edit-id` attributes).
3.  **Sandbox Listener:**
    *   On `input`, finds the parent element with `data-edit-id`.
    *   Parses the `editId` to get `filePath`, `targetLine`, `targetColumn`.
    *   Gets the `newValue` from the edited element.
    *   Sends `{ editId, newValue }` via POST request to the plugin's `/api/apply-edit` endpoint.
4.  **Plugin API (`/api/apply-edit`):**
    *   Receives `{ editId, newValue }`.
    *   Parses `editId` to get `filePath`, `targetLine`, `targetColumn`.
    *   Performs security checks on `filePath`.
    *   Reads the **original raw file content** from disk using `fs.readFile`.
    *   Parses the raw content into an **SWC AST** using `swc.parseSync`.
    *   **Finds Target Node:** Uses a helper function (`findNodeByLineCol`) that traverses the SWC AST. For relevant nodes, it calculates their start line/column from their `span.start` offset and the raw file content string. It returns the SWC AST node whose calculated start position matches `targetLine` and `targetColumn`.
    *   **Modifies AST:** Finds the `JSXText` child of the target node and updates its `value` / `raw` properties with `newValue`.
    *   **Prints Code:** Generates the final code string from the modified SWC AST using `swc.printSync`.
    *   **Writes File:** Overwrites the original file on disk with the new code using `fs.writeFile`.
    *   Sends a success/error response back to the listener.
5.  **HMR Update:** Vite detects the file change made by the plugin and updates the Preview iframe.
6.  **Frontend Proxy & Backend:** Remain unchanged (not directly involved in the edit application logic in this model).

---

## Part 1: Preview Project (Sandbox - React + Vite)

- [ ] **Initialize Project**
  ```bash
  npm create vite@latest poc-preview --template react
  cd poc-preview
  npm install
  ```

- [ ] **Install Dependencies**
  ```bash
  # SWC for API-side modification (can potentially be replaced by Babel later)
  npm install --save-dev @swc/core
  # Babel for transform-side ID generation
  npm install --save-dev @babel/parser @babel/traverse @babel/generator @babel/types
  # Listener does NOT need SWC/Babel anymore
  ```

- [ ] **Create Vite Plugin (`vite-inline-edit-plugin.js`)**
  **REVISED:** Uses Babel in `transform` to add line/col IDs. Hosts `/api/apply-edit` endpoint using SWC for modification.
  ```javascript
  import fs from 'fs/promises';
  import path from 'path';
  import { fileURLToPath } from 'url';
  // Babel imports for transform hook
  import { parse } from '@babel/parser';
  import traverseBabel from '@babel/traverse';
  import generate from '@babel/generator';
  import * as t from '@babel/types';
  // SWC import for API hook
  import * as swc from '@swc/core';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const DEBUG = true;
  const debug = (message, data = null) => { /* ... */ };
  const VITE_PROJECT_ROOT = path.resolve(__dirname);
  debug('[STARTUP] Vite Project Root:', VITE_PROJECT_ROOT);

  // --- Helper: Calculate Line/Col from Offset (for API endpoint) --- 
  function getLineColFromOffset(content, offset) {
      if (offset < 0 || offset > content.length) return null;
      let line = 1;
      let lastNewline = -1;
      for (let i = 0; i < offset; i++) {
          if (content[i] === '\n') {
              line++;
              lastNewline = i;
          }
      }
      const column = offset - lastNewline; // Column is 1-based offset from last newline
      return { line, column };
  }

  // --- Helper: Find SWC AST node by Line/Col (for API endpoint) --- 
  function findNodeByLineCol(swcAst, targetLine, targetColumn, fileContent) {
      let foundNode = null;

      function traverse(node) {
          if (!node || foundNode) return; // Stop if found

          // Calculate line/col for the current node's start span
          if (node.span?.start !== undefined) {
              const loc = getLineColFromOffset(fileContent, node.span.start);
              if (loc && loc.line === targetLine && loc.column === targetColumn) {
                  // Potential match - check node type? JSXOpeningElement is typical target
                  if (node.type === 'JSXOpeningElement') { 
                     debug('[API Find Node] Found matching node by Line/Col', { type: node.type, line: loc.line, col: loc.column });
                     foundNode = node;
                     return; // Stop traversal
                  }
              }
          }

          // --- Generic Traversal (Needs to be comprehensive for SWC AST) --- 
          // Iterate over known properties that might contain child nodes or arrays of nodes
          for (const key in node) {
              if (!node.hasOwnProperty(key) || key === 'span' || key === 'ctxt') continue;
              const value = node[key];
              if (Array.isArray(value)) {
                  value.forEach(traverse);
              } else if (value && typeof value === 'object' && value.type) { // Check if it looks like an AST node
                  traverse(value);
              }
          }
      }

      traverse(swcAst); // Start from the root
      return foundNode; // Return the JSXOpeningElement node or null
  }

  // --- Helper: Parse Edit ID (Line/Col format) --- 
  function parseEditId(editId) { 
      const parts = editId.split(':');
      if (parts.length < 3) return null;
      const column = parseInt(parts.pop(), 10);
      const line = parseInt(parts.pop(), 10);
      const filePath = parts.join(':');
      if (!filePath || isNaN(line) || isNaN(column)) return null;
      return { filePath, line, column };
  }

  // --- Helper: Modify SWC AST (Finds text child of target element) --- 
  function modifyJSXTextChild(targetElementNode, newValue) {
      if (!targetElementNode || !targetElementNode.children || targetElementNode.type !== 'JSXElement') {
          debug('[API Modify] Cannot modify text, invalid target node or no children');
          return false;
      }
      let modified = false;
      for (let i = 0; i < targetElementNode.children.length; i++) {
          const child = targetElementNode.children[i];
          if (child?.type === 'JSXText') {
              debug('[API Modify] Updating JSXText node', { before: child.value, after: newValue });
              child.value = newValue;
              child.raw = newValue; // Keep raw simple
              modified = true;
              break; // Modify first text child
          }
      }
      return modified;
  }

  export default function inlineEditPlugin() {
    debug('[INIT] Initializing inline edit plugin (Line/Col ID - Babel Transform)');
    return {
      name: 'vite-inline-edit-plugin',
      enforce: 'pre', 

      // --- Transform Hook (Uses Babel) --- 
      transform(code, id) {
          if (!/\.(jsx|tsx)$/.test(id) || !id.startsWith(VITE_PROJECT_ROOT) || id.includes('node_modules')) {
              return null;
          }
          const relativeFilePath = path.relative(VITE_PROJECT_ROOT, id);
          const webRelativeFilePath = relativeFilePath.split(path.sep).join('/');
          debug('[TRANSFORM] Processing file with Babel:', { path: webRelativeFilePath });

          try {
              const babelAst = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
              let attributesAdded = 0;
              traverseBabel(babelAst, {
                  JSXOpeningElement(path) {
                      const node = path.node;
                      if (node.loc && !node.attributes.some(a => t.isJSXAttribute(a) && a.name.name === 'data-edit-id')) {
                          const line = node.loc.start.line;
                          const column = node.loc.start.column + 1;
                          const editId = `${webRelativeFilePath}:${line}:${column}`;
                          const idAttribute = t.jsxAttribute(t.jsxIdentifier('data-edit-id'), t.stringLiteral(editId));
                          node.attributes.push(idAttribute);
                          attributesAdded++;
                          debug('[TRANSFORM Babel] Added ID', { editId });
                      }
                  }
              });
              if (attributesAdded === 0) return null; // Avoid regenerating if nothing changed

              debug('[TRANSFORM] Generating code with Babel...', { count: attributesAdded });
              const output = generate(babelAst, { sourceMaps: true, sourceFileName: webRelativeFilePath }, code);
              return { code: output.code, map: output.map }; 
          } catch (error) {
              debug('Error processing file with Babel:', error);
              return null;
          }
      },

      // --- Configure Server Hook (Uses SWC for modification) --- 
      configureServer(server) {
          debug('[SERVER] Configuring dev server middleware');
          server.middlewares.use('/api/apply-edit', async (req, res, next) => {
              if (req.method !== 'POST') return next();
              debug('[API /apply-edit] Request received');
              let body = '';
              req.on('data', chunk => { body += chunk.toString(); });
              req.on('end', async () => {
                  try {
                      const { editId, newValue } = JSON.parse(body);
                      if (!editId || newValue === undefined) {
                          res.writeHead(400, { 'Content-Type': 'application/json' });
                          return res.end(JSON.stringify({ error: 'Missing editId or newValue' }));
                      }
                      
                      const parsedId = parseEditId(editId);
                      if (!parsedId) {
                          res.writeHead(400, { 'Content-Type': 'application/json' });
                          return res.end(JSON.stringify({ error: 'Invalid editId format' }));
                      }
                      const { filePath, line, column } = parsedId;
                      
                      // --- Core Logic --- 
                      const absoluteFilePath = path.resolve(VITE_PROJECT_ROOT, filePath);
                      if (!absoluteFilePath.startsWith(VITE_PROJECT_ROOT)) {
                          res.writeHead(403, { 'Content-Type': 'application/json' });
                          return res.end(JSON.stringify({ error: 'Access denied' }));
                      }

                      const originalContent = await fs.readFile(absoluteFilePath, 'utf-8');
                      const swcAst = swc.parseSync(originalContent, { 
                          syntax: filePath.endsWith('.tsx') ? 'typescript' : 'ecmascript',
                          tsx: filePath.endsWith('.tsx'), jsx: !filePath.endsWith('.tsx'),
                          target: 'es2022'
                      });
                      
                      // Find the parent JSXElement node using line/col
                      const targetOpeningNode = findNodeByLineCol(swcAst, line, column, originalContent);
                      
                      // Need the parent JSXElement to modify children
                      // This requires a more complex find function or modifying findNodeByLineCol
                      // to return the parent.
                      // TODO: Enhance findNodeByLineCol or find parent after getting opening node.
                      let parentElementNode = null; // Placeholder
                      if (targetOpeningNode) { 
                          // Logic to find parent JSXElement from opening node needed!
                          // parentElementNode = findParentJsxElement(swcAst, targetOpeningNode); 
                          debug('[API /apply-edit] Found opening tag, need parent logic.');
                      }

                      if (!parentElementNode) {
                           debug('[API /apply-edit] Target element not found by line/col', { line, column });
                           res.writeHead(404, { 'Content-Type': 'application/json' });
                           return res.end(JSON.stringify({ error: 'Target element not found for modification.' }));
                      }

                      // Modify the text child of the found parent element
                      const modified = modifyJSXTextChild(parentElementNode, newValue);
                      if (!modified) {
                          debug('[API /apply-edit] Modification failed (no text child?)');
                          res.writeHead(409, { 'Content-Type': 'application/json' });
                          return res.end(JSON.stringify({ error: 'Target node found, but failed to modify text child.' }));
                      }
  
                      const printResult = swc.printSync(swcAst, { sourceMaps: false });
                      await fs.writeFile(absoluteFilePath, printResult.code, 'utf-8');
                      debug('[API /apply-edit] File updated successfully');
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ success: true, filePath }));
                  } catch (error) {
                      debug('Error processing edit request:', error);
                      res.writeHead(500, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({ error: 'Internal server error' }));
                  }
              });
          });
      }
    };
  }
  ```

- [ ] **Configure Vite (`vite.config.js`)**
  *(No changes needed here)*
  ```javascript
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import inlineEditPlugin from './vite-inline-edit-plugin';

  export default defineConfig({
    plugins: [
      inlineEditPlugin(),
      react()
    ],
    // Optional: Add server config if needed
    server: {
      port: parseInt(process.env.VITE_PORT || '5173'),
      strictPort: false,
      host: true
    }
  });
  ```

- [ ] **Create Client Listener (`src/inline-edit-listener.ts`)**
  **REVISED:** Simplified, sends line/col ID to `/api/apply-edit`.
  ```typescript
  // No SWC/Babel needed here
  const DEBUG = true;
  const debug = (message: string, data?: unknown): void => { /* ... */ };
  const PLUGIN_APPLY_EDIT_API_URL = '/api/apply-edit';

  // Parse filePath:line:column
  function parseEditId(editId: string): { filePath: string; line: number; column: number } | null {
      const parts = editId.split(':');
      if (parts.length < 3) return null;
      const column = parseInt(parts.pop(), 10);
      const line = parseInt(parts.pop(), 10);
      const filePath = parts.join(':');
      if (!filePath || isNaN(line) || isNaN(column)) return null;
      return { filePath, line, column };
  }

  export function initializeInlineEditListener(): () => void {
    debug('[INIT] Initializing inline edit listener (API Send Mode - Line/Col)');
    async function handleInlineEdit(event: Event): Promise<void> {
        if (!(event.target instanceof HTMLElement && event.target.isContentEditable)) return;
        const target = event.target;
        let element: HTMLElement | null = target;
        while (element && !element.hasAttribute('data-edit-id')) {
            element = element.parentElement;
        }
        if (!element) return;

        const editId = element.getAttribute('data-edit-id');
        const newValue = target.textContent || '';
        if (!editId) return;

        // Parse needed for debugging, optional otherwise
        const parsedId = parseEditId(editId);
        if (!parsedId) { 
             debug('[EVENT] Failed to parse editId', { editId }); 
             return; 
        }
        debug('[EVENT] Sending edit request', { editId, newValue });
        
        try {
            const response = await fetch(PLUGIN_APPLY_EDIT_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ editId, newValue }),
            });
            if (!response.ok) { /* ... handle error ... */ }
            const result = await response.json(); 
            debug('[API Res] Plugin apply-edit success', result);
        } catch (error) { /* ... handle error ... */ }
    }
    document.addEventListener('input', handleInlineEdit);
    return () => { document.removeEventListener('input', handleInlineEdit); };
  }
  ```

- [ ] **Modify `src/App.jsx`**
  *(No changes needed here)*
  ```jsx
  import React, { useEffect } from 'react';
  import { initializeInlineEditListener } from './inline-edit-listener';

  function App() {
    useEffect(() => {
      const cleanup = initializeInlineEditListener();
      return cleanup;
    }, []);

    return (
      <div>
        <h1 contentEditable="true" suppressContentEditableWarning={true}>
          Edit This Header!
        </h1>
        <p contentEditable="true" suppressContentEditableWarning={true}>
          Some editable paragraph text.
        </p>
      </div>
    );
  }
  
  export default App;
  ```

- [ ] **Run Preview Project**
  ```bash
  npm run dev
  ```

---

## Part 2: Frontend Project (Host Application)

- [ ] **Initialize Project**
  ```bash
  mkdir poc-frontend
  cd poc-frontend
  ```

- [ ] **Create `index.html`**
  *(No changes needed here)*
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Visual Editor PoC</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
      iframe { width: 100%; height: 600px; border: 1px solid #ccc; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Visual Editor Host</h1>
    <iframe id="preview-iframe" src="http://localhost:5173"></iframe>
    <script src="app.js"></script>
  </body>
  </html>
  ```

- [ ] **Create `app.js`**
  *(No changes needed here - still forwards { filePath, newContent })*
  ```javascript
  const BACKEND_EDIT_URL = 'http://localhost:3001/api/__edit'; // Adjust port if needed
  const statusIndicator = document.getElementById('status-indicator');
  const iframe = document.getElementById('preview-iframe');

  // Debug mode flag
  const DEBUG = true;
  const debug = (message, data = null) => { /* ... debug impl ... */ };
  // ... (logToPanel, updateStatus implementations) ...

  function handleIframeMessage(event) {
    // ... (Origin check remains the same) ...
    if (event.data.source === "react-devtools-content-script") return; // Ignore devtools messages

    debug('Message received from iframe', { origin: event.origin, data: event.data });

    const allowedOrigins = [ /* ... allowed origins ... */ ];
    if (!allowedOrigins.includes(event.origin)) {
       debug('Message rejected - origin mismatch', { received: event.origin, allowed: allowedOrigins });
       return;
    }

    if (event.data.type === 'inline-edit-request') {
      // NEW: Expecting { filePath, newContent }
      const { filePath, newContent } = event.data.payload;
      if (typeof filePath === 'string' && typeof newContent === 'string') {
        debug('Edit request identified', { filePath, contentLength: newContent.length });
        console.log('Edit request received for:', filePath);
        updateStatus('Edit request received');
        sendEditToBackend({ filePath, newContent }); // Send new payload format
      } else {
        debug('Invalid payload format received', event.data.payload);
      }
    } else {
       debug('Unknown message type ignored', { type: event.data.type });
    }
  }

  async function sendEditToBackend(payload) { // Payload is { filePath, newContent }
    debug('Sending edit to backend', { filePath: payload.filePath });
    try {
      const startTime = Date.now();
      // Using BACKEND_EDIT_URL
      const response = await fetch(BACKEND_EDIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload) // Send { filePath, newContent }
      });
      const responseTime = Date.now() - startTime;
      debug('Backend response received', { status: response.status, responseTimeMs: responseTime });

      if (!response.ok) {
        const errorData = await response.json();
        debug('Error response from backend', errorData);
        throw new Error(errorData.error || `Server returned ${response.status}`);
      }

      const responseData = await response.json();
      debug('Success response from backend', responseData);
      console.log('Edit successfully sent to backend');
      updateStatus('Edit applied successfully');
    } catch (error) {
      debug('Error sending edit to backend', { message: error.message, stack: error.stack });
      console.error('Failed to send edit to backend:', error);
      updateStatus(`Error: ${error.message}`, true);
    }
  }

  // ... (checkBackendStatus, iframe loading, initialization logic remains similar) ...
  // Ensure BACKEND_SOURCE_URL is also checked if needed by checkBackendStatus

  window.addEventListener('message', handleIframeMessage);
  // ... (iframe initialization, etc.) ...
  ```

- [ ] **Run Frontend Project**
  ```bash
  npx serve
  ```

---

## Part 3: Backend Project (Node.js)

- [ ] **Initialize Project**
  ```bash
  mkdir poc-backend
  cd poc-backend
  npm init -y
  npm install express cors fs-extra # No @swc/core needed here anymore
  ```

- [ ] **Create `server.js`**
  **REVISED:** Only contains the `/api/__edit` endpoint.
  ```javascript
  const express = require('express');
  const fs = require('fs-extra');
  const path = require('path');
  const cors = require('cors');

  const app = express();
  const PORT = process.env.PORT || 3001;
  const DEBUG = true;
  const debug = (message, data = null) => { /* ... debug impl ... */ };

  // Root needs to point to the *actual* preview project for writing files
  const SANDBOX_PROJECT_ROOT = path.resolve(__dirname, '../poc-preview');
  debug('Sandbox project root (for writing):', SANDBOX_PROJECT_ROOT);

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Endpoint to write file content
  app.post('/api/__edit', async (req, res) => {
    const { filePath, newContent } = req.body;
    debug('Edit request received', { filePath, contentLength: newContent?.length });

    if (!filePath || typeof filePath !== 'string' || newContent === undefined || typeof newContent !== 'string') {
       debug('Missing required fields', { filePathProvided: !!filePath, newContentProvided: newContent !== undefined });
       return res.status(400).json({ error: 'Missing required fields: filePath and newContent (string)' });
    }

    // Basic path sanitization
    if (filePath.includes('..')) {
       debug('Potential directory traversal attempt denied:', filePath);
       return res.status(400).json({ error: 'Invalid path' });
    }
    const absoluteFilePath = path.resolve(SANDBOX_PROJECT_ROOT, filePath);
    if (!absoluteFilePath.startsWith(SANDBOX_PROJECT_ROOT)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Write the file (same as before)
    try {
      await fs.writeFile(absoluteFilePath, newContent);
      debug('File written successfully', { path: absoluteFilePath });
      console.log(`Successfully updated ${filePath}`);
      res.status(200).json({ success: true });
    } catch (error) {
      debug('Error writing file:', error);
      console.error('Error processing edit request (write file):', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Status endpoint (optional but good for health checks)
  app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', service: 'file-writer', timestamp: new Date().toISOString() });
  });

  app.listen(PORT, () => {
    console.log(`Minimal Backend (File Writer) running at http://localhost:${PORT}`);
    debug('Minimal Backend server started');
  });
  ```

- [ ] **Run Backend Project**
  ```bash
  node server.js
  ```

---

## Testing Steps

1.  Run `npm install --save-dev @babel/parser @babel/traverse @babel/generator @babel/types`. Start Vite Dev Server and Backend.
2.  Open Frontend.
3.  Inspect editable elements. Verify `data-edit-id` has format `filePath:line:column`. Check if line/column numbers are correct.
4.  Edit text.
5.  Check Preview console: Listener should log the line/col ID and the request being sent to `/api/apply-edit`.
6.  Check Vite Server console: Plugin should log receipt of `/api/apply-edit` request, parsing of line/col ID. **Verify** the `findNodeByLineCol` logic finds the correct node and the `modifyJSXTextChild` updates it. Check for file write confirmation.
7.  Verify HMR update in Preview and that the change persists.

## Troubleshooting

-   **Babel Transform:** Ensure Babel dependencies are installed. Check Vite logs for errors during Babel parsing or generation in the `transform` hook.
-   **`data-edit-id` Format:** Verify the line/column numbers generated seem correct.
-   **`/api/apply-edit` Logic:**
    *   Check if the line/column ID is parsed correctly.
    *   **Crucially debug `findNodeByLineCol`:** Ensure it correctly calculates line/column from SWC offsets and matches the target. This is the most complex part.
    *   Ensure `modifyJSXTextChild` finds the text node within the element returned by `findNodeByLineCol`.
    *   Check for file read/write errors.
-   Console logs are key! 