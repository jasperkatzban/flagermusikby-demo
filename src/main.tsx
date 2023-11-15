import './index.css';
import { createApp } from './createApp';
import type { Engine } from './Engine';

let engine: Engine | null = null;

type Mouse = { x: number, y: number }

let mouse: Mouse = { x: 0, y: 0 }

document.addEventListener('DOMContentLoaded', () => {
  engine = createApp();
});

const onMouseMove = ((event: MouseEvent) => {
  event.preventDefault();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  if (engine) {
    engine.updateNavigation(mouse);
  }
})

const onMouseDown = ((event: MouseEvent) => {
  event.preventDefault();

  if (engine) {
    engine.fireClickEvent();
  }
})

// TODO: update 3d mouse position when zoom has changed
const onZoom = ((event: any) => {
})

document.addEventListener('mousemove', onMouseMove, false);
document.addEventListener('mousedown', onMouseDown, false);
document.addEventListener('scroll', onZoom, false);

// Handle hot reloading of the engine.
if (import.meta.hot) {
  import.meta.hot.accept('./createApp', module => {
    if (engine) {
      engine.detach();
      engine.dispose();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engine = (module as any).createApp();
  });
}

