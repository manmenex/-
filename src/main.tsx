import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { setStrictInvariants } from './core/settle';
import './styles.css';

// dev/test ให้ invariant ที่ผิดพลาด throw ทันที; production ให้ log แล้วไปต่อ
setStrictInvariants(import.meta.env.DEV);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
