const BACKEND_URL = 'http://localhost:3001/api/__edit';
const statusIndicator = document.getElementById('status-indicator');

// Debug mode flag
const DEBUG = true;

// Debug logger function
const debug = (message, data = null) => {
  if (!DEBUG) return;

  const timestamp = new Date().toISOString();
  const formattedMessage = `[Frontend Debug ${timestamp}] ${message}`;

  if (data) {
    console.log(formattedMessage, data);
  } else {
    console.log(formattedMessage);
  }
};

// Add a debug panel if in debug mode
if (DEBUG) {
  const debugPanel = document.createElement('div');
  debugPanel.id = 'debug-panel';
  debugPanel.style.cssText = 'position: fixed; bottom: 0; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: #f0f0f0; border-top: 1px solid #ccc; padding: 10px; font-family: monospace; font-size: 12px;';

  const debugHeader = document.createElement('div');
  debugHeader.textContent = 'Debug Console';
  debugHeader.style.fontWeight = 'bold';
  debugPanel.appendChild(debugHeader);

  const debugLog = document.createElement('div');
  debugLog.id = 'debug-log';
  debugPanel.appendChild(debugLog);

  // Add to DOM after page loads
  window.addEventListener('load', () => {
    document.body.appendChild(debugPanel);
    logToPanel('Debug panel initialized');
  });

  // Override console.log to also log to panel
  const originalConsoleLog = console.log;
  console.log = function () {
    originalConsoleLog.apply(console, arguments);
    const args = Array.from(arguments);
    logToPanel(args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' '));
  };
}

function logToPanel(message) {
  if (!DEBUG) return;

  const debugLog = document.getElementById('debug-log');
  if (debugLog) {
    const entry = document.createElement('div');
    entry.textContent = message;
    debugLog.appendChild(entry);
    debugLog.scrollTop = debugLog.scrollHeight;
  }
}

function updateStatus(message, isError = false) {
  debug('Status update', { message, isError });

  statusIndicator.textContent = message;
  statusIndicator.className = `status ${isError ? 'error' : 'success'}`;

  // Reset after 3 seconds
  setTimeout(() => {
    statusIndicator.textContent = 'Ready';
    statusIndicator.className = 'status';
    debug('Status reset to Ready');
  }, 3000);
}

function handleIframeMessage(event) {
  if (event.data.source === "react-devtools-content-script") {
    return;
  }

  debug('Message received from iframe', {
    origin: event.origin,
    data: event.data,
    expectedOrigin: 'http://localhost:5173'
  });

  // Security check - only accept messages from our iframe (allow both ports 5173 and 3000)
  if (event.origin !== 'http://localhost:5173' && event.origin !== 'http://localhost:3000') {
    debug('Message rejected - origin mismatch', { received: event.origin });
    return;
  }

  // Check for inline edit requests
  if (event.data.type === 'editApplied') {
    debug('Edit request identified', event.data.payload);
    console.log('Edit request received:', event.data.payload);
    updateStatus('Edit request received');
    sendEditToBackend(event.data.payload);
  }
}

async function sendEditToBackend(payload) {
  debug('Sending edit to backend', payload);

  try {
    const startTime = Date.now();
    debug('Fetching from backend', { url: BACKEND_URL, method: 'POST' });

    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseTime = Date.now() - startTime;
    debug('Backend response received', {
      status: response.status,
      statusText: response.statusText,
      responseTimeMs: responseTime
    });

    if (!response.ok) {
      const errorData = await response.json();
      debug('Error response from backend', errorData);
      throw new Error(errorData.error || `Server returned ${response.status}: ${response.statusText}`);
    }

    const responseData = await response.json();
    debug('Success response from backend', responseData);

    console.log('Edit successfully sent to backend');
    updateStatus('Edit applied successfully');
  } catch (error) {
    debug('Error sending edit to backend', {
      message: error.message,
      stack: error.stack
    });
    console.error('Failed to send edit to backend:', error);
    updateStatus(`Error: ${error.message}`, true);
  }
}

// Monitor backend health
async function checkBackendStatus() {
  try {
    debug('Checking backend status');
    const response = await fetch('http://localhost:3001/api/status');

    if (response.ok) {
      const data = await response.json();
      debug('Backend status', data);
      return true;
    } else {
      debug('Backend status check failed', {
        status: response.status,
        statusText: response.statusText
      });
      return false;
    }
  } catch (error) {
    debug('Backend unreachable', { message: error.message });
    return false;
  }
}

// Listen for messages from the iframe
window.addEventListener('message', handleIframeMessage);
debug('Message event listener registered');

// Show initial connection status
const iframe = document.getElementById('preview-iframe');
iframe.onload = async () => {
  debug('Preview iframe loaded');
  updateStatus('Preview connected');

  // Check backend status
  const backendAvailable = await checkBackendStatus();
  debug('Backend status check completed', { available: backendAvailable });

  if (!backendAvailable) {
    updateStatus('Warning: Backend service unavailable', true);
  }
};

debug('Frontend app initialized'); 