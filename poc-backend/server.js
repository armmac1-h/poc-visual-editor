const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const swc = require('@swc/core');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Debug mode flag
const DEBUG = true;

// Debug logger function
const debug = (message, data = null) => {
  if (!DEBUG) return;

  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[DEBUG ${timestamp}] ${message}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(`[DEBUG ${timestamp}] ${message}`);
  }
};

// Adjust this to point to your poc-preview project directory
const SANDBOX_PROJECT_ROOT = path.resolve(__dirname, '../poc-preview');
debug('Sandbox project root:', SANDBOX_PROJECT_ROOT);

// Middleware
app.use(cors());
app.use(express.json());

// Parse editId string into file path and location
function parseEditId(editId) {
  const [filePath, line, column] = editId.split(':');
  const result = {
    filePath,
    loc: {
      line: parseInt(line, 10),
      column: parseInt(column, 10)
    }
  };
  debug('Parsed editId:', result);
  return result;
}

// API endpoint for handling inline edits
app.post('/api/__edit', async (req, res) => {
  debug('Received edit request:', req.body);

  try {
    const { editId, newValue } = req.body;

    console.log(`Processing edit: ${editId} -> "${newValue}"`);

    res.status(200).json({ success: true });

  } catch (error) {
    debug('Error in edit handler:', error.stack || error);
    console.error('Error processing edit request:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a debug endpoint to check server status
app.get('/api/status', (req, res) => {
  debug('Status request received');

  const status = {
    status: 'ok',
    sandboxPath: SANDBOX_PROJECT_ROOT,
    exists: fs.existsSync(SANDBOX_PROJECT_ROOT),
    timestamp: new Date().toISOString(),
    debugMode: DEBUG
  };

  debug('Sending status response', status);
  res.json(status);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Backend server running at http://localhost:${PORT}`);
  console.log(`Sandbox root: ${SANDBOX_PROJECT_ROOT}`);
  debug('Server started with debug logging enabled');
}); 