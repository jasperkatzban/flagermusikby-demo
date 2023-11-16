import {
  Clock,
  Color,
  DirectionalLight,
  Mesh,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Vector3,
  Vector4,
  WebGLRenderer,
  ShaderMaterial,
  AudioListener,
  Vector2,
} from 'three';
import { getRapier, Rapier } from './physics/rapier';
import * as Stats from 'stats.js';

import { EventSource, ResourcePool } from './lib';

import { Wavefront, Map } from './lib';

import toonVertexShader from './shaders/toon.vert?raw'
import toonFragmentShader from './shaders/toon.frag?raw'

// Set up FPS stats
const stats = new Stats()
stats.showPanel(0)
document.body.appendChild(stats.dom)

/** Contains the three.js renderer and handles to important resources. */
export class Engine {
  public readonly scene = new Scene();
  public readonly camera: OrthographicCamera;
  public readonly renderer: WebGLRenderer;
  public readonly pool = new ResourcePool();
  public readonly viewPosition = new Vector3();
  public viewAngle = 0;
  public readonly update = new EventSource<{ update: number }>();

  public rapier!: Rapier;
  private physicsWorld?: World;
  private eventQueue: any;

  private mount: HTMLElement | undefined;
  private frameId: number | null = null;
  private clock = new Clock();

  public map: Map | undefined;
  public wavefronts: { [key: string]: Wavefront } = {};

  // Renderer setup
  private frustumSize = 50;
  private aspect = window.innerWidth / window.innerHeight;
  private sunlight: DirectionalLight;
  private cursorMesh?: Mesh;
  private cursorPos: Vector3;

  private viewOffset = new Vector2(0, 0);
  public mousePos = new Vector2(0, 0);

  // Audio Setup
  private listener: AudioListener;

  constructor() {
    // Set up renderer scene
    this.animate = this.animate.bind(this);
    this.camera = new OrthographicCamera(
      this.frustumSize * this.aspect / - 2,
      this.frustumSize * this.aspect / 2,
      this.frustumSize / 2,
      this.frustumSize / - 2, 0.1, 100
    );
    this.camera.position.set(0, 0, 1);
    this.camera.updateMatrixWorld();

    this.sunlight = this.createSunlight();
    this.renderer = this.createRenderer();

    this.map = undefined;

    this.cursorPos = new Vector3(0, 0, 0);

    // Set up audio listener
    this.listener = new AudioListener();
    this.camera.add(this.listener);
  }

  /** Shut down the renderer and release all resources. */
  public dispose() {
    this.pool.dispose();
  }

  /** Attach the renderer to the DOM. */
  public async attach(mount: HTMLElement) {
    this.mount = mount;
    window.addEventListener('resize', this.onWindowResize.bind(this));
    mount.appendChild(this.renderer.domElement);
    this.onWindowResize();

    // Make sure physics WASM bundle is initialized before starting rendering loop.
    // Physics objects cannot be created until after physics engine is initialized.
    const r = (this.rapier = await getRapier());

    // Create physics
    const gravity = { x: 0, y: 0 };
    this.physicsWorld = new r.World(gravity);
    // To avoid leaking WASM resources, this MUST be freed manually with eventQueue.free() once you are done using it.
    this.eventQueue = new r.EventQueue(true);

    // Create cursor
    const cursorMaterial = new ShaderMaterial({
      uniforms: {
        color:
          { value: new Vector4(1.0, 1.0, 1.0, 1.0) }
      },
      vertexShader: toonVertexShader,
      fragmentShader: toonFragmentShader,
    })
    const cursorGeometry = new SphereGeometry(.4, 5);
    this.cursorMesh = new Mesh(cursorGeometry, cursorMaterial);
    this.scene.add(this.cursorMesh)

    // Add world map
    this.map = new Map(this.rapier, this.physicsWorld, this.scene);

    if (!this.frameId) {
      this.clock.start();
      this.frameId = requestAnimationFrame(this.animate);
    }
  }

