import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Spike root element is missing');

if (root.hasChildNodes()) {
  hydrateRoot(root, <App />);
  root.dataset.renderMode = 'hydration';
} else {
  createRoot(root).render(<App />);
  root.dataset.renderMode = 'client';
}
