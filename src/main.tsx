import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import './ui/styles/app.css';
import { App } from './ui/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
