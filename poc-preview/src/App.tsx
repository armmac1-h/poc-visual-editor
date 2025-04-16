import { useEffect } from 'react';
import './App.css';
import { initializeInlineEditListener } from './inline-edit-listener'; // Import the listener

function App() {
  useEffect(() => {
    const cleanup = initializeInlineEditListener();
    return () => {
      cleanup();
    };
  }, []);
  return <div className="container">
      <h1 contentEditable="true" suppressContentEditableWarning={true}>㉿🔐 🚩 </h1>
      <p contentEditable="true" suppressContentEditableWarning={true}>
        Some editable paragraph text.
      </p>
      <div className="card">
        <p contentEditable="true" suppressContentEditableWarning={true}>
          Edit me to see the changes in real-time.
        </p>
      </div>
    </div>;
}
export default App;