  /** Detach the renderer from the DOM. */
  public detach() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.mount?.removeChild(this.renderer.domElement);
  }

  /** Update the positions of any moving objects. */
  public updateScene(deltaTime: number) {
    // Run callbacks.
    this.update.emit('update', deltaTime);

    // Run physics 
    this.physicsWorld?.step(this.eventQueue);

    // Check for collision events
    this.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
      this.map?.checkCollisionEvents(handle1, handle2);
      for (const [key, wavefront] of Object.entries(this.wavefronts)) {
        wavefront.checkCollisionEvents(handle1, handle2);
      }
    });

    // Update environment and wavefronts
    this.map?.update()

    for (const [key, wavefront] of Object.entries(this.wavefronts)) {
      wavefront.update();
      if (wavefront.age > wavefront.lifespan) {
        wavefront.remove();
        delete this.wavefronts[key];
      }
    }

    // Update camera and cursor positions
    this.updateCameraPos();
  }

  public updateNavigation(mouse: { x: number, y: number }) {
    this.mousePos.set(mouse.x, mouse.y);
  }

  public updateCameraPos() {
    // Make the camera follow the cursor with damping
    const acceleration = this.mousePos.length() ** 4;
    const normal = this.mousePos.clone().normalize().multiplyScalar(acceleration * 10)
    this.viewOffset.add(normal);

    // Add a subtle pan depending on where the cursor is
    const mousePosWorld = new Vector2(this.mousePos.x * window.innerWidth / 8, this.mousePos.y * window.innerHeight / 8);
    const swayOffset = mousePosWorld.add(this.viewOffset.clone().negate()).multiplyScalar(.1);

    // Adjust camera offset to simulate panning
    this.camera.setViewOffset(window.innerWidth, window.innerHeight, this.viewOffset.x + swayOffset.x, -this.viewOffset.y - swayOffset.y, window.innerWidth, window.innerHeight)
    this.camera.updateProjectionMatrix();

    // Move the game cursor and offset its position to account for damping
    let zoomFactor = .5 / this.camera.zoom * this.frustumSize;
    this.cursorPos = new Vector3((this.mousePos.x * this.aspect + (this.viewOffset.x + swayOffset.x) / 395) * zoomFactor, (this.mousePos.y + (this.viewOffset.y + swayOffset.y) / 395) * zoomFactor, 0.0);
    this.cursorMesh?.position.copy(this.cursorPos);
  }

  public fireClickEvent() {
    const lifespan = 5;
    const wavefront = new Wavefront(lifespan, this.rapier, this.physicsWorld, this.scene, this.listener, this.cursorPos);
    this.wavefronts[this.time.toString()] = wavefront
  }

  /** Return the elapsed running time. */
  public get time(): number {
    return this.clock.elapsedTime;
  }

  private animate() {
    const deltaTime = Math.min(this.clock.getDelta(), 0.1);
    this.updateScene(deltaTime);
    this.render();
    this.frameId = window.requestAnimationFrame(this.animate);
    stats.update()
  }

  /** Render the scene. */
  public render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Handle window resize event. */
  private onWindowResize() {
    if (this.mount) {
      const width = this.mount.clientWidth;
      const height = this.mount.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.renderer.render(this.scene, this.camera);
    }
  }

  private createRenderer() {
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = false;
    return renderer;
  }

  private createSunlight() {
    const sunlight = new DirectionalLight(new Color('#ffffff').convertSRGBToLinear(), 0.4);
    sunlight.position.set(0, 1, 1);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.width = 1024;
    sunlight.shadow.mapSize.height = 1024;
    sunlight.shadow.camera.near = 1;
    sunlight.shadow.camera.far = 32;
    sunlight.shadow.camera.left = -15;
    sunlight.shadow.camera.right = 15;
    sunlight.shadow.camera.top = 15;
    sunlight.shadow.camera.bottom = -15;
    this.scene.add(sunlight);
    return sunlight;
  }
}
