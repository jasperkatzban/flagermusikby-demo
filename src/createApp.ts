import './index.css';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Engine } from './Engine';

export function createApp() {
  const engine = new Engine();
  const renderElt = document.getElementById('root')!;

  engine.attach(renderElt);

  const orbitControls = new OrbitControls(engine.camera, renderElt);
  orbitControls.listenToKeyEvents(renderElt); // optional

  orbitControls.enableDamping = true; // an animation loop is required when either damping or auto-rotation are enabled
  orbitControls.enableRotate = false;
  orbitControls.dampingFactor = 0.05;
  orbitControls.screenSpacePanning = false;
  // orbitControls.zoomToCursor = false;

  orbitControls.update();
  engine.update.subscribe('update', () => {
    orbitControls.update();
  });

  return engine;
}
