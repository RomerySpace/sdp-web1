import { App } from './core/App';
import './styles/main.css';

const container = document.querySelector<HTMLElement>('#app')!;

try {
  const app = new App(container);
  if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
} catch (error) {
  console.error('[SDP] The exhibition could not initialize.', error);
  container.replaceChildren();
  const message = document.createElement('div');
  message.className = 'graphics-fallback';
  message.innerHTML = '<h1>SDP</h1><p>This space needs WebGL 2.</p><p>Please enable hardware acceleration or try another desktop browser.</p>';
  container.append(message);
}
