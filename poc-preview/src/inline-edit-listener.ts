// No SWC import needed here anymore!
// import * as swc from '@swc/core';

const DEBUG = true;
const debug = (message: string, data?: unknown): void => {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const prefix = `[Listener Debug ${timestamp}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
};

// New API endpoint for sending edits TO the plugin
const PLUGIN_APPLY_EDIT_API_URL = '/api/apply-edit';

// Parses "filePath:startOffset:endOffset"
// (Keeping this helper here as it's simple and relates to the ID format)
function parseEditId(editId: string): { filePath: string; startOffset: number; endOffset: number } | null {
  const parts = editId.split(':');
  if (parts.length < 3) {
    debug('[PARSE] Failed: Incorrect number of parts', { editId });
    return null;
  }
  
  const endOffsetStr = parts.pop();
  const startOffsetStr = parts.pop();
  const filePath = parts.join(':');

  if (typeof startOffsetStr !== 'string' || typeof endOffsetStr !== 'string') {
    debug('[PARSE] Failed: Offset strings are undefined', { editId });
    return null;
  }

  const startOffset = parseInt(startOffsetStr, 10);
  const endOffset = parseInt(endOffsetStr, 10);

  if (!filePath || isNaN(startOffset) || isNaN(endOffset)) {
    debug('[PARSE] Failed: Invalid format or NaN offset', { editId, filePath, startOffset, endOffset });
    return null;
  }

  return {
    filePath,
    startOffset,
    endOffset, 
  };
}

// Removed: findAndModifyJSXText (moved to plugin)
// Removed: fetchSourceCode (plugin reads file directly)

export function initializeInlineEditListener(): () => void {
  debug('[INIT] Initializing inline edit listener (API Send Mode)');

  async function handleInlineEdit(event: Event): Promise<void> {
    if (!(event.target instanceof HTMLElement && event.target.isContentEditable)) {
      return;
    }
    const target = event.target;
    debug('[EVENT] Input detected', { target: target.tagName });

    let element: HTMLElement | null = target;
    let searchDepth = 0;
    while (element && !element.hasAttribute('data-edit-id')) {
      element = element.parentElement;
      searchDepth++;
      if (searchDepth > 10) {
        debug('[EVENT] Search depth exceeded for data-edit-id');
        element = null;
        break;
      }
    }

    if (!element) {
      debug('[EVENT] No element with data-edit-id found');
      return;
    }

    const editId = element.getAttribute('data-edit-id');
    const newValue = target.textContent || '';
    
    // We still need the ID to send to the plugin
    if (!editId) {
      debug('[EVENT] editId attribute is missing or empty');
      return;
    }

    // Note: We don't strictly *need* to parse the ID here anymore, 
    // but it can be useful for debugging before sending.
    const parsedId = parseEditId(editId);
    if (!parsedId) {
        debug('[EVENT] Failed to parse editId before sending', { editId });
        return; // Don't send if invalid
    }

    debug('[EVENT] Sending edit request to plugin', { editId, newValue });

    try {
      // Step: Send { editId, newValue } to the plugin API
      const response = await fetch(PLUGIN_APPLY_EDIT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ editId, newValue }),
      });

      debug('[API Res] Plugin apply-edit response status:', response.status);

      if (!response.ok) {
        let errorText = `Plugin API Error (${response.status})`;
        try { 
            const errorJson = await response.json(); 
            errorText = errorJson.error || JSON.stringify(errorJson);
        } catch { 
            errorText = await response.text(); 
        } 
        throw new Error(errorText);
      }

      // Response from plugin isn't strictly needed for HMR flow, but useful for status
      const result = await response.json(); 
      debug('[API Res] Plugin apply-edit success', result);
      // Optionally update UI to show success/failure
      
      // Send message to the parent window (poc-frontend)
      window.parent.postMessage(
        { 
          type: 'editApplied', 
          payload: {
            editId,
            newValue: result.newContent 
          } 
        }, 
        'http://localhost:3000' // Target origin for security
      );

    } catch (error) {
      debug('[API Res] Error sending edit request to plugin', {
         message: error instanceof Error ? error.message : String(error),
      });
      // Optionally update UI to show error
    }
  }

  document.addEventListener('input', handleInlineEdit);
  debug('[INIT] Input event listener registered');

  return () => {
    document.removeEventListener('input', handleInlineEdit);
    debug('[INIT] Inline edit listener and WebSocket connection removed');
  };
} 