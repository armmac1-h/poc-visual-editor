# Visual Editor Proof of Concept

This is a proof of concept for a visual inline editing feature using three separate services:

1. **Preview (Sandbox)**: A React + Vite application that allows content to be edited in-place
2. **Frontend (Host)**: A simple HTML/JS application that hosts the preview in an iframe
3. **Backend**: A Node.js service that processes edit requests and updates source files

## Project Structure

```
poc-visual-editor/
├── poc-preview/         # React + Vite app with content editable elements
├── poc-frontend/        # Static HTML/JS app that hosts the preview
├── poc-backend/         # Node.js API service with SWC code transformation
├── start-all.sh         # Helper script to start all services
├── project.md           # Project documentation and instructions
└── README.md            # This file
```

## Core Workflow

1. Edit content in the Preview iframe 
2. Preview sends a `postMessage` with `{id, value}` to the parent window
3. Frontend forwards this data to the Backend
4. Backend parses the ID, locates and modifies the file in the Preview project
5. Vite HMR automatically updates the Preview iframe

## Running the Projects

### Option 1: All at once

The easiest way to run all services is to use the helper script:

```bash
./start-all.sh
```

This will start all three services and open the Frontend in your browser.

### Option 2: Individually

You can also run each service separately in different terminal windows:

**Preview (React + Vite)**
```bash
cd poc-preview
npm run dev
```

**Backend (Node.js)**
```bash
cd poc-backend
npm run dev
```

**Frontend (Host)**
```bash
cd poc-frontend
npx serve
```

## Testing the Editor

1. Open the Frontend in your browser (typically http://localhost:3000)
2. Click on any of the editable text elements in the Preview iframe
3. Make changes to the text
4. Observe the following:
   - Browser console shows messages being sent
   - Backend console shows processing of the edit
   - The source files in the Preview project are updated
   - The Preview iframe updates via Vite's HMR

## Debugging Features

The system includes comprehensive debugging tools across all components:

### Frontend Debugging

- Visual debug panel at the bottom of the frontend page
- Detailed logging of all messaging events
- Status indicators for connection and operation status
- Backend health checks on startup

### Preview Debugging

- Console logs for all user interactions
- DOM mutation tracking
- Message flow tracing
- Element search path visualization

### Backend Debugging

- Detailed AST transformation logging
- Request processing visualization
- File operation tracking
- Error tracing with stack traces

### Vite Plugin Debugging

- JSX element transformation logging
- File processing statistics
- Error handling with detailed messages

To enable/disable debugging:

1. Set the `DEBUG` constant to `true` or `false` in each component:
   - Frontend: `poc-frontend/app.js`
   - Preview: `poc-preview/src/inline-edit-listener.ts`
   - Backend: `poc-backend/server.js`
   - Vite Plugin: `poc-preview/vite-inline-edit-plugin.js`

## Troubleshooting

- If you see CORS errors, make sure all three services are running
- Check browser console and server logs for detailed error messages
- Verify the Preview iframe is loading correctly
- Ensure editable elements have parent elements with `data-edit-id` attributes
- The backend `/api/status` endpoint can verify the backend is running correctly
- Check the debug panel in the Frontend for real-time error reporting